// TerrainSystem.js
import { scene } from '../../render';
import { UnitSystem } from './UnitSystem';
import { HexCoord } from './HexCoord';
import { addColorVariation } from './utils';
import { getGameState } from '../../systems/gameStateStore';
import { TERRAIN_TYPES, terrainTypesRecord, getTerrainColor, getTerrainName, getTerrainBaseHeight, getTerrainHeightVariation, getTerrainHeightModifier, getTerrainThreshold, isImpassable } from './terrainStats';
import type { TerrainTypeConfig, TerrainDecoration } from '../../types';

class TerrainSystem {
    static decoratorModels: any; // never assigned anywhere -- addDecorator() is dead code

    // Table and pure lookups live in terrainStats.ts, which imports nothing
    // that renders -- see there. Re-exported so every existing caller works.
    static terrainTypes = TERRAIN_TYPES;

    static get terrainTypesRecord(): Record<string, TerrainTypeConfig> {
        return terrainTypesRecord;
    }

    static getTerrainColor = getTerrainColor;
    static getTerrainName = getTerrainName;
    static getTerrainBaseHeight = getTerrainBaseHeight;
    static getTerrainHeightVariation = getTerrainHeightVariation;
    static getTerrainHeightModifier = getTerrainHeightModifier;
    static getTerrainThreshold = getTerrainThreshold;
    static isImpassable = isImpassable;


    static getMoveCost(hex: any, unit: any): number {
        // Check if the tile has a road first
        const tile = getGameState().map.getTile(hex.userData.q, hex.userData.r);
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

    static getHeight(hex: any): number {
        // Prefer the actual rendered surface height over the tile's raw,
        // unsmoothed userData.height. GridSystem.smoothHexTile() blends each
        // hex's center vertex (index 13) with its neighbors' heights after
        // creation, so the two can diverge -- units/decorators/projectiles
        // placed at userData.height then sit visibly above or below the
        // terrain they're standing on, especially on rough terrain where
        // neighbor heights vary a lot. Before smoothing has run, vertex 13
        // still equals userData.height, so this is safe at any point in
        // the map lifecycle.
        const hexMesh = hex?.children?.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        const position = hexMesh?.geometry?.attributes?.position;
        if (position && position.count > 13) {
            return position.getY(13);
        }

        return hex?.userData?.height || 0;
    }

    static getTerrainTypeFromNoise(noiseValue: number): string {
        // Convert terrainTypes to array and sort by threshold
        const sortedTypes = Object.entries(this.terrainTypesRecord)
            .sort(([, a], [, b]) => a.threshold - b.threshold);

        // Check thresholds in ascending order
        for (const [type, data] of sortedTypes) {
            if (noiseValue <= data.threshold) {
                return type;
            }
        }
        return 'MOUNTAIN'; // Default to mountain if above all thresholds
    }

    static getTerrainDecorations(terrainType: string): TerrainDecoration[] {
        return this.terrainTypesRecord[terrainType]?.decorations || [];
    }

    static getRandomDecoration(terrainType: string): TerrainDecoration | null {
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

    // Ground height for PLACING things on a hex (units, buildings).
    // getHeight() returns the smoothed center vertex, which smoothing can
    // pull well ABOVE the hex's flat top face (userData.height) when
    // neighbors are higher -- anything placed there visibly hovers over
    // the rim the eye judges contact against. Take the LOWER of the two:
    // feet never float; at worst the center bump clips slightly into the
    // model's underside, which reads as sitting in the terrain.
    static getPlacementHeight(hex: any): number {
        return Math.min(this.getHeight(hex), hex.userData.height);
    }

    static addDecorator(hex: any, decoratorType: string): void {
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

    static getTerrainMaterial(terrainType: string) {
        return this.terrainTypesRecord[terrainType]?.material || this.terrainTypes.GRASS.material;
    }

    static getLerpedTerrainColor(noiseValue: number): number {
        // Convert terrainTypes to array and sort by threshold
        const sortedTypes = Object.entries(this.terrainTypesRecord)
            .sort(([, a], [, b]) => a.threshold - b.threshold);

        // Find the current and next terrain type based on noise value
        let currentType: any = null;
        let nextType: any = null;
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

export { TerrainSystem };
