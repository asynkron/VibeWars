// The command/gene layer of the search-based AI. A Gene is one unit's
// intended action; a candidate plan is an ordered list of genes (one per
// AI unit). applyGene() validates the gene against the CURRENT branch
// state and records the resulting facts as events -- it is the only layer
// that decides outcomes (deaths, craters); SimState.apply stays mechanical.
//
// Design notes:
//   - Genes are cheap data, safe to mutate/copy during hillclimbing. The
//     seed drives all per-gene randomness (rocket scatter, random moves),
//     so a plan evaluates identically every time.
//   - moveTowards picks the best REACHABLE hex closest to the target
//     (the old dead AI pathed straight at the enemy's own occupied hex,
//     which the occupied-skip rule makes unreachable -- so it never moved).
//   - unitMoved events carry moveSpent, and applyGene reads the current
//     branch state, so multiple genes for the same unit compose correctly
//     against its shrinking movement budget (another old-AI bug: moves
//     never deducted movement points).

import * as HexCoord from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { SimState, SimUnit } from './SimState';
import { simDijkstra, simCostFieldFrom, simPath } from './SimPathfinding';
import { resolveAttack, mulberry32, combineSeed } from './resolveAttack';
import { burningTilesOf, firePathDamage, tickFires } from '../../shared/hexengine/fire';

export type BuiltinGeneKind =
    | 'moveTowards' | 'moveAway' | 'moveRandom' | 'moveToBuilding' | 'standoff' | 'attack' | 'idle';

// An engine may register gene kinds of its own, so the kind is not a closed
// union. `string & {}` keeps editor completion for the builtins while still
// admitting a custom name.
export type GeneKind = BuiltinGeneKind | (string & {});

export interface Gene {
    kind: GeneKind;
    unitIndex: number;
    targetIndex?: number;   // enemy unit index for moveTowards/moveAway/attack
    buildingIndex?: number; // building index for moveToBuilding
    // Which of the unit's skills this gene uses. Absent means its primary
    // attack -- what every gene meant before skills existed, and what
    // keeps today's plans byte-identical.
    //
    // A PARAMETER of the existing genes rather than a gene kind per skill,
    // and that is a branching-factor decision. randomGene's roulette table
    // stays the same size; a unit with one attack has no choice to make and
    // consumes no extra rng() draw, which matters because an extra draw
    // would shift the random stream for all nine engines at once and every
    // determinism test would shift with it, catching nothing.
    skillId?: string;
    seed: number;           // drives scatter + random-move picks
}

// A gene kind contributed by an engine rather than built in here.
export interface GeneDefinition {
    // Apply it to the branch. Same contract as the builtin cases: validate
    // against the CURRENT state, record events, return whether it acted.
    // MUST route any movement through recordSimMove, or captures are lost.
    apply(state: SimState, gene: Gene): boolean;
    // Optional guard consulted by randomGene: when it returns false the roll
    // falls back to moveTowards, exactly like the builtin moveToBuilding and
    // standoff guards. Without it the kind is always considered rollable.
    applicable?(state: SimState, unitIndex: number): boolean;
}

// How an engine generates and applies genes. Everything an engine may want
// to differ on lives here; DEFAULT_DIALECT reproduces the hardcoded
// behaviour these values replaced.
export interface GeneDialect {
    // Roulette table for randomGene. Weights are consumed in order and
    // should sum to <= 1; whatever is left over falls through to 'idle'.
    weights: ReadonlyArray<readonly [GeneKind, number]>;
    // Custom kinds, keyed by the name used in `weights` and Gene.kind.
    extras: Readonly<Record<string, GeneDefinition>>;
    // Probability that a generated gene aims at the WEAKEST legal target
    // instead of a uniformly random enemy. The random remainder is what
    // keeps exploration alive for the hillclimber.
    focusFireChance: number;
    sweep: SweepTuning;
}

// Tuning for the post-plan attack sweep (see sweepAttacks).
export interface SweepTuning {
    // Added to a shot's value when the damage would finish the target off.
    killBonus: number;
    // Multiplier applied to splash damage landing on OWN units, subtracted
    // from the shot's value.
    friendlyFirePenalty: number;
}

function unitCanCapture(unit: SimUnit): boolean {
    return !!UnitSystem.unitTypesRecord[unit.type]?.canCapture;
}

// A building this unit's side could take: still standing, not already
// owned by them, and reachable through a door. A composite's walls are
// skipped -- marching infantry at the back of a depot it can never enter
// is the failure this filter exists to prevent. (Whether it still holds a
// prize is invisible here -- the score layer decides what a capture is
// worth.)
export function nearestCapturableBuildingIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [i, building] of state.liveBuildings()) {
        if (!building.isEntrance) continue;
        if (building.ownerIndex === unit.playerIndex) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, building.q, building.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

export function nearestEnemyIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [i, other] of state.activeUnits()) {
        if (other.playerIndex === unit.playerIndex) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, other.q, other.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// Begin a turn: the unit reset, and the wildfire.
//
// THE ONLY WAY A SIMULATED TURN SHOULD START. Four places used to record a
// bare turnStarted -- the cheap rollout, the deep rollout, the beam's
// per-child reset and the headless match loop -- and fire has to be rolled
// at every one of them or the AI searches a game where fires never spread.
// Collecting them here is the same move skillCost() made for skill costs.
//
// The rng is an ARGUMENT because each of those callers already owns a
// seeded stream, and because the beam's children are evaluated on worker
// threads whose results are merged as though they were comparable. A
// Math.random() in this path would make a plan depend on which core ran it.
export function startTurn(state: SimState, playerIndex: number, rng: () => number): void {
    state.record({ type: 'turnStarted', playerIndex });

    // Rolled here, in the command layer, and recorded as the outcome --
    // apply() must stay mechanical, and a beam node replayed on another
    // thread must rebuild the same board rather than re-throw the dice.
    const burning = burningTilesOf(state.fireView, state.cols, state.rows);
    if (burning.length === 0) return;
    const tick = tickFires(state.fireView, burning, rng);
    state.record({ type: 'fireTicked', ignited: tick.ignited, burnedOut: tick.burnedOut });
}

// A death, cargo included.
//
// A transport takes its passengers down with it. Without that a loaded APC
// is an invulnerable warehouse: getUnitAt hides the cargo from every shot,
// so nothing else can ever reach it. Making the ride a real risk is what
// lets the beam weigh it against the mobility rather than treating loading
// as free.
//
// It lives in one function because it did not: the damage path cascaded and
// the drowning path did not, so sinking the ground under a transport left
// its passengers alive, riding a corpse, at coordinates that no longer
// updated. Every death in this file goes through here.
//
// Derived at the command layer like every other death -- apply() stays
// mechanical.
function recordDeath(state: SimState, unitIndex: number): void {
    state.record({ type: 'unitDied', unitIndex });
    for (const [index, rider] of state.liveUnits()) {
        if (rider.carriedBy === unitIndex) {
            state.record({ type: 'unitDied', unitIndex: index });
        }
    }
}

// Nearest enemy this unit is ALLOWED to shoot (respects the class
// targeting rule: artillery/infantry can't touch air).
export function nearestTargetableEnemyIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [i, other] of state.activeUnits()) {
        if (other.playerIndex === unit.playerIndex) continue;
        if (!UnitSystem.canTarget(unit.type, other.type)) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, other.q, other.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// Focus fire (the HeroesOfBlazor lesson): the most VALUABLE target is the
// weakest one -- finishing a damaged unit removes its whole material value
// from the board, while spreading damage removes nothing. Lowest hp wins;
// distance breaks ties. Only targets this unit may legally shoot.
export function weakestTargetableEnemyIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestHp = Infinity;
    let bestDist = Infinity;
    for (const [i, other] of state.activeUnits()) {
        if (other.playerIndex === unit.playerIndex) continue;
        if (!UnitSystem.canTarget(unit.type, other.type)) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, other.q, other.r);
        if (other.hp < bestHp || (other.hp === bestHp && dist < bestDist)) {
            bestHp = other.hp;
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// Resolve the gene's target: an explicitly set live enemy, else the
// nearest (targetable one for genes that end in shooting).
function resolveTargetIndex(state: SimState, unitIndex: number, gene: Gene): number | null {
    const unit = state.getUnit(unitIndex)!;
    if (gene.targetIndex !== undefined) {
        const target = state.getUnit(gene.targetIndex);
        if (target && target.playerIndex !== unit.playerIndex) return gene.targetIndex;
    }
    if (gene.kind === 'attack' || gene.kind === 'standoff') {
        return nearestTargetableEnemyIndex(state, unitIndex);
    }
    return nearestEnemyIndex(state, unitIndex);
}

// The single write path for simulated movement: records the move and
// derives the capture fact when a canCapture unit ends up on a building
// its side doesn't own. Mirrors the live rule (BuildingSystem.tryCapture
// hooked into UnitSystem.move) so sim and reality agree on when captures
// happen. No unit is spawned here -- the factory's content is hidden, so
// the sim only records the capture and lets score.ts value it.
export function recordSimMove(state: SimState, unitIndex: number, toQ: number, toR: number, moveSpent: number): void {
    // Charged BEFORE the move is recorded, because the route is worked out
    // from where the unit is standing NOW. Afterwards it is already at the
    // far end and the path it took is gone.
    chargeFireDamage(state, unitIndex, toQ, toR);

    state.record({ type: 'unitMoved', unitIndex, toQ, toR, moveSpent });
    const unit = state.getUnit(unitIndex);
    if (!unit || !unitCanCapture(unit)) return;
    const found = state.getBuildingAt(toQ, toR);
    // isEntrance is the door rule: a composite is taken only from the piece
    // that has one. Standing on its back or side wall is just standing on a
    // tile.
    if (found && found[1].isEntrance && found[1].ownerIndex !== unit.playerIndex) {
        state.record({ type: 'buildingCaptured', buildingIndex: found[0], playerIndex: unit.playerIndex });
    }
}

// A unit pays for every burning tile it walks into.
//
// Behind state.hasFire, which is free when nothing is alight -- i.e. on
// almost every board almost all of the time. Only when there IS a fire does
// this reconstruct the route, and it has to reconstruct it: unitMoved
// carries the destination alone, so the tiles crossed are not in the event.
//
// The DAMAGE is recorded, not the path. That keeps the log small and, more
// importantly, keeps it a statement of fact -- the live game replays the
// number rather than re-walking a route it might route differently.
function chargeFireDamage(state: SimState, unitIndex: number, toQ: number, toR: number): void {
    if (!state.hasFire) return;
    const unit = state.getUnit(unitIndex);
    if (!unit) return;

    const route = simPath(state, unitIndex, toQ, toR);
    if (!route) return;

    const flies = UnitSystem.unitTypesRecord[unit.type]?.unitClass === 'air';
    const damage = firePathDamage(state.fireView, route.path, flies);
    if (damage <= 0) return;

    state.record({ type: 'unitBurned', unitIndex, damage });
    // Death is explicit and comes from the command layer, exactly as it does
    // for an attack -- and through recordDeath, so a transport that burns to
    // death still takes its passengers with it.
    const after = state.getUnit(unitIndex);
    if (after && after.hp <= 0) recordDeath(state, unitIndex);
}

// Apply one gene to the branch, recording events. Returns true if any
// event was recorded. `extras` supplies any engine-registered kinds; an
// unknown kind is a no-op rather than an error, so a plan carried between
// engines degrades instead of throwing.
export function applyGene(
    state: SimState,
    gene: Gene,
    extras: Readonly<Record<string, GeneDefinition>> = {}
): boolean {
    const unit = state.getUnit(gene.unitIndex);
    if (!unit) return false;

    switch (gene.kind) {
        case 'idle':
            return false;

        case 'attack': {
            if (unit.hasAttacked) return false;
            const targetIndex = resolveTargetIndex(state, gene.unitIndex, gene);
            if (targetIndex === null) return false;
            const target = state.getUnit(targetIndex)!;

            const dist = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
            if (dist < unit.minRange || dist > unit.maxRange) return false;

            // Class targeting rule: artillery/infantry can't attack air.
            if (!UnitSystem.canTarget(unit.type, target.type)) return false;

            const resolved = resolveAttack(state, gene.unitIndex, targetIndex, gene.seed, gene.skillId);
            if (!resolved || resolved.hits.length === 0) return false;

            for (const hit of resolved.hits) {
                state.record({
                    type: 'unitAttacked',
                    attackerIndex: gene.unitIndex,
                    defenderIndex: hit.unitIndex,
                    damage: hit.damage,
                    // Named only when it is NOT the primary attack. The
                    // event log is hashed verbatim by the neutrality
                    // fixture, so writing the primary's id into every
                    // attack would move all eight digests and throw away
                    // the comparison that proves this migration is
                    // behaviour-neutral -- for a field that carries no
                    // information, since absent already means primary.
                    ...(gene.skillId ? { skillId: gene.skillId } : {}),
                });
                const victim = state.getUnit(hit.unitIndex);
                if (victim && victim.hp <= 0) {
                    recordDeath(state, hit.unitIndex);
                }
            }
            for (const impact of resolved.impacts) {
                if (impact.craterDelta === 0) continue; // volley rockets: visual only
                const before = state.getTile(impact.q, impact.r);
                state.record({ type: 'terrainModified', q: impact.q, r: impact.r, delta: impact.craterDelta });
                const after = state.getTile(impact.q, impact.r);
                // Drowning: a tile that just sank into WATER takes any
                // land unit standing on it down with it. Plums.
                if (before && before.type !== 'WATER' && after && after.type === 'WATER') {
                    const standing = state.getUnitAt(impact.q, impact.r);
                    if (standing && UnitSystem.unitTypesRecord[standing[1].type].terrainCosts.WATER == null) {
                        recordDeath(state, standing[0]);
                    }
                }
            }
            return true;
        }

        case 'moveTowards':
        case 'moveAway': {
            if (unit.move <= 0) return false;
            const targetIndex = resolveTargetIndex(state, gene.unitIndex, gene);
            if (targetIndex === null) return false;
            const target = state.getUnit(targetIndex)!;

            // moveAway flees WITH PURPOSE (the HeroesOfBlazor lesson):
            // best is a hex the threat cannot even reach next turn
            // (distance > its move + max range); only if no such hex is
            // reachable fall back to plain distance-maximizing.
            const threatStats = UnitSystem.unitTypesRecord[target.type];
            const safeDist = threatStats.move + threatStats.maxRange;

            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: string | null = null;
            let bestDist = gene.kind === 'moveTowards'
                ? HexCoord.getDistance(unit.q, unit.r, target.q, target.r)
                : -Infinity;
            let bestCost = Infinity;
            let bestSafe = gene.kind === 'moveAway'
                && HexCoord.getDistance(unit.q, unit.r, target.q, target.r) > safeDist;

            for (const key of reachable) {
                const [q, r] = key.split(',').map(Number);
                if (q === unit.q && r === unit.r) continue;
                const dist = HexCoord.getDistance(q, r, target.q, target.r);
                const cost = distances.get(key)!;
                let better: boolean;
                if (gene.kind === 'moveTowards') {
                    better = dist < bestDist || (dist === bestDist && cost < bestCost && bestKey !== null);
                } else {
                    const safe = dist > safeDist;
                    // Safe beats unsafe; among safe hexes prefer CHEAP
                    // (don't waste movement running further than needed);
                    // among unsafe prefer far.
                    better = (safe && !bestSafe)
                        || (safe && bestSafe && (cost < bestCost || (cost === bestCost && dist > bestDist)))
                        || (!safe && !bestSafe && (dist > bestDist || (dist === bestDist && cost < bestCost && bestKey !== null)));
                    if (better) bestSafe = safe;
                }
                if (better) {
                    bestDist = dist;
                    bestCost = cost;
                    bestKey = key;
                }
            }

            // Nothing strictly better by hex distance. For moveAway that
            // genuinely means stay; for moveTowards it usually means the
            // unit is standing behind something.
            //
            // THE GREEDY RULE HAS A DEAD END, and it is not a corner case.
            // A hex-distance test can only accept a step that shortens the
            // straight line, so a unit whose route runs AROUND a ridge or a
            // lake stops at the obstacle and never moves again -- the first
            // step around is farther away, so it is refused, and next turn
            // looks identical. Measured on the shipped 12x18 map, walking a
            // single unit at a stationary enemy with this gene alone: 74 of
            // 84 starts for a Bulwark and the same 74 for a Halberd stop
            // dead at (5,11) and stay there; a Kestrel never arrives from
            // any of its 84. Only Pike (crosses mountains) and Nightjar
            // (flies) get through, because they never have to go around
            // anything. A real route exists in every case -- for that
            // Bulwark it costs 6.5, about four turns.
            //
            // So when the greedy rule finds nothing, fall back to TRUE PATH
            // DISTANCE: a cost field from the target across ground this
            // unit can cross, and the reachable hex that is nearest along
            // it. Only on the fallback, because the field is a full-map
            // dijkstra and the beam applies thousands of genes per turn --
            // and because where the greedy rule works it is already right.
            if (bestKey === null && gene.kind === 'moveTowards') {
                const field = simCostFieldFrom(state, unit.type, target.q, target.r);
                let bestField = field.get(`${unit.q},${unit.r}`) ?? Infinity;
                for (const key of reachable) {
                    const [q, r] = key.split(',').map(Number);
                    if (q === unit.q && r === unit.r) continue;
                    const value = field.get(key);
                    if (value === undefined) continue;
                    const cost = distances.get(key)!;
                    if (value < bestField || (value === bestField && cost < bestCost && bestKey !== null)) {
                        bestField = value;
                        bestCost = cost;
                        bestKey = key;
                    }
                }
            }

            if (bestKey === null) return false; // nothing better than staying
            const [toQ, toR] = bestKey.split(',').map(Number);
            recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
            return true;
        }

        case 'standoff': {
            // Kiting (the HeroesOfBlazor "fire from max range" lesson):
            // move to a reachable hex INSIDE the unit's firing bracket
            // around the target, preferring the farthest legal distance --
            // this is how artillery fights: walk to range 3, never range 1.
            if (unit.move <= 0) return false;
            const targetIndex = resolveTargetIndex(state, gene.unitIndex, gene);
            if (targetIndex === null) return false;
            const target = state.getUnit(targetIndex)!;
            if (!UnitSystem.canTarget(unit.type, target.type)) return false;

            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: string | null = null;
            let bestDist = -Infinity;
            let bestCost = Infinity;
            const currentDist = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);

            for (const key of reachable) {
                const [q, r] = key.split(',').map(Number);
                if (q === unit.q && r === unit.r) continue;
                const dist = HexCoord.getDistance(q, r, target.q, target.r);
                if (dist < unit.minRange || dist > unit.maxRange) continue;
                const cost = distances.get(key)!;
                // Prefer the farthest in-bracket distance, then cheapest.
                if (dist > bestDist || (dist === bestDist && cost < bestCost)) {
                    bestDist = dist;
                    bestCost = cost;
                    bestKey = key;
                }
            }

            // Already parked at the ideal distance? Nothing to do.
            if (bestKey === null || (currentDist === unit.maxRange && bestDist <= currentDist)) return false;
            const [toQ, toR] = bestKey.split(',').map(Number);
            recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
            return true;
        }

        case 'moveToBuilding': {
            if (unit.move <= 0 || !unitCanCapture(unit)) return false;
            // Explicit building if it's still capturable, else the nearest.
            let buildingIndex = gene.buildingIndex ?? null;
            if (buildingIndex !== null) {
                const b = state.getBuilding(buildingIndex);
                if (!b || b.destroyed || b.ownerIndex === unit.playerIndex) buildingIndex = null;
            }
            if (buildingIndex === null) buildingIndex = nearestCapturableBuildingIndex(state, gene.unitIndex);
            if (buildingIndex === null) return false;
            const building = state.getBuilding(buildingIndex)!;

            // Same best-reachable-hex logic as moveTowards, aimed at the
            // building tile -- which, unlike an enemy's hex, is itself
            // enterable, so "reach it exactly" (the capture) wins outright.
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: string | null = null;
            let bestDist = HexCoord.getDistance(unit.q, unit.r, building.q, building.r);
            let bestCost = Infinity;
            for (const key of reachable) {
                const [q, r] = key.split(',').map(Number);
                if (q === unit.q && r === unit.r) continue;
                const dist = HexCoord.getDistance(q, r, building.q, building.r);
                const cost = distances.get(key)!;
                if (dist < bestDist || (dist === bestDist && cost < bestCost && bestKey !== null)) {
                    bestDist = dist;
                    bestCost = cost;
                    bestKey = key;
                }
            }
            // Same dead end as moveTowards, and the same fallback: a
            // capturing unit whose route to the door runs around the ridge
            // would otherwise stop at it forever.
            if (bestKey === null) {
                const field = simCostFieldFrom(state, unit.type, building.q, building.r);
                let bestField = field.get(`${unit.q},${unit.r}`) ?? Infinity;
                for (const key of reachable) {
                    const [q, r] = key.split(',').map(Number);
                    if (q === unit.q && r === unit.r) continue;
                    const value = field.get(key);
                    if (value === undefined) continue;
                    const cost = distances.get(key)!;
                    if (value < bestField || (value === bestField && cost < bestCost && bestKey !== null)) {
                        bestField = value;
                        bestCost = cost;
                        bestKey = key;
                    }
                }
            }

            if (bestKey === null) return false;
            const [toQ, toR] = bestKey.split(',').map(Number);
            recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
            return true;
        }

        case 'moveRandom': {
            if (unit.move <= 0) return false;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            const options = [...reachable].filter((key) => key !== `${unit.q},${unit.r}`);
            if (options.length === 0) return false;
            const rng = mulberry32(gene.seed);
            const key = options[Math.floor(rng() * options.length)];
            const [toQ, toR] = key.split(',').map(Number);
            recordSimMove(state, gene.unitIndex, toQ, toR, distances.get(key)!);
            return true;
        }

        default: {
            const custom = extras[gene.kind];
            return custom ? custom.apply(state, gene) : false;
        }
    }
}

// Fire every unit of `playerIndex` that can still attack. Attacks carry no
// in-turn downside (there is no return fire), so any plan that leaves a
// legal, net-positive shot on the table is strictly worse than the same
// plan plus that shot -- the classic "moved into range but forgot to
// shoot" blunder. Run after a plan's genes, both in evaluation and on the
// executed winner, so simulation and reality agree.
//
// Target choice per unit: resolve every legal shot (splash and friendly
// fire included) and take the highest NET value -- enemy damage plus kill
// bonuses, minus 1.5x any damage to own units; skip the unit entirely if
// nothing nets positive (e.g. a barrage that would mostly hit friends).
// Deterministic: the resolve seed derives from the acting/target indices,
// and firing replays the exact resolution just scored.
export function sweepAttacks(
    state: SimState,
    playerIndex: number,
    tuning: SweepTuning = DEFAULT_SWEEP
): boolean {
    let fired = false;
    const shooters = [...state.activeUnits()]
        .filter(([, u]) => u.playerIndex === playerIndex && !u.hasAttacked)
        .map(([i]) => i);

    for (const unitIndex of shooters) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hasAttacked) continue;

        let bestTarget = -1;
        let bestValue = 0; // only fire if strictly net-positive
        for (const [enemyIndex, enemy] of state.activeUnits()) {
            if (enemy.playerIndex === playerIndex) continue;
            const dist = HexCoord.getDistance(unit.q, unit.r, enemy.q, enemy.r);
            if (dist < unit.minRange || dist > unit.maxRange) continue;

            const seed = combineSeed(0x5eed, unitIndex, enemyIndex);
            const resolved = resolveAttack(state, unitIndex, enemyIndex, seed);
            if (!resolved) continue;
            let value = 0;
            for (const hit of resolved.hits) {
                const victim = state.getUnit(hit.unitIndex);
                if (!victim) continue;
                const worth = hit.damage + (hit.damage >= victim.hp ? tuning.killBonus : 0);
                value += victim.playerIndex === playerIndex ? -tuning.friendlyFirePenalty * worth : worth;
            }
            if (value > bestValue) {
                bestValue = value;
                bestTarget = enemyIndex;
            }
        }

        if (bestTarget >= 0) {
            const seed = combineSeed(0x5eed, unitIndex, bestTarget);
            fired = applyGene(state, { kind: 'attack', unitIndex, targetIndex: bestTarget, seed }) || fired;
        }
    }
    return fired;
}

export const DEFAULT_GENE_WEIGHTS: ReadonlyArray<readonly [GeneKind, number]> = [
    ['attack', 0.30],
    ['moveTowards', 0.20],
    ['standoff', 0.10],
    ['moveRandom', 0.10],
    ['moveAway', 0.10],
    ['moveToBuilding', 0.10],
    ['idle', 0.10],
];

export const DEFAULT_SWEEP: SweepTuning = {
    killBonus: 100,
    friendlyFirePenalty: 1.5,
};

export const DEFAULT_DIALECT: GeneDialect = {
    weights: DEFAULT_GENE_WEIGHTS,
    extras: {},
    focusFireChance: 0.5,
    sweep: DEFAULT_SWEEP,
};

// Random gene for one specific unit -- population init and mutation both
// use this. rng is the search's own seeded PRNG.
//
// The draw pattern is deliberately unchanged from when the weights were a
// module constant, so the baseline dialect reproduces the shipped AI's
// play bit for bit. Two different dialects diverge from each other, which
// is the point -- each is only required to be deterministic in its own seed.
export function randomGene(
    state: SimState,
    unitIndex: number,
    rng: () => number,
    dialect: GeneDialect = DEFAULT_DIALECT
): Gene {
    const unit = state.getUnit(unitIndex);
    const enemies: number[] = [];
    if (unit) {
        for (const [i, other] of state.activeUnits()) {
            if (other.playerIndex !== unit.playerIndex) enemies.push(i);
        }
    }

    let roll = rng();
    let kind: GeneKind = 'idle';
    for (const [k, weight] of dialect.weights) {
        if (roll < weight) { kind = k; break; }
        roll -= weight;
    }
    // moveToBuilding only makes sense for capture-capable units with a
    // capturable building on the map; otherwise redirect the roll to
    // plain aggression (which the no-enemies fallback below may in turn
    // downgrade to moveRandom).
    if (kind === 'moveToBuilding' && (!unit || !unitCanCapture(unit) || nearestCapturableBuildingIndex(state, unitIndex) === null)) {
        kind = 'moveTowards';
    }
    // standoff needs an enemy this unit may legally shoot.
    if (kind === 'standoff' && (!unit || nearestTargetableEnemyIndex(state, unitIndex) === null)) {
        kind = 'moveTowards';
    }
    // Engine-registered kinds get the same treatment via their own guard.
    const custom = dialect.extras[kind];
    if (custom?.applicable && !custom.applicable(state, unitIndex)) {
        kind = 'moveTowards';
    }
    if (enemies.length === 0 && (kind === 'attack' || kind === 'moveTowards' || kind === 'moveAway')) {
        kind = 'moveRandom';
    }

    // Focus fire: focusFireChance of the time aim at the weakest legal
    // target (finish damaged units off) instead of a uniformly random
    // enemy -- the random remainder keeps exploration alive for the
    // hillclimber.
    let targetIndex: number | undefined;
    if (enemies.length > 0) {
        const weakest = unit ? weakestTargetableEnemyIndex(state, unitIndex) : null;
        targetIndex = rng() < dialect.focusFireChance && weakest !== null
            ? weakest
            : enemies[Math.floor(rng() * enemies.length)];
    }

    return {
        kind,
        unitIndex,
        targetIndex,
        seed: Math.floor(rng() * 0x7fffffff),
    };
}
