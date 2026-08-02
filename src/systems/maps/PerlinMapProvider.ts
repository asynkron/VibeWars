// The original random 50x50 map: perlin-noise terrain with random height
// variation, random roads added by game.ts, and the classic asymmetric
// starting lineup. Every load is different.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { perlinNoise } from '../../shared/hexengine/perlinNoise';
import { TERRAIN_CONFIG } from '../../constants';
import { MapProvider, Tile } from './MapProvider';
import type { TileLike } from '../../types';

export const perlinMapProvider: MapProvider = {
    key: 'random50',
    name: 'Random Wilderness (50x50)',
    rows: 50,
    cols: 50,
    randomRoads: 10,
    spawns: {
        player: [
            { type: 'Droid', q: 2, r: 2 },
            { type: 'Artillery', q: 3, r: 3 },
            { type: 'Tank1', q: 4, r: 4 },
            { type: 'Tank2', q: 5, r: 4 },
            { type: 'Tank3', q: 6, r: 4 },
            { type: 'Boat1', q: 6, r: 6 },
            { type: 'DroverAPC', q: 7, r: 4 },
            { type: 'HalberdAA', q: 7, r: 5 },
            { type: 'LynxIFV', q: 4, r: 5 },
            { type: 'NightjarHelo', q: 3, r: 5 },
            { type: 'ShrikeJet', q: 8, r: 3 },
        ],
        cpu: [
            { type: 'Tank1', q: 1, r: 5 },
            { type: 'Artillery', q: 2, r: 6 },
        ],
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
        return tiles;
    },
};
