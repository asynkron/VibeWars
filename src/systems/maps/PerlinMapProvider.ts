// The random map: perlin-noise terrain with random height variation and
// random roads added by game.ts. Every load is different.
//
// Three sizes, and THE GENERATOR IS THE SAME ONE IN ALL THREE. generate()
// below is the original body, line for line -- same noise, same scale, same
// valley offset, same height scale, same lerped colours. The three variants
// differ only in how big the grid is and how many units each side starts
// with. There is deliberately no second terrain generator in here.
//
// What IS new is where the units start. The old 50x50 map put eleven units
// on one side and two on the other, all bunched in one corner on whatever
// the noise happened to put there -- including, sometimes, open water, from
// which a ground unit never gets out. Now both sides get the SAME roster on
// opposite edges, the way the authored maps do it, and each unit is nudged
// to the nearest tile it can actually stand on.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { perlinNoise } from '../../shared/hexengine/perlinNoise';
import { TERRAIN_CONFIG } from '../../constants';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { TileLike } from '../../types';

// Rosters are PREFIXES of this list, so every size is a superset of the one
// below it. The first three are the rock/paper/scissors triangle -- tank
// beats AA beats air beats tank -- so even the smallest match has the whole
// counter system in it rather than three arbitrary units. Five is exactly
// the authored maps' roster.
const ROSTER = [
    'Bulwark',   // tank
    'Halberd',   // AA
    'Nightjar',  // air
    'Kestrel',   // artillery
    'Pike',      // infantry, the only class that can capture
    'Sabre',
    'Lynx',
    'Drover',
    'Shrike',
    'Mortar',
];

const neighbourOffsets = (q: number) => (q % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]);

// The nearest tile to (q, r) that a ground unit can stand on and that no
// other unit has claimed -- a breadth-first walk outward. On a random map
// the intended spawn hex is water or mountain often enough to matter.
function nearestFreeGround(
    tiles: TileLike[][], cols: number, rows: number,
    q: number, r: number, taken: Set<string>
): [number, number] {
    const seen = new Set<string>([`${q},${r}`]);
    const queue: Array<[number, number]> = [[q, r]];
    for (let head = 0; head < queue.length; head++) {
        const [cq, cr] = queue[head];
        const tile = tiles[cq]?.[cr];
        if (tile && !TerrainSystem.isImpassable(tile.type) && !taken.has(`${cq},${cr}`)) {
            return [cq, cr];
        }
        for (const [dq, dr] of neighbourOffsets(cq)) {
            const nq = cq + dq;
            const nr = cr + dr;
            if (nq < 0 || nr < 0 || nq >= cols || nr >= rows) continue;
            if (seen.has(`${nq},${nr}`)) continue;
            seen.add(`${nq},${nr}`);
            queue.push([nq, nr]);
        }
    }
    return [q, r]; // No passable ground anywhere; nothing better to say.
}

// Both sides' starting units: the same roster, spread along opposite edges,
// each on ground it can stand on. The player takes the southern edge and
// the CPU the northern, the convention every other map follows.
function placeSpawns(
    tiles: TileLike[][], cols: number, rows: number, perTeam: number
): { player: StartingUnit[]; cpu: StartingUnit[] } {
    const roster = ROSTER.slice(0, perTeam);
    const taken = new Set<string>();
    const line = (edgeRow: number): StartingUnit[] => roster.map((type, index) => {
        // Centred on the edge rather than started from a corner, so a big
        // roster on a small map does not run off the end.
        const column = Math.floor((cols - roster.length) / 2) + index;
        const [q, r] = nearestFreeGround(tiles, cols, rows, column, edgeRow, taken);
        taken.add(`${q},${r}`);
        return { type, q, r };
    });
    return { player: line(rows - 1), cpu: line(0) };
}

function createRandomMap(key: string, name: string, size: number, perTeam: number): MapProvider {
    // The tiles the last generate() produced, so spawns can be placed on
    // ground that actually exists. Both callers -- GameState and the
    // headless harness -- generate the map and then read spawns, in that
    // order. Before any generate() there is nothing to consult, and the raw
    // edge coordinates are the honest answer.
    let generated: TileLike[][] | null = null;

    return {
        key,
        name,
        rows: size,
        cols: size,
        randomRoads: 10,

        get spawns() {
            return placeSpawns(generated ?? [], size, size, perTeam);
        },

        generate(): TileLike[][] {
            const tiles: TileLike[][] = [];
            for (let q = 0; q < this.cols; q++) {
                tiles[q] = [];
                for (let r = 0; r < this.rows; r++) {
                    const rawNoise = perlinNoise(q / TERRAIN_CONFIG.PERLIN_SCALE, r / TERRAIN_CONFIG.PERLIN_SCALE);
                    const noiseValue = (rawNoise + 1) / 2;

                    const terrainType = TerrainSystem.getTerrainTypeFromNoise(noiseValue);
                    const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                    const heightVariation = Math.random() * TerrainSystem.getTerrainHeightVariation(terrainType);

                    let height: number;
                    if (terrainType === 'WATER') {
                        height = baseHeight;
                    } else {
                        height =
                            baseHeight +
                            noiseValue * TERRAIN_CONFIG.HEIGHT_SCALE +
                            heightVariation -
                            TERRAIN_CONFIG.VALLEY_OFFSET;
                    }

                    const color = TerrainSystem.getLerpedTerrainColor(noiseValue);
                    tiles[q][r] = new Tile(height, terrainType, color);
                }
            }
            generated = tiles;
            return tiles;
        },
    };
}

export const randomSmallMapProvider = createRandomMap('random20', 'Random — Small', 20, 3);
export const randomMediumMapProvider = createRandomMap('random30', 'Random — Medium', 30, 5);
export const randomLargeMapProvider = createRandomMap('random50', 'Random — Large', 50, 10);

// The old name, so nothing that imported it has to change. It is the 50x50
// map that key has always meant.
export const perlinMapProvider = randomLargeMapProvider;
