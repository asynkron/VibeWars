// Deterministic, north/south-mirrored 8x8 competitive map. The northern
// half is authored below; the southern half is its exact mirror (row r
// equals row rows-1-r), so both players face identical terrain. Heights
// get a small hash-based variation computed from the NORTHERN source row,
// so even the relief mirrors exactly. No Math.random / noise anywhere --
// every load produces the same map. (Cosmetics elsewhere -- decoration
// placement, per-vertex color jitter, water animation phase -- still
// randomize, but none of them affect movement or combat.)
//
// Roads: the two edge columns carry full north-south roads, baked as
// tile.hasRoad (randomRoads: 0). Road visuals are created by
// GridSystem.smoothHexTile from these flags, same as before.
//
// Spawns: both sides get the SAME roster on their own back row, mirrored
// -- the player on the southern edge, the CPU on the northern.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { hash } from '../../shared/hexengine/utils';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { TileLike } from '../../types';

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

// One shared roster; the player spawns it on the southern back row, the
// CPU mirrored on the northern.
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Tank1', q: 1 },
    { type: 'Tank2', q: 2 },
    { type: 'Artillery', q: 3 },
    { type: 'NightjarHelo', q: 4 },
    { type: 'Tank3', q: 5 },
    { type: 'DroverAPC', q: 6 },
];

const asSpawns = (r: number): StartingUnit[] => ROSTER.map(({ type, q }) => ({ type, q, r }));

export const mirror8MapProvider: MapProvider = {
    key: 'mirror8',
    name: 'Mirrored Skirmish (8x8)',
    rows: ROWS,
    cols: COLS,
    randomRoads: 0,
    spawns: {
        player: asSpawns(ROWS - 1),
        cpu: asSpawns(0),
    },

    generate(): TileLike[][] {
        const tiles: TileLike[][] = [];
        for (let q = 0; q < COLS; q++) {
            tiles[q] = [];
            for (let r = 0; r < ROWS; r++) {
                // Mirror: southern rows read the northern layout row.
                const sourceRow = r < ROWS / 2 ? r : ROWS - 1 - r;
                const terrainType = CHAR_TO_TYPE[NORTH_LAYOUT[sourceRow][q]] ?? 'GRASS';

                const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                let height: number;
                if (terrainType === 'WATER') {
                    height = baseHeight;
                } else {
                    // Deterministic relief, seeded from (q, source row) so
                    // the southern mirror gets byte-identical heights.
                    const variation01 = (hash(q * 131 + sourceRow * 31) & 0xff) / 255;
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
