import { describe, it, expect } from 'vitest';
import { depotCells, depotRotationDeg, DEPOT_TURNS } from './depotLayout';
import { hexDistance } from '../../shared/hexengine/hexMath';

// The fan has to survive being turned, and it has to survive being anchored
// on an odd column -- which is exactly what the old hardcoded cells could
// not do. Both anchors below are checked at every heading.
const ANCHORS: Array<[number, number]> = [
    [8, 5],   // even column, the parity the old table was written for
    [7, 5],   // odd column, where the old table produced a broken shape
    [0, 0],   // corner: cube coordinates go negative here
    [13, 11],
];

const cellsOf = (q: number, r: number, turns: number) =>
    depotCells(q, r, turns).map(([, cq, cr]) => `${cq},${cr}`);

describe('depotLayout', () => {
    it('reproduces the historical cells at rest on an even column', () => {
        // What both providers spelled out by hand before this existed. If
        // this drifts, every authored depot moves.
        expect(depotCells(8, 5, 0)).toEqual([
            ['forgeDepotN', 8, 5],
            ['forgeDepotW', 7, 5],
            ['forgeDepotS', 8, 6],
            ['forgeDepotE', 9, 5],
        ]);
    });

    it('places four distinct hexes at every heading, from any anchor', () => {
        for (const [q, r] of ANCHORS) {
            for (const turns of DEPOT_TURNS) {
                expect(new Set(cellsOf(q, r, turns)).size).toBe(4);
            }
        }
    });

    it('keeps every piece touching the anchor', () => {
        // The three outer pieces are NEIGHBOURS of the anchor, not merely
        // near it. A fan that stretches is a fan whose trim does not meet.
        for (const [q, r] of ANCHORS) {
            for (const turns of DEPOT_TURNS) {
                const [anchor, ...outer] = depotCells(q, r, turns);
                for (const [, cq, cr] of outer) {
                    expect(hexDistance(anchor[1], anchor[2], cq, cr)).toBe(1);
                }
            }
        }
    });

    it('keeps the fan contiguous -- W joins S joins E', () => {
        // The pieces are cut to meet in that order. If consecutive ones stop
        // touching, the shape is three separate spurs off the anchor and the
        // open edges face nothing.
        for (const [q, r] of ANCHORS) {
            for (const turns of DEPOT_TURNS) {
                const [, w, s, e] = depotCells(q, r, turns);
                expect(hexDistance(w[1], w[2], s[1], s[2])).toBe(1);
                expect(hexDistance(s[1], s[2], e[1], e[2])).toBe(1);
                // ...and the two ends must NOT touch, or the fan has closed
                // into a ring around a hex that is not the anchor.
                expect(hexDistance(w[1], w[2], e[1], e[2])).toBe(2);
            }
        }
    });

    it('gives six genuinely different headings', () => {
        for (const [q, r] of ANCHORS) {
            const shapes = DEPOT_TURNS.map((t) => cellsOf(q, r, t).slice(1).sort().join('|'));
            expect(new Set(shapes).size).toBe(6);
        }
    });

    it('comes back to the start after six sixths', () => {
        for (const [q, r] of ANCHORS) {
            expect(depotCells(q, r, 6)).toEqual(depotCells(q, r, 0));
            expect(depotCells(q, r, -1)).toEqual(depotCells(q, r, 5));
        }
    });

    it('turns the models by the same sixths as the cells', () => {
        expect(DEPOT_TURNS.map(depotRotationDeg)).toEqual([0, 60, 120, 180, 240, 300]);
        expect(depotRotationDeg(6)).toBe(0);
    });
});
