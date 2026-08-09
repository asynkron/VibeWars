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
//   - moveTowards computes the complete cheapest route to the target, then
//     walks the affordable prefix and stops before its occupied hex.
//   - unitMoved events carry moveSpent, and applyGene reads the current
//     branch state, so multiple genes for the same unit compose correctly
//     against its shrinking movement budget (another old-AI bug: moves
//     never deducted movement points).

import * as HexCoord from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { SimState, SimUnit } from './SimState';
import { simDijkstra, simCostFieldFrom, simMoveCost, simPath, simPathToTarget } from './SimPathfinding';
import { resolveAttack, mulberry32, combineSeed } from './resolveAttack';
import { burningTilesOf, canIgnite, FIRE_DAMAGE, firePathDamage, isBurning, tickFires } from '../../shared/hexengine/fire';
import { pickProductionSpot } from '../../shared/hexengine/production';

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
    // falls back to `fallback` (moveTowards when undeclared), exactly like
    // the builtin moveToBuilding and standoff guards. Without it the kind
    // is always considered rollable.
    applicable?(state: SimState, unitIndex: number): boolean;
    // What an inapplicable roll becomes. Default is moveTowards -- the
    // convention every earlier gene was measured under -- and that default
    // is NOT neutral: a narrow gene that can never apply on a given board
    // silently adds its whole weight to the army's advance. A gene that
    // would rather not exist than press declares 'idle' here, which is
    // what makes adding it to a dialect ADDITIVE instead of a hidden
    // aggression tilt on every board where it never fires.
    fallback?: GeneKind;
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
    // Tuning for the post-plan attack sweep -- or NULL for no sweep at
    // all, which means every shot must come from an explicit gene. The
    // sweep exists because random plans forget to shoot; it also fires
    // from FINAL positions only, so any movement left after its shot is
    // dead and the search drifts toward park-and-shoot. An engine whose
    // dialect rolls shooting genes often enough may not need the floor --
    // quickdraw is the engine that asks. Null rather than an optional
    // field, so a call site cannot forget to decide: the type makes every
    // sweep caller say what it does when there is none.
    sweep: SweepTuning | null;
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
        if (building.isHeadquarters) continue;
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

    // Factory deliveries, after the countdowns ticked in turnStarted and
    // before the fire moves. The countdown floors at 0 ("due") in apply;
    // HERE the spot is chosen -- spot-picking reads occupancy, which is
    // the command layer's job, not apply()'s -- and the delivery recorded
    // as a fact. A factory whose every candidate hex is blocked records
    // nothing and stays due: production waits under siege.
    for (let i = 0; i < state.buildingCount; i++) {
        const building = state.getBuilding(i);
        if (!building || building.destroyed || !building.isEntrance) continue;
        if (building.ownerIndex !== playerIndex || building.productType === null) continue;
        if (building.productionCountdown !== 0) continue;
        const spot = pickProductionSpot(
            {
                getTile: (q, r) => state.getTile(q, r),
                isOccupied: (q, r) => state.getUnitAt(q, r) !== null,
                isBuilding: (q, r) => state.getBuildingAt(q, r) !== null,
            },
            building,
            building.productType
        );
        if (!spot) continue;
        state.record({
            type: 'unitProduced',
            buildingIndex: i,
            unitIndex: state.unitCount,
            unitType: building.productType,
            q: spot.q,
            r: spot.r,
            playerIndex,
        });
    }

    // Rolled here, in the command layer, and recorded as the outcome --
    // apply() must stay mechanical, and a beam node replayed on another
    // thread must rebuild the same board rather than re-throw the dice.
    //
    // A fireless board -- almost every map, almost every turn -- would still
    // pay a full cols-by-rows scan here, once per child at every beam depth.
    // hasFire answers the same question from a cached base check plus the
    // handful of overrides, so bail before the board walk.
    if (!state.hasFire) return;
    const burning = burningTilesOf(state.fireView, state.cols, state.rows);
    if (burning.length === 0) return;

    // Standing in it costs, before the fire moves. Charged first so a unit
    // that is about to be caught by the spread is not burnt twice in one
    // turn -- this turn it pays for where it already was.
    for (const [index, unit] of state.activeUnits()) {
        if (unit.playerIndex !== playerIndex) continue;
        if (UnitSystem.unitTypesRecord[unit.type]?.unitClass === 'air') continue;
        const tile = state.getTile(unit.q, unit.r);
        if (!isBurning(tile)) continue;
        state.record({ type: 'unitBurned', unitIndex: index, damage: FIRE_DAMAGE });
        const after = state.getUnit(index);
        // No wreck fire: the tile is already alight, and a corpse in a fire
        // cannot set light to a fire.
        if (after && after.hp <= 0) recordDeath(state, index, false);
    }

    const tick = tickFires(state.fireView, burning, rng);
    state.record({ type: 'fireTicked', ignited: tick.ignited, burnedOut: tick.burnedOut, aged: burning });
}

// The cheapest a tile can cost to enter: a road, for every unit.
const MIN_TILE_COST = 0.5;

// A destroyed machine leaves a burning wreck half the time.
const WRECK_FIRE_CHANCE = 0.5;
// A fixed salt, so a wreck's roll cannot collide with the spread's stream.
const WRECK_FIRE_SEED = 0x77265;

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
function recordDeath(state: SimState, unitIndex: number, wreckFires = true): void {
    // Read BEFORE the death is recorded: record() applies before it logs, and
    // the unitDied arm nulls the unit -- afterwards there is no type and no
    // coordinates left to ask about.
    const dying = state.getUnit(unitIndex);

    state.record({ type: 'unitDied', unitIndex });

    // A burning wreck. Mechanical only -- infantry leaves no fuel behind --
    // and only where there is something left to catch.
    //
    // ROLLED HERE, IN THE COMMAND LAYER, and recorded as an outcome, for the
    // same reason the fire spread is: apply() must stay mechanical, and a
    // beam node replayed on another worker thread has to rebuild the same
    // board rather than throw fresh dice.
    //
    // The seed is derived from the branch's own position -- the dying unit,
    // where it fell, and how many events got us here. A node is identified by
    // the events that produced it and replayed identically, so that triple is
    // stable across threads without any caller having to thread a seed in.
    if (wreckFires && dying && UnitSystem.isMechanical(dying.type)) {
        const tile = state.getTile(dying.q, dying.r);
        if (canIgnite(tile)) {
            const rng = mulberry32(combineSeed(WRECK_FIRE_SEED, unitIndex, dying.q, dying.r, state.events.length));
            if (rng() < WRECK_FIRE_CHANCE) {
                state.record({ type: 'fireStarted', q: dying.q, r: dying.r, casterIndex: -1 });
            }
        }
    }
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
    if (found && !found[1].isHeadquarters
        && found[1].isEntrance && found[1].ownerIndex !== unit.playerIndex) {
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

    // A CHEAP REJECT BEFORE THE EXPENSIVE ONE. Reconstructing the route costs
    // a full Dijkstra, and this runs on every simulated move -- so as soon as
    // one tile anywhere on the map was alight, every move in the search paid
    // for a second pathfind. Measured at 20x on a 30x30 map with ONE fire.
    //
    // No route can touch a fire further away than the straight-line distance
    // the unit could possibly cover, and the cheapest tile in the game costs
    // 0.5 (a road), so `move / 0.5` bounds it. A hex distance check against
    // that bound is a handful of integer operations per burning tile.
    const reach = Math.ceil(unit.move / MIN_TILE_COST);
    let withinReach = false;
    for (const fire of state.burningTiles()) {
        if (HexCoord.getDistance(unit.q, unit.r, fire.q, fire.r) <= reach) { withinReach = true; break; }
    }
    if (!withinReach) return;

    // BOUNDED BY THE UNIT'S MOVEMENT. Left unbounded this ran a Dijkstra
    // over the ENTIRE board on every simulated move -- 900 tiles on a 30x30
    // map to reconstruct a route three hexes long. A path cannot cost more
    // than the mover had to spend, so this is the same answer for a fraction
    // of the work, and it matches the ceiling the caller's own search used,
    // which lets the two share a memo instead of repeating each other.
    const route = simPath(state, unitIndex, toQ, toR, unit.move);
    if (!route) return;

    const flies = UnitSystem.unitTypesRecord[unit.type]?.unitClass === 'air';
    const damage = firePathDamage(state.fireView, route.path, flies);
    if (damage <= 0) return;

    state.record({ type: 'unitBurned', unitIndex, damage });
    // Death is explicit and comes from the command layer, exactly as it does
    // for an attack -- and through recordDeath, so a transport that burns to
    // death still takes its passengers with it.
    const after = state.getUnit(unitIndex);
    // No wreck fire from a burn death. The unit dies on a tile that is by
    // definition already alight, so there is nothing to ignite -- and the
    // move has not been recorded yet, so this would be reading the hex it
    // set off FROM rather than the one it died on.
    if (after && after.hp <= 0) recordDeath(state, unitIndex, false);
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

            if (gene.kind === 'moveTowards') {
                // Route all the way to the occupied target without imposing
                // this turn's movement ceiling. Then consume that route in
                // order until the next step is unaffordable. The target is a
                // marker only: stop on the final free hex before it.
                const route = simPathToTarget(state, gene.unitIndex, target.q, target.r);
                if (!route) return false;
                let spent = 0;
                let destination: { q: number; r: number } | null = null;
                for (const step of route.path) {
                    if (step.q === target.q && step.r === target.r) break;
                    const stepCost = simMoveCost(state, unit.type, step.q, step.r);
                    if (stepCost === null || spent + stepCost > unit.move) break;
                    spent += stepCost;
                    destination = step;
                }
                if (!destination) return false;
                recordSimMove(state, gene.unitIndex, destination.q, destination.r, spent);
                return true;
            }

            // moveAway flees WITH PURPOSE (the HeroesOfBlazor lesson):
            // best is a hex the threat cannot even reach next turn
            // (distance > its move + max range); only if no such hex is
            // reachable fall back to plain distance-maximizing.
            const threatStats = UnitSystem.unitTypesRecord[target.type];
            const safeDist = threatStats.move + threatStats.maxRange;

            const cols = state.cols;
            const startKey = unit.r * cols + unit.q;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: number | null = null;
            let bestDist = -Infinity;
            let bestCost = Infinity;
            let bestSafe = HexCoord.getDistance(unit.q, unit.r, target.q, target.r) > safeDist;

            for (const key of reachable) {
                if (key === startKey) continue;
                const q = key % cols;
                const r = (key - q) / cols;
                const dist = HexCoord.getDistance(q, r, target.q, target.r);
                const cost = distances.get(key)!;
                const safe = dist > safeDist;
                // Safe beats unsafe; among safe hexes prefer CHEAP
                // (don't waste movement running further than needed);
                // among unsafe prefer far.
                const better = (safe && !bestSafe)
                    || (safe && bestSafe && (cost < bestCost || (cost === bestCost && dist > bestDist)))
                    || (!safe && !bestSafe && (dist > bestDist || (dist === bestDist && cost < bestCost && bestKey !== null)));
                if (better) bestSafe = safe;
                if (better) {
                    bestDist = dist;
                    bestCost = cost;
                    bestKey = key;
                }
            }

            if (bestKey === null) return false; // nothing better than staying
            const toQ = bestKey % cols;
            recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
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

            const cols = state.cols;
            const startKey = unit.r * cols + unit.q;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: number | null = null;
            let bestDist = -Infinity;
            let bestCost = Infinity;
            const currentDist = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);

            for (const key of reachable) {
                if (key === startKey) continue;
                const q = key % cols;
                const r = (key - q) / cols;
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
            const toQ = bestKey % cols;
            recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
            return true;
        }

        case 'moveToBuilding': {
            if (unit.move <= 0 || !unitCanCapture(unit)) return false;
            // Explicit building if it's still capturable, else the nearest.
            let buildingIndex = gene.buildingIndex ?? null;
            if (buildingIndex !== null) {
                const b = state.getBuilding(buildingIndex);
                if (!b || b.destroyed || b.isHeadquarters || b.ownerIndex === unit.playerIndex) buildingIndex = null;
            }
            if (buildingIndex === null) buildingIndex = nearestCapturableBuildingIndex(state, gene.unitIndex);
            if (buildingIndex === null) return false;
            const building = state.getBuilding(buildingIndex)!;

            // Same best-reachable-hex logic as moveTowards, aimed at the
            // building tile -- which, unlike an enemy's hex, is itself
            // enterable, so "reach it exactly" (the capture) wins outright.
            const cols = state.cols;
            const startKey = unit.r * cols + unit.q;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: number | null = null;
            let bestDist = HexCoord.getDistance(unit.q, unit.r, building.q, building.r);
            let bestCost = Infinity;
            for (const key of reachable) {
                if (key === startKey) continue;
                const q = key % cols;
                const r = (key - q) / cols;
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
                const field = simCostFieldFrom(state, unit.type, building.q, building.r, unit.playerIndex);
                let bestField = field.get(startKey) ?? Infinity;
                for (const key of reachable) {
                    if (key === startKey) continue;
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
            const toQ = bestKey % cols;
            recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
            return true;
        }

        case 'moveRandom': {
            if (unit.move <= 0) return false;
            const cols = state.cols;
            const startKey = unit.r * cols + unit.q;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            const options = [...reachable].filter((key) => key !== startKey);
            if (options.length === 0) return false;
            const rng = mulberry32(gene.seed);
            const key = options[Math.floor(rng() * options.length)];
            const toQ = key % cols;
            recordSimMove(state, gene.unitIndex, toQ, (key - toQ) / cols, distances.get(key)!);
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
    // Engine-registered kinds get the same treatment via their own guard,
    // falling back to the kind they declare -- see GeneDefinition.fallback.
    const custom = dialect.extras[kind];
    if (custom?.applicable && !custom.applicable(state, unitIndex)) {
        kind = custom.fallback ?? 'moveTowards';
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
