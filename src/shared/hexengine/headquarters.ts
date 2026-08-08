// Shared HQ defeat rule for the live board and the pure simulation.
// A map may omit HQs entirely, or author one for only one side. Only an
// owned HQ that exists in the building ledger and has been destroyed makes
// that owner lose; neutral buildings and sides without HQs are irrelevant.

export interface HeadquartersBuilding {
    ownerIndex: number | null;
    destroyed: boolean;
    type?: string;
    isHeadquarters?: boolean;
}

function isHeadquarters(building: HeadquartersBuilding): boolean {
    return building.type === 'hq' || building.isHeadquarters === true;
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
