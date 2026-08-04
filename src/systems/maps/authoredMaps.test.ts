// The bar every authored map has to clear, run over all of them at once.
//
// Per-map test files check things only that map has -- Rotor12x18's depot
// diamond, Mirror8's factory pair. This file checks what makes a map a
// COMPETITIVE map at all, and it reads its list from the registry, so adding
// a provider to AUTHORED_PROVIDERS is what subjects it to these. That is
// deliberate: the way to add a map should be the way to get it tested.
//
// The connectivity test is here because of a bug that had already shipped.
// The AI could not walk around obstacles, and 74 of 84 starting positions
// left a tank stuck against a ridge. That was a pathfinding fault rather
// than a map fault -- but a map that walls a corner off produces the same
// symptom, and nothing here would have caught it.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { AUTHORED_PROVIDERS } from './mapRegistry';
import { MAP_SIZES } from '../../constants';
import { MapProvider, StartingUnit } from './MapProvider';
import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { unitTypesRecord } from '../../shared/hexengine/unitStats';
import type { TileLike } from '../../types';

// Same offsets GridSystem.getHexNeighborsCoords uses.
const neighbourOffsets = (q: number) => (q % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]);

function neighbours(q: number, r: number, cols: number, rows: number) {
    return neighbourOffsets(q)
        .map(([dq, dr]) => [q + dq, r + dr] as [number, number])
        .filter(([nq, nr]) => nq >= 0 && nq < cols && nr >= 0 && nr < rows);
}

// Move cost for one unit type onto one tile, or null where it cannot go.
// Reads the unit's OWN terrainCosts, because the roster disagrees about
// what is passable: Pike crosses mountains, Nightjar flies over everything.
function stepCost(type: string, tile: TileLike): number | null {
    const cost = unitTypesRecord[type]?.terrainCosts?.[tile.type];
    if (cost == null) return null;
    return tile.hasRoad ? 0.5 : cost;
}

// Cheapest cost from a start to every reachable tile, for one unit type.
function costField(tiles: TileLike[][], cols: number, rows: number, type: string, from: [number, number]) {
    const best = new Map<string, number>();
    best.set(`${from[0]},${from[1]}`, 0);
    const queue: Array<[number, number, number]> = [[from[0], from[1], 0]];
    while (queue.length) {
        queue.sort((a, b) => a[2] - b[2]);
        const [q, r, cost] = queue.shift()!;
        if (cost > (best.get(`${q},${r}`) ?? Infinity)) continue;
        for (const [nq, nr] of neighbours(q, r, cols, rows)) {
            const step = stepCost(type, tiles[nq][nr]);
            if (step == null) continue;
            const next = cost + step;
            if (next < (best.get(`${nq},${nr}`) ?? Infinity)) {
                best.set(`${nq},${nr}`, next);
                queue.push([nq, nr, next]);
            }
        }
    }
    return best;
}

// Which of the two transforms this map is symmetric under, checking type,
// height and roads together. A map has to be exactly one or the other; the
// test does not care which, only that both sides face the same ground.
type Transform = { name: string; of: (q: number, r: number, cols: number, rows: number) => [number, number] };
const TRANSFORMS: Transform[] = [
    { name: 'north/south mirror', of: (q, r, _cols, rows) => [q, rows - 1 - r] },
    { name: 'half turn', of: (q, r, cols, rows) => [cols - 1 - q, rows - 1 - r] },
];

function symmetryOf(provider: MapProvider, tiles: TileLike[][]): Transform | null {
    const { cols, rows } = provider;
    return TRANSFORMS.find((transform) => {
        for (let q = 0; q < cols; q++) {
            for (let r = 0; r < rows; r++) {
                const [mq, mr] = transform.of(q, r, cols, rows);
                const a = tiles[q][r];
                const b = tiles[mq][mr];
                if (a.type !== b.type || a.height !== b.height || a.hasRoad !== b.hasRoad) return false;
            }
        }
        return true;
    }) ?? null;
}

describe.each(AUTHORED_PROVIDERS.map((p) => [p.key, p] as const))('authored map: %s', (key, provider) => {
    const { cols, rows } = provider;
    const tiles = provider.generate();
    const all: Array<[number, number]> = [];
    for (let q = 0; q < cols; q++) for (let r = 0; r < rows; r++) all.push([q, r]);
    const spawns = provider.spawns;
    const buildings = provider.buildings ?? [];

    it('agrees with the size table constants.ts reads before any provider loads', () => {
        // MAP_CONFIG.ROWS/COLS are baked at module scope from this table, so
        // a provider that disagrees builds a grid of the wrong size.
        expect(MAP_SIZES[key], `${key} is missing from MAP_SIZES`).toBeDefined();
        expect([MAP_SIZES[key].cols, MAP_SIZES[key].rows]).toEqual([cols, rows]);
        expect(tiles).toHaveLength(cols);
        for (const column of tiles) expect(column).toHaveLength(rows);
    });

    it('gives both sides identical ground, to the bit', () => {
        const symmetry = symmetryOf(provider, tiles);
        expect(symmetry, `${key} is symmetric under neither transform`).not.toBeNull();
    });

    it('produces the same map on every load', () => {
        const again = provider.generate();
        for (const [q, r] of all) {
            expect(again[q][r].type).toBe(tiles[q][r].type);
            expect(again[q][r].height).toBe(tiles[q][r].height);
            expect(again[q][r].hasRoad).toBe(tiles[q][r].hasRoad);
        }
    });

    it('gives both sides the same roster', () => {
        const types = (units: StartingUnit[]) => units.map((u) => u.type).sort();
        expect(spawns.player.length).toBeGreaterThan(0);
        expect(types(spawns.player)).toEqual(types(spawns.cpu));
    });

    it('starts every unit on ground it can stand on', () => {
        for (const unit of [...spawns.player, ...spawns.cpu]) {
            const tile = tiles[unit.q]?.[unit.r];
            expect(tile, `${unit.type} at ${unit.q},${unit.r} is off the map`).toBeDefined();
            expect(
                stepCost(unit.type, tile),
                `${unit.type} starts on ${tile.type} at ${unit.q},${unit.r}`
            ).not.toBeNull();
        }
    });

    it('starts no two units on the same hex', () => {
        const keys = [...spawns.player, ...spawns.cpu].map((u) => `${u.q},${u.r}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('lets every unit reach every enemy unit on its own feet', () => {
        // The one that matters most. Water and mountain are the only things
        // that can cut a map in two, and a corner walled off by them is a
        // unit that spends the match walking into a wall -- which is exactly
        // what the movement bug looked like from the outside.
        for (const mine of spawns.player) {
            const field = costField(tiles, cols, rows, mine.type, [mine.q, mine.r]);
            for (const theirs of spawns.cpu) {
                const reach = field.get(`${theirs.q},${theirs.r}`);
                expect(
                    reach,
                    `${mine.type} at ${mine.q},${mine.r} cannot reach ${theirs.type} at ${theirs.q},${theirs.r}`
                ).toBeDefined();
            }
        }
    });

    it('leaves neither side a shorter walk to any building', () => {
        if (!buildings.length) return;
        // Measured with the capturing class, since capturing is what a
        // building is for, and compared as SETS rather than pairwise. What
        // fairness means here is that the costs one side faces are the costs
        // the other side faces -- not that any particular building is
        // equidistant, which on a rotational map it never is.
        //
        // This is the assertion that caught the 8x8 map being a north/south
        // mirror on a grid where a north/south mirror is not a symmetry: the
        // two sides paid {3, 6} and {3, 5} to the same pair of factories.
        const capturers = (units: StartingUnit[]) =>
            units.filter((u) => unitTypesRecord[u.type]?.canCapture);
        expect(capturers(spawns.player).length, `${key} has buildings but nothing that captures`)
            .toBeGreaterThan(0);

        const costs = (from: StartingUnit[]) => buildings
            .map((building) => Math.min(...capturers(from).map((u) =>
                costField(tiles, cols, rows, u.type, [u.q, u.r]).get(`${building.q},${building.r}`) ?? Infinity)))
            .sort((a, b) => a - b);

        const mine = costs(spawns.player);
        const theirs = costs(spawns.cpu);
        expect(mine.every(Number.isFinite), `${key} has a building nobody can reach`).toBe(true);
        expect(theirs).toEqual(mine);
    });

    it('puts every building on ground and none of them under a unit', () => {
        const occupied = new Set([...spawns.player, ...spawns.cpu].map((u) => `${u.q},${u.r}`));
        for (const building of buildings) {
            const tile = tiles[building.q]?.[building.r];
            expect(tile, `building at ${building.q},${building.r} is off the map`).toBeDefined();
            expect(TerrainSystem.isImpassable(tile.type)).toBe(false);
            expect(occupied.has(`${building.q},${building.r}`)).toBe(false);
            expect(tile.hasRoad, 'a road under a building').toBe(false);
        }
    });

    it('never lays a road on water', () => {
        for (const [q, r] of all) {
            if (tiles[q][r].type === 'WATER') expect(tiles[q][r].hasRoad).toBe(false);
        }
    });

    it('authors its own roads instead of asking for random ones', () => {
        expect(provider.randomRoads).toBe(0);
    });
});
