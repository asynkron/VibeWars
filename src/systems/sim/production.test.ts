// Factory production: one unit of the product line every 4th owner turn.
// The rule lives in shared/hexengine/production.ts; SimState carries the
// countdown and the newborn roster; SimCommands.startTurn records the
// delivery. The live game runs the identical rule in GameState.nextTurn.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { startTurn } from './SimCommands';
import { mulberry32 } from './resolveAttack';
import { pickProductionSpot, PRODUCTION_INTERVAL, EXPECTED_PRODUCT } from '../../shared/hexengine/production';
import { hexNeighbors } from '../../shared/hexengine/hexMath';

const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });

function makeState(units: any[], buildings: any[] = []): SimState {
    return SimState.snapshot({
        map: { cols: 8, rows: 8, getTile: () => grass() },
        units,
        buildings,
    });
}

const pike = (q: number, r: number, playerIndex: number) => ({
    type: 'Pike', q, r, playerIndex, hp: 4, maxHp: 4,
    move: 2, attack: 3, minRange: 1, maxRange: 1, hasAttacked: false,
});

// A factory already OPENED for player 0 -- the live shape after a yield:
// product line known, countdown mid-cycle unless stated.
const openFactory = (patch: any = {}) => ({
    type: 'factory', q: 4, r: 4, ownerIndex: 0, hasHiddenUnit: false,
    productType: 'Bulwark', productionCountdown: PRODUCTION_INTERVAL, ...patch,
});

function turnsOf(state: SimState, side: number, count: number): void {
    for (let i = 0; i < count; i++) {
        startTurn(state, side, mulberry32(100 + i));
        startTurn(state, 1 - side, mulberry32(200 + i));
    }
}

describe('the delivery cadence', () => {
    it('an owned factory delivers on its owner\'s 4th turn, then every 4th', () => {
        const state = makeState([pike(0, 0, 0), pike(7, 7, 1)], [openFactory()]);
        // Owner turns 1-3: countdown ticks, nothing born.
        turnsOf(state, 0, 3);
        expect(state.unitCount).toBe(2);
        // Owner turn 4: delivery.
        startTurn(state, 0, mulberry32(1));
        expect(state.unitCount).toBe(3);
        const born = state.getUnit(2)!;
        expect(born.type).toBe('Bulwark');
        expect(born.playerIndex).toBe(0);
        // On the factory's own hex -- it was free.
        expect(born.q).toBe(4);
        expect(born.r).toBe(4);
        // The newborn cannot act on its birth turn...
        expect(born.move).toBe(0);
        expect(born.hasAttacked).toBe(true);
        // ...and wakes on the owner's next turn like anyone else.
        startTurn(state, 1, mulberry32(2));
        startTurn(state, 0, mulberry32(3));
        const awake = state.getUnit(2)!;
        expect(awake.move).toBeGreaterThan(0);
        expect(awake.hasAttacked).toBe(false);
        // Next delivery exactly one interval later.
        startTurn(state, 1, mulberry32(4));
        turnsOf(state, 0, 2);
        expect(state.unitCount).toBe(3);
        startTurn(state, 0, mulberry32(5));
        expect(state.unitCount).toBe(4);
    });

    it('the opponent\'s turns do not tick someone else\'s factory', () => {
        const state = makeState([pike(0, 0, 0), pike(7, 7, 1)], [openFactory()]);
        for (let i = 0; i < 10; i++) startTurn(state, 1, mulberry32(i));
        expect(state.unitCount).toBe(2);
    });

    it('capture resets the cycle: the conqueror waits a full interval', () => {
        const state = makeState(
            [pike(0, 0, 0), pike(7, 7, 1)],
            [openFactory({ productionCountdown: 1 })],
        );
        state.record({ type: 'buildingCaptured', buildingIndex: 0, playerIndex: 1 });
        expect(state.getBuilding(0)!.productionCountdown).toBe(PRODUCTION_INTERVAL);
        turnsOf(state, 1, 3);
        expect(state.unitCount).toBe(2);
        startTurn(state, 1, mulberry32(9));
        expect(state.unitCount).toBe(3);
        expect(state.getUnit(2)!.playerIndex).toBe(1);
    });

    it('a rollout capture opens the EXPECTED product line (fog of war)', () => {
        // The sim never sees an unopened factory's real content; capturing
        // one inside a search line starts production of the stand-in the
        // score's captureYield expectation is also priced on.
        const state = makeState(
            [pike(0, 0, 0), pike(7, 7, 1)],
            [{ type: 'factory', q: 4, r: 4, ownerIndex: null, hiddenUnitType: 'Nightjar' }],
        );
        expect(state.getBuilding(0)!.productType).toBeNull();
        state.record({ type: 'buildingCaptured', buildingIndex: 0, playerIndex: 0 });
        expect(state.getBuilding(0)!.productType).toBe(EXPECTED_PRODUCT);
    });

    it('a factory with no product line never produces', () => {
        const state = makeState(
            [pike(0, 0, 0), pike(7, 7, 1)],
            [openFactory({ productType: null })],
        );
        turnsOf(state, 0, 10);
        expect(state.unitCount).toBe(2);
    });
});

describe('the blocked door', () => {
    it('waits under siege and delivers the turn the door frees up', () => {
        // Every candidate hex -- the entrance and all six neighbours -- is
        // occupied; production stays due (countdown 0) instead of
        // skipping the delivery.
        const blockers = [
            pike(4, 4, 1),
            ...hexNeighbors(4, 4).map(({ q, r }) => ({ ...pike(q, r, 1), type: 'Bulwark' })),
        ];
        const state = makeState([pike(0, 0, 0), ...blockers], [openFactory()]);
        turnsOf(state, 0, 6);
        expect(state.unitCount).toBe(8);
        expect(state.getBuilding(0)!.productionCountdown).toBe(0);
        // The siege lifts: the blocker on the entrance dies.
        state.record({ type: 'unitDied', unitIndex: 1 });
        startTurn(state, 0, mulberry32(50));
        expect(state.unitCount).toBe(9);
        expect(state.getUnit(8)!.q).toBe(4);
        expect(state.getUnit(8)!.r).toBe(4);
    });
});

describe('pickProductionSpot', () => {
    const board = (occupied: Array<[number, number]>, buildings: Array<[number, number]> = []) => ({
        getTile: () => ({ type: 'GRASS' }),
        isOccupied: (q: number, r: number) => occupied.some(([oq, or]) => oq === q && or === r),
        isBuilding: (q: number, r: number) => buildings.some(([bq, br]) => bq === q && br === r),
    });

    it('prefers the entrance hex itself', () => {
        expect(pickProductionSpot(board([]), { q: 4, r: 4 }, 'Bulwark')).toEqual({ q: 4, r: 4 });
    });

    it('falls to the first free neighbour when the entrance is taken', () => {
        const spot = pickProductionSpot(board([[4, 4]]), { q: 4, r: 4 }, 'Bulwark')!;
        expect(spot).not.toBeNull();
        expect(spot.q === 4 && spot.r === 4).toBe(false);
    });

    it('never spawns onto another building\'s tile', () => {
        const neighbours: Array<[number, number]> = [[4, 3], [4, 5], [3, 3], [3, 4], [5, 3], [5, 4]];
        const spot = pickProductionSpot(board([[4, 4]], neighbours), { q: 4, r: 4 }, 'Bulwark');
        expect(spot).toBeNull();
    });

    it('respects the product\'s terrain: no naval units delivered onto grass', () => {
        expect(pickProductionSpot(board([]), { q: 4, r: 4 }, 'Gunboat')).toBeNull();
    });
});
