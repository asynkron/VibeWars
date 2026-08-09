import { describe, expect, it } from 'vitest';
import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import {
    applyBuildingFoundations,
    generateMap,
    type MapProvider,
} from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';

function tile(type: string, height: number, color = 0x123456): TileLike {
    return {
        type,
        height,
        color,
        moveCost: 7,
        hasRoad: true,
        vegetated: true,
        burning: 0,
        burned: false,
    };
}

const building = (q: number, r: number): BuildingSpawn => ({
    type: 'factory',
    q,
    r,
    hiddenUnitType: null,
});

describe('building concrete foundations', () => {
    it('replaces every building tile while preserving its levelled height', () => {
        const untouched = tile('GRASS', 1.2);
        const foundation = tile('SAND', 0.74);
        const tiles = [[untouched], [foundation]];

        applyBuildingFoundations(tiles, [building(1, 0)]);

        expect(untouched.type).toBe('GRASS');
        expect(foundation).toMatchObject({
            type: 'CONCRETE',
            height: 0.74,
            color: TerrainSystem.getTerrainColor('CONCRETE'),
            moveCost: TerrainSystem.terrainTypes.CONCRETE.moveCost,
            hasRoad: false,
            vegetated: false,
        });
        expect(TerrainSystem.getTerrainHeightVariation('CONCRETE')).toBe(0);
    });

    it('reads random-map building placement after terrain generation', () => {
        let buildings: BuildingSpawn[] = [];
        const provider: MapProvider = {
            key: 'dynamic', name: 'dynamic', rows: 1, cols: 1, randomRoads: 0,
            spawns: { player: [], cpu: [] },
            get buildings() { return buildings; },
            generate() {
                buildings = [building(0, 0)];
                return [[tile('FOREST', 1.6)]];
            },
        };

        expect(generateMap(provider)[0][0].type).toBe('CONCRETE');
    });

    it('fails loudly when a building footprint falls outside the map', () => {
        expect(() => applyBuildingFoundations([[tile('GRASS', 1)]], [building(2, 2)]))
            .toThrow('Building foundation at 2,2 is outside the map');
    });
});
