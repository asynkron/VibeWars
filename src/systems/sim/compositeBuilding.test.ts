// A composite building -- the forge depot's four hexes -- is ONE structure
// for ownership, and it has exactly one way in. Reach the door and the
// whole thing changes hands; walk onto its back or side wall and nothing
// happens at all.
//
// Both halves of that rule have to hold in two places at once. The live
// game captures through BuildingSystem's move hook, and the AI's simulation
// captures through SimCommands/SimState. If those disagree, AIController
// replays a plan the live world does not reproduce -- the AI marches
// infantry at a wall and the capture it counted on never lands.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { recordSimMove, nearestCapturableBuildingIndex } from './SimCommands';
import { rotor12x18MapProvider } from '../maps/Rotor12x18MapProvider';
import type { BuildingSpawn } from '../../types';

// Four pieces of one depot plus a lone factory, on flat ground.
function board(buildings: any[]) {
    const cols = 8, rows = 8;
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units: [{
            type: 'Pike', q: 0, r: 0, playerIndex: 0,
            hp: 6, maxHp: 6, move: 3, attack: 4, minRange: 1, maxRange: 2, hasAttacked: false,
        }],
        buildings,
    });
}

// Index 3 is the S piece: the door. 0/1/2 are back and side walls.
const depot = [
    { type: 'forgeDepotN', q: 4, r: 3, hiddenUnitType: null, groupId: 'depot' },
    { type: 'forgeDepotW', q: 3, r: 3, hiddenUnitType: null, groupId: 'depot' },
    { type: 'forgeDepotE', q: 5, r: 3, hiddenUnitType: null, groupId: 'depot' },
    { type: 'forgeDepotS', q: 4, r: 4, hiddenUnitType: 'Sabre', groupId: 'depot', isEntrance: true },
];
const DOOR_INDEX = 3;
const lone = { type: 'factory', q: 1, r: 6, hiddenUnitType: 'Sabre' };

describe('composite buildings are owned whole', () => {
    it('flips every piece when the structure is taken', () => {
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });

        for (let i = 0; i < 4; i++) {
            expect(state.getBuilding(i)!.ownerIndex).toBe(0);
        }
    });

    it('leaves buildings outside the group alone', () => {
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });
        expect(state.getBuilding(4)!.ownerIndex).toBeNull();
    });

    it('does not group a lone building with anything', () => {
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: 4, playerIndex: 1 });
        expect(state.getBuilding(4)!.ownerIndex).toBe(1);
        for (let i = 0; i < 4; i++) expect(state.getBuilding(i)!.ownerIndex).toBeNull();
    });

    it('opens the prize when the group is taken', () => {
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });
        expect(state.getBuilding(DOOR_INDEX)!.hasHiddenUnit).toBe(false);
        expect(state.getBuilding(DOOR_INDEX)!.yieldedTo).toBe(0);
    });

    it('credits the prize exactly once, not once per piece', () => {
        // Four pieces crediting yieldedTo would value one Sabre at four --
        // score.ts adds CAPTURE_YIELD_VALUE per building with yieldedTo set.
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });
        const credited = [0, 1, 2, 3].filter((i) => state.getBuilding(i)!.yieldedTo !== null);
        expect(credited).toEqual([DOOR_INDEX]);
    });

    it('re-capture flips the group back without re-crediting the prize', () => {
        const state = board([...depot, lone]);
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });
        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 1 });

        for (let i = 0; i < 4; i++) expect(state.getBuilding(i)!.ownerIndex).toBe(1);
        // yieldedTo still records who OPENED it -- player 0 -- because the
        // prize was paid out then and cannot be paid again.
        expect(state.getBuilding(DOOR_INDEX)!.yieldedTo).toBe(0);
    });

    it('skips a piece that sank, and still takes the rest', () => {
        const state = board([...depot, lone]);
        // Drop the E wing into the water.
        state.record({ type: 'terrainModified', q: 5, r: 3, delta: -5 });
        expect(state.getBuilding(2)!.destroyed).toBe(true);

        state.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 0 });
        expect(state.getBuilding(0)!.ownerIndex).toBe(0);
        expect(state.getBuilding(1)!.ownerIndex).toBe(0);
        expect(state.getBuilding(3)!.ownerIndex).toBe(0);
        // A destroyed piece is gone, not un-owned: it keeps whatever it had.
        expect(state.getBuilding(2)!.ownerIndex).toBeNull();
    });

    it('survives condense with its grouping intact', () => {
        // condense() rebuilds the state for the next turn snapshot. Losing
        // groupId there would let the AI capture pieces one at a time from
        // turn two onward.
        const state = board([...depot, lone]);
        const next = state.condense();
        next.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 1 });
        for (let i = 0; i < 4; i++) expect(next.getBuilding(i)!.ownerIndex).toBe(1);
    });

    it('survives fork with its grouping intact', () => {
        const state = board([...depot, lone]);
        const branch = state.fork();
        branch.record({ type: 'buildingCaptured', buildingIndex: DOOR_INDEX, playerIndex: 1 });
        for (let i = 0; i < 4; i++) expect(branch.getBuilding(i)!.ownerIndex).toBe(1);
        // The parent is untouched.
        for (let i = 0; i < 4; i++) expect(state.getBuilding(i)!.ownerIndex).toBeNull();
    });
});

describe('a composite is taken only through its door', () => {
    // recordSimMove is the layer that DECIDES a capture happened -- the
    // event itself is a fact and is applied mechanically. So this is where
    // the door rule has to be enforced, and where it has to be tested.
    const walk = (state: SimState, q: number, r: number) => {
        recordSimMove(state, 0, q, r, 1);
        return state.events.some((e) => e.type === 'buildingCaptured');
    };

    it('captures when infantry steps on the door', () => {
        const state = board([...depot, lone]);
        expect(walk(state, 4, 4)).toBe(true);
        for (let i = 0; i < 4; i++) expect(state.getBuilding(i)!.ownerIndex).toBe(0);
    });

    for (const [name, q, r] of [['back', 4, 3], ['west side', 3, 3], ['east side', 5, 3]] as const) {
        it(`records nothing when infantry steps on the ${name} wall`, () => {
            const state = board([...depot, lone]);
            expect(walk(state, q, r)).toBe(false);
            for (let i = 0; i < 4; i++) expect(state.getBuilding(i)!.ownerIndex).toBeNull();
        });
    }

    it('still captures a lone building from its own tile', () => {
        // An ungrouped building is its own way in; the door rule must not
        // quietly make ordinary factories uncapturable.
        const state = board([...depot, lone]);
        expect(walk(state, 1, 6)).toBe(true);
        expect(state.getBuilding(4)!.ownerIndex).toBe(0);
    });

    it('sends capture-seeking infantry at the door, not at the nearest wall', () => {
        // The unit sits north of the depot, so the BACK wall is nearest.
        // Aiming there would park it one hex from a capture it can never
        // make -- the moveToBuilding gene and the capture-pull score term
        // both resolve through this.
        const state = SimState.snapshot({
            map: { cols: 8, rows: 8, getTile: () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 }) },
            units: [{
                type: 'Pike', q: 4, r: 0, playerIndex: 0,
                hp: 6, maxHp: 6, move: 3, attack: 4, minRange: 1, maxRange: 2, hasAttacked: false,
            }],
            buildings: depot,
        });
        expect(nearestCapturableBuildingIndex(state, 0)).toBe(DOOR_INDEX);
    });
});

describe('the shipped map groups its depots', () => {
    const buildings = rotor12x18MapProvider.buildings as BuildingSpawn[];

    it('gives all four pieces of each depot one groupId', () => {
        const groups = new Map<string, BuildingSpawn[]>();
        for (const b of buildings) {
            expect(b.groupId).toBeTruthy();
            const list = groups.get(b.groupId!) ?? [];
            list.push(b);
            groups.set(b.groupId!, list);
        }
        expect(groups.size).toBe(2); // one depot per side
        for (const pieces of groups.values()) expect(pieces).toHaveLength(4);
    });

    it('keeps the two depots in separate groups', () => {
        // Sharing a groupId across the map would hand both depots to
        // whoever captures either one.
        const north = buildings.filter((b) => !b.rotationDeg);
        const south = buildings.filter((b) => b.rotationDeg === 180);
        expect(new Set(north.map((b) => b.groupId)).size).toBe(1);
        expect(new Set(south.map((b) => b.groupId)).size).toBe(1);
        expect(north[0].groupId).not.toBe(south[0].groupId);
    });

    it('gives each depot exactly one door', () => {
        // Zero doors seals the depot forever; two makes the back a second
        // approach. Either is a silent map bug, so it is checked here.
        for (const groupId of new Set(buildings.map((b) => b.groupId))) {
            const pieces = buildings.filter((b) => b.groupId === groupId);
            expect(pieces.filter((b) => b.isEntrance).length).toBe(1);
        }
    });

    it('puts the door on the S piece, the model that has one', () => {
        for (const b of buildings) {
            expect(!!b.isEntrance).toBe(b.type === 'forgeDepotS');
        }
    });

    it('puts exactly one prize in each depot, behind its door', () => {
        for (const groupId of new Set(buildings.map((b) => b.groupId))) {
            const pieces = buildings.filter((b) => b.groupId === groupId);
            const holders = pieces.filter((b) => b.hiddenUnitType);
            expect(holders).toHaveLength(1);
            expect(holders[0].isEntrance).toBe(true);
        }
    });
});
