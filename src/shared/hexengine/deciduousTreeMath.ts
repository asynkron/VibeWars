// One branch-generation rule, kept pure so the workbench and renderer can
// share it and tests can pin the exact parent -> child contract.
export function childBranchLength(parentLength: number, ratio: number): number {
    return parentLength * ratio;
}

export function firstSideBranchLength(treeBaseHeight: number, startRatio: number): number {
    return treeBaseHeight * startRatio;
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
