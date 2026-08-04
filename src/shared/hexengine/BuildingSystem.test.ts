// The LIVE capture path, which is the one that actually paints the models.
// SimState has its own tests for the same rule; both are needed, because a
// rule that holds in the simulation and not in the game is exactly the
// divergence AIController's replay warnings are there to catch.

import '../../test/threeStub';
import { describe, it, expect, beforeEach } from 'vitest';
import { BuildingSystem } from './BuildingSystem';
import { setGameState } from '../../systems/gameStateStore';
import type { Building, GameUnit } from '../../types';

// Index 3 is the S piece: the door, and the only way in. 0/1/2 are the
// back and side walls.
const depot = (): Building[] => [
    { type: 'forgeDepotN', q: 4, r: 3, ownerIndex: null, hiddenUnitType: null, groupId: 'depot', destroyed: false },
    { type: 'forgeDepotW', q: 3, r: 3, ownerIndex: null, hiddenUnitType: null, groupId: 'depot', destroyed: false },
    { type: 'forgeDepotE', q: 5, r: 3, ownerIndex: null, hiddenUnitType: null, groupId: 'depot', destroyed: false },
    { type: 'forgeDepotS', q: 4, r: 4, ownerIndex: null, hiddenUnitType: 'Sabre', groupId: 'depot', isEntrance: true, destroyed: false },
];
const DOOR = { q: 4, r: 4 };
const WALLS = [{ q: 4, r: 3 }, { q: 3, r: 3 }, { q: 5, r: 3 }];

const loneFactory = (): Building => (
    { type: 'factory', q: 1, r: 6, ownerIndex: null, hiddenUnitType: 'Sabre', destroyed: false }
);

// Just enough GameState for tryCapture: the buildings it reads, and the
// map/unit hooks yieldHiddenUnit calls. Visuals no-op on their own --
// attachVisual returns early when there is no hex and no loaded model.
let spawned: Array<{ type: string; q: number; r: number; playerIndex: number }>;

function installState(buildings: Building[]) {
    spawned = [];
    setGameState({
        buildings,
        units: [] as GameUnit[],
        players: [{ color: 0x3366ff }, { color: 0xff5533 }],
        map: { getTile: () => ({ type: 'GRASS' }) },
        getUnitAt: () => undefined,
        // yieldHiddenUnit resyncs the own-unit markers afterwards, which
        // reads the current player and bails for anything but a human.
        getCurrentPlayer: () => ({ controller: 'cpu' }),
        spawnUnit: (type: string, q: number, r: number, playerIndex: number) =>
            spawned.push({ type, q, r, playerIndex }),
    } as any);
}

const pike = (q: number, r: number, playerIndex: number): GameUnit =>
    ({ type: 'Pike', q, r, playerIndex } as any);

const tank = (q: number, r: number, playerIndex: number): GameUnit =>
    ({ type: 'Bulwark', q, r, playerIndex } as any);

describe('BuildingSystem.tryCapture on a composite building', () => {
    let buildings: Building[];
    beforeEach(() => {
        buildings = [...depot(), loneFactory()];
        installState(buildings);
    });

    it('takes the whole depot when infantry reaches the door', () => {
        expect(BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0))).toBe(true);
        expect(buildings.slice(0, 4).map((b) => b.ownerIndex)).toEqual([0, 0, 0, 0]);
    });

    it('refuses the back wall and both side walls', () => {
        // The point of the door: a depot has one approach worth defending,
        // not four equivalent ones.
        for (const wall of WALLS) {
            expect(BuildingSystem.tryCapture(pike(wall.q, wall.r, 0))).toBe(false);
        }
        expect(buildings.slice(0, 4).map((b) => b.ownerIndex)).toEqual([null, null, null, null]);
        expect(spawned).toHaveLength(0);
    });

    it('leaves buildings outside the group untouched', () => {
        BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0));
        expect(buildings[4].ownerIndex).toBeNull();
    });

    it('yields the prize once, next to the door it came out of', () => {
        BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0));
        expect(spawned).toHaveLength(1);
        expect(spawned[0].type).toBe('Sabre');
        expect(spawned[0].playerIndex).toBe(0);
        expect(buildings[3].hiddenUnitType).toBeNull();
    });

    it('gives nothing more away on re-capture', () => {
        BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0));
        expect(BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 1))).toBe(true);
        expect(buildings.slice(0, 4).map((b) => b.ownerIndex)).toEqual([1, 1, 1, 1]);
        expect(spawned).toHaveLength(1); // still just the first payout
    });

    it('declines when the side already owns the structure', () => {
        BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0));
        expect(BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0))).toBe(false);
        expect(spawned).toHaveLength(1);
    });

    it('still refuses units that cannot capture, even at the door', () => {
        expect(BuildingSystem.tryCapture(tank(DOOR.q, DOOR.r, 1))).toBe(false);
        expect(buildings.slice(0, 4).map((b) => b.ownerIndex)).toEqual([null, null, null, null]);
    });

    it('skips a destroyed wall and still takes the rest through the door', () => {
        buildings[2].destroyed = true; // the E wall sank
        expect(BuildingSystem.tryCapture(pike(DOOR.q, DOOR.r, 0))).toBe(true);
        expect(buildings[0].ownerIndex).toBe(0);
        expect(buildings[1].ownerIndex).toBe(0);
        expect(buildings[3].ownerIndex).toBe(0);
        expect(buildings[2].ownerIndex).toBeNull();
    });

    it('is uncapturable once the door itself has sunk', () => {
        // Losing the door seals the depot. Worth stating: the alternative
        // -- silently promoting a wall -- would make sinking the entrance a
        // way to open the structure from any side.
        buildings[3].destroyed = true;
        for (const wall of WALLS) {
            expect(BuildingSystem.tryCapture(pike(wall.q, wall.r, 0))).toBe(false);
        }
    });

    it('leaves an ungrouped building behaving exactly as before', () => {
        expect(BuildingSystem.tryCapture(pike(1, 6, 1))).toBe(true);
        expect(buildings[4].ownerIndex).toBe(1);
        expect(buildings.slice(0, 4).map((b) => b.ownerIndex)).toEqual([null, null, null, null]);
        expect(spawned).toHaveLength(1);
    });
});
