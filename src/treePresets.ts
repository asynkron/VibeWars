import type { DeciduousTreeParameters } from './shared/hexengine/ProceduralDecorations';
import { SPRUCE_TREE_PARAMETERS } from './shared/hexengine/treeModelPresets';

export interface TreePreset {
    id: string;
    name: string;
    variant: string;
    parameters: DeciduousTreeParameters;
    windStrength: number;
}

export const TREE_PRESETS: readonly TreePreset[] = [
    {
        id: 'broadleaf-standard',
        name: 'Lövträd · Standard',
        variant: 'Lövträd #05',
        windStrength: 1,
        parameters: {
            branches: {
                countPerFork: 3,
                levels: 2,
                startLengthRatio: 0.38,
                lengthRatioPerTrunkLevel: 0.75,
                childLengthRatio: 0.75,
                childRadiusRatio: 0.73,
                gravity: 3,
            },
            trunk: {
                levels: 3,
                baseLengthRatio: 0.50,
                childLengthRatio: 0.75,
                baseRadiusScale: 1.30,
                tipRadiusRatio: 0.26,
            },
            canopy: {
                shape: 'dome',
                leafStyle: 'round',
                texture: 'procedural',
                textureAlphaThreshold: 0.12,
                textureEdgeFade: 0.38,
                widthScale: 1.90,
                widthRatioPerTrunkLevel: 1,
                heightScale: 1.90,
                leafScale: 0.65,
                gloss: 0.60,
                innerOpacity: 0.75,
                outerOpacity: 0.64,
                depthFromTip: 0,
            },
        },
    },
    {
        id: 'spruce',
        name: 'Gran',
        variant: 'Gran #01',
        windStrength: 1,
        parameters: SPRUCE_TREE_PARAMETERS,
    },
    {
        id: 'pine',
        name: 'Tall',
        variant: 'Tall #01',
        windStrength: 1,
        parameters: {
            branches: {
                countPerFork: 3,
                levels: 2,
                startLengthRatio: 0.26,
                lengthRatioPerTrunkLevel: 0.45,
                childLengthRatio: 0.50,
                childRadiusRatio: 0.59,
                gravity: 3,
            },
            trunk: {
                levels: 3,
                baseLengthRatio: 0.75,
                childLengthRatio: 0.60,
                baseRadiusScale: 0.90,
                tipRadiusRatio: 0.26,
            },
            canopy: {
                shape: 'cone',
                leafStyle: 'long-needles',
                texture: 'procedural',
                textureAlphaThreshold: 0.12,
                textureEdgeFade: 0.38,
                widthScale: 1.90,
                widthRatioPerTrunkLevel: 1,
                heightScale: 0.90,
                leafScale: 0.45,
                gloss: 0.11,
                innerOpacity: 1,
                outerOpacity: 1,
                depthFromTip: 0,
            },
        },
    },
];
