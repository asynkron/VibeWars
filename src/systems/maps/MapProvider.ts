// Pluggable map generation. Each provider owns everything that defines a
// playable map: its dimensions, tile generation (including authored
// roads), how many random roads to sprinkle on top (0 for fully authored
// maps), and both sides' starting units.
//
// NOTE: map SIZE is duplicated in constants.ts's MAP_SIZES table rather
// than read from the provider. That's deliberate -- MAP_CONFIG.ROWS/COLS
// must be correct while modules are still evaluating (render.ts computes
// world dimensions at module scope), and constants.ts can't import
// providers without creating an import cycle through TerrainSystem/render.
// The registry asserts the two stay in sync at startup instead.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import type { BuildingSpawn, TileLike } from '../../types';

export interface StartingUnit {
    type: string;
    q: number;
    r: number;
}

export interface MapProvider {
    // Registry key; selectable via the ?map=<key> URL parameter.
    readonly key: string;
    readonly name: string;
    readonly rows: number;
    readonly cols: number;
    // Number of random roads game.ts should generate after map creation.
    // Authored maps bake their roads as tile.hasRoad and use 0.
    readonly randomRoads: number;
    readonly spawns: {
        player: StartingUnit[];
        cpu: StartingUnit[];
    };
    // Buildings authored onto the map (factories, depots, optional HQs).
    // Omitted/empty for maps without buildings.
    readonly buildings?: BuildingSpawn[];
    // Produce the full tile grid, indexed [q][r].
    generate(): TileLike[][];
}

export class Tile implements TileLike {
    height: number;
    type: string;
    color: number;
    hasRoad: boolean;
    moveCost: number;
    // The fire face, matching SimTile's, so the shared rules in
    // shared/hexengine/fire.ts drive the live board and the simulated one
    // through the same code.
    //
    // `vegetated` is filled in by GameMap once the whole grid exists, not
    // here: it is a question about the tile at (q, r) and the constructor
    // does not know where it is.
    vegetated: boolean;
    burning: number;
    burned: boolean;

    constructor(height: number, type: string, color: number) {
        this.height = height;
        this.type = type;
        this.color = color;
        this.hasRoad = false;
        this.moveCost = (TerrainSystem.terrainTypes as any)[type]?.moveCost ?? 1;
        this.vegetated = false;
        this.burning = 0;
        this.burned = false;
    }
}
