// What the relief has to be true of, measured on the map people play on.
//
// Three of these are regressions with a number attached, because the two
// faults being fixed were both visible as numbers before they were visible
// on screen:
//
//   the ground was flat      the middle half of all land fitted inside a
//                            band 0.153 high
//   the lakes were craters   a land tile touching water stood a median
//                            1.028 above the surface, and the renderer
//                            snaps its water-facing corners down to meet it
//
// And one of them is the invariant everything else is worth nothing
// without: on a competitive map the two halves must be identical, to the
// bit, not to a tolerance.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { rotor12x18MapProvider as MAP } from './Rotor12x18MapProvider';
import { distanceField, shoreFactor, symmetricRelief } from '../../shared/hexengine/terrainRelief';
import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';

const COLS = MAP.cols;
const ROWS = MAP.rows;
const WATER = TerrainSystem.getTerrainBaseHeight('WATER');

const neighbours = (q: number, r: number) => (q % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
).map(([dq, dr]) => [q + dq, r + dr])
 .filter(([nq, nr]) => nq >= 0 && nq < COLS && nr >= 0 && nr < ROWS);

const tiles = MAP.generate();
const cells: Array<[number, number]> = [];
for (let q = 0; q < COLS; q++) for (let r = 0; r < ROWS; r++) cells.push([q, r]);

const isLand = (q: number, r: number) => tiles[q][r].type !== 'WATER';
// Mountains are excluded from the ground statistics throughout: they are
// impassable scenery an order of magnitude taller than everything else, and
// letting them into a spread measurement would drown out the ground the
// complaint was actually about.
const isGround = (q: number, r: number) => isLand(q, r) && tiles[q][r].type !== 'MOUNTAIN';

const groundHeights = cells.filter(([q, r]) => isGround(q, r)).map(([q, r]) => tiles[q][r].height);
const sorted = [...groundHeights].sort((a, b) => a - b);
const quantile = (f: number) => sorted[Math.floor(f * (sorted.length - 1))];

describe('the map has terrain rather than jitter', () => {
    it('spreads the middle half of the ground over a real range', () => {
        // Was 0.153 -- two adjacent shades of green, whichever way you
        // looked at it. Anything under about 0.3 reads as flat from the
        // game camera, because the corner averaging in
        // GridSystem.smoothHexTile takes a bite out of whatever is here.
        const interquartile = quantile(0.75) - quantile(0.25);
        expect(interquartile).toBeGreaterThan(0.3);
    });

    it('rises and falls across several hexes instead of per tile', () => {
        // The point of the whole change, stated as something measurable.
        //
        // Under WHITE noise -- which is what the old field was -- two
        // neighbouring tiles are exactly as unrelated as two tiles on
        // opposite sides of the map, so these two averages come out equal.
        // Under coherent noise a neighbour is much closer than a stranger,
        // and the ratio is how much of a landscape there is.
        let near = 0, nearN = 0;
        for (const [q, r] of cells) {
            if (!isGround(q, r)) continue;
            for (const [nq, nr] of neighbours(q, r)) {
                if (!isGround(nq, nr)) continue;
                near += Math.abs(tiles[q][r].height - tiles[nq][nr].height);
                nearN++;
            }
        }
        let far = 0, farN = 0;
        for (const a of groundHeights) for (const b of groundHeights) { far += Math.abs(a - b); farN++; }

        expect(near / nearN).toBeLessThan((far / farN) * 0.65);
    });

    it('never authors ground at or below the waterline', () => {
        // A land tile at the surface reads as submerged, and
        // GridSystem.modifyHexHeight turns anything at or under the
        // waterline into water outright.
        for (const [q, r] of cells) {
            if (!isLand(q, r)) continue;
            expect(tiles[q][r].height, `${q},${r} is ${tiles[q][r].type}`).toBeGreaterThan(WATER);
        }
    });
});

describe('the lakes are not craters', () => {
    it('brings the ground down to meet the water', () => {
        // smoothHexTile pulls a land tile's water-facing corners down to
        // the waterline so the beach MEETS the water. That is right; what
        // was wrong was the land being authored a median 1.028 above it, so
        // meeting the water meant falling a full unit across half a hex --
        // six times the entire variation of the rest of the map.
        // Depot tiles are excluded on purpose. They are exempt from the
        // shore ramp -- the northern depot sits on the lake shore and is
        // meant to stand above it -- and they keep a flat top anyway,
        // because smoothHexTile returns early for a building tile. So the
        // drop there is a quay wall, which is a thing, not a crater slope.
        const depot = new Set(MAP.buildings!.map(b => `${b.q},${b.r}`));
        const shore = cells
            .filter(([q, r]) => isGround(q, r) && !depot.has(`${q},${r}`))
            .filter(([q, r]) => neighbours(q, r).some(([nq, nr]) => !isLand(nq, nr)))
            .map(([q, r]) => tiles[q][r].height - WATER);

        expect(shore.length).toBeGreaterThan(20);
        const median = [...shore].sort((a, b) => a - b)[Math.floor(shore.length / 2)];
        expect(median).toBeLessThan(0.4);
        expect(Math.max(...shore)).toBeLessThan(0.75);
    });

    it('leaves no rim standing around a lake', () => {
        // The failure this guards against is the shore ramp overshooting:
        // if the tiles one step back from the water ended up HIGHER than
        // the ones further inland, the crater wall would simply have moved
        // outward. The beach must be the low ground.
        const byDistance = distanceField(COLS, ROWS, (q, r) => !isLand(q, r));
        const meanAt = (d: number) => {
            const hs = cells.filter(([q, r]) => isGround(q, r) && byDistance[q][r] === d)
                            .map(([q, r]) => tiles[q][r].height);
            return hs.reduce((a, b) => a + b, 0) / hs.length;
        };
        expect(meanAt(1)).toBeLessThan(meanAt(2));
        expect(meanAt(2)).toBeLessThan(meanAt(3));
    });
});

describe('both halves are identical to the bit', () => {
    it('gives every rotated pair of cells exactly the same height', () => {
        // toBe, not toBeCloseTo. A competitive map that is symmetric to
        // within a tolerance is not symmetric: one side would be fighting
        // uphill by an amount too small to see and large enough to matter
        // to a search that plays out thousands of positions.
        for (const [q, r] of cells) {
            expect(tiles[q][r].height, `${q},${r} vs ${COLS - 1 - q},${ROWS - 1 - r}`)
                .toBe(tiles[COLS - 1 - q][ROWS - 1 - r].height);
        }
    });

    it('is exact in the relief field itself, not just after rounding', () => {
        for (const [q, r] of cells) {
            expect(symmetricRelief(q, r, COLS, ROWS))
                .toBe(symmetricRelief(COLS - 1 - q, ROWS - 1 - r, COLS, ROWS));
        }
    });

    it('produces the same map on every call', () => {
        const again = MAP.generate();
        for (const [q, r] of cells) expect(again[q][r].height).toBe(tiles[q][r].height);
    });
});

describe('depot pads', () => {
    it('stand each depot on one level platform', () => {
        // The pieces are separate models on adjacent hexes and a building
        // tile keeps its authored height exactly, so two heights in one
        // group is a step through the middle of the building. The northern
        // depot straddles a sand/grass boundary and used to have one.
        const groups = new Map<string, number[]>();
        for (const piece of MAP.buildings!) {
            const heights = groups.get(piece.groupId!) ?? [];
            heights.push(tiles[piece.q][piece.r].height);
            groups.set(piece.groupId!, heights);
        }
        expect(groups.size).toBe(2);
        for (const [groupId, heights] of groups) {
            expect(heights, groupId).toHaveLength(4);
            for (const h of heights) expect(h, groupId).toBe(heights[0]);
        }
        const [a, b] = [...groups.values()];
        expect(a[0]).toBe(b[0]);
    });

    it('keeps the pads clear of the water they sit beside', () => {
        for (const piece of MAP.buildings!) {
            expect(tiles[piece.q][piece.r].height).toBeGreaterThan(WATER + 0.5);
        }
    });
});

describe('shoreFactor', () => {
    it('is zero at the water and whole once the shore is out of reach', () => {
        expect(shoreFactor(0, 3)).toBe(0);
        expect(shoreFactor(3, 3)).toBe(1);
        expect(shoreFactor(9, 3)).toBe(1);
        expect(shoreFactor(Infinity, 3)).toBe(1);  // a map with no water at all
    });

    it('climbs, and climbs smoothly', () => {
        let previous = -1;
        for (let d = 0; d <= 3; d += 0.25) {
            const value = shoreFactor(d, 3);
            expect(value).toBeGreaterThan(previous);
            previous = value;
        }
        // Eased, not linear: shallow at both ends so the beach meets the
        // water and the inland flat without a crease at either join.
        expect(shoreFactor(1.5, 3)).toBe(0.5);
        expect(shoreFactor(0.3, 3)).toBeLessThan(0.3 / 3);
        expect(shoreFactor(2.7, 3)).toBeGreaterThan(2.7 / 3);
    });
});

describe('distanceField', () => {
    it('counts hexes out from the sources', () => {
        const field = distanceField(COLS, ROWS, (q, r) => q === 5 && r === 9);
        expect(field[5][9]).toBe(0);
        for (const [nq, nr] of neighbours(5, 9)) expect(field[nq][nr]).toBe(1);
    });

    it('is Infinity everywhere when nothing is a source', () => {
        const field = distanceField(4, 4, () => false);
        expect(field[0][0]).toBe(Infinity);
        expect(field[3][3]).toBe(Infinity);
    });

    it('is symmetric when its sources are', () => {
        const field = distanceField(COLS, ROWS, (q, r) => !isLand(q, r));
        for (const [q, r] of cells) expect(field[q][r]).toBe(field[COLS - 1 - q][ROWS - 1 - r]);
    });
});
