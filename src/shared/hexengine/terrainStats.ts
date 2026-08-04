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
            decorations: [],  // Water has no decorations
            material: {
                color: 0x293D86,
                metalness: 0.3,
                roughness: 0.4
            }
        },
        SAND: {
            name: 'sand',
            moveCost: 1.5,
            baseHeight: 0.7,  // Beaches stand clear of the water
            heightVariation: 0.15,
            heightModifier: 1,
            threshold: 0.45,  // Between water (0.4) and grass (0.6)
            impassable: false,
            decorations: [
                {
                    model: '/assets/3d/decorator_natural_dune.obj',
                    color: 0xE8B27D,  // Same as base
                    chance: 0.05  // Reduced from 0.1
                }
            ],
            material: {
                color: 0xE8A27D,  // Pastel orange-sand color
                metalness: 0.1,
                roughness: 0.6
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
            decorations: [
                {
                    model: '/assets/3d/decorator_building_ruins.obj',
                    color: 0x808080,  // Gray for ruins
                    chance: 0.003  // Reduced from 0.01
                },
                {
                    model: '/assets/3d/decorator_building_watchtower.obj',
                    color: 0x696969,  // Dim gray for stone structures
                    chance: 0.002  // Reduced from 0.005
                },
                {
                    model: '/assets/3d/decorator_building_lightHouse.obj',
                    color: 0xFFFFFF,  // White for lighthouse
                    chance: 0.001  // Reduced from 0.002
                },
                {
                    model: '/assets/3d/decorator_building_temple.obj',
                    color: 0xDEB887,  // Burlywood for temple stone
                    chance: 0.001  // Reduced from 0.003
                },
                {
                    model: '/assets/3d/decorator_building_barracks.obj',
                    color: 0x8B4513,  // Saddle brown for military structures
                    chance: 0.002  // Reduced from 0.005
                },
                {
                    model: '/assets/3d/decorator_building_barn.obj',
                    color: 0x8B4513,  // Saddle brown for wooden structures
                    chance: 0.003  // Reduced from 0.008
                },
                {
                    model: '/assets/3d/decorator_building_city1.obj',
                    color: 0xCD853F,  // Peru color for city buildings
                    chance: 0.001  // Reduced from 0.003
                },
                {
                    model: '/assets/3d/decorator_building_city2.obj',
                    color: 0xDEB887,  // Burlywood for city buildings
                    chance: 0.001  // Reduced from 0.003
                },
                {
                    model: '/assets/3d/decorator_building_towersignalLight.obj',
                    color: 0x696969,  // Dim gray for tower
                    chance: 0.001  // Reduced from 0.002
                },
                {
                    model: '/assets/3d/decorator_natural_Forest_pine_cut.obj',
                    color: 0x1B3B1B,  // Darker forest green for pine
                    chance: 0.01
                },
                {
                    model: '/assets/3d/decorator_natural_pineForest.obj',
                    color: 0x1B3B1B,  // Darker forest green for pine
                    chance: 0.02
                },
                {
                    model: '/assets/3d/decorator_natural_forest_deciduous.obj',
                    color: 0x355E3B,  // Keeping original hunter green for deciduous
                    chance: 0.04
                }
            ],
            material: {
                color: 0x495627,
                metalness: 0.15,
                roughness: 0.6
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
            decorations: [
                {
                    model: '/assets/3d/decorator_natural_Forest_pine_cut.obj',
                    color: 0x1B3B1B,  // Darker forest green for pine
                    chance: 0.1
                },
                {
                    model: '/assets/3d/decorator_natural_pineForest.obj',
                    color: 0x1B3B1B,  // Darker forest green for pine
                    chance: 0.4
                },
                {
                    model: '/assets/3d/decorator_natural_forest_deciduous.obj',
                    color: 0x355E3B,  // Keeping original hunter green for deciduous
                    chance: 0.8
                }
            ],
            material: {
                color: 0x322E17,  // Dark brown for forest floor
                metalness: 0.1,
                roughness: 0.6
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
            decorations: [],
            material: {
                color: 0x4F4D44,
                metalness: 0.1,
                roughness: 0.8
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
