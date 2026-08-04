// Deterministic 10x10 competitive map with 180-DEGREE ROTATIONAL symmetry.
//
// THE RIVER IS THE MAP. Rows 4 and 5 are water from edge to edge except for
// four tiles: a sand ford at q2 and a sand ford at q7, five columns apart,
// with a four-tile rock spur between them at q4/q5 that only Pike and
// Nightjar can cross. So there are exactly two ground crossings, they are
// far enough apart that a force holding one cannot also hold the other, and
// the whole first half of the game is the question "which one".
//
// WHY A HALF TURN AND NOT A MIRROR. A north/south mirror is not a symmetry
// of an odd-q offset grid: which six hexes touch a given one depends on the
// PARITY of its column, and flipping r without flipping the column parity
// maps a tile onto a neighbourhood shaped the other way. The picture
// mirrors, the adjacency graph does not, and the two sides end up paying
// different costs for the same-looking ground. The half turn
// (q, r) -> (COLS-1-q, ROWS-1-r) is a real isometry whenever COLS is EVEN,
// because q -> COLS-1-q flips column parity, which is exactly what turns an
// even-q neighbour offset into the matching odd-q one. COLS is 10. Do not
// change it to an odd number.
//
// The rotation is also what makes the two fords interesting rather than
// merely present. Each ford has ONE wide bank and ONE narrow bank, and the
// rotation puts the wide bank of the west ford in the north and the wide
// bank of the east ford in the south:
//
//   WEST FORD (q2)   north bank: (2,4) can be entered from (1,3), (2,3) and
//                    (3,3) -- three lanes, open grass, the CPU pours in.
//                    south bank: (2,5) leads only to (2,6), which leads only
//                    to (3,6) -- a one-hex funnel the player defends.
//   EAST FORD (q7)   the same picture turned half a turn: a one-hex funnel
//                    (6,3) -> (7,3) -> (7,4) on the CPU's side, and three
//                    lanes (6,6) (7,6) (8,6) on the player's.
//
// So each side owns one ford it can flood and one it must squeeze through,
// and they are diagonally opposite. Attack where you are wide and you fight
// on the enemy's chosen ground on arrival; attack where you are narrow and
// you are a column of targets for two turns. Both factories sit behind the
// ford their far owner is narrow at, so the prize is always on the far side
// of the hard crossing.
//
// The authored half is deliberately NOT left/right symmetric -- were it, the
// half turn would coincide with a reflection and the map would read as a
// mirror after all. The two ponds are the clearest evidence: (7,2)+(8,2)+
// (8,3) in the north-east, reappearing as (1,6)+(1,7)+(2,7) in the
// south-west rather than across from themselves.
//
// Heights come from the coherent relief field (terrainRelief.ts) plus a
// shore ramp, so the ground SLOPES into the river over three hexes instead
// of standing a full unit above it. Both are pure functions of the cell:
// no Math.random, no Date, no module state, same map on every load.
//
// Roads: two highways, each of which is the other's half turn. The western
// one leaves the CPU's back row at (1,0), runs down the open west bank and
// crosses at the west ford; the eastern one leaves (6,0), threads the wood
// and crosses at the east ford. Each ends on the opposite back row. They do
// NOT join along the bank -- there is a deliberate one-tile gap at (5,3) and
// (4,6) -- so a defender cannot slide between the two fords at 0.5 a hex and
// answer every commitment for free.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { hash } from '../../shared/hexengine/utils';
import { distanceField, shoreFactor, symmetricRelief } from '../../shared/hexengine/terrainRelief';
import { MapProvider, Tile } from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';

const ROWS = 10;
const COLS = 10;

// Northern half, rows 0 (top / CPU spawn row) through 4.
// G = grass, F = forest, S = sand, W = water, M = mountain.
//              q: 0123456789
const NORTH_LAYOUT = [
    'GGGGGGGGGG', // r0: CPU spawn row -- open grass, no cover to camp in
    'GGGGGFFGFG', // r1: the eastern wood begins; the west stays open
    'GGGSGGFWWS', // r2: north pond pinches the eastern lane against the edge
    'GGSGGFFFWG', // r3: near bank -- open grass west, forest east, pond lobe
    'WWSWMMWSWW', // r4: THE RIVER. Fords at q2 and q7, rock spur at q4/q5
];

const CHAR_TO_TYPE: Record<string, string> = {
    G: 'GRASS',
    F: 'FOREST',
    S: 'SAND',
    W: 'WATER',
    M: 'MOUNTAIN',
};

// A short row indexes past its end and yields `undefined`, which the `??`
// below quietly turns into GRASS -- a miscounted column would open a hole in
// the river and nothing would say so. Count them once, here, at load.
if (NORTH_LAYOUT.length !== ROWS / 2) {
    throw new Error(`ford10: authored ${NORTH_LAYOUT.length} rows, needs ${ROWS / 2}`);
}
for (const [index, row] of NORTH_LAYOUT.entries()) {
    if (row.length !== COLS) {
        throw new Error(`ford10: row ${index} is ${row.length} characters, needs ${COLS}`);
    }
}

// The half turn, the one transform this map is built on.
const ROTATE_Q = (q: number) => COLS - 1 - q;
const ROTATE_R = (r: number) => ROWS - 1 - r;

// Roads, authored for the northern half only; the southern half gets the
// half-turn image, so the network maps onto itself exactly like the terrain.
//
// Two highways rather than one lattice. The western one runs (1,0) down
// column 1, turns east along the open bank as far as (4,3), and drops into
// the west ford at (2,4). The eastern one runs (6,0) down through the wood
// to (6,3), steps to (7,3) and drops into the east ford at (7,4). Their
// images continue them across the river and out to the far back row, so
// each highway is one unbroken 0.5-cost route from one spawn corner to the
// other -- but crossing at a DIFFERENT ford.
//
// (4,3) is the eastern end of the western bank road and (5,3) is bare
// forest. That one missing tile is the point: shifting from one ford to the
// other costs a real move, so committing is a commitment.
const NORTH_ROADS: Array<[number, number]> = [
    // Western highway: down column 1, east along the open bank.
    [1, 0], [1, 1], [1, 2], [1, 3],
    [2, 3], [3, 3], [4, 3],
    // ...and into the west ford. Its image is (7, 5), the far half of the
    // EAST ford -- so one authored tile per ford paves both crossings.
    [2, 4],
    // Eastern highway: down column 6 through the wood to the bank...
    [6, 0], [6, 1], [6, 2], [6, 3],
    // ...one step east to the throat of the eastern funnel, and in.
    [7, 3], [7, 4],
];

// (q, r) keys of every road tile, north half plus its half-turn image.
const ROAD_TILES = new Set<string>();
for (const [q, r] of NORTH_ROADS) {
    ROAD_TILES.add(`${q},${r}`);
    ROAD_TILES.add(`${ROTATE_Q(q)},${ROTATE_R(r)}`);
}

// Same roster as the other authored maps: the full rock/paper/scissors
// triangle -- tank (Bulwark) beats AA (Halberd) beats air (Nightjar) beats
// tank -- plus artillery (Kestrel) and the only capturing class (Pike).
//
// Columns are chosen so each unit starts pointing at the ground it is the
// answer to:
//   Bulwark q1  on the head of the western highway, facing the wide bank of
//               the west ford. The open-flank tank lane.
//   Halberd q3  behind the west bank, where a Nightjar that flies the river
//               has to come down. AA covers the approach the water invites.
//   Kestrel q4  one step from (4,3)/(5,3), the only pair of tiles that
//               reaches BOTH fords at range 3. Artillery over a chokepoint.
//   Pike    q5  directly above the rock spur at q5 -- the crossing nothing
//               else on either side can use. Infantry over the mountain.
//   Nightjar q7 above the funnel bank, the one ford its own side is narrow
//               at, because it does not need a ford at all.
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Bulwark', q: 1 },
    { type: 'Halberd', q: 3 },
    { type: 'Kestrel', q: 4 },
    { type: 'Pike', q: 5 },
    { type: 'Nightjar', q: 7 },
];

// One neutral factory per half, each the other's half-turn image, both
// holding the same hidden unit so neither side gets a content advantage.
//
// (3,2) is a sand shelf in the CPU's open western approach. Its image (6,7)
// is the same shelf in the player's open eastern approach. So each side's
// OWN factory is a short walk down its wide lane -- and each side's far
// factory sits behind the ford it is narrow at. Taking both means squeezing
// through the funnel, which is the whole argument of the map.
//
// A single tile, not a four-piece depot: on 100 tiles a diamond would eat
// the bank. `isEntrance` defaults to true for a building with no groupId,
// so the whole tile is the door.
const FACTORY_ANCHOR = { q: 3, r: 2 };
const FACTORIES: BuildingSpawn[] = [
    {
        type: 'factory',
        q: FACTORY_ANCHOR.q,
        r: FACTORY_ANCHOR.r,
        hiddenUnitType: 'Sabre',
    },
    {
        type: 'factory',
        q: ROTATE_Q(FACTORY_ANCHOR.q),
        r: ROTATE_R(FACTORY_ANCHOR.r),
        hiddenUnitType: 'Sabre',
    },
];

const BUILDING_TILES = new Set(FACTORIES.map((b) => `${b.q},${b.r}`));

// How far the ground rises and falls on top of each terrain's base height.
// Same 0.55 the 12x18 map uses, so a slope reads as a slope from the game
// camera without the map turning into badlands.
const RELIEF_AMPLITUDE = 0.55;

// How much of each terrain's own heightVariation survives as per-tile
// texture. The relief carries the shape of the land; this is only so that
// neighbouring tiles of one type are not identical plates.
const TEXTURE_SHARE = 0.35;

// How much of MOUNTAIN's heightVariation (4.5) the spur actually takes.
// Lower than the 12x18 map's full share on purpose: that map has eight
// mountain tiles spread along a diagonal ridge and a camera far enough back
// to read it as one. This has FOUR, in a 2x2 block, on a map two thirds the
// width -- at full variation they stand up as needles in the middle of the
// river rather than as a rock the infantry scrambles over.
const MOUNTAIN_BULK = 0.5;

// How many hexes it takes for the ground to climb from the waterline to its
// full height. Three, as on the 12x18 map: two is still a wall.
const SHORE_REACH = 3;

// The least a land tile may stand above the waterline. SimState's
// terrainModified turns any tile at or below WATER's base height into water,
// and a ford that a Kestrel crater can flood is not a ford.
const MIN_FREEBOARD = 0.1;

const terrainAt = (q: number, r: number): string => {
    const southern = r >= ROWS / 2;
    const sourceQ = southern ? ROTATE_Q(q) : q;
    const sourceR = southern ? ROTATE_R(r) : r;
    return CHAR_TO_TYPE[NORTH_LAYOUT[sourceR][sourceQ]] ?? 'GRASS';
};

export const ford10MapProvider: MapProvider = {
    key: 'ford10',
    name: 'Two Fords (10x10)',
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
        // Hexes to the nearest water, for the shore ramp below. The water
        // layout is symmetric under the map's rotation and these are
        // integers, so the field is exactly symmetric too.
        const fromWater = distanceField(COLS, ROWS, (q, r) => terrainAt(q, r) === 'WATER');

        const tiles: TileLike[][] = [];
        for (let q = 0; q < COLS; q++) {
            tiles[q] = [];
            for (let r = 0; r < ROWS; r++) {
                // Southern rows read the northern layout rotated half a
                // turn -- BOTH coordinates flip, which is what makes this a
                // rotation rather than a reflection, and a rotation is the
                // only one of the two an odd-q hex grid respects.
                const southern = r >= ROWS / 2;
                const sourceQ = southern ? ROTATE_Q(q) : q;
                const sourceR = southern ? ROTATE_R(r) : r;
                const terrainType = CHAR_TO_TYPE[NORTH_LAYOUT[sourceR][sourceQ]] ?? 'GRASS';

                const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                // In [-1, 1], continuous across the map and identical at
                // every pair of cells the rotation swaps -- it averages the
                // field with its own image, and two-term float addition is
                // commutative, so the pair agrees bit for bit.
                const relief = symmetricRelief(q, r, COLS, ROWS);
                const variation = TerrainSystem.getTerrainHeightVariation(terrainType);
                // A building tile keeps whatever height is authored here --
                // GridSystem.smoothHexTile returns early for it -- so the
                // factory gets a FLAT pad with no per-tile texture on it,
                // while still riding the same relief and the same shore ramp
                // as the ground around it. Skipping the ramp instead would
                // leave it standing on a plinth above its own beach.
                const isBuilding = BUILDING_TILES.has(`${q},${r}`);
                const texture01 = isBuilding ? 0 : (hash(sourceQ * 131 + sourceR * 31) & 0xff) / 255;

                let height: number;
                if (terrainType === 'WATER') {
                    height = baseHeight;
                } else if (terrainType === 'MOUNTAIN') {
                    // The spur follows the land: tallest where the relief is
                    // already high, so the four tiles read as one rock. No
                    // shore ramp -- a cliff into a river is a cliff, and
                    // flattening it to the water's edge would be worse.
                    const bulk01 = ((relief + 1) / 2) * 0.7 + texture01 * 0.3;
                    height = baseHeight + relief * RELIEF_AMPLITUDE + bulk01 * variation * MOUNTAIN_BULK;
                } else {
                    height = baseHeight + relief * RELIEF_AMPLITUDE + texture01 * variation * TEXTURE_SHARE;
                    // Everything above the waterline is scaled down as the
                    // water gets closer, so the banks SLOPE into the river
                    // over three hexes instead of ending in a crater wall --
                    // and the fords, water on five sides, end up barely
                    // proud of the surface, which is what a ford looks like.
                    const shore = shoreFactor(fromWater[q][r], SHORE_REACH);
                    height = waterLevel + (height - waterLevel) * shore;
                    height = Math.max(waterLevel + MIN_FREEBOARD, height);
                }

                const tile = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                // Never a road on water, and never one on the rock spur
                // either: the game checks hasRoad BEFORE the unit's own
                // terrainCosts, so a road on MOUNTAIN would quietly cost a
                // Bulwark 0.5 and hand every tank the infantry's crossing.
                tile.hasRoad =
                    ROAD_TILES.has(`${q},${r}`) && terrainType !== 'WATER' && terrainType !== 'MOUNTAIN';
                tiles[q][r] = tile;
            }
        }
        return tiles;
    },
};
