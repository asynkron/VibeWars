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
            { type: 'Mortar', q: 3, r: 3 },
            { type: 'Bulwark', q: 4, r: 4 },
            { type: 'Kestrel', q: 5, r: 4 },
            { type: 'Sabre', q: 6, r: 4 },
            { type: 'Gunboat', q: 6, r: 6 },
            { type: 'Drover', q: 7, r: 4 },
            { type: 'Halberd', q: 7, r: 5 },
            { type: 'Lynx', q: 4, r: 5 },
            { type: 'Nightjar', q: 3, r: 5 },
            { type: 'Shrike', q: 8, r: 3 },
        ],
        cpu: [
            { type: 'Bulwark', q: 1, r: 5 },
            { type: 'Mortar', q: 2, r: 6 },
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
