// Deterministic 10x10 competitive map: A RIVER WITH TWO FORDS.
//
// One question, asked in one glance: the river cuts the map clean in half
// and there are exactly TWO ways across for anything with wheels or tracks.
// Which one do you commit to, and can you be made to regret it?
//
// The northern half (rows 0..4) is authored below; the southern half is
// that half turned HALF A TURN about the map's centre, so tile (q, r)
// equals tile (COLS-1-q, ROWS-1-r). The half turn is used rather than a
// north/south mirror because a mirror is NOT a symmetry of an odd-q offset
// grid: which six hexes touch a given one depends on the parity of its
// column, so flipping r alone maps a tile onto a neighbourhood shaped the
// other way. COLS is 10 -- EVEN -- and that is what makes q -> COLS-1-q
// flip column parity and turn an even-q neighbour offset into the matching
// odd-q one. The transform is a real isometry of this grid; the mirror is
// not, and Mirror8 pays for it with a building one move-point closer to one
// side than to the other.
//
// The authored half is deliberately NOT left/right symmetric -- were it,
// the half turn would coincide with a reflection, both transforms would
// match, and the map would be a mirror map wearing a rotation's clothes.
// The forest pockets and the two banks sit off-centre for that reason.
//
// WHAT THE MAP IS MADE OF -- four features, no more:
//
//   1. THE RIVER. Rows 4 and 5, bank to bank. Water at the two edges
//      (q0-q1, q8-q9) and down the centre (q4-q5), so the river cannot be
//      walked round: the map's edges are cut too.
//   2. THE TWO FORDS. Sand bars at q2-q3 (west) and q6-q7 (east), each two
//      hexes wide so a single tank cannot cork one, and four columns apart
//      so holding one holds nothing about the other. They are the only
//      ground crossings on the map.
//   3. THE SPINE. A wooded ridge down the middle -- forest at (4,2) (5,2),
//      mountain at (4,3) (5,3), and their images to the south -- standing
//      on the central water. It turns "swap flanks" into a three-turn
//      march back through row 1 or a slow push through the trees, which is
//      what makes choosing a ford a commitment rather than an opening move.
//   4. TWO ROADS, ONE PER FORD. Each runs the full height of the map, from
//      one back row across one ford to the other back row, and each is the
//      other's half-turn image. They never touch: a road here is a lane you
//      pick, not a network you manoeuvre inside.
//
// Air ignores all of it. The Nightjar crosses the river anywhere at cost 1
// and swaps flanks in a single turn, which is precisely the point of
// owning one on a map built out of a barrier. The Halberd is the answer,
// and it starts in the middle where it can reach either ford.
//
// Heights come from the same coherent relief field the 12x18 map uses
// (terrainRelief.ts) plus a shore ramp, so the land slopes down into the
// river instead of standing a full unit above it. Both are pure functions
// of the cell and the relief is symmetrised, so every load produces the
// same map, bit for bit, on both sides -- no Math.random, no noise library.

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
    'GGFGGGGGFG', // r1: the lateral road behind the line; two cover pockets
    'GGGGFFGGGG', // r2: the spine's treeline -- Pike walks it at half a tank's price
    'GSSFMMSGFG', // r3: north bank. Sand apron at the fords, rock in the middle
    'WWSSWWSSWW', // r4: THE RIVER. Fords at q2-q3 (west) and q6-q7 (east)
];

// A wrong-length row throws on the index below, but a MIS-TYPED character
// silently becomes grass -- so the shape is asserted where it is cheap.
if (NORTH_LAYOUT.length !== ROWS / 2 || NORTH_LAYOUT.some((row) => row.length !== COLS)) {
    throw new Error(`ford10 layout must be ${ROWS / 2} rows of ${COLS} characters`);
}

const CHAR_TO_TYPE: Record<string, string> = {
    G: 'GRASS',
    F: 'FOREST',
    S: 'SAND',
    W: 'WATER',
    M: 'MOUNTAIN',
};

// The half turn, the one transform this map is built on. Everything with a
// southern counterpart goes through it.
const ROTATE_Q = (q: number) => COLS - 1 - q;

// Roads, authored for the northern half only; the southern half gets the
// half-turn image, so the network maps onto itself and neither side gets
// the better lane.
//
// TWO ARTERIES, ONE PER FORD, and each one is a full-length highway because
// its northern half and the image of the OTHER northern half meet at the
// crossing:
//
//   west lane   (1,0)-(1,3) authored, then (2,4) authored, then (2,5)-(2,9)
//               which are the images of (7,4)-(7,0)
//   east lane   (7,0)-(7,4) authored, then (7,5) which is the image of
//               (2,4), then (8,6)-(8,9) which are the images of (1,3)-(1,0)
//
// So ten authored tiles buy two continuous roads that each cross one ford.
// The lanes never meet, which is the map's thesis in road form.
const NORTH_ROADS: Array<[number, number]> = [
    // West artery: down column 1, past the north-bank factory, onto the
    // western ford at (2,4). (1,3) touches (2,4) -- odd q reaches (q+1, r+1).
    [1, 0], [1, 1], [1, 2], [1, 3], [2, 4],
    // East artery: straight down column 7 and onto the eastern ford.
    [7, 0], [7, 1], [7, 2], [7, 3], [7, 4],
];

// (q, r) keys of every road tile, north half plus its half-turn image.
const ROAD_TILES = new Set<string>();
for (const [q, r] of NORTH_ROADS) {
    ROAD_TILES.add(`${q},${r}`);
    ROAD_TILES.add(`${COLS - 1 - q},${ROWS - 1 - r}`);
}

// The same five-unit roster both sides get, on their own back row, the
// CPU's on r0 as written and the player's on r9 with its columns rotated --
// so each unit starts as its opposite number's half-turn image.
//
// The columns are chosen so the opening reads itself. The PIKE stands on
// the road that leads to its OWN factory, two turns away: infantry is the
// only class that captures, and this map gives it a job on turn one. The
// BULWARK stands on the OTHER road -- the one that crosses the far ford and
// arrives on the enemy's bank exactly as their Pike is reaching for the
// prize. The KESTREL sits behind the near ford, where its 2-3 range covers
// the far bank of the crossing its own side has to hold. The NIGHTJAR is on
// the far flank with the tank, because air is what makes a committed flank
// reversible. The HALBERD is in the middle, the one unit that does not have
// to choose a ford on turn one, because whichever air appears is its
// problem.
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Pike', q: 1 },      // capturer, on the road to its own factory
    { type: 'Kestrel', q: 3 },   // artillery, covering the near ford
    { type: 'Halberd', q: 5 },   // AA, central, uncommitted
    { type: 'Nightjar', q: 6 },  // air, escorting the far push
    { type: 'Bulwark', q: 7 },   // tank, on the road across the far ford
];

// One single-tile factory per bank, each the other's half-turn image, both
// holding the same prize so neither side gets a content advantage.
//
// (2,3) is the sand apron on the NORTHERN bank of the WESTERN ford, one hex
// off the western road; its image (7,6) is the southern bank of the EASTERN
// ford. So each side's factory sits on its own bank, beside the ford its
// own road crosses -- and the enemy's road comes out of the water right
// next to it. Taking your own factory is cheap and taking theirs is not,
// which is what puts both armies at the two crossings on turn two.
//
// No road is authored under either tile: a building tile keeps its authored
// height exactly (smoothHexTile returns early for it) and the road would be
// created after that early return and silently vanish.
const FACTORY_ANCHOR = { q: 2, r: 3 };
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
        r: ROWS - 1 - FACTORY_ANCHOR.r,
        hiddenUnitType: 'Sabre',
    },
];

// How far the ground rises and falls on top of each terrain's own base
// height, and how much of that terrain's own heightVariation survives as
// per-tile surface texture. Same values as the 12x18 map: the relief
// carries the shape of the land, the texture only keeps neighbouring tiles
// of one type from being identical plates.
const RELIEF_AMPLITUDE = 0.55;
const TEXTURE_SHARE = 0.35;

// How many hexes it takes the ground to climb from the waterline to full
// height. Three, so both banks of the river are beaches rather than the
// walls of a canal.
const SHORE_REACH = 3;

// The least a land tile may stand above the waterline. SimState's
// terrainModified turns any tile at or below water's base height INTO
// water, and sinking a building's tile destroys the building.
const MIN_FREEBOARD = 0.1;

// The layout read at (q, r): northern rows straight, southern rows through
// the half turn. Both coordinates flip, which is what makes it a rotation.
const terrainAt = (q: number, r: number): string => {
    const southern = r >= ROWS / 2;
    const sourceQ = southern ? ROTATE_Q(q) : q;
    const sourceR = southern ? ROWS - 1 - r : r;
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
        // Hexes to the nearest water, for the shore ramp. The river is
        // symmetric under the map's rotation and these are integers, so the
        // field is exactly symmetric too.
        const fromWater = distanceField(COLS, ROWS, (q, r) => terrainAt(q, r) === 'WATER');

        const tiles: TileLike[][] = [];
        for (let q = 0; q < COLS; q++) {
            tiles[q] = [];
            for (let r = 0; r < ROWS; r++) {
                const southern = r >= ROWS / 2;
                const sourceQ = southern ? ROTATE_Q(q) : q;
                const sourceR = southern ? ROWS - 1 - r : r;
                const terrainType = CHAR_TO_TYPE[NORTH_LAYOUT[sourceR][sourceQ]] ?? 'GRASS';

                const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                // In [-1, 1], continuous across the map and identical at
                // every pair of cells the rotation swaps -- two terms, and
                // float addition of two terms is commutative to the bit.
                const relief = symmetricRelief(q, r, COLS, ROWS);

                let height: number;
                if (terrainType === 'WATER') {
                    height = baseHeight;
                } else {
                    // Seeded from the SOURCE cell, so the rotated copy gets
                    // byte-identical texture.
                    const texture01 = (hash(sourceQ * 131 + sourceR * 31) & 0xff) / 255;
                    const variation = TerrainSystem.getTerrainHeightVariation(terrainType);
                    height = baseHeight + relief * RELIEF_AMPLITUDE + texture01 * variation * TEXTURE_SHARE;

                    if (terrainType === 'MOUNTAIN') {
                        // The spine. Peaks follow the relief so the ridge
                        // reads as one ridge, and they are exempt from the
                        // shore ramp below: a cliff into a river is a
                        // cliff, and flattening it to the water's edge
                        // would turn the map's centrepiece into a puddle.
                        const bulk01 = ((relief + 1) / 2) * 0.7 + texture01 * 0.3;
                        height = baseHeight + relief * RELIEF_AMPLITUDE + bulk01 * variation;
                    } else {
                        // The banks slope in over three hexes instead of
                        // ending in a wall, which is what turns the fords
                        // into sand bars rather than trenches.
                        const shore = shoreFactor(fromWater[q][r], SHORE_REACH);
                        height = waterLevel + (height - waterLevel) * shore;
                        height = Math.max(waterLevel + MIN_FREEBOARD, height);
                    }
                }

                const tile = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                // Water AND mountain: the game charges 0.5 for any road tile
                // BEFORE it consults the unit's terrainCosts, so a road on a
                // mountain would quietly open the spine to tanks. Nothing in
                // the fairness battery would catch it.
                tile.hasRoad = ROAD_TILES.has(`${q},${r}`)
                    && terrainType !== 'WATER'
                    && terrainType !== 'MOUNTAIN';
                tiles[q][r] = tile;
            }
        }
        return tiles;
    },
};
