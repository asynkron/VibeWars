import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { HexCoord } from './HexCoord';
import { MAP_CONFIG } from '../../constants';

describe('HexCoord', () => {
    it('getKey/fromKey round-trip', () => {
        const coord = new HexCoord(3, -2);
        expect(coord.getKey()).toBe('3,-2');
        const parsed = HexCoord.fromKey(coord.getKey());
        expect(parsed.q).toBe(3);
        expect(parsed.r).toBe(-2);
    });

    it('isWithinMapBounds respects MAP_CONFIG.COLS/ROWS', () => {
        expect(HexCoord.isWithinMapBounds(0, 0)).toBe(true);
        expect(HexCoord.isWithinMapBounds(-1, 0)).toBe(false);
        expect(HexCoord.isWithinMapBounds(0, -1)).toBe(false);
        expect(HexCoord.isWithinMapBounds(MAP_CONFIG.COLS - 1, MAP_CONFIG.ROWS - 1)).toBe(true);
        expect(HexCoord.isWithinMapBounds(MAP_CONFIG.COLS, 0)).toBe(false);
        expect(HexCoord.isWithinMapBounds(0, MAP_CONFIG.ROWS)).toBe(false);
    });

    it('getDistance returns 0 for the same hex and is symmetric', () => {
        expect(HexCoord.getDistance(4, 4, 4, 4)).toBe(0);
        expect(HexCoord.getDistance(0, 0, 3, 0)).toBe(HexCoord.getDistance(3, 0, 0, 0));
        expect(HexCoord.getDistance(2, 5, 8, 1)).toBe(HexCoord.getDistance(8, 1, 2, 5));
    });

    it('getNeighbors returns 6 distinct coordinates', () => {
        const neighbors = HexCoord.getNeighbors(2, 2);
        expect(neighbors).toHaveLength(6);

        const keys = new Set(neighbors.map((n) => `${n.q},${n.r}`));
        expect(keys.size).toBe(6);
    });

    it('getNeighbors accounts for odd/even column offset (axial-to-offset conversion)', () => {
        // Odd and even columns shift their neighbor rows in opposite
        // directions -- this is what makes the "brick wall" of hexes line up.
        const evenColumnNeighbors = HexCoord.getNeighbors(2, 5).map((n) => n.r);
        const oddColumnNeighbors = HexCoord.getNeighbors(3, 5).map((n) => n.r);
        expect(evenColumnNeighbors).not.toEqual(oddColumnNeighbors);
    });

    it('every neighbor returned by getNeighbors is at getDistance 1, for both even and odd columns', () => {
        // Regression test: getDistance used to apply a pure axial/cube
        // distance formula directly to offset (q, r) coordinates, which
        // undercounted distance across the column-shift boundary and
        // reported 2 for one of the six actual grid neighbors. getDistance
        // now converts to cube coordinates first (see HexCoord.toCube).
        //
        // Coordinates are kept within the map's valid, non-negative domain
        // (MAP_CONFIG bounds; see isWithinMapBounds) -- getNeighbors' column
        // parity check (`q % 2 === 1`) misclassifies negative columns in JS
        // (`-5 % 2` is -1, never 1), but that never comes up in practice:
        // any neighbor landing outside the map is always discarded via
        // isValid()/getValidNeighbors() before it's used for anything.
        for (const [q, r] of [[2, 2], [3, 2], [10, 10], [20, 3], [3, 20], [48, 48]]) {
            HexCoord.getNeighbors(q, r).forEach((n) => {
                expect(HexCoord.getDistance(q, r, n.q, n.r)).toBe(1);
            });
        }
    });

    it('getDistance matches BFS shortest-path length over the real neighbor graph', () => {
        // Ground-truth check: build a small region by BFS-ing outward from
        // an interior hex through getNeighbors (i.e. actual grid adjacency),
        // and confirm getDistance agrees with each cell's BFS depth. This is
        // independent of any particular distance formula. Origin is kept
        // well within the map's valid domain -- see the note above.
        const RADIUS = 4;
        const origin = { q: 20, r: 20 };
        const bfsDistance = new Map<string, number>();
        bfsDistance.set('20,20', 0);
        let frontier = [origin];

        for (let depth = 1; depth <= RADIUS; depth++) {
            const next: { q: number; r: number }[] = [];
            for (const hex of frontier) {
                for (const n of HexCoord.getNeighbors(hex.q, hex.r)) {
                    const key = `${n.q},${n.r}`;
                    if (!bfsDistance.has(key)) {
                        bfsDistance.set(key, depth);
                        next.push(n);
                    }
                }
            }
            frontier = next;
        }

        expect(bfsDistance.size).toBeGreaterThan(1);
        for (const [key, depth] of bfsDistance) {
            const [q, r] = key.split(',').map(Number);
            expect(HexCoord.getDistance(20, 20, q, r)).toBe(depth);
        }
    });

    it('distanceTo is the instance-method equivalent of getDistance', () => {
        const a = new HexCoord(1, 1);
        const b = new HexCoord(4, 8);
        expect(a.distanceTo(b)).toBe(HexCoord.getDistance(1, 1, 4, 8));
    });

    it('isValid delegates to isWithinMapBounds', () => {
        expect(new HexCoord(0, 0).isValid()).toBe(true);
        expect(new HexCoord(-5, 0).isValid()).toBe(false);
    });
});
