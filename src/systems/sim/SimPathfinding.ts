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

// A one-entry memo of the last Dijkstra, keyed on everything that can change
// its answer.
//
// It exists because of ONE call pattern: a move gene runs simDijkstra to
// choose a destination, then recordSimMove immediately runs simPath over the
// same unit from the same hex to count the burning tiles on the route. That
// is the identical search twice, back to back, on the hottest path in the
// engine -- and it is why a single fire on the map made a turn plan seven
// times slower. Anything that could change the answer is in the key, so a
// stale hit is not possible: the board's event count, the unit, where it is
// standing, and the cost ceiling.
const dijkstraMemo = new WeakMap<SimState, { key: string; result: SimDijkstraResult }>();

function memoKey(state: SimState, unitIndex: number, maxCost: number): string | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    return `${state.events.length}|${unitIndex}|${unit.q}|${unit.r}|${maxCost}`;
}

export function simDijkstra(state: SimState, unitIndex: number, maxCost: number = Infinity): SimDijkstraResult {
    const key = memoKey(state, unitIndex, maxCost);
    if (key !== null) {
        const cached = dijkstraMemo.get(state);
        if (cached && cached.key === key) return cached.result;
    }
    const result = simDijkstraUncached(state, unitIndex, maxCost);
    if (key !== null) dijkstraMemo.set(state, { key, result });
    return result;
}

function simDijkstraUncached(state: SimState, unitIndex: number, maxCost: number = Infinity): SimDijkstraResult {
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

// Cost to reach every hex FROM a given coordinate, for a given unit type.
//
// Unlike simDijkstra this is a field over the map rather than a unit's
// reachable set: it ignores who is standing where (units move, and the
// hex you are routing toward is occupied by the enemy you are routing at)
// and it is not bounded by a movement budget. What it answers is "how far
// is this hex from there, along ground this unit can actually cross" --
// which is the question a movement gene needs and hex distance only
// approximates.
export function simCostFieldFrom(
    state: SimState,
    unitType: string,
    fromQ: number,
    fromR: number
): Map<string, number> {
    const field = new Map<string, number>();
    const closed = new Set<string>();
    const startKey = keyOf(fromQ, fromR);
    field.set(startKey, 0);

    const frontier = new PriorityQueue<string>();
    frontier.enqueue(startKey, 0);

    while (!frontier.isEmpty()) {
        const currentKey = frontier.dequeue()!;
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);
        const [cq, cr] = currentKey.split(',').map(Number);
        const currentCost = field.get(currentKey)!;

        for (const n of HexCoord.getNeighbors(cq, cr)) {
            if (n.q < 0 || n.q >= state.cols || n.r < 0 || n.r >= state.rows) continue;
            const step = simMoveCost(state, unitType, n.q, n.r);
            if (step == null) continue;
            const nextKey = keyOf(n.q, n.r);
            const next = currentCost + step;
            if (next < (field.get(nextKey) ?? Infinity)) {
                field.set(nextKey, next);
                frontier.enqueue(nextKey, next);
            }
        }
    }
    return field;
}
