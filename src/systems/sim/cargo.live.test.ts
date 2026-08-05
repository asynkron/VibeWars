// The two cargo rules the LIVE side was missing.
//
// Both existed in the simulation and not in the live game, which is the
// worst shape a bug can take here: the AI searches a plan and replays it
// against the live board, so the two disagreeing means it plays a different
// game than it chose, and AIController validates only range and hasAttacked.
//
// These are pure-state tests against the same rules the live executors
// implement, because UnitSystem itself needs a renderer.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from './SimState';
import { NO_COOLDOWNS } from '../../shared/hexengine/skills';
import { applyGene } from './SimCommands';

const grass = () => ({ type: 'GRASS', height: 1, moveCost: 1, hasRoad: false });

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 6, maxHp: 6, move: 3, attack: 4, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...over,
    };
}

const board = (units: SimUnit[]) => SimState.snapshot({
    map: { cols: 12, rows: 12, getTile: () => grass() },
    units,
    buildings: [],
});

describe('cargo follows its transport', () => {
    it('moves with it, so nothing reads a stale position', () => {
        // Without this the passenger's coordinates stay where it boarded,
        // and every distance term lies -- including the capture pull that is
        // the whole reason to drive infantry forward.
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 0, hp: 4, maxHp: 4 }),
            unit({ type: 'Bulwark', q: 9, r: 9, playerIndex: 1, hp: 10, maxHp: 10 }),
        ]);
        state.record({ type: 'unitMoved', unitIndex: 0, toQ: 5, toR: 4, moveSpent: 2 });
        const rider = state.getUnit(1)!;
        expect([rider.q, rider.r]).toEqual([5, 4]);
    });

    it('does not report itself as standing on the transport\'s hex', () => {
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 0, hp: 4, maxHp: 4 }),
        ]);
        expect(state.getUnitAt(3, 3)![0]).toBe(0);
    });
});

describe('cargo dies with its transport', () => {
    it('goes down when the ride is destroyed', () => {
        // Otherwise a loaded APC is an invulnerable warehouse: getUnitAt
        // hides the passenger from every shot, so nothing else can reach it.
        // Making the ride a real risk is what lets the search weigh it.
        const state = board([
            unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1, hp: 10, maxHp: 10, minRange: 1, maxRange: 1 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 1 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1, hp: 4, maxHp: 4 }),
        ]);
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(state.getUnit(1), 'the transport survived the test setup').toBeNull();
        expect(state.getUnit(2), 'the passenger outlived its ride').toBeNull();
    });

    it('leaves an EMPTY transport\'s death alone', () => {
        const state = board([
            unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1, hp: 10, maxHp: 10 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 1 }),
            unit({ type: 'Pike', q: 8, r: 8, playerIndex: 0, hp: 4, maxHp: 4 }),
        ]);
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(state.getUnit(1)).toBeNull();
        expect(state.getUnit(2), 'an unrelated unit was caught in the cascade').not.toBeNull();
    });
});
