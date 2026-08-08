// Shared HQ defeat rule for the live board and the pure simulation.
// A map may omit HQs entirely, or author one for only one side. Only an
// owned HQ that exists in the building ledger and has been destroyed makes
// that owner lose; neutral buildings and sides without HQs are irrelevant.

export interface HeadquartersBuilding {
    ownerIndex: number | null;
    destroyed: boolean;
    type?: string;
    isHeadquarters?: boolean;
    isEntrance?: boolean;
}

function isHeadquarters(building: HeadquartersBuilding): boolean {
    return building.type === 'hq' || building.isHeadquarters === true;
}

// A standing HQ is solid terrain to ground units except at its one authored
// door, and even that door opens only for the owning side. Air units decide
// separately to ignore this rule, because they pass over the structure.
// Non-HQ buildings retain their existing capture-door behaviour.
export function headquartersAllowsGroundEntry(
    building: HeadquartersBuilding,
    playerIndex: number
): boolean {
    if (!isHeadquarters(building) || building.destroyed) return true;
    return building.isEntrance === true && building.ownerIndex === playerIndex;
}

export function headquartersLosers(
    buildings: readonly HeadquartersBuilding[],
    playerCount: number
): number[] {
    return Array.from({ length: playerCount }, (_, playerIndex) => playerIndex)
        .filter((playerIndex) => buildings.some((building) =>
            isHeadquarters(building)
                && building.ownerIndex === playerIndex
                && building.destroyed
        ));
}
