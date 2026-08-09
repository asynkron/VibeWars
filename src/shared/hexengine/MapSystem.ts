// GameMap delegates tile generation to the selected MapProvider (see
// src/systems/maps/) -- the perlin wilderness, the mirrored 8x8 skirmish
// map, and any future maps all plug in through the same interface. The
// Tile class lives with the providers now; re-exported here for existing
// importers.
import { selectedMapProvider } from '../../systems/maps/mapRegistry';
import { Tile } from '../../systems/maps/MapProvider';
import { MAP_CONFIG } from '../../constants';
import type { TileLike } from '../../types';
import { hasBurnableVegetation } from './tileVegetation';

class GameMap {
  rows: number;
  cols: number;
  tiles: TileLike[][];

  constructor(rows = MAP_CONFIG.ROWS, cols = MAP_CONFIG.COLS) {
    this.rows = rows;
    this.cols = cols;
    this.tiles = selectedMapProvider().generate();

    // Which tiles have greenery on them, decided ONCE here and never again.
    //
    // Here rather than in Tile's constructor because it is a question about
    // a POSITION, and here rather than in each provider because every map
    // must answer it the same way -- including the random ones nobody
    // authored. hasBurnableVegetation replays the same decoration rolls and
    // removes the roads/building pieces that suppress those decorations, so
    // fire can only ever start where a player can actually see something to
    // burn.
    //
    // Frozen at build time on purpose: craters lower tiles afterwards and
    // the scenery is never redrawn, so asking again later would answer for
    // trees that are not there.
    const buildingTiles = new Set(
      (selectedMapProvider().buildings ?? []).map((building) => `${building.q},${building.r}`)
    );
    for (let q = 0; q < this.cols; q++) {
      for (let r = 0; r < this.rows; r++) {
        const tile = this.tiles[q]?.[r];
        if (tile) {
          tile.vegetated = hasBurnableVegetation(
            tile.type, q, r, tile.height, tile.hasRoad, buildingTiles.has(`${q},${r}`)
          );
        }
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
