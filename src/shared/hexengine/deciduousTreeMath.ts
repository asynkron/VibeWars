// One branch-generation rule, kept pure so the workbench and renderer can
// share it and tests can pin the exact parent -> child contract.
export function childBranchLength(parentLength: number, ratio: number): number {
    return parentLength * ratio;
}
