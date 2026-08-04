// Deterministic 12x18 competitive map with 180-DEGREE ROTATIONAL symmetry.
//
// The northern half (rows 0..8) is authored below; the southern half is
// that half rotated half a turn about the map's centre, so tile (q, r)
// equals tile (COLS-1-q, ROWS-1-r). That is NOT a mirror: a mirrored map
// puts the same feature directly across from itself, which is instantly
// readable as a reflection. Under rotation each feature reappears
// diagonally opposite instead, so the map reads as asymmetric while both
// sides still face byte-identical terrain, identical distances and
// identical cover.
//
// The authored half is deliberately NOT left/right symmetric either --
// were it, the rotation would coincide with a reflection and the whole
// point would be lost. Lakes, ridge and forest sit off-centre.
//
// Heights get the same hash-based variation as the 8x8 map, seeded from
// the SOURCE cell so the rotated copy gets identical relief. No
// Math.random / noise anywhere: every load produces the same map.
//
// Roads: the two edge columns carry full north-south roads baked as
// tile.hasRoad (randomRoads: 0). Column 0 rotates onto column 11, so the
// pair is symmetric under the same transform as everything else.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { hash } from '../../shared/hexengine/utils';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';

const ROWS = 18;
const COLS = 12;

// Northern half, rows 0 (top / CPU spawn row) through 8.
// G = grass, F = forest, S = sand, W = water, M = mountain.
//              q: 012345678901
const NORTH_LAYOUT = [
    'GGGGGGGGGGGG', // r0: CPU spawn row -- open grass, no cover to camp in
    'GGFFGGGGFGGG', // r1: light forest, weighted left
    'GSWWGGGSFGGG', // r2: west lake begins; a forest shoulder east
    'GSWWSGGWWSGG', // r3: west lake body, east lake begins
    'GGSSGGMWWSGG', // r4: ridge toe meets the east lake
    'GGGGGMMGSSGG', // r5: central ridge, offset west of centre
    'GFGGGMGGGGFG', // r6: ridge tail; factory sits at q3 on open ground
    'GFFGGGGFFGGG', // r7: forest belt with a gap at q5/q6
    'GGGGGSSGGGGG', // r8: sand saddle at the waist of the map
];

const CHAR_TO_TYPE: Record<string, string> = {
    G: 'GRASS',
    F: 'FOREST',
    S: 'SAND',
    W: 'WATER',
    M: 'MOUNTAIN',
};

// Roads, authored for the northern half only; the southern half gets the
// half-turn image of it, so the network maps onto itself exactly like the
// terrain and neither side gets the better route.
//
// Two arteries rather than two straight edge columns: a western one that
// runs down past the lake and bends east to pass the factory, and an
// eastern one that bends west through the forest belt. They meet on a
// lateral road along the waist, which the rotated copy joins one row
// further down -- so the middle of the map is a crossroads worth holding
// rather than two lanes that never touch.
const NORTH_ROADS: Array<[number, number]> = [
    // Western artery, down the flank of the lake...
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
    // ...bending east onto the cross street, which runs the width of the
    // map past the factory at (3, 6).
    [2, 6], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7],
    // Eastern artery, straight down and then west onto the same street.
    [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [9, 7],
    // The single tile that crosses the waist. Its half-turn image is
    // (6, 9), which is a NEIGHBOUR of it -- so one authored tile per side
    // is enough to join the two halves into one network, without the two
    // copies landing side by side and rendering as a slab.
    [5, 8],
];

// (q, r) keys of every road tile, north half plus its half-turn image.
const ROAD_TILES = new Set<string>();
for (const [q, r] of NORTH_ROADS) {
    ROAD_TILES.add(`${q},${r}`);
    ROAD_TILES.add(`${COLS - 1 - q},${ROWS - 1 - r}`);
}

// Same roster as the 8x8 map: the full rock/paper/scissors triangle --
// tank (Bulwark) beats AA (Halberd) beats air (Nightjar) beats tank --
// plus artillery (Kestrel) and the only capturing class (Pike).
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Bulwark', q: 3 },
    { type: 'Kestrel', q: 4 },
    { type: 'Halberd', q: 6 },
    { type: 'Nightjar', q: 7 },
    { type: 'Pike', q: 8 },
];

// The CPU's back row is r0 and the player's is r17. Rotating the CPU
// roster gives the player's, so each unit type starts the same distance
// from the centre on both sides.
const ROTATE_Q = (q: number) => COLS - 1 - q;

// One neutral forge depot per half. The depot is FOUR pieces on four
// adjacent hexes, and the pieces are named for where they sit: viewed from
// above with north up, the N piece is capped by edge trim along its NW, N
// and NE edges and left open toward SW, S and SE, while E is capped to the
// east and open toward NW and SW. So they form a DIAMOND -- N on top, W
// and E either side, S below -- which is the only arrangement where every
// open edge meets another piece and no trim ends up buried inside.
//
// The anchor is the N piece and its column must be EVEN, because that is
// the parity for which SW/S/SE are (q-1, r), (q, r+1) and (q+1, r).
const DEPOT_ANCHOR = { q: 8, r: 5 };

// The southern depot is the northern one turned half a turn, pieces and
// all: same cells under the map's rotation, each model spun 180 degrees so
// its joining edges still face inward. Only the N piece holds the prize,
// so a depot still yields exactly one Sabre however it is taken.
const depotAt = (anchorQ: number, anchorR: number, rotationDeg: number): BuildingSpawn[] => {
    const cells: Array<[BuildingSpawn['type'], number, number]> = [
        ['forgeDepotN', anchorQ, anchorR],
        ['forgeDepotW', anchorQ - 1, anchorR],
        ['forgeDepotE', anchorQ + 1, anchorR],
        ['forgeDepotS', anchorQ, anchorR + 1],
    ];
    return cells.map(([type, q, r]) => ({
        type,
        q: rotationDeg ? COLS - 1 - q : q,
        r: rotationDeg ? ROWS - 1 - r : r,
        hiddenUnitType: type === 'forgeDepotN' ? 'Sabre' : null,
        rotationDeg,
    }));
};

const FACTORIES: BuildingSpawn[] = [
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 0),
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 180),
];

// A depot's four pieces have to sit on ONE level platform, or they meet in
// steps: the map's per-tile relief varies grass between 0.30 and 0.40, and
// a building tile keeps its authored height exactly (smoothHexTile returns
// early for it), so whatever is authored here is what the pieces stand on.
const DEPOT_CELLS = new Set(FACTORIES.map((f) => `${f.q},${f.r}`));

export const rotor12x18MapProvider: MapProvider = {
    key: 'rotor12x18',
    name: 'Half Turn (12x18)',
    rows: ROWS,
    cols: COLS,
    randomRoads: 0,
    buildings: FACTORIES,
    spawns: {
        cpu: ROSTER.map(({ type, q }) => ({ type, q, r: 0 })),
        player: ROSTER.map(({ type, q }) => ({ type, q: ROTATE_Q(q), r: ROWS - 1 })),
    },

    generate(): TileLike[][] {
        const tiles: TileLike[][] = [];
        for (let q = 0; q < COLS; q++) {
            tiles[q] = [];
            for (let r = 0; r < ROWS; r++) {
                // Southern rows read the northern layout rotated half a
                // turn -- both coordinates flip, which is what makes this
                // a rotation rather than a reflection.
                const southern = r >= ROWS / 2;
                const sourceQ = southern ? ROTATE_Q(q) : q;
                const sourceR = southern ? ROWS - 1 - r : r;
                const terrainType = CHAR_TO_TYPE[NORTH_LAYOUT[sourceR][sourceQ]] ?? 'GRASS';

                const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                let height: number;
                if (terrainType === 'WATER' || DEPOT_CELLS.has(`${q},${r}`)) {
                    // Flat: water is always level, and so is a depot's pad.
                    height = baseHeight;
                } else {
                    // Seeded from the SOURCE cell, so the rotated copy gets
                    // byte-identical relief.
                    const variation01 = (hash(sourceQ * 131 + sourceR * 31) & 0xff) / 255;
                    height = baseHeight + variation01 * TerrainSystem.getTerrainHeightVariation(terrainType);
                }

                const tile = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                tile.hasRoad = ROAD_TILES.has(`${q},${r}`) && terrainType !== 'WATER';
                tiles[q][r] = tile;
            }
        }
        return tiles;
    },
};
