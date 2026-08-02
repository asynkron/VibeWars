// TerrainSystem.js

class TerrainSystem {
    static terrainTypes = {
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
            baseHeight: 0.1,  // Slightly above water
            heightVariation: 0.1,
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
            baseHeight: 0.3,
            heightVariation: 0.1,
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
            baseHeight: 0.5,
            heightVariation: 0.4,
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
            baseHeight: 1,
            heightVariation: 4,
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

    static getTerrainColor(terrainType) {
        return this.terrainTypes[terrainType]?.material?.color || this.terrainTypes.GRASS.material.color;
    }

    static getTerrainName(terrainType) {
        return this.terrainTypes[terrainType]?.name || 'grass';
    }

    static getTerrainBaseHeight(terrainType) {
        return this.terrainTypes[terrainType]?.baseHeight || this.terrainTypes.GRASS.baseHeight;
    }

    static getTerrainHeightVariation(terrainType) {
        return this.terrainTypes[terrainType]?.heightVariation || this.terrainTypes.GRASS.heightVariation;
    }

    static getTerrainHeightModifier(terrainType) {
        return this.terrainTypes[terrainType]?.heightModifier || 0;
    }

    static getTerrainThreshold(terrainType) {
        return this.terrainTypes[terrainType]?.threshold || this.terrainTypes.GRASS.threshold;
    }

    static isImpassable(terrainType) {
        return this.terrainTypes[terrainType]?.impassable || false;
    }

    static getMoveCost(hex, unit) {
        // Check if the tile has a road first
        const tile = gameState.map.getTile(hex.userData.q, hex.userData.r);
        if (tile && tile.hasRoad) {
            return 0.5;
        }

        const terrainType = hex.userData.type?.toUpperCase();
        const cost = UnitSystem.getMovementCost(unit.type, terrainType);
        // If a unit is provided and has terrain costs defined, use those regardless of terrain's default cost
        if (cost) {
            return cost;
        }
        // Otherwise fall back to terrain's default cost
        return 0;
    }

    static getHeight(hex) {

        const baseHeight = hex.userData.height || 0;

        return baseHeight;
    }

    static getTerrainTypeFromNoise(noiseValue) {
        // Convert terrainTypes to array and sort by threshold
        const sortedTypes = Object.entries(this.terrainTypes)
            .sort(([, a], [, b]) => a.threshold - b.threshold);

        // Check thresholds in ascending order
        for (const [type, data] of sortedTypes) {
            if (noiseValue <= data.threshold) {
                return type;
            }
        }
        return 'MOUNTAIN'; // Default to mountain if above all thresholds
    }

    static getTerrainDecorations(terrainType) {
        return this.terrainTypes[terrainType]?.decorations || [];
    }

    static getRandomDecoration(terrainType) {
        const decorations = this.getTerrainDecorations(terrainType);
        if (decorations.length === 0) return null;

        // Roll for each decoration based on its chance
        for (const decoration of decorations) {
            if (Math.random() < decoration.chance) {
                return decoration;
            }
        }
        return null;  // No decoration was selected
    }

    static addDecorator(hex, decoratorType) {
        if (this.decoratorModels[decoratorType]) {
            const decorator = this.decoratorModels[decoratorType].clone();
            const worldPos = new HexCoord(hex.userData.q, hex.userData.r).getWorldPosition();
            decorator.position.set(worldPos.x, this.getHeight(hex), worldPos.z);

            // Random rotation in 60-degree increments (6 possible orientations)
            const randomHexRotation = Math.floor(Math.random() * 6) * (Math.PI / 3);
            decorator.rotation.y = randomHexRotation;

            hex.userData.decorator = decorator;
            scene.add(decorator);
        }
    }

    static getTerrainMaterial(terrainType) {
        return this.terrainTypes[terrainType]?.material || this.terrainTypes.GRASS.material;
    }

    static getLerpedTerrainColor(noiseValue) {
        // Convert terrainTypes to array and sort by threshold
        const sortedTypes = Object.entries(this.terrainTypes)
            .sort(([, a], [, b]) => a.threshold - b.threshold);

        // Find the current and next terrain type based on noise value
        let currentType = null;
        let nextType = null;
        let currentThreshold = 0;
        let nextThreshold = 1;

        for (let i = 0; i < sortedTypes.length; i++) {
            const [type, data] = sortedTypes[i];
            if (noiseValue <= data.threshold) {
                currentType = type;
                currentThreshold = i > 0 ? sortedTypes[i - 1][1].threshold : 0;
                // Set next type to the next terrain type in the sequence
                nextType = i < sortedTypes.length - 1 ? sortedTypes[i + 1][0] : type;
                nextThreshold = data.threshold;
                break;
            }
        }

        // If we're above all thresholds, use the last terrain type
        if (!currentType) {
            const lastType = sortedTypes[sortedTypes.length - 1][0];
            return this.getTerrainColor(lastType);
        }

        // Special handling for water tiles
        if (currentType === 'WATER') {
            // Calculate lerp factor between water threshold and sand threshold
            const lerpFactor = (noiseValue - currentThreshold) / (this.terrainTypes.SAND.threshold - currentThreshold);

            // Get water color and create a lighter blue color for shallow water
            const waterColor = new THREE.Color(this.getTerrainColor('WATER'));

            // Lerp between water and shallow water colors


            return waterColor.getHex();
        }

        // Calculate lerp factor
        const lerpFactor = (noiseValue - currentThreshold) / (nextThreshold - currentThreshold);

        // Get colors
        const currentColor = new THREE.Color(this.getTerrainColor(currentType));
        const nextColor = new THREE.Color(this.getTerrainColor(nextType));

        // Lerp between colors
        const resultColor = new THREE.Color();
        resultColor.r = currentColor.r + (nextColor.r - currentColor.r) * lerpFactor;
        resultColor.g = currentColor.g + (nextColor.g - currentColor.g) * lerpFactor;
        resultColor.b = currentColor.b + (nextColor.b - currentColor.b) * lerpFactor;

        return addColorVariation(resultColor).getHex();
    }
}

console.log('TerrainSystem.js loaded');
