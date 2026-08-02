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
import type { TileLike } from '../../types';

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
    // Produce the full tile grid, indexed [q][r].
    generate(): TileLike[][];
}

export class Tile implements TileLike {
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
