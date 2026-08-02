// GameMap delegates tile generation to the selected MapProvider (see
// src/systems/maps/) -- the perlin wilderness, the mirrored 8x8 skirmish
// map, and any future maps all plug in through the same interface. The
// Tile class lives with the providers now; re-exported here for existing
// importers.
import { selectedMapProvider } from '../../systems/maps/mapRegistry';
import { Tile } from '../../systems/maps/MapProvider';
import { MAP_CONFIG } from '../../constants';
import type { TileLike } from '../../types';

class GameMap {
  rows: number;
  cols: number;
  tiles: TileLike[][];

  constructor(rows = MAP_CONFIG.ROWS, cols = MAP_CONFIG.COLS) {
    this.rows = rows;
    this.cols = cols;
    this.tiles = selectedMapProvider().generate();
  }

  getTile(q: number, r: number): TileLike | null {
    if (q >= 0 && q < this.cols && r >= 0 && r < this.rows) {
      return this.tiles[q][r];
    }
    return null;
  }
}

export { Tile, GameMap };
