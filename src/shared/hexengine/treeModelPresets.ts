import type { DeciduousTreeParameters } from './ProceduralDecorations';

// Shared by the tree workbench and the game's cached forest prototypes.
// Keep one source of truth so approving a Gran preset changes both places.
export const SPRUCE_TREE_PARAMETERS: DeciduousTreeParameters = {
    branches: {
        countPerFork: 4,
        levels: 1,
        startLengthRatio: 0.36,
        lengthRatioPerTrunkLevel: 0.70,
        childLengthRatio: 0.85,
        childRadiusRatio: 0.32,
        gravity: 3,
    },
    trunk: {
        levels: 6,
        baseLengthRatio: 0.32,
        childLengthRatio: 0.95,
        baseRadiusScale: 0.80,
        tipRadiusRatio: 0.13,
    },
    canopy: {
        shape: 'cone',
        leafStyle: 'needles',
        texture: 'spruce-2x2',
        textureAlphaThreshold: 0.11,
        textureEdgeFade: 0.67,
        widthScale: 2.95,
        widthRatioPerTrunkLevel: 0.95,
        heightScale: 2.30,
        leafScale: 2.30,
        gloss: 0.60,
        innerOpacity: 1,
        outerOpacity: 1,
        depthFromTip: 0,
    },
};
