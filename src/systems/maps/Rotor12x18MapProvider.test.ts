// Measures the 12x18 map's fairness rather than trusting the symmetry
// claim: real movement costs, real hex adjacency, real spawn positions.
import { describe, it, expect } from 'vitest';
import { rotor12x18MapProvider as MAP } from './Rotor12x18MapProvider';

const COLS = MAP.cols;
const ROWS = MAP.rows;

// Same offsets GridSystem.getHexNeighborsCoords uses.
const neighbours = (q: number, r: number) => (q % 2 === 1
    ? [[1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1], [1, 0]]
).map(([dq, dr]) => [q + dq, r + dr]).filter(([nq, nr]) => nq >= 0 && nq < COLS && nr >= 0 && nr < ROWS);

// Dijkstra over move cost for a ground unit (water and mountain impassable).
function costsFrom(tiles: any[][], starts: Array<[number, number]>) {
    const best = new Map<string, number>();
    const queue: Array<[number, number, number]> = [];
    for (const [q, r] of starts) { best.set(`${q},${r}`, 0); queue.push([q, r, 0]); }
    while (queue.length) {
        queue.sort((a, b) => a[2] - b[2]);
        const [q, r, c] = queue.shift()!;
        if (c > (best.get(`${q},${r}`) ?? Infinity)) continue;
        for (const [nq, nr] of neighbours(q, r)) {
            const t = tiles[nq][nr];
            if (t.type === 'WATER' || t.type === 'MOUNTAIN') continue;
            const step = c + (t.moveCost ?? 1);
            if (step < (best.get(`${nq},${nr}`) ?? Infinity)) {
                best.set(`${nq},${nr}`, step);
                queue.push([nq, nr, step]);
            }
        }
    }
    return best;
}

describe('Half Turn (12x18) balance', () => {
    const tiles = MAP.generate();
    const factories = MAP.buildings!;
    const cpuStarts = MAP.spawns.cpu.map(u => [u.q, u.r] as [number, number]);
    const playerStarts = MAP.spawns.player.map(u => [u.q, u.r] as [number, number]);
    const cpuCost = costsFrom(tiles, cpuStarts);
    const playerCost = costsFrom(tiles, playerStarts);
    const at = (m: Map<string, number>, q: number, r: number) => m.get(`${q},${r}`) ?? Infinity;

    it('is 180-degree rotationally symmetric, and NOT a mirror', () => {
        let rotationMatches = 0;
        let mirrorMatches = 0;
        for (let q = 0; q < COLS; q++) {
            for (let r = 0; r < ROWS; r++) {
                if (tiles[q][r].type === tiles[COLS - 1 - q][ROWS - 1 - r].type) rotationMatches++;
                if (tiles[q][r].type === tiles[q][ROWS - 1 - r].type) mirrorMatches++;
            }
        }
        expect(rotationMatches).toBe(COLS * ROWS);        // exact half-turn symmetry
        expect(mirrorMatches).toBeLessThan(COLS * ROWS);  // but not a reflection
    });

    it('gives both sides the same reach to their own and the far depot', () => {
        // The depot is four pieces but has ONE door, and the door is the
        // only tile a capture can happen on -- so reach to the depot means
        // reach to that tile. Measuring to a wall would report a distance
        // no capture can be made from.
        const [a, b] = factories.filter(f => f.isEntrance);
        // Each side's nearer factory, and each side's farther one.
        const cpuNear = at(cpuCost, a.q, a.r);
        const playerNear = at(playerCost, b.q, b.r);
        const cpuFar = at(cpuCost, b.q, b.r);
        const playerFar = at(playerCost, a.q, a.r);
        expect(cpuNear).toBe(playerNear);
        expect(cpuFar).toBe(playerFar);
        expect(Number.isFinite(cpuNear)).toBe(true);
        expect(Number.isFinite(cpuFar)).toBe(true);
    });

    it('gives both sides the same terrain to fight over', () => {
        const half = (rows: number[]) => {
            const counts: Record<string, number> = {};
            for (let q = 0; q < COLS; q++) for (const r of rows) {
                counts[tiles[q][r].type] = (counts[tiles[q][r].type] ?? 0) + 1;
            }
            return counts;
        };
        const north = half([...Array(ROWS / 2).keys()]);
        const south = half([...Array(ROWS / 2).keys()].map(i => ROWS - 1 - i));
        expect(south).toEqual(north);
    });

    it('gives both sides the same road network', () => {
        for (let q = 0; q < COLS; q++) {
            for (let r = 0; r < ROWS; r++) {
                expect(tiles[q][r].hasRoad).toBe(tiles[COLS - 1 - q][ROWS - 1 - r].hasRoad);
            }
        }
    });

    it('places the two depots as half-turn images of each other', () => {
        const north = factories.filter(f => !f.rotationDeg);
        const south = factories.filter(f => f.rotationDeg === 180);
        expect(north).toHaveLength(4);
        expect(south).toHaveLength(4);
        for (const n of north) {
            const mate = south.find(s => s.type === n.type);
            expect(mate).toBeDefined();
            expect(mate!.q).toBe(COLS - 1 - n.q);
            expect(mate!.r).toBe(ROWS - 1 - n.r);
        }
        // Exactly one piece per depot carries the hidden unit.
        expect(north.filter(f => f.hiddenUnitType).length).toBe(1);
        expect(south.filter(f => f.hiddenUnitType).length).toBe(1);
    });

    it('assembles each depot as the diamond its pieces are cut for', () => {
        // The N piece is capped along NW/N/NE and open toward SW/S/SE; E is
        // capped east and open toward NW/SW. Only the diamond -- N on top,
        // W and E either side, S below -- leaves every open edge against
        // another piece. Anything else buries trim inside the complex.
        for (const rotationDeg of [0, 180]) {
            const depot = factories.filter(f => (f.rotationDeg ?? 0) === rotationDeg);
            const piece = (t: string) => depot.find(f => f.type === t)!;
            const n = piece('forgeDepotN');
            const sign = rotationDeg ? -1 : 1;
            // The anchor's column must be even for these offsets to hold.
            expect((rotationDeg ? COLS - 1 - n.q : n.q) % 2).toBe(0);
            expect([piece('forgeDepotW').q, piece('forgeDepotW').r]).toEqual([n.q - sign, n.r]);
            expect([piece('forgeDepotE').q, piece('forgeDepotE').r]).toEqual([n.q + sign, n.r]);
            expect([piece('forgeDepotS').q, piece('forgeDepotS').r]).toEqual([n.q, n.r + sign]);
        }
    });

    it('keeps every depot piece on passable ground', () => {
        for (const f of factories) {
            const type = tiles[f.q][f.r].type;
            expect(type === 'WATER' || type === 'MOUNTAIN').toBe(false);
        }
    });

    it('keeps roads off the factory tiles and out of the water', () => {
        // A building tile never gets its road drawn: smoothHexTile returns
        // early for it, before the road is created. A road authored under a
        // factory would silently vanish and leave a gap in the network.
        for (const f of factories) {
            expect(tiles[f.q][f.r].hasRoad).toBe(false);
        }
        for (let q = 0; q < COLS; q++) {
            for (let r = 0; r < ROWS; r++) {
                if (tiles[q][r].type === 'WATER') expect(tiles[q][r].hasRoad).toBe(false);
            }
        }
    });

    it('leaves neither side a shorter road to the middle', () => {
        const waist = ROWS / 2;
        let cpuBest = Infinity, playerBest = Infinity;
        for (let q = 0; q < COLS; q++) {
            cpuBest = Math.min(cpuBest, at(cpuCost, q, waist - 1), at(cpuCost, q, waist));
            playerBest = Math.min(playerBest, at(playerCost, q, waist - 1), at(playerCost, q, waist));
        }
        expect(cpuBest).toBe(playerBest);
    });
});
