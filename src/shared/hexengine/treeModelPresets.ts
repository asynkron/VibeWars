import type { DeciduousTreeParameters } from './ProceduralDecorations';

// Shared by the tree workbench and the game's cached forest prototypes.
// Keep one source of truth so approving a preset changes both places.
export const BROADLEAF_TREE_PARAMETERS: DeciduousTreeParameters = {
    branches: {
        countPerFork: 3,
        levels: 2,
        startLengthRatio: 0.38,
        lengthRatioPerTrunkLevel: 0.75,
        childLengthRatio: 0.75,
        childRadiusRatio: 0.59,
        gravity: 3,
    },
    trunk: {
        levels: 3,
        baseLengthRatio: 0.75,
        childLengthRatio: 0.50,
        baseRadiusScale: 1.10,
        tipRadiusRatio: 0.26,
    },
    canopy: {
        shape: 'dome',
        texture: 'maple',
        textureAlphaThreshold: 0.49,
        textureEdgeFade: 0.38,
        widthScale: 1.90,
        widthRatioPerTrunkLevel: 1,
        heightScale: 1.40,
        leafScale: 0.65,
        gloss: 0.60,
        innerOpacity: 1,
        depthFromTip: 0,
    },
};

// A second in-game broadleaf silhouette. It deliberately stays out of the
// workbench preset cards: this is a forest variant, not a new editor default.
export const BROADLEAF_TREE_WIDE_PARAMETERS: DeciduousTreeParameters = {
    branches: {
        countPerFork: 3,
        levels: 2,
        startLengthRatio: 0.38,
        lengthRatioPerTrunkLevel: 0.75,
        childLengthRatio: 0.75,
        childRadiusRatio: 0.59,
        gravity: 3,
    },
    trunk: {
        levels: 3,
        baseLengthRatio: 0.75,
        childLengthRatio: 0.65,
        baseRadiusScale: 1.10,
        tipRadiusRatio: 0.26,
    },
    canopy: {
        shape: 'dome',
        texture: 'maple',
        textureAlphaThreshold: 0.49,
        textureEdgeFade: 0.38,
        widthScale: 2.40,
        widthRatioPerTrunkLevel: 0.76,
        heightScale: 2.65,
        leafScale: 0.65,
        gloss: 0.58,
        innerOpacity: 1,
        depthFromTip: 0,
    },
};

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
        texture: 'spruce-2x2',
        textureAlphaThreshold: 0.20,
        textureEdgeFade: 0.67,
        widthScale: 2.95,
        widthRatioPerTrunkLevel: 0.95,
        heightScale: 2.30,
        leafScale: 2.30,
        gloss: 0.60,
        innerOpacity: 1,
        depthFromTip: 0,
    },
};
