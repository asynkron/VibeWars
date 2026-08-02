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
import { SimState } from './SimState';
import { simDijkstra } from './SimPathfinding';
import { resolveAttack, mulberry32 } from './resolveAttack';

export type GeneKind = 'moveTowards' | 'moveAway' | 'moveRandom' | 'attack' | 'idle';

export interface Gene {
    kind: GeneKind;
    unitIndex: number;
    targetIndex?: number; // enemy unit index for moveTowards/moveAway/attack
    seed: number;         // drives scatter + random-move picks
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
            state.record({ type: 'unitMoved', unitIndex: gene.unitIndex, toQ, toR, moveSpent: bestCost });
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
            state.record({ type: 'unitMoved', unitIndex: gene.unitIndex, toQ, toR, moveSpent: distances.get(key)! });
            return true;
        }
    }
}

const KIND_WEIGHTS: Array<[GeneKind, number]> = [
    ['attack', 0.35],
    ['moveTowards', 0.30],
    ['moveRandom', 0.15],
    ['moveAway', 0.10],
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
