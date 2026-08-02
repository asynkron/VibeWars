import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { simDijkstra, simPath, simMoveCost } from './SimPathfinding';
import { HexCoord } from '../../shared/hexengine/HexCoord';

// Tile factories. Types must exist in UnitSystem terrainCosts (upper-cased).
const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });
const water = () => ({ height: 0.3, type: 'WATER', hasRoad: false, moveCost: Infinity });
const forest = () => ({ height: 1, type: 'FOREST', hasRoad: false, moveCost: 2 });

function makeUnit(patch: any = {}) {
    return {
        type: 'Tank1', q: 2, r: 2, playerIndex: 1, hp: 10, maxHp: 10,
        move: 2, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false,
        ...patch,
    };
}

// Build a SimState over a 6x6 grid. tileAt(q, r) decides each tile; units
// as given.
function makeState(tileAt: (q: number, r: number) => any, units: any[]): SimState {
    const cols = 6, rows = 6;
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tileAt(q, r) },
        units,
    });
}

const key = (q: number, r: number) => `${q},${r}`;

describe('simMoveCost', () => {
    it('roads cost 0.5 regardless of terrain and unit type', () => {
        const state = makeState((q, r) => (q === 3 && r === 2 ? { ...water(), hasRoad: true } : grass()), [makeUnit()]);
        expect(simMoveCost(state, 'Tank1', 3, 2)).toBe(0.5);
    });

    it('uses the unit type terrain costs, null when impassable', () => {
        const state = makeState((q) => (q === 3 ? water() : q === 4 ? forest() : grass()), [makeUnit()]);
        expect(simMoveCost(state, 'Tank1', 2, 2)).toBe(1);      // grass
        expect(simMoveCost(state, 'Tank1', 4, 2)).toBe(2);      // forest
        expect(simMoveCost(state, 'Tank1', 3, 2)).toBeNull();   // water impassable for tanks
        expect(simMoveCost(state, 'NightjarHelo', 3, 2)).toBe(1); // flyer crosses water
    });
});

describe('simDijkstra', () => {
    it('reaches all hexes within the movement budget on open grass', () => {
        const state = makeState(() => grass(), [makeUnit({ move: 2 })]);
        const { reachable, distances } = simDijkstra(state, 0, 2);

        // Every direct neighbor costs 1.
        for (const n of HexCoord.getNeighbors(2, 2)) {
            expect(reachable.has(key(n.q, n.r))).toBe(true);
            expect(distances.get(key(n.q, n.r))).toBe(1);
        }
        // The start itself is reachable at cost 0.
        expect(distances.get(key(2, 2))).toBe(0);
    });

    it('water blocks ground units but not flyers', () => {
        // Everything except the start tile is water.
        const state = makeState((q, r) => (q === 2 && r === 2 ? grass() : water()), [
            makeUnit({ type: 'Tank1', move: 2 }),
        ]);
        const tank = simDijkstra(state, 0, 2);
        expect(tank.reachable.size).toBe(1); // only the start

        const state2 = makeState((q, r) => (q === 2 && r === 2 ? grass() : water()), [
            makeUnit({ type: 'NightjarHelo', move: 2 }),
        ]);
        const helo = simDijkstra(state2, 0, 2);
        expect(helo.reachable.size).toBeGreaterThan(1);
    });

    it('occupied hexes are skipped entirely', () => {
        // Grass everywhere; an enemy sits on one specific neighbor.
        const blocked = HexCoord.getNeighbors(2, 2)[1];
        const state = makeState(() => grass(), [
            makeUnit({ move: 1 }),
            makeUnit({ q: blocked.q, r: blocked.r, playerIndex: 0 }),
        ]);
        const { reachable } = simDijkstra(state, 0, 1);
        expect(reachable.has(key(blocked.q, blocked.r))).toBe(false);
        // The other five neighbors are fine.
        const others = HexCoord.getNeighbors(2, 2).filter((n) => !(n.q === blocked.q && n.r === blocked.r));
        others.forEach((n) => expect(reachable.has(key(n.q, n.r))).toBe(true));
    });

    it('terrain sunk to water mid-branch blocks that branch but not siblings', () => {
        // Start + one neighbor chain of grass, everything else water: the
        // neighbor acts as a bridge.
        const bridge = HexCoord.getNeighbors(2, 2)[0];
        const beyond = HexCoord.getNeighbors(bridge.q, bridge.r).find(
            (n) => !(n.q === 2 && n.r === 2)
        )!;
        const isLand = (q: number, r: number) =>
            (q === 2 && r === 2) || (q === bridge.q && r === bridge.r) || (q === beyond.q && r === beyond.r);
        const base = makeState((q, r) => (isLand(q, r) ? grass() : water()), [makeUnit({ move: 3 })]);

        const sunk = base.fork();
        // Sink the bridge below the effective water level (0.3).
        sunk.record({ type: 'terrainModified', q: bridge.q, r: bridge.r, delta: -5 });

        const before = simDijkstra(base.fork(), 0, 3);
        const after = simDijkstra(sunk, 0, 3);

        expect(before.reachable.has(key(beyond.q, beyond.r))).toBe(true);
        expect(after.reachable.has(key(bridge.q, bridge.r))).toBe(false);
        expect(after.reachable.has(key(beyond.q, beyond.r))).toBe(false);
        // The original branch is untouched.
        expect(simDijkstra(base, 0, 3).reachable.has(key(beyond.q, beyond.r))).toBe(true);
    });
});

describe('simPath', () => {
    it('returns ordered steps excluding the start, with total cost', () => {
        const bridge = HexCoord.getNeighbors(2, 2)[0];
        const beyond = HexCoord.getNeighbors(bridge.q, bridge.r).find(
            (n) => !(n.q === 2 && n.r === 2)
        )!;
        const state = makeState(() => grass(), [makeUnit({ move: 5 })]);

        const result = simPath(state, 0, beyond.q, beyond.r, 5)!;
        expect(result).not.toBeNull();
        expect(result.path[result.path.length - 1]).toEqual({ q: beyond.q, r: beyond.r });
        expect(result.path.some((s) => s.q === 2 && s.r === 2)).toBe(false); // start excluded
        expect(result.cost).toBe(result.path.length); // all grass, cost 1 per step
        expect(result.cost).toBeLessThanOrEqual(2);
    });

    it('returns null when the destination is beyond maxCost', () => {
        const state = makeState(() => grass(), [makeUnit({ move: 1 })]);
        expect(simPath(state, 0, 5, 5, 1)).toBeNull();
    });
});
