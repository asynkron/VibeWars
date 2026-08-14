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

export interface SceneColorGrade {
    readonly exposure: number;
    readonly saturation: number;
    readonly gamma: number;
    readonly balance: readonly [number, number, number];
    readonly referenceWaterPalette?: boolean;
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
    // When present, every procedural choice owned by the provider -- plus
    // game.ts's random roads -- restarts from this seed on every load.
    // Ordinary random maps omit it and continue to use Math.random.
    readonly seed?: number;
    // Optional post-process calibration for authored visual-study maps.
    // It affects only the rendered scene; HTML controls remain unchanged.
    readonly colorGrade?: SceneColorGrade;
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

// Replace the natural terrain under every authored building piece with one
// real terrain tile. This happens after generate(): random-map providers do
// not know their final building coordinates until they have seen the rolled
// mainland, and their grouped buildings have already levelled their shared
// pad by then. Preserve that height; only the surface becomes concrete.
export function applyBuildingFoundations(
    tiles: TileLike[][],
    buildings: readonly BuildingSpawn[]
): TileLike[][] {
    const concrete = TerrainSystem.terrainTypes.CONCRETE;
    for (const building of buildings) {
        const tile = tiles[building.q]?.[building.r];
        if (!tile) {
            throw new Error(`Building foundation at ${building.q},${building.r} is outside the map`);
        }
        tile.type = 'CONCRETE';
        tile.color = concrete.material.color;
        tile.moveCost = concrete.moveCost;
        tile.hasRoad = false;
        tile.vegetated = false;
    }
    return tiles;
}

// The canonical map assembly path for both the live GameMap and headless
// simulation. Reading provider.buildings AFTER generate() is required for
// random providers, whose placements are generated alongside the terrain.
export function generateMap(provider: MapProvider): TileLike[][] {
    const tiles = provider.generate();
    return applyBuildingFoundations(tiles, provider.buildings ?? []);
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
