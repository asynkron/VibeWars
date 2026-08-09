import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { collectDecorationFireAnchors, vegetationParticleCounts } from './FireSystem';

function attribute(values: number[], itemSize: number) {
    return {
        count: values.length / itemSize,
        getX: (index: number) => values[index * itemSize],
        getY: (index: number) => values[index * itemSize + 1],
        getZ: (index: number) => values[index * itemSize + 2],
    };
}

describe('collectDecorationFireAnchors', () => {
    it('separates actual trunk and crown vertices from merged vegetation', () => {
        const decor = {
            material: { userData: { burnUniform: { value: 0 } } },
            geometry: { attributes: {
                position: attribute([
                    0, 0, 0,
                    0, 1.5, 0,
                    0.2, 2.8, -0.1,
                    -0.3, 3.4, 0.2,
                ], 3),
                aDecorKind: attribute([0, 0, 1, 3], 1),
            } },
        };

        expect(collectDecorationFireAnchors(decor)).toEqual({
            trunks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1.5, z: 0 }],
            crowns: [{ x: 0.2, y: 2.8, z: -0.1 }, { x: -0.3, y: 3.4, z: 0.2 }],
        });
    });

    it('does not treat a building decorator as vegetation', () => {
        const building = {
            material: { userData: {} },
            geometry: { attributes: {
                position: attribute([0, 8, 0], 3),
                aDecorKind: attribute([1], 1),
            } },
        };

        expect(collectDecorationFireAnchors(building)).toEqual({ trunks: [], crowns: [] });
    });
});

describe('vegetationParticleCounts', () => {
    it('gives a bush less fire and a tall tree more fire than the old fixed amount', () => {
        const bush = vegetationParticleCounts({
            trunks: [],
            crowns: [
                { x: -0.2, y: 0, z: -0.15 },
                { x: 0.2, y: 0.35, z: 0.15 },
            ],
        });
        const tallTree = vegetationParticleCounts({
            trunks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 3.5, z: 0 }],
            crowns: [{ x: -0.5, y: 1.0, z: 0 }, { x: 0.5, y: 3.5, z: 0 }],
        });

        expect(bush.flames).toBeLessThan(44);
        expect(tallTree.flames).toBeGreaterThan(44);
        expect(bush.smoke).toBeLessThan(18);
        expect(tallTree.smoke).toBeGreaterThan(18);
    });

    it('caps a large grove and preserves the old open-ground budget', () => {
        const grove = vegetationParticleCounts({
            trunks: [{ x: -1, y: 0, z: -1 }, { x: 1, y: 3.5, z: 1 }],
            crowns: [{ x: -1, y: 3, z: 1 }, { x: 1, y: 3.5, z: -1 }],
        });

        expect(grove).toEqual({ flames: 88, smoke: 36 });
        expect(vegetationParticleCounts({ trunks: [], crowns: [] }))
            .toEqual({ flames: 44, smoke: 18 });
    });
});
