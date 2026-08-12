// One branch-generation rule, kept pure so the workbench and renderer can
// share it and tests can pin the exact parent -> child contract.
export function childBranchLength(parentLength: number, ratio: number): number {
    return parentLength * ratio;
}

export function firstSideBranchLength(treeBaseHeight: number, startRatio: number): number {
    return treeBaseHeight * startRatio;
}

export function sideBranchLengthAtTrunkLevel(baseLength: number, ratio: number, trunkLevel: number): number {
    return baseLength * Math.pow(ratio, Math.max(0, trunkLevel));
}

export function canopyWidthAtTrunkLevel(baseWidth: number, ratio: number, trunkLevel: number): number {
    return baseWidth * Math.pow(ratio, Math.max(0, trunkLevel));
}

export function leaderBranchAzimuth(
    side: number,
    sideCount: number,
    phase: number,
    jitter: number,
): number {
    const sector = Math.PI * 2 / sideCount;
    return phase + side * sector + jitter * sector * 0.34;
}
