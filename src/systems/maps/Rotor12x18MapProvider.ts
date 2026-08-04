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
// Heights come from a coherent relief field (see terrainRelief.ts) rather
// than a per-tile hash, plus a shore ramp that slopes the ground into the
// lakes instead of leaving it standing a full unit above them. Both are
// pure functions of the cell, so every load still produces the same map --
// no Math.random and no noise library anywhere.
//
// Roads: the two edge columns carry full north-south roads baked as
// tile.hasRoad (randomRoads: 0). Column 0 rotates onto column 11, so the
// pair is symmetric under the same transform as everything else.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { hash } from '../../shared/hexengine/utils';
import { distanceField, shoreFactor, symmetricRelief } from '../../shared/hexengine/terrainRelief';
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
//
// All four pieces share a groupId, which makes them ONE building for
// ownership: taking the depot takes all four and retints all four. Without
// it each piece is captured separately and a depot can stand in two
// players' colours at once.
//
// The S piece is the DOOR, and the only way in. The other three are back
// and side walls -- walking onto them does nothing, so a depot has an
// approach that can be defended rather than four equivalent ones. The
// prize lives behind that door for the same reason.
const depotAt = (anchorQ: number, anchorR: number, rotationDeg: number): BuildingSpawn[] => {
    const cells: Array<[BuildingSpawn['type'], number, number]> = [
        ['forgeDepotN', anchorQ, anchorR],
        ['forgeDepotW', anchorQ - 1, anchorR],
        ['forgeDepotE', anchorQ + 1, anchorR],
        ['forgeDepotS', anchorQ, anchorR + 1],
    ];
    const groupId = `forgeDepot@${anchorQ},${anchorR}/${rotationDeg}`;
    return cells.map(([type, q, r]) => ({
        type,
        q: rotationDeg ? COLS - 1 - q : q,
        r: rotationDeg ? ROWS - 1 - r : r,
        hiddenUnitType: type === 'forgeDepotS' ? 'Sabre' : null,
        groupId,
        isEntrance: type === 'forgeDepotS',
        rotationDeg,
    }));
};

const FACTORIES: BuildingSpawn[] = [
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 0),
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 180),
];

// A depot's four pieces have to sit on ONE level platform, or they meet in
// steps -- a building tile keeps its authored height exactly, because
// smoothHexTile returns early for it, so whatever is authored here is what
// the pieces stand on.
//
// They did NOT sit on one platform. Each cell took its own terrain's base
// height, and the northern depot straddles a boundary: its W and S pieces
// stand on grass at 0.9 while N and E stand on sand at 0.7. That is a 0.2
// step straight through the middle of the building, which is the thing the
// comment above was written to prevent.
//
// So the pad is computed ONCE per depot and shared by all four pieces:
// the highest base height in the group -- max, so no piece is left buried
// -- lifted onto the relief at the group's anchor. Only the anchor is
// sampled, and the two depots' anchors are each other's image under the
// map's rotation, so the two pads are identical by construction.
// How far the ground rises and falls, on top of each terrain's own base
// height. 0.55 either way makes the land span about 1.1 -- seven times the
// 0.153 the middle half of it used to fit inside, and about two thirds of a
// hex radius, which is the point where a slope is clearly a slope from the
// game camera without the map turning into badlands.
const RELIEF_AMPLITUDE = 0.55;

// How much of each terrain's own heightVariation survives as per-tile
// texture. The relief carries the shape of the land now; this is only so
// that neighbouring tiles of one type are not identical plates. Forest
// (0.6) stays visibly rougher than grass (0.3), which is what those numbers
// were always for.
const TEXTURE_SHARE = 0.35;

// How many hexes it takes for the ground to climb from the waterline to its
// full height. Three: two is still a wall, four would flatten most of a
// 12x18 map with four lakes on it.
const SHORE_REACH = 3;

// The least a land tile may stand above the waterline. Without it a sand
// tile at the water's edge with the relief against it lands within a
// hundredth of the surface and reads as submerged.
const MIN_FREEBOARD = 0.1;

const terrainAt = (q: number, r: number): string => {
    const southern = r >= ROWS / 2;
    const sourceQ = southern ? ROTATE_Q(q) : q;
    const sourceR = southern ? ROWS - 1 - r : r;
    return CHAR_TO_TYPE[NORTH_LAYOUT[sourceR][sourceQ]] ?? 'GRASS';
};

// cell key -> groupId, so generate() can look a pad up by tile. Pure data,
// safe to build at module load.
const DEPOT_GROUP_AT = new Map(FACTORIES.map((piece) => [`${piece.q},${piece.r}`, piece.groupId!]));

// groupId -> the one height every piece of that depot stands on. Computed
// ONCE PER DEPOT and not per tile: sampling the relief separately for each
// piece is exactly how four pieces end up at four heights.
//
// Called from generate(), never at module load. TerrainSystem reaches
// BuildingSystem, which reaches mapRegistry, which reaches back here -- so
// touching it while this module is still evaluating finds it undefined.
function depotPadHeights(): Map<string, number> {
    const pads = new Map<string, number>();
    // The highest base height in the group, so no piece is left buried.
    for (const piece of FACTORIES) {
        const group = piece.groupId!;
        const base = TerrainSystem.getTerrainBaseHeight(terrainAt(piece.q, piece.r));
        pads.set(group, Math.max(pads.get(group) ?? 0, base));
    }
    // Then lifted onto the relief at the group's anchor -- the N piece. The
    // two depots' anchors are each other's image under the map's rotation
    // and symmetricRelief is exact there, so the two pads come out bit for
    // bit the same.
    for (const piece of FACTORIES) {
        if (piece.type !== 'forgeDepotN') continue;
        const relief = symmetricRelief(piece.q, piece.r, COLS, ROWS);
        pads.set(piece.groupId!, pads.get(piece.groupId!)! + relief * RELIEF_AMPLITUDE);
    }
    return pads;
}

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
        const waterLevel = TerrainSystem.getTerrainBaseHeight('WATER');
        // Hexes to the nearest lake, for the shore ramp below. The water
        // layout is symmetric under the map's rotation and these are
        // integers, so the field is exactly symmetric too.
        const fromWater = distanceField(COLS, ROWS, (q, r) => terrainAt(q, r) === 'WATER');
        const pads = depotPadHeights();

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
                // In [-1, 1], continuous across the map and identical at
                // every pair of cells the rotation swaps.
                const relief = symmetricRelief(q, r, COLS, ROWS);
                const group = DEPOT_GROUP_AT.get(`${q},${r}`);

                let height: number;
                if (terrainType === 'WATER') {
                    height = baseHeight;
                } else if (group) {
                    // One pad for all four pieces, riding the relief but
                    // not the shore ramp: the northern depot stands on the
                    // lake shore, and a depot half-drowned in its own beach
                    // is worse than a depot on a headland above it. Its
                    // tile keeps a flat top anyway -- smoothHexTile returns
                    // early for building tiles -- so the drop to the water
                    // is a quay wall rather than a crater slope.
                    height = pads.get(group)!;
                } else {
                    // A little of the old per-tile jitter survives as
                    // surface texture, so tiles of the same type are not
                    // identical plates -- forest keeps more of it than
                    // grass, exactly as its heightVariation always said.
                    const texture01 = (hash(sourceQ * 131 + sourceR * 31) & 0xff) / 255;
                    const variation = TerrainSystem.getTerrainHeightVariation(terrainType);
                    height = baseHeight + relief * RELIEF_AMPLITUDE + texture01 * variation * TEXTURE_SHARE;

                    if (terrainType === 'MOUNTAIN') {
                        // Peaks follow the land: tallest where the relief
                        // is already high, so the ridge reads as a ridge
                        // rather than as a row of unrelated slabs. A third
                        // stays per-tile so no two peaks are twins.
                        const bulk01 = ((relief + 1) / 2) * 0.7 + texture01 * 0.3;
                        height = baseHeight + relief * RELIEF_AMPLITUDE + bulk01 * variation;
                    } else {
                        // The shore ramp. Everything above the waterline is
                        // scaled down as the water gets closer, so the
                        // ground SLOPES in over three hexes instead of
                        // ending in a wall. Mountains are exempt on
                        // purpose: a cliff into a lake is a cliff, and
                        // flattening one to a puddle's edge would be worse.
                        const shore = shoreFactor(fromWater[q][r], SHORE_REACH);
                        height = waterLevel + (height - waterLevel) * shore;
                        // Never author land at the waterline itself: it
                        // would read as submerged, and the drowning rule
                        // treats anything at or below it as water.
                        height = Math.max(waterLevel + MIN_FREEBOARD, height);
                    }
                }

                const tile = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                tile.hasRoad = ROAD_TILES.has(`${q},${r}`) && terrainType !== 'WATER';
                tiles[q][r] = tile;
            }
        }
        return tiles;
    },
};
