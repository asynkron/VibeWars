// Pure pathfinding over SimState -- the simulation-side counterpart of
// PathfindingSystem.dijkstra, which is unusable for search because it walks
// GridSystem.hexGrid (THREE objects) and the live getGameState().units.
//
// The movement rules deliberately mirror the live ones exactly
// (TerrainSystem.getMoveCost + PathfindingSystem.dijkstra):
//   - a tile with a road costs ground units 0.5; aircraft ignore roads
//   - otherwise cost = unitTypesRecord[unit.type].terrainCosts[TYPE];
//     falsy (null/0/undefined) means impassable
//   - occupied hexes are skipped entirely, including as destinations
//   - the frontier stops expanding past maxCost
//
// One intentional difference: no pre-seeding of every map tile's distance
// (the live version initializes all cols x rows entries up front). With
// small move budgets the search stays local and cheap, which matters when
// hillclimbing evaluates hundreds of candidate plans per AI turn.
//
// KEYS ARE HEX INDICES (r * cols + q) -- the same arithmetic SimState's
// tile store and occupancy index use -- not "q,r" strings. This is the
// innermost loop of the whole AI: every movement gene runs a dijkstra and
// then walks its `reachable` set, and the beam applies tens of thousands
// of genes per turn. String keys meant a template allocation per visited
// hex and a split-and-parse per read-back, which profiled as pure GC
// pressure. A number decodes with one modulo: q = key % cols, and
// r = (key - q) / cols.

import { PriorityQueue } from '../../shared/hexengine/priorityQueue';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { SimState, SimTile } from './SimState';
import { headquartersAllowsGroundEntry } from '../../shared/hexengine/headquarters';

export interface SimDijkstraResult {
    distances: Map<number, number>;
    previous: Map<number, number>;
    reachable: Set<number>;
}

export interface SimPathResult {
    // Steps from (excluding) the unit's current hex to the destination.
    path: { q: number; r: number }[];
    cost: number;
}

// hexNeighbors' six directions as parallel delta tables, split by column
// parity (odd-q offset: odd columns sit half a row lower). SAME ORDER as
// hexMath.hexNeighbors, and the order is load-bearing: expansion order
// decides Map insertion order, insertion order decides which of two
// equally-good hexes a movement gene picks, and the neutrality fixtures
// hash the events that follow from that pick. Tables rather than the
// function because the function allocates six objects per visited hex.
const NEIGHBOR_DQ = [-1, 0, 1, 1, 0, -1];
const NEIGHBOR_DR_EVEN = [-1, -1, -1, 0, 1, 0];
const NEIGHBOR_DR_ODD = [0, -1, 0, 1, 1, 1];

// tile.type is stored upper-case everywhere a SimState is built, but the
// live rule upper-cases defensively and this must stay behaviour-identical
// -- so the conversion survives, memoised per distinct string so the hot
// loop stops allocating a fresh copy of "GRASS" per visited hex.
const upperOf = new Map<string, string>();
function terrainKey(type: string): string {
    let upper = upperOf.get(type);
    if (upper === undefined) {
        upper = type.toUpperCase();
        upperOf.set(type, upper);
    }
    return upper;
}

// Mirror of TerrainSystem.getMoveCost against SimState data. Returns null
// for impassable (the live version returns 0; both are treated as "skip").
export function simMoveCost(state: SimState, unitType: string, q: number, r: number): number | null {
    const tile = state.getTile(q, r);
    if (!tile) return null;
    if (tile.hasRoad && UnitSystem.unitTypesRecord[unitType]?.unitClass !== 'air') return 0.5;
    const cost = UnitSystem.getMovementCost(unitType, terrainKey(tile.type));
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

function simDijkstraUncached(
    state: SimState,
    unitIndex: number,
    maxCost: number = Infinity,
    occupiedDestinationKey: number | null = null
): SimDijkstraResult {
    const distances = new Map<number, number>();
    const previous = new Map<number, number>();
    const reachable = new Set<number>();

    const unit = state.getUnit(unitIndex);
    if (!unit) return { distances, previous, reachable };

    const cols = state.cols;
    const rows = state.rows;
    // Hoisted out of the neighbor loop: the record is per unit TYPE, and
    // this loop is the hottest in the engine. SimState.apply already
    // indexes unitTypesRecord by this type unguarded, so an unknown type
    // cannot reach here alive.
    const costs = UnitSystem.unitTypesRecord[unit.type].terrainCosts;
    const isAir = UnitSystem.unitTypesRecord[unit.type].unitClass === 'air';

    const closed = new Set<number>();
    const startKey = unit.r * cols + unit.q;
    distances.set(startKey, 0);
    reachable.add(startKey);

    const frontier = new PriorityQueue<number>();
    frontier.enqueue(startKey, 0);

    while (!frontier.isEmpty()) {
        const currentKey = frontier.dequeue()!;
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);

        const currentDistance = distances.get(currentKey)!;
        if (currentDistance > maxCost) break;
        if (currentKey === occupiedDestinationKey) break;

        const cq = currentKey % cols;
        const cr = (currentKey - cq) / cols;
        const drTable = cq % 2 === 1 ? NEIGHBOR_DR_ODD : NEIGHBOR_DR_EVEN;
        for (let d = 0; d < 6; d++) {
            const nq = cq + NEIGHBOR_DQ[d];
            const nr = cr + drTable[d];
            if (nq < 0 || nq >= cols || nr < 0 || nr >= rows) continue;
            const neighborKey = nr * cols + nq;
            if (closed.has(neighborKey)) continue;
            const isDestination = neighborKey === occupiedDestinationKey;
            // Occupied hexes are skipped entirely, mirroring the live
            // dijkstra's coord.isOccupied() filter. Note this sees the
            // simulated positions/deaths in this branch, not the live world.
            if (!isDestination && state.getUnitAt(nq, nr)) continue;
            const building = state.getBuildingAt(nq, nr)?.[1];
            if (!isDestination && building && !isAir
                && !headquartersAllowsGroundEntry(building, unit.playerIndex)) continue;

            const tile = state.getTile(nq, nr);
            if (!tile) continue;
            // The destination is an occupied target marker, not a tile the
            // mover will enter. Give that final edge zero cost so even an air
            // target over impassable ground can be routed TOWARD; callers
            // deliberately stop before this final step.
            const terrainCost = tile.hasRoad && !isAir ? 0.5 : costs[terrainKey(tile.type)];
            if (!isDestination && !terrainCost) continue;
            const cost = isDestination ? 0 : terrainCost!;

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

// The complete cheapest route toward an occupied target, independent of the
// unit's remaining movement. The returned path includes the target marker as
// its final step; movement callers walk only the affordable prefix before it.
export function simPathToTarget(
    state: SimState,
    unitIndex: number,
    toQ: number,
    toR: number
): SimPathResult | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    if (toQ < 0 || toQ >= state.cols || toR < 0 || toR >= state.rows) return null;

    const endKey = toR * state.cols + toQ;
    const { distances, previous } = simDijkstraUncached(state, unitIndex, Infinity, endKey);
    if (!distances.has(endKey)) return null;

    const path: { q: number; r: number }[] = [];
    let currentKey = endKey;
    while (previous.has(currentKey)) {
        const q = currentKey % state.cols;
        path.unshift({ q, r: (currentKey - q) / state.cols });
        currentKey = previous.get(currentKey)!;
    }
    return { path, cost: distances.get(endKey)! };
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
    // Out of bounds can never be reachable. Explicit now that keys are
    // indices: a negative q would otherwise alias a real hex one row down.
    if (toQ < 0 || toQ >= state.cols || toR < 0 || toR >= state.rows) return null;

    const { distances, previous, reachable } = simDijkstra(state, unitIndex, maxCost);
    const endKey = toR * state.cols + toQ;
    if (!reachable.has(endKey)) return null;

    const path: { q: number; r: number }[] = [];
    let currentKey = endKey;
    while (previous.has(currentKey)) {
        const q = currentKey % state.cols;
        path.unshift({ q, r: (currentKey - q) / state.cols });
        currentKey = previous.get(currentKey)!;
    }

    return { path, cost: distances.get(endKey)! };
}

// The cost fields already computed for this turn snapshot, keyed on the
// base tile array's identity -- shared by every fork of the snapshot, the
// same trick SimState's fire caches use.
//
// The field reads nothing but tiles, so within one snapshot it is a pure
// function of (unit type, start hex) -- and the moveTowards/moveToBuilding
// dead-end fallback asks for the same handful of fields once per child
// rollout, thousands of times per beam turn. On the shipped map MOST
// starts dead-end into the fallback (see pathDeadEnd.test.ts), so this
// full-map dijkstra was being rebuilt identically for every child. A
// TERRAIN override vetoes the cache: a branch that cratered a tile into
// water computes fresh rather than trusting a stale field. Fire overrides
// do not veto -- burning changes nothing movement reads -- and that is
// load-bearing: a board with one wreck alight writes fire overrides into
// every branch, which under a blanket veto starved the cache exactly in
// the midgame states that lean on the fallback hardest.
//
// Callers receive a SHARED map and must treat it as read-only. Every
// caller only .get()s -- see SimCommands' fallbacks and pathDeadEnd.test.
const costFieldCache = new WeakMap<readonly SimTile[], Map<string, Map<number, number>>>();

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
    fromR: number,
    playerIndex?: number
): Map<number, number> {
    const cols = state.cols;
    const cacheable = !state.hasTerrainOverrides;
    const cacheKey = `${unitType}|${playerIndex ?? -1}|${state.events.length}|${fromR * cols + fromQ}`;
    if (cacheable) {
        const hit = costFieldCache.get(state.tileIdentity)?.get(cacheKey);
        if (hit) return hit;
    }

    const field = new Map<number, number>();
    const closed = new Set<number>();
    const costs = UnitSystem.unitTypesRecord[unitType].terrainCosts;
    const isAir = UnitSystem.unitTypesRecord[unitType].unitClass === 'air';
    const startKey = fromR * cols + fromQ;
    field.set(startKey, 0);

    const frontier = new PriorityQueue<number>();
    frontier.enqueue(startKey, 0);

    while (!frontier.isEmpty()) {
        const currentKey = frontier.dequeue()!;
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);
        const cq = currentKey % cols;
        const cr = (currentKey - cq) / cols;
        const currentCost = field.get(currentKey)!;

        const drTable = cq % 2 === 1 ? NEIGHBOR_DR_ODD : NEIGHBOR_DR_EVEN;
        for (let d = 0; d < 6; d++) {
            const nq = cq + NEIGHBOR_DQ[d];
            const nr = cr + drTable[d];
            if (nq < 0 || nq >= cols || nr < 0 || nr >= state.rows) continue;
            const building = state.getBuildingAt(nq, nr)?.[1];
            if (building && !isAir && (
                playerIndex === undefined || !headquartersAllowsGroundEntry(building, playerIndex)
            )) continue;
            const tile = state.getTile(nq, nr);
            if (!tile) continue;
            const step = tile.hasRoad && !isAir ? 0.5 : costs[terrainKey(tile.type)];
            if (!step) continue;
            const nextKey = nr * cols + nq;
            const next = currentCost + step;
            if (next < (field.get(nextKey) ?? Infinity)) {
                field.set(nextKey, next);
                frontier.enqueue(nextKey, next);
            }
        }
    }

    if (cacheable) {
        let perBase = costFieldCache.get(state.tileIdentity);
        if (!perBase) {
            perBase = new Map();
            costFieldCache.set(state.tileIdentity, perBase);
        }
        perBase.set(cacheKey, field);
    }
    return field;
}
