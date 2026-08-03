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

import { HexCoord } from '../../shared/hexengine/HexCoord';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { SimState, SimUnit } from './SimState';
import { simDijkstra } from './SimPathfinding';
import { resolveAttack, mulberry32, combineSeed } from './resolveAttack';

export type GeneKind = 'moveTowards' | 'moveAway' | 'moveRandom' | 'moveToBuilding' | 'standoff' | 'attack' | 'idle';

export interface Gene {
    kind: GeneKind;
    unitIndex: number;
    targetIndex?: number;   // enemy unit index for moveTowards/moveAway/attack
    buildingIndex?: number; // building index for moveToBuilding
    seed: number;           // drives scatter + random-move picks
}

function unitCanCapture(unit: SimUnit): boolean {
    return !!UnitSystem.unitTypesRecord[unit.type]?.canCapture;
}

// A building this unit's side could take: still standing and not already
// owned by them. (Whether it still holds a prize is invisible here -- the
// score layer decides how much a capture is worth.)
export function nearestCapturableBuildingIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [i, building] of state.liveBuildings()) {
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
    for (const [i, other] of state.liveUnits()) {
        if (other.playerIndex === unit.playerIndex) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, other.q, other.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// Nearest enemy this unit is ALLOWED to shoot (respects the class
// targeting rule: artillery/infantry can't touch air).
export function nearestTargetableEnemyIndex(state: SimState, unitIndex: number): number | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [i, other] of state.liveUnits()) {
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
    for (const [i, other] of state.liveUnits()) {
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
function recordMove(state: SimState, unitIndex: number, toQ: number, toR: number, moveSpent: number): void {
    state.record({ type: 'unitMoved', unitIndex, toQ, toR, moveSpent });
    const unit = state.getUnit(unitIndex);
    if (!unit || !unitCanCapture(unit)) return;
    const found = state.getBuildingAt(toQ, toR);
    if (found && found[1].ownerIndex !== unit.playerIndex) {
        state.record({ type: 'buildingCaptured', buildingIndex: found[0], playerIndex: unit.playerIndex });
    }
}

// Apply one gene to the branch, recording events. Returns true if any
// event was recorded.
export function applyGene(state: SimState, gene: Gene): boolean {
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

            const resolved = resolveAttack(state, gene.unitIndex, targetIndex, gene.seed);
            if (!resolved || resolved.hits.length === 0) return false;

            for (const hit of resolved.hits) {
                state.record({
                    type: 'unitAttacked',
                    attackerIndex: gene.unitIndex,
                    defenderIndex: hit.unitIndex,
                    damage: hit.damage,
                });
                const victim = state.getUnit(hit.unitIndex);
                if (victim && victim.hp <= 0) {
                    state.record({ type: 'unitDied', unitIndex: hit.unitIndex });
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
                        state.record({ type: 'unitDied', unitIndex: standing[0] });
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

            if (bestKey === null) return false; // nothing strictly better than staying
            const [toQ, toR] = bestKey.split(',').map(Number);
            recordMove(state, gene.unitIndex, toQ, toR, bestCost);
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
            recordMove(state, gene.unitIndex, toQ, toR, bestCost);
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
            if (bestKey === null) return false;
            const [toQ, toR] = bestKey.split(',').map(Number);
            recordMove(state, gene.unitIndex, toQ, toR, bestCost);
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
            recordMove(state, gene.unitIndex, toQ, toR, distances.get(key)!);
            return true;
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
export function sweepAttacks(state: SimState, playerIndex: number): boolean {
    let fired = false;
    const shooters = [...state.liveUnits()]
        .filter(([, u]) => u.playerIndex === playerIndex && !u.hasAttacked)
        .map(([i]) => i);

    for (const unitIndex of shooters) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hasAttacked) continue;

        let bestTarget = -1;
        let bestValue = 0; // only fire if strictly net-positive
        for (const [enemyIndex, enemy] of state.liveUnits()) {
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
                const worth = hit.damage + (hit.damage >= victim.hp ? 100 : 0);
                value += victim.playerIndex === playerIndex ? -1.5 * worth : worth;
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

const KIND_WEIGHTS: Array<[GeneKind, number]> = [
    ['attack', 0.30],
    ['moveTowards', 0.20],
    ['standoff', 0.10],
    ['moveRandom', 0.10],
    ['moveAway', 0.10],
    ['moveToBuilding', 0.10],
    ['idle', 0.10],
];

// Random gene for one specific unit -- population init and mutation both
// use this. rng is the search's own seeded PRNG.
export function randomGene(state: SimState, unitIndex: number, rng: () => number): Gene {
    const unit = state.getUnit(unitIndex);
    const enemies: number[] = [];
    if (unit) {
        for (const [i, other] of state.liveUnits()) {
            if (other.playerIndex !== unit.playerIndex) enemies.push(i);
        }
    }

    let roll = rng();
    let kind: GeneKind = 'idle';
    for (const [k, weight] of KIND_WEIGHTS) {
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
    if (enemies.length === 0 && (kind === 'attack' || kind === 'moveTowards' || kind === 'moveAway')) {
        kind = 'moveRandom';
    }

    // Focus fire: half the time aim at the weakest legal target (finish
    // damaged units off) instead of a uniformly random enemy -- the random
    // half keeps exploration alive for the hillclimber.
    let targetIndex: number | undefined;
    if (enemies.length > 0) {
        const weakest = unit ? weakestTargetableEnemyIndex(state, unitIndex) : null;
        targetIndex = rng() < 0.5 && weakest !== null
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
