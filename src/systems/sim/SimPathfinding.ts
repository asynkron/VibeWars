// Pure pathfinding over SimState -- the simulation-side counterpart of
// PathfindingSystem.dijkstra, which is unusable for search because it walks
// GridSystem.hexGrid (THREE objects) and the live getGameState().units.
//
// The movement rules deliberately mirror the live ones exactly
// (TerrainSystem.getMoveCost + PathfindingSystem.dijkstra):
//   - a tile with a road always costs 0.5, bypassing unit/terrain rules
//   - otherwise cost = unitTypesRecord[unit.type].terrainCosts[TYPE];
//     falsy (null/0/undefined) means impassable
//   - occupied hexes are skipped entirely, including as destinations
//   - the frontier stops expanding past maxCost
//
// One intentional difference: no pre-seeding of every map tile's distance
// (the live version initializes all cols x rows entries up front). With
// small move budgets the search stays local and cheap, which matters when
// hillclimbing evaluates hundreds of candidate plans per AI turn.

import { PriorityQueue } from '../../shared/hexengine/priorityQueue';
import * as HexCoord from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { SimState } from './SimState';

export interface SimDijkstraResult {
    distances: Map<string, number>;
    previous: Map<string, string>;
    reachable: Set<string>;
}

export interface SimPathResult {
    // Steps from (excluding) the unit's current hex to the destination.
    path: { q: number; r: number }[];
    cost: number;
}

function keyOf(q: number, r: number): string {
    return `${q},${r}`;
}

// Mirror of TerrainSystem.getMoveCost against SimState data. Returns null
// for impassable (the live version returns 0; both are treated as "skip").
export function simMoveCost(state: SimState, unitType: string, q: number, r: number): number | null {
    const tile = state.getTile(q, r);
    if (!tile) return null;
    if (tile.hasRoad) return 0.5;
    const cost = UnitSystem.getMovementCost(unitType, tile.type.toUpperCase());
    return cost ? cost : null;
}

export function simDijkstra(state: SimState, unitIndex: number, maxCost: number = Infinity): SimDijkstraResult {
    const distances = new Map<string, number>();
    const previous = new Map<string, string>();
    const reachable = new Set<string>();

    const unit = state.getUnit(unitIndex);
    if (!unit) return { distances, previous, reachable };

    const closed = new Set<string>();
    const startKey = keyOf(unit.q, unit.r);
    distances.set(startKey, 0);
    reachable.add(startKey);

    const frontier = new PriorityQueue<string>();
    frontier.enqueue(startKey, 0);

    while (!frontier.isEmpty()) {
        const currentKey = frontier.dequeue()!;
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);

        const currentDistance = distances.get(currentKey)!;
        if (currentDistance > maxCost) break;

        const [cq, cr] = currentKey.split(',').map(Number);
        for (const n of HexCoord.getNeighbors(cq, cr)) {
            if (n.q < 0 || n.q >= state.cols || n.r < 0 || n.r >= state.rows) continue;
            const neighborKey = keyOf(n.q, n.r);
            if (closed.has(neighborKey)) continue;
            // Occupied hexes are skipped entirely, mirroring the live
            // dijkstra's coord.isOccupied() filter. Note this sees the
            // simulated positions/deaths in this branch, not the live world.
            if (state.getUnitAt(n.q, n.r)) continue;

            const cost = simMoveCost(state, unit.type, n.q, n.r);
            if (!cost) continue;

            const newDistance = currentDistance + cost;
            if (newDistance < (distances.get(neighborKey) ?? Infinity)) {
                distances.set(neighborKey, newDistance);
                previous.set(neighborKey, currentKey);
                if (newDistance <= maxCost) {
                    reachable.add(neighborKey);
                    frontier.enqueue(neighborKey, newDistance);
                }
            }
        }
    }

    return { distances, previous, reachable };
}

// Mirror of PathfindingSystem.getPath semantics: null when the destination
// isn't reachable within maxCost, otherwise the step list (start excluded)
// plus the total movement cost.
export function simPath(
    state: SimState,
    unitIndex: number,
    toQ: number,
    toR: number,
    maxCost: number = Infinity
): SimPathResult | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;

    const { distances, previous, reachable } = simDijkstra(state, unitIndex, maxCost);
    const endKey = keyOf(toQ, toR);
    if (!reachable.has(endKey)) return null;

    const path: { q: number; r: number }[] = [];
    let currentKey = endKey;
    while (previous.has(currentKey)) {
        const [q, r] = currentKey.split(',').map(Number);
        path.unshift({ q, r });
        currentKey = previous.get(currentKey)!;
    }

    return { path, cost: distances.get(endKey)! };
}
