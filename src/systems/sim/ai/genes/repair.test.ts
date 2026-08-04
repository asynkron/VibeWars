// Repair as a simulated action: what it must refuse, what it must cost, and
// that the cooldown really keeps it down.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from '../../SimState';
import { repairGene } from './repair';
import { PIKE_REPAIR, NO_COOLDOWNS, isReady } from '../../../../shared/hexengine/skills';

const grass = () => ({ type: 'GRASS', height: 1, moveCost: 1, hasRoad: false });

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 4, maxHp: 4, move: 2, attack: 3, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, ...over,
    };
}

const board = (units: SimUnit[]) => SimState.snapshot({
    map: { cols: 10, rows: 10, getTile: () => grass() },
    units,
    buildings: [],
});

const gene = (unitIndex: number) => ({ kind: 'repair' as any, unitIndex, seed: 1 });

describe('repair', () => {
    it('patches a damaged machine standing beside it', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 4, maxHp: 10 }),
        ]);
        expect(repairGene.apply(state, gene(0))).toBe(true);
        expect(state.getUnit(1)!.hp).toBe(7);
    });

    it('clamps at full health instead of overhealing', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 9, maxHp: 10 }),
        ]);
        repairGene.apply(state, gene(0));
        expect(state.getUnit(1)!.hp).toBe(10);
    });

    it('refuses a full-health ally outright', () => {
        // Not merely deprioritised. A capped heal ties with doing nothing,
        // and a tie can survive a beam while burning the action and the
        // cooldown -- the one unpunished failure mode in the reference.
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 10, maxHp: 10 }),
        ]);
        expect(repairGene.applicable!(state, 0)).toBe(false);
        expect(repairGene.apply(state, gene(0))).toBe(false);
    });

    it('refuses infantry, which is not a machine', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Pike', q: 2, r: 3, playerIndex: 0, hp: 1 }),
        ]);
        expect(repairGene.applicable!(state, 0)).toBe(false);
    });

    it('refuses an enemy machine', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 1, hp: 4, maxHp: 10 }),
        ]);
        expect(repairGene.applicable!(state, 0)).toBe(false);
    });

    it('refuses to repair itself', () => {
        const state = board([unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0, hp: 1 })]);
        expect(repairGene.applicable!(state, 0)).toBe(false);
    });

    it('costs the turn, because Pike is the only unit that can capture', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 4, maxHp: 10 }),
        ]);
        repairGene.apply(state, gene(0));
        expect(state.getUnit(0)!.hasAttacked).toBe(true);
    });

    it('goes on cooldown and stays there for three of its own turns', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 2, maxHp: 10 }),
            unit({ type: 'Bulwark', q: 8, r: 8, playerIndex: 1, hp: 10, maxHp: 10 }),
        ]);
        repairGene.apply(state, gene(0));
        expect(isReady(state.getUnit(0)!.cooldowns, PIKE_REPAIR.id)).toBe(false);

        for (let round = 0; round < PIKE_REPAIR.cooldown; round++) {
            expect(repairGene.applicable!(state, 0), `usable again after ${round} turns`).toBe(false);
            state.record({ type: 'turnStarted', playerIndex: 0 });
            state.record({ type: 'turnStarted', playerIndex: 1 });
        }
        expect(isReady(state.getUnit(0)!.cooldowns, PIKE_REPAIR.id)).toBe(true);
        expect(repairGene.applicable!(state, 0)).toBe(true);
    });

    it('walks toward a casualty it cannot reach yet', () => {
        // The reason this gene handles its own approach: a skill that only
        // fired when it happened to already be in range would depend on two
        // random genes landing together.
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 7, playerIndex: 0, hp: 2, maxHp: 10 }),
        ]);
        expect(repairGene.apply(state, gene(0))).toBe(true);
        const healer = state.getUnit(0)!;
        expect([healer.q, healer.r]).not.toEqual([2, 2]);
        expect(state.getUnit(1)!.hp).toBe(2); // moved, not healed
    });

    it('picks the ally that absorbs the most of it', () => {
        const state = board([
            unit({ type: 'Pike', q: 2, r: 2, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 2, r: 3, playerIndex: 0, hp: 9, maxHp: 10 }),  // absorbs 1
            unit({ type: 'Bulwark', q: 1, r: 2, playerIndex: 0, hp: 4, maxHp: 10 }),  // absorbs 3
        ]);
        repairGene.apply(state, gene(0));
        expect(state.getUnit(2)!.hp).toBe(7);
        expect(state.getUnit(1)!.hp).toBe(9);
    });
});
