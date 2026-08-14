// The random maps had no tests at all, for a reason worth recording: their
// generate() calls TerrainSystem.getLerpedTerrainColor, which does real
// arithmetic on THREE.Color's channels, and the test stub answered every
// property with a proxy -- so merely generating one threw "Cannot convert
// object to primitive value". The stub now carries a real Color. These are
// the first assertions this map has ever had.
//
// The authored maps get authoredMaps.test.ts, which measures things only a
// symmetric map can promise. A random map cannot promise its two sides
// identical ground. What it CAN promise is that nothing it places is
// stranded, unreachable or overlapping -- which is what this checks.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { RANDOM_PROVIDERS } from './mapRegistry';
import { MAP_SIZES } from '../../constants';
import { StartingUnit } from './MapProvider';
import { hexDistance } from '../../shared/hexengine/hexMath';
import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { unitTypesRecord } from '../../shared/hexengine/unitStats';
import type { BuildingSpawn, TileLike } from '../../types';
import {
    hqDoorApproach,
    hqDoorCell,
    islandNoiseValue,
    randomBuildingRotationDeg,
} from './PerlinMapProvider';

const EXPECTED = {
    // Authored per size: 1/2/3 Pike + 1/2/3 Drover and 1/2/3 AttackBoat.
    // Small fields no AA because it fields no air -- see the roster note
    // in PerlinMapProvider.
    random20: { units: 4, boats: 1, depots: 2 },
    random30: { units: 10, boats: 2, depots: 3 },
    random30fixed: { units: 0, boats: 0, depots: 3 },
    random50: { units: 16, boats: 3, depots: 7 },
} as const;

function generatedSignature(provider: (typeof RANDOM_PROVIDERS)[number]): string {
    const tiles = provider.generate();
    return JSON.stringify({
        tiles: tiles.map((column) => column.map((tile) => [
            tile.type,
            tile.height,
            tile.color,
        ])),
        spawns: provider.spawns,
        buildings: provider.buildings,
    });
}

describe('fixed random 30x30 map', () => {
    it('recreates identical terrain, placements, and rotations from its hard seed', () => {
        const provider = RANDOM_PROVIDERS.find((candidate) => candidate.key === 'random30fixed')!;
        expect(provider.seed).toBeDefined();
        expect(generatedSignature(provider)).toBe(generatedSignature(provider));
    });
});

const neighbourOffsets = (q: number) => (q % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]);

describe('random HQ rotation', () => {
    it('can select each of the six hex-grid directions', () => {
        const directions = Array.from({ length: 6 }, (_, index) =>
            randomBuildingRotationDeg(() => (index + 0.5) / 6));
        expect(directions).toEqual([0, 60, 120, 180, 240, 300]);
    });
});

describe('random island edge field', () => {
    it('forces the perimeter to deep water and leaves the interior noise untouched', () => {
        expect(islandNoiseValue(0.92, 0, 10, 20, 20)).toBe(0.18);
        expect(islandNoiseValue(0.92, 10, 0, 20, 20)).toBe(0.18);
        expect(islandNoiseValue(0.92, 19, 10, 20, 20)).toBe(0.18);
        expect(islandNoiseValue(0.92, 10, 19, 20, 20)).toBe(0.18);
        expect(islandNoiseValue(0.63, 10, 10, 20, 20)).toBe(0.63);
    });
});

function neighbours(q: number, r: number, cols: number, rows: number) {
    return neighbourOffsets(q)
        .map(([dq, dr]) => [q + dq, r + dr] as [number, number])
        .filter(([nq, nr]) => nq >= 0 && nq < cols && nr >= 0 && nr < rows);
}

function stepCost(type: string, tile: TileLike): number | null {
    const cost = unitTypesRecord[type]?.terrainCosts?.[tile.type];
    return cost == null ? null : cost;
}

// Everything one unit type can walk to from a start.
function reachable(tiles: TileLike[][], cols: number, rows: number, type: string, from: [number, number]) {
    const seen = new Set<string>([`${from[0]},${from[1]}`]);
    const queue: Array<[number, number]> = [from];
    for (let head = 0; head < queue.length; head++) {
        const [q, r] = queue[head];
        for (const [nq, nr] of neighbours(q, r, cols, rows)) {
            if (seen.has(`${nq},${nr}`)) continue;
            if (stepCost(type, tiles[nq][nr]) == null) continue;
            seen.add(`${nq},${nr}`);
            queue.push([nq, nr]);
        }
    }
    return seen;
}

describe.each(RANDOM_PROVIDERS.map((p) => [p.key, p] as const))('random map: %s', (key, provider) => {
    const { cols, rows } = provider;
    const expected = EXPECTED[key as keyof typeof EXPECTED];
    // generate() first, then read spawns and buildings -- the order every
    // real caller uses, and the order the provider's placement depends on.
    const tiles = provider.generate();
    const spawns = provider.spawns;
    const buildings = provider.buildings ?? [];
    const groups = new Map<string, BuildingSpawn[]>();
    for (const piece of buildings) {
        if (!piece.groupId || !piece.type.startsWith('forgeDepot')) continue;
        groups.set(piece.groupId!, [...(groups.get(piece.groupId!) ?? []), piece]);
    }

    it('is the size the table promises', () => {
        expect([MAP_SIZES[key].cols, MAP_SIZES[key].rows]).toEqual([cols, rows]);
        expect(tiles).toHaveLength(cols);
    });

    it('is always surrounded by a complete ring of water', () => {
        for (let q = 0; q < cols; q++) {
            expect(tiles[q][0].type, `north edge ${q},0`).toBe('WATER');
            expect(tiles[q][rows - 1].type, `south edge ${q},${rows - 1}`).toBe('WATER');
        }
        for (let r = 0; r < rows; r++) {
            expect(tiles[0][r].type, `west edge 0,${r}`).toBe('WATER');
            expect(tiles[cols - 1][r].type, `east edge ${cols - 1},${r}`).toBe('WATER');
        }
    });

    it('keeps the complete water ring across fresh Perlin crops', () => {
        for (let sample = 0; sample < 10; sample++) {
            const fresh = provider.generate();
            for (let q = 0; q < cols; q++) {
                expect(fresh[q][0].type).toBe('WATER');
                expect(fresh[q][rows - 1].type).toBe('WATER');
            }
            for (let r = 0; r < rows; r++) {
                expect(fresh[0][r].type).toBe('WATER');
                expect(fresh[cols - 1][r].type).toBe('WATER');
            }
        }
    });

    it(`fields ${expected.units} units a side, the same on both`, () => {
        expect(spawns.player).toHaveLength(expected.units);
        expect(spawns.cpu).toHaveLength(expected.units);
        const types = (units: StartingUnit[]) => units.map((u) => u.type).sort();
        expect(types(spawns.cpu)).toEqual(types(spawns.player));
    });

    it(`fields ${expected.boats} attack boats a side on one connected waterway`, () => {
        const playerBoats = spawns.player.filter((unit) => unit.type === 'AttackBoat');
        const cpuBoats = spawns.cpu.filter((unit) => unit.type === 'AttackBoat');
        expect(playerBoats).toHaveLength(expected.boats);
        expect(cpuBoats).toHaveLength(expected.boats);
        for (const boat of [...playerBoats, ...cpuBoats]) {
            expect(tiles[boat.q][boat.r].type).toBe('WATER');
        }
        if (!expected.boats) return;
        const first = playerBoats[0];
        const connected = reachable(tiles, cols, rows, first.type, [first.q, first.r]);
        for (const boat of [...playerBoats, ...cpuBoats]) {
            expect(connected.has(`${boat.q},${boat.r}`), `${boat.q},${boat.r} is in another lake`).toBe(true);
        }
    });

    it('gives each side infantry, or the depots are scenery', () => {
        if (!expected.units) return;
        // Only canCapture units take a building, so a roster without one
        // makes every depot on the map unwinnable furniture. This is why
        // Pike is third in the roster rather than fifth.
        for (const side of [spawns.player, spawns.cpu]) {
            expect(side.some((u) => unitTypesRecord[u.type]?.canCapture)).toBe(true);
        }
    });

    it(`places ${expected.depots} forge depots, four pieces each`, () => {
        expect(groups.size).toBe(expected.depots);
        for (const [groupId, pieces] of groups) {
            expect(pieces, groupId).toHaveLength(4);
            expect(pieces.map((p) => p.type).sort())
                .toEqual(['forgeDepotE', 'forgeDepotN', 'forgeDepotS', 'forgeDepotW']);
        }
    });

    it('gives each side exactly one owned seven-tile HQ', () => {
        const headquarters = buildings.filter((building) => building.type === 'hq');
        expect(headquarters).toHaveLength(14);
        for (const ownerIndex of [0, 1]) {
            const pieces = headquarters.filter((building) => building.ownerIndex === ownerIndex);
            expect(pieces).toHaveLength(7);
            expect(new Set(pieces.map((piece) => piece.groupId))).toEqual(new Set([`hq@player${ownerIndex}`]));
            expect(pieces.filter((piece) => !piece.drawnByAnchor)).toHaveLength(1);
            expect(pieces.filter((piece) => piece.drawnByAnchor)).toHaveLength(6);
            expect(pieces.filter((piece) => piece.isEntrance)).toHaveLength(1);
            for (const piece of pieces) expect(piece.hiddenUnitType).toBeNull();
            expect(new Set(pieces.map((piece) => piece.rotationDeg)).size).toBe(1);
            expect([0, 60, 120, 180, 240, 300]).toContain(pieces[0].rotationDeg);

            const anchor = pieces.find((piece) => !piece.drawnByAnchor)!;
            for (const piece of pieces.filter((candidate) => candidate !== anchor)) {
                expect(hexDistance(anchor.q, anchor.r, piece.q, piece.r)).toBe(1);
            }
        }
    });

    it('keeps every rotated HQ door on clear, reachable ground', () => {
        const occupied = new Set(
            [...spawns.player, ...spawns.cpu, ...buildings].map(({ q, r }) => `${q},${r}`)
        );
        for (const ownerIndex of [0, 1]) {
            const pieces = buildings.filter(
                (building) => building.type === 'hq' && building.ownerIndex === ownerIndex
            );
            const anchor = pieces.find((piece) => !piece.drawnByAnchor)!;
            const turns = (anchor.rotationDeg ?? 0) / 60;
            const [entranceQ, entranceR] = hqDoorCell(anchor.q, anchor.r, turns);
            const [doorQ, doorR] = hqDoorApproach(anchor.q, anchor.r, turns);
            const doorKey = `${doorQ},${doorR}`;

            expect(TerrainSystem.isImpassable(tiles[doorQ][doorR].type), doorKey).toBe(false);
            expect(occupied.has(doorKey), `HQ door blocked at ${doorKey}`).toBe(false);
            expect(pieces.find((piece) => piece.isEntrance)).toMatchObject({ q: entranceQ, r: entranceR });
            expect(hexDistance(entranceQ, entranceR, doorQ, doorR)).toBe(1);

            for (const side of [spawns.player, spawns.cpu]) {
                if (!side.length) continue;
                const walker = side[0];
                const canReach = reachable(tiles, cols, rows, walker.type, [walker.q, walker.r]);
                expect(canReach.has(doorKey), `${walker.type} cannot drive to HQ door at ${doorKey}`).toBe(true);
            }
        }
    });

    it('gives every depot exactly one door, holding exactly one prize', () => {
        for (const [groupId, pieces] of groups) {
            const doors = pieces.filter((p) => p.isEntrance);
            expect(doors, groupId).toHaveLength(1);
            expect(doors[0].type).toBe('forgeDepotS');
            expect(pieces.filter((p) => p.hiddenUnitType).map((p) => p.type)).toEqual(['forgeDepotS']);
        }
    });

    it('builds every depot as a contiguous fan around its anchor', () => {
        // This used to demand an EVEN anchor column and the three literal
        // cells (q-1,r), (q,r+1), (q+1,r) -- which is the fan only on an
        // even column, and only pointing south. The cells now come from a
        // turn in cube coordinates, so the anchor's parity no longer means
        // anything and a depot can face any of six ways.
        //
        // What still has to hold is the SHAPE, because the models are cut
        // for it: every piece touching the anchor, and W-S-E touching each
        // other in that order, so each open edge meets another piece.
        for (const [groupId, pieces] of groups) {
            const at = (type: string) => pieces.find((p) => p.type === type)!;
            const n = at('forgeDepotN'), w = at('forgeDepotW');
            const s = at('forgeDepotS'), e = at('forgeDepotE');
            for (const piece of [w, s, e]) {
                expect(hexDistance(n.q, n.r, piece.q, piece.r), `${groupId} ${piece.type} to anchor`).toBe(1);
            }
            expect(hexDistance(w.q, w.r, s.q, s.r), `${groupId} W to S`).toBe(1);
            expect(hexDistance(s.q, s.r, e.q, e.r), `${groupId} S to E`).toBe(1);
            // The ends of the fan stay apart -- closed, it would be a ring
            // around a hex that is not the anchor.
            expect(hexDistance(w.q, w.r, e.q, e.r), `${groupId} W to E`).toBe(2);
        }
    });

    it('turns every depot to one of the six headings, models with cells', () => {
        for (const [groupId, pieces] of groups) {
            const headings = new Set(pieces.map((p) => p.rotationDeg));
            // One heading per depot: a piece turned differently from its
            // neighbours joins nothing.
            expect(headings.size, `${groupId} headings`).toBe(1);
            expect([0, 60, 120, 180, 240, 300]).toContain([...headings][0]);
        }
    });

    it('stands each depot on one level platform', () => {
        // A building tile keeps its authored height exactly -- smoothHexTile
        // returns early for it -- so four heights is a step through the
        // middle of the building.
        for (const [groupId, pieces] of groups) {
            const heights = pieces.map((p) => tiles[p.q][p.r].height);
            for (const height of heights) expect(height, groupId).toBe(heights[0]);
        }
    });

    it('stands each seven-tile HQ on one level platform', () => {
        for (const ownerIndex of [0, 1]) {
            const pieces = buildings.filter(
                (building) => building.type === 'hq' && building.ownerIndex === ownerIndex
            );
            const heights = pieces.map((piece) => tiles[piece.q][piece.r].height);
            expect(heights).toHaveLength(7);
            for (const height of heights) expect(height).toBe(heights[0]);
        }
    });

    it('puts nothing on ground it cannot stand on', () => {
        for (const unit of [...spawns.player, ...spawns.cpu]) {
            expect(stepCost(unit.type, tiles[unit.q][unit.r]), `${unit.type} at ${unit.q},${unit.r}`)
                .not.toBeNull();
        }
        for (const piece of buildings) {
            expect(TerrainSystem.isImpassable(tiles[piece.q][piece.r].type), `${piece.q},${piece.r}`)
                .toBe(false);
        }
    });

    it('never stacks two things on one hex', () => {
        const keys = [...spawns.player, ...spawns.cpu, ...buildings].map((x) => `${x.q},${x.r}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('keeps the depots apart', () => {
        // Two depots that touch are one objective wearing two hats: an
        // infantryman between both doors takes them on consecutive turns
        // without moving.
        for (const [a, piecesA] of groups) {
            for (const [b, piecesB] of groups) {
                if (a >= b) continue;
                for (const pieceA of piecesA) {
                    for (const [nq, nr] of neighbours(pieceA.q, pieceA.r, cols, rows)) {
                        expect(
                            piecesB.some((p) => p.q === nq && p.r === nr),
                            `${a} touches ${b} at ${nq},${nr}`
                        ).toBe(false);
                    }
                }
            }
        }
    });

    it('lets every unit reach every enemy in its movement domain and every depot door', () => {
        // The whole point of placing on the mainland. A unit on an island is
        // out of the match, and a depot on one can never be captured.
        const doors = buildings.filter((p) => p.type.startsWith('forgeDepot') && p.isEntrance);
        expect(doors).toHaveLength(expected.depots);
        for (const mine of spawns.player) {
            const canReach = reachable(tiles, cols, rows, mine.type, [mine.q, mine.r]);
            const mineIsNaval = unitTypesRecord[mine.type].unitClass === 'naval';
            for (const theirs of spawns.cpu.filter(
                (unit) => (unitTypesRecord[unit.type].unitClass === 'naval') === mineIsNaval
            )) {
                expect(
                    canReach.has(`${theirs.q},${theirs.r}`),
                    `${mine.type} at ${mine.q},${mine.r} cannot reach ${theirs.type} at ${theirs.q},${theirs.r}`
                ).toBe(true);
            }
        }
        // Doors specifically, and with the capturing class, since reaching a
        // depot with a tank proves nothing about taking it.
        for (const side of [spawns.player, spawns.cpu]) {
            const capturer = side.find((u) => unitTypesRecord[u.type]?.canCapture);
            if (!capturer) continue;
            const canReach = reachable(tiles, cols, rows, capturer.type, [capturer.q, capturer.r]);
            for (const door of doors) {
                expect(canReach.has(`${door.q},${door.r}`), `no route to the door at ${door.q},${door.r}`)
                    .toBe(true);
            }
        }

        // HQs are destruction objectives rather than capture targets, but
        // they still have to belong to the same playable mainland as both
        // armies. Otherwise a side could receive an unreachable objective.
        const headquarters = buildings.filter((building) => building.type === 'hq');
        for (const side of [spawns.player, spawns.cpu]) {
            if (!side.length) continue;
            const walker = side[0];
            const canReach = reachable(tiles, cols, rows, walker.type, [walker.q, walker.r]);
            for (const headquartersBuilding of headquarters) {
                expect(
                    canReach.has(`${headquartersBuilding.q},${headquartersBuilding.r}`),
                    `${walker.type} cannot reach HQ at ${headquartersBuilding.q},${headquartersBuilding.r}`
                ).toBe(true);
            }
        }
    });
});
