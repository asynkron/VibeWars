import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { HexCoord } from './HexCoord';

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
        expect(HexCoord.isWithinMapBounds(49, 49)).toBe(true);
        expect(HexCoord.isWithinMapBounds(50, 0)).toBe(false);
        expect(HexCoord.isWithinMapBounds(0, 50)).toBe(false);
    });

    it('getDistance returns 0 for the same hex and is symmetric', () => {
        expect(HexCoord.getDistance(4, 4, 4, 4)).toBe(0);
        expect(HexCoord.getDistance(0, 0, 3, 0)).toBe(HexCoord.getDistance(3, 0, 0, 0));
    });

    it('getDistance matches axial hex-distance formula', () => {
        // distance = (|dq| + |dr| + |dq+dr|) / 2
        expect(HexCoord.getDistance(0, 0, 2, -1)).toBe(2);
        expect(HexCoord.getDistance(0, 0, 0, 3)).toBe(3);
        expect(HexCoord.getDistance(1, 1, -2, -2)).toBe(6);
    });

    it('getNeighbors returns 6 distinct coordinates', () => {
        const neighbors = HexCoord.getNeighbors(2, 2);
        expect(neighbors).toHaveLength(6);

        const keys = new Set(neighbors.map((n) => `${n.q},${n.r}`));
        expect(keys.size).toBe(6);
    });

    it('getDistance disagrees with getNeighbors for one of the six directions (pre-existing quirk)', () => {
        // getNeighbors works in offset coordinates (odd/even column shift);
        // getDistance applies a pure axial/cube-distance formula directly to
        // those same (q, r) pairs without converting to axial first. For 5
        // of 6 directions this coincidentally still reports distance 1, but
        // the "column-shift" diagonal (index 0 for even columns, index 3 for
        // odd columns) reports distance 2 for an actual grid neighbor.
        // Documented here rather than fixed -- PathfindingSystem's A*
        // heuristic uses getDistance, so this affects estimated (not
        // necessarily final) path costs in that one direction.
        const evenColumnNeighbors = HexCoord.getNeighbors(2, 2);
        const evenDistances = evenColumnNeighbors.map((n) => HexCoord.getDistance(2, 2, n.q, n.r));
        expect(evenDistances).toEqual([2, 1, 1, 1, 1, 1]);

        const oddColumnNeighbors = HexCoord.getNeighbors(3, 2);
        const oddDistances = oddColumnNeighbors.map((n) => HexCoord.getDistance(3, 2, n.q, n.r));
        expect(oddDistances).toEqual([1, 1, 1, 2, 1, 1]);
    });

    it('getNeighbors accounts for odd/even column offset (axial-to-offset conversion)', () => {
        // Odd and even columns shift their neighbor rows in opposite
        // directions -- this is what makes the "brick wall" of hexes line up.
        const evenColumnNeighbors = HexCoord.getNeighbors(2, 5).map((n) => n.r);
        const oddColumnNeighbors = HexCoord.getNeighbors(3, 5).map((n) => n.r);
        expect(evenColumnNeighbors).not.toEqual(oddColumnNeighbors);
    });

    it('distanceTo is the instance-method equivalent of getDistance', () => {
        const a = new HexCoord(1, 1);
        const b = new HexCoord(4, -2);
        expect(a.distanceTo(b)).toBe(HexCoord.getDistance(1, 1, 4, -2));
    });

    it('isValid delegates to isWithinMapBounds', () => {
        expect(new HexCoord(0, 0).isValid()).toBe(true);
        expect(new HexCoord(-5, 0).isValid()).toBe(false);
    });
});
