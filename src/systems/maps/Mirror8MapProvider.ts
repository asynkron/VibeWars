// Deterministic 8x8 competitive map with 180-DEGREE ROTATIONAL symmetry.
// The northern half is authored below; the southern half is that half
// turned half a turn, so tile (q, r) equals tile (cols-1-q, rows-1-r).
// Heights get a small hash-based variation computed from the SOURCE cell,
// so even the relief matches exactly. No Math.random / noise anywhere --
// every load produces the same map. (Cosmetics elsewhere -- decoration
// placement, per-vertex color jitter, water animation phase -- still
// randomize, but none of them affect movement or combat.)
//
// IT USED TO BE A NORTH/SOUTH MIRROR, AND THAT WAS NOT FAIR. A vertical
// mirror is not a symmetry of an odd-q offset hex grid: which six hexes
// touch a given one depends on the PARITY OF ITS COLUMN -- even columns
// reach up-left and up-right, odd columns reach down-left and down-right --
// so flipping r without flipping the column parity maps each tile onto a
// neighbourhood shaped the other way. The picture mirrors; the adjacency
// graph does not. Measured on the old map, with the capturing unit:
//
//     player -> its own factory   3        cpu -> its own factory   3
//     player -> enemy factory     6        cpu -> enemy factory     5
//
// One free move-point on every contested approach, on a map whose whole
// premise is that both sides face the same ground. The half turn is a real
// rotation of the plane and therefore a real isometry -- which is why the
// 12x18 map uses it, and why it now does too.
//
// The authored rows are all palindromes, so the TERRAIN is untouched by the
// change: rotating a left/right-symmetric row gives the same row as
// mirroring it. What moved is the southern relief, the CPU's roster order,
// and the southern factory, which are now the rotations of their northern
// counterparts instead of their reflections.
//
// Roads: the two edge columns carry full north-south roads, baked as
// tile.hasRoad (randomRoads: 0). Road visuals are created by
// GridSystem.smoothHexTile from these flags, same as before.
//
// Spawns: both sides get the SAME roster on their own back row, ROTATED --
// the player on the southern edge, the CPU on the northern, its columns
// reversed so each unit is its opposite number's half-turn image.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { hash } from '../../shared/hexengine/utils';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';

const ROWS = 8;
const COLS = 8;

// Northern half, rows 0 (top / CPU spawn row) through 3.
// G = grass, F = forest, S = sand, W = water, M = mountain.
const NORTH_LAYOUT = [
    'GGGGGGGG', // r0: CPU spawn row -- open grass
    'GFFGGFFG', // r1: forest cover pockets
    'SWWSSWWS', // r2: twin lakes with sand shores, fords at q0/q3/q4/q7
    'GGSMMSGG', // r3: central mountain ridge, passages on the flanks
];

const CHAR_TO_TYPE: Record<string, string> = {
    G: 'GRASS',
    F: 'FOREST',
    S: 'SAND',
    W: 'WATER',
    M: 'MOUNTAIN',
};

// Edge columns carry roads across the whole map.
const ROAD_COLUMNS = [0, COLS - 1];

// One shared roster of five units; the player spawns it on the southern
// back row, the CPU rotated onto the northern. Covers the full
// rock/paper/scissors triangle: tank (Bulwark) beats AA (Halberd) beats
// air (Nightjar) beats tank, plus artillery (Kestrel) for fire support.
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Bulwark', q: 2 },
    { type: 'Kestrel', q: 3 },
    { type: 'Halberd', q: 4 },
    { type: 'Nightjar', q: 5 },
    // Infantry -- the only class that can capture the factories below.
    { type: 'Pike', q: 6 },
];

// The half turn, the one transform this map is built on. Everything that
// has a southern counterpart goes through it.
const ROTATE = (q: number, r: number): [number, number] => [COLS - 1 - q, ROWS - 1 - r];

// One neutral factory per half, each the other's half-turn image, both
// holding the same hidden unit so neither side gets a content advantage.
// (4,2) is a SAND ford tile between the twin lakes -- reachable, contested
// ground -- and (3,5) is the ford it rotates onto. The Sabre medium tank
// (cut from the starting roster) returns as the capture prize.
const FACTORY_ANCHOR = { q: 4, r: 2 };
const FACTORIES: BuildingSpawn[] = [
    { type: 'factory', q: FACTORY_ANCHOR.q, r: FACTORY_ANCHOR.r, hiddenUnitType: 'Sabre' },
    (([q, r]) => ({ type: 'factory' as const, q, r, hiddenUnitType: 'Sabre' }))(
        ROTATE(FACTORY_ANCHOR.q, FACTORY_ANCHOR.r)
    ),
];

const asSpawns = (r: number): StartingUnit[] =>
    ROSTER.map(({ type, q }) => (r === 0 ? { type, q: COLS - 1 - q, r } : { type, q, r }));

export const mirror8MapProvider: MapProvider = {
    key: 'mirror8',
    name: 'Twin Ridge (8x8)',
    rows: ROWS,
    cols: COLS,
    randomRoads: 0,
    buildings: FACTORIES,
    spawns: {
        player: asSpawns(ROWS - 1),
        cpu: asSpawns(0),
    },

    generate(): TileLike[][] {
        const tiles: TileLike[][] = [];
        for (let q = 0; q < COLS; q++) {
            tiles[q] = [];
            for (let r = 0; r < ROWS; r++) {
                // Southern rows read the northern layout rotated half a
                // turn -- BOTH coordinates flip, which is what makes this a
                // rotation rather than a reflection, and a rotation is the
                // only one of the two that an odd-q hex grid respects.
                const southern = r >= ROWS / 2;
                const [sourceQ, sourceRow] = southern ? ROTATE(q, r) : [q, r];
                const terrainType = CHAR_TO_TYPE[NORTH_LAYOUT[sourceRow][sourceQ]] ?? 'GRASS';

                const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                let height: number;
                if (terrainType === 'WATER') {
                    height = baseHeight;
                } else {
                    // Deterministic relief, seeded from the SOURCE cell so
                    // the rotated copy gets byte-identical heights.
                    const variation01 = (hash(sourceQ * 131 + sourceRow * 31) & 0xff) / 255;
                    height = baseHeight + variation01 * TerrainSystem.getTerrainHeightVariation(terrainType);
                }

                const tile = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                tile.hasRoad = ROAD_COLUMNS.includes(q) && terrainType !== 'WATER';
                tiles[q][r] = tile;
            }
        }
        return tiles;
    },
};
