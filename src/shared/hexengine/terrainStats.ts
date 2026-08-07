// The terrain table and the pure lookups over it, with no dependency on
// three.js or on anything that renders.
//
// It used to live inside TerrainSystem, which imports render.ts for a
// single `scene.add(decorator)` on one line -- and that one line put a
// WebGLRenderer between SimState and a question as simple as "how high does
// water sit". TerrainSystem re-exports everything below, so nothing else
// had to change.
//
// See unitStats.ts for the same split on the unit side, and
// systems/sim/workerSafety.test.ts for the guard that keeps both honest.

// Decoration paths are RELATIVE, with no leading slash, like every other
// asset path in the codebase. An absolute path resolves against the origin,
// which is the site root when the game is served from one and the wrong
// place entirely when it is served from a subpath -- as it is on GitHub
// Pages, where the game lives under /VibeWars/ and "/assets/..." would ask
// for files one directory above the site.

import type { TerrainTypeConfig } from '../../types';

export const TERRAIN_TYPES = {
        WATER: {
            name: 'water',
            moveCost: Infinity,
            baseHeight: 0,
            heightVariation: 0,
            heightModifier: 1,
            threshold: 0.4,
            impassable: true,
            material: {
                color: 0x293D86,
                metalness: 0.3,
                roughness: 0.4
            }
        },
        // NOTE on metalness/roughness below: all four GROUND types carry
        // the SAME values (water keeps its own -- water should gleam).
        // The height-banded shader paints COLOR from world height, so a
        // tile's type no longer decides how it looks -- but its material
        // still decided how it caught the light, and two neighbors in the
        // same color band with different roughness produced visible
        // lighting seams along tile borders. One surface, one response.
        SAND: {
            name: 'sand',
            moveCost: 1.5,
            baseHeight: 0.7,  // Beaches stand clear of the water
            heightVariation: 0.15,
            heightModifier: 1,
            threshold: 0.45,  // Between water (0.4) and grass (0.6)
            impassable: false,
            material: {
                color: 0xE8A27D,  // Pastel orange-sand color
                metalness: 0.1,
                roughness: 0.7
            }
        },
        GRASS: {
            name: 'grass',
            moveCost: 1,
            baseHeight: 0.9,
            heightVariation: 0.3,
            heightModifier: 1,
            threshold: 0.6,
            impassable: false,
            material: {
                color: 0x495627,
                metalness: 0.1,
                roughness: 0.7
            }
        },
        FOREST: {
            name: 'forest',
            moveCost: 2,
            baseHeight: 1.1,
            heightVariation: 0.6,
            heightModifier: 1,
            threshold: 0.7,
            impassable: false,
            material: {
                color: 0x322E17,  // Dark brown for forest floor
                metalness: 0.1,
                roughness: 0.7
            }
        },
        MOUNTAIN: {
            name: 'mountain',
            moveCost: 3,
            baseHeight: 1.6,
            heightVariation: 4.5,
            heightModifier: 14.5,
            threshold: 1.0,
            impassable: true,
            material: {
                color: 0x4F4D44,
                metalness: 0.1,
                roughness: 0.7
            }
        }
    };

export const terrainTypesRecord = TERRAIN_TYPES as unknown as Record<string, TerrainTypeConfig>;

export function getTerrainColor(terrainType: string): number {
    return terrainTypesRecord[terrainType]?.material?.color || TERRAIN_TYPES.GRASS.material.color;
}

export function getTerrainName(terrainType: string): string {
    return terrainTypesRecord[terrainType]?.name || 'grass';
}

// Nullish, NOT ||. WATER's baseHeight is 0, and `||` treated that as
// missing and fell through to GRASS -- which made the effective water
// level equal to whatever grass happened to be set to. Four callers use
// this as THE water level (GridSystem's shoreline and sink checks,
// SimState's terrainModified), so raising grass silently raised the sea
// and every crater flooded its tile. Water level is water's own value.
export function getTerrainBaseHeight(terrainType: string): number {
    return terrainTypesRecord[terrainType]?.baseHeight ?? TERRAIN_TYPES.GRASS.baseHeight;
}

export function getTerrainHeightVariation(terrainType: string): number {
    return terrainTypesRecord[terrainType]?.heightVariation || TERRAIN_TYPES.GRASS.heightVariation;
}

export function getTerrainHeightModifier(terrainType: string): number {
    return terrainTypesRecord[terrainType]?.heightModifier || 0;
}

export function getTerrainThreshold(terrainType: string): number {
    return terrainTypesRecord[terrainType]?.threshold || TERRAIN_TYPES.GRASS.threshold;
}

export function isImpassable(terrainType: string): boolean {
    return terrainTypesRecord[terrainType]?.impassable || false;
}

// Alias under TerrainSystem's own name, so the simulation layer can do
// `import * as TerrainSystem from './terrainStats'` unchanged.
export const terrainTypes = TERRAIN_TYPES;
