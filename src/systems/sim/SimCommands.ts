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

export type GeneKind = 'moveTowards' | 'moveAway' | 'moveRandom' | 'moveToBuilding' | 'attack' | 'idle';

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

// Resolve the gene's target: an explicitly set live enemy, else the nearest.
function resolveTargetIndex(state: SimState, unitIndex: number, gene: Gene): number | null {
    const unit = state.getUnit(unitIndex)!;
    if (gene.targetIndex !== undefined) {
        const target = state.getUnit(gene.targetIndex);
        if (target && target.playerIndex !== unit.playerIndex) return gene.targetIndex;
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
                state.record({ type: 'terrainModified', q: impact.q, r: impact.r, delta: impact.craterDelta });
            }
            return true;
        }

        case 'moveTowards':
        case 'moveAway': {
            if (unit.move <= 0) return false;
            const targetIndex = resolveTargetIndex(state, gene.unitIndex, gene);
            if (targetIndex === null) return false;
            const target = state.getUnit(targetIndex)!;

            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: string | null = null;
            let bestDist = gene.kind === 'moveTowards'
                ? HexCoord.getDistance(unit.q, unit.r, target.q, target.r)
                : -Infinity;
            let bestCost = Infinity;

            for (const key of reachable) {
                const [q, r] = key.split(',').map(Number);
                if (q === unit.q && r === unit.r) continue;
                const dist = HexCoord.getDistance(q, r, target.q, target.r);
                const cost = distances.get(key)!;
                const better = gene.kind === 'moveTowards'
                    ? dist < bestDist || (dist === bestDist && cost < bestCost && bestKey !== null)
                    : dist > bestDist || (dist === bestDist && cost < bestCost && bestKey !== null);
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
    ['moveTowards', 0.25],
    ['moveRandom', 0.15],
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
    if (enemies.length === 0 && (kind === 'attack' || kind === 'moveTowards' || kind === 'moveAway')) {
        kind = 'moveRandom';
    }

    return {
        kind,
        unitIndex,
        targetIndex: enemies.length > 0 ? enemies[Math.floor(rng() * enemies.length)] : undefined,
        seed: Math.floor(rng() * 0x7fffffff),
    };
}
