// Shared map generator building on the Battle Isle terrain rules.
import { TerrainSystem } from './TerrainSystem';
import { perlinNoise } from './perlinNoise';
import { MAP_CONFIG, TERRAIN_CONFIG } from '../../constants';
import type { TileLike } from '../../types';

class Tile implements TileLike {
  height: number;
  type: string;
  color: number;
  hasRoad: boolean;
  moveCost: number;

  constructor(height: number, type: string, color: number) {
    this.height = height;
    this.type = type;
    this.color = color;
    this.hasRoad = false;
    this.moveCost = (TerrainSystem.terrainTypes as any)[type]?.moveCost ?? 1;
  }
}

class GameMap {
  rows: number;
  cols: number;
  tiles: TileLike[][];

  constructor(rows = MAP_CONFIG.ROWS, cols = MAP_CONFIG.COLS) {
    this.rows = rows;
    this.cols = cols;
    this.tiles = [];
    for (let q = 0; q < cols; q++) {
      this.tiles[q] = [];
    }
    this.generateMap();
  }

  generateMap() {
    for (let q = 0; q < this.cols; q++) {
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
        this.tiles[q][r] = new Tile(height, terrainType, color);
      }
    }
  }

  getTile(q: number, r: number): TileLike | null {
    if (q >= 0 && q < this.cols && r >= 0 && r < this.rows) {
      return this.tiles[q][r];
    }
    return null;
  }
}

export { Tile, GameMap };
