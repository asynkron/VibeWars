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
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 0,
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
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 0,
        depthFromTip: 0,
    },
};

// Third in-game broadleaf profile. The color grading is baked into the
// merged forest geometry through colorProfile, so it remains per tree even
// when many trees share one material and draw call.
export const BROADLEAF_TREE_THIRD_PARAMETERS: DeciduousTreeParameters = {
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
        widthScale: 2.30,
        widthRatioPerTrunkLevel: 0.78,
        heightScale: 2.05,
        leafScale: 0.65,
        gloss: 0.60,
        innerOpacity: 1,
        brightness: 2,
        contrast: 1.15,
        saturation: 0.37,
        hue: -38 * Math.PI / 180,
        depthFromTip: 0,
        colorProfile: 1,
    },
};

// Explicit workbench definition for the birch population. Its crown starts
// from the bright broadleaf recipe, while barkProfile selects the dedicated
// charcoal-to-ivory spotted procedural bark independently of crown color.
export const BIRCH_TREE_PARAMETERS: DeciduousTreeParameters = {
    branches: { ...BROADLEAF_TREE_THIRD_PARAMETERS.branches },
    trunk: { ...BROADLEAF_TREE_THIRD_PARAMETERS.trunk },
    canopy: {
        ...BROADLEAF_TREE_THIRD_PARAMETERS.canopy,
        barkProfile: 3,
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
        textureAlphaThreshold: 0.25,
        textureEdgeFade: 0.67,
        widthScale: 2.95,
        widthRatioPerTrunkLevel: 0.95,
        heightScale: 2.30,
        leafScale: 2.30,
        gloss: 0.60,
        innerOpacity: 1,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 0,
        depthFromTip: 0,
    },
};

export const PINE_TREE_PARAMETERS: DeciduousTreeParameters = {
    branches: {
        countPerFork: 3,
        levels: 2,
        startLengthRatio: 0.26,
        lengthRatioPerTrunkLevel: 0.75,
        childLengthRatio: 0.50,
        childRadiusRatio: 0.59,
        gravity: 3,
    },
    trunk: {
        levels: 3,
        baseLengthRatio: 1.25,
        childLengthRatio: 0.50,
        baseRadiusScale: 0.65,
        tipRadiusRatio: 0.10,
    },
    canopy: {
        shape: 'dome',
        texture: 'spruce-2x2',
        textureAlphaThreshold: 0.35,
        textureEdgeFade: 1,
        widthScale: 1.90,
        widthRatioPerTrunkLevel: 0.73,
        heightScale: 0.90,
        leafScale: 0.45,
        gloss: 0.11,
        innerOpacity: 1,
        brightness: 1.88,
        contrast: 1.05,
        saturation: 0.40,
        hue: -62 * Math.PI / 180,
        depthFromTip: 0,
        colorProfile: 2,
    },
};
