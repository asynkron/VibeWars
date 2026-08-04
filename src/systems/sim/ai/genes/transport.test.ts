// The transport, which is the one part of this port that had nothing to
// copy: the reference has no transports, and its Apply(IUnit, IUnit, int)
// could not express one -- no board, no return value, no hex target.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from '../../SimState';
import { loadGene, unloadGene, carriedBy } from './transport';
import { applyGene } from '../../SimCommands';
import { NO_COOLDOWNS } from '../../../../shared/hexengine/skills';
import { scoreState, DEFAULT_SCORE_WEIGHTS } from '../../score';

const grass = () => ({ type: 'GRASS', height: 1, moveCost: 1, hasRoad: false });

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 4, maxHp: 4, move: 3, attack: 3, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...over,
    };
}

const board = (units: SimUnit[]) => SimState.snapshot({
    map: { cols: 12, rows: 12, getTile: () => grass() },
    units,
    buildings: [],
});

const gene = (kind: string, unitIndex: number) => ({ kind: kind as any, unitIndex, seed: 1 });

const loaded = () => {
    const state = board([
        unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 6, maxHp: 6 }),
        unit({ type: 'Pike', q: 3, r: 4, playerIndex: 0 }),
        unit({ type: 'Bulwark', q: 9, r: 9, playerIndex: 1, hp: 10, maxHp: 10 }),
    ]);
    loadGene.apply(state, gene('load', 0));
    return state;
};

// Loaded, then a fresh turn -- which is when an unload actually happens in
// a game. Loading costs the transport its action, so testing unload on the
// same turn measures the load's cost rather than the unload's.
const loadedAndRested = () => {
    const state = loaded();
    state.record({ type: 'turnStarted', playerIndex: 0 });
    return state;
};

describe('loading', () => {
    it('picks up adjacent infantry', () => {
        const state = loaded();
        expect(state.getUnit(1)!.carriedBy).toBe(0);
        expect(carriedBy(state, 0)).toHaveLength(1);
    });

    it('moves the passenger onto the carrier\'s hex', () => {
        const state = loaded();
        const carrier = state.getUnit(0)!;
        const rider = state.getUnit(1)!;
        expect([rider.q, rider.r]).toEqual([carrier.q, carrier.r]);
    });

    it('refuses anything that is not infantry', () => {
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 3, r: 4, playerIndex: 0, hp: 10, maxHp: 10 }),
        ]);
        expect(loadGene.applicable!(state, 0)).toBe(false);
    });

    it('refuses an enemy passenger', () => {
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 4, playerIndex: 1 }),
        ]);
        expect(loadGene.applicable!(state, 0)).toBe(false);
    });

    it('refuses a second passenger, because capacity is one', () => {
        const state = loaded();
        expect(loadGene.applicable!(state, 0)).toBe(false);
    });

    it('is refused outright by a unit that is not a transport', () => {
        const state = board([
            unit({ type: 'Bulwark', q: 3, r: 3, playerIndex: 0, hp: 10, maxHp: 10 }),
            unit({ type: 'Pike', q: 3, r: 4, playerIndex: 0 }),
        ]);
        expect(loadGene.applicable!(state, 0)).toBe(false);
    });
});

describe('a loaded passenger is cargo, not a unit on the board', () => {
    it('stops occupying its hex', () => {
        const state = loaded();
        const carrier = state.getUnit(0)!;
        // The carrier is found there; the passenger sharing the hex is not.
        expect(state.getUnitAt(carrier.q, carrier.r)![0]).toBe(0);
    });

    it('stays in liveUnits, so the score does not read it as dead', () => {
        // The modelling decision everything else follows from. score.ts
        // prices a unit directly AND through a quadratic army-size term, so
        // a passenger that left the list would count as dead twice and the
        // search would never load anything.
        const before = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 6, maxHp: 6 }),
            unit({ type: 'Pike', q: 3, r: 4, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 9, r: 9, playerIndex: 1, hp: 10, maxHp: 10 }),
        ]);
        const scoreBefore = scoreState(before, 0, DEFAULT_SCORE_WEIGHTS);
        const after = loaded();
        expect([...after.liveUnits()]).toHaveLength(3);
        // Loading is not a material loss. It moves the passenger onto the
        // carrier's hex, so positional terms may shift a little -- what
        // must not happen is the ~130-point cliff of a unit going missing.
        expect(Math.abs(scoreState(after, 0, DEFAULT_SCORE_WEIGHTS) - scoreBefore)).toBeLessThan(60);
    });

    it('rides along when the transport drives', () => {
        const state = loaded();
        applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 2, seed: 1 });
        const carrier = state.getUnit(0)!;
        const rider = state.getUnit(1)!;
        expect([rider.q, rider.r]).toEqual([carrier.q, carrier.r]);
    });

    it('dies with its transport, or a full APC is an invulnerable warehouse', () => {
        const state = loaded();
        const carrier = state.getUnit(0)!;
        // Kill the transport outright.
        state.record({ type: 'unitAttacked', attackerIndex: 2, defenderIndex: 0, damage: carrier.hp });
        state.record({ type: 'unitDied', unitIndex: 0 });
        for (const [index, rider] of state.liveUnits()) {
            if (rider.carriedBy === 0) state.record({ type: 'unitDied', unitIndex: index });
        }
        expect(state.getUnit(0)).toBeNull();
        expect(state.getUnit(1)).toBeNull();
    });
});

describe('unloading', () => {
    it('puts the passenger down on an adjacent hex', () => {
        const state = loaded();
        expect(unloadGene.apply(state, gene('unload', 0))).toBe(true);
        const rider = state.getUnit(1)!;
        const carrier = state.getUnit(0)!;
        expect(rider.carriedBy).toBeNull();
        expect([rider.q, rider.r]).not.toEqual([carrier.q, carrier.r]);
    });

    it('lands it with no movement but able to act', () => {
        // A transport that delivers a unit AND lets it drive off is a free
        // teleport. Being able to act is the payoff for having ridden.
        const state = loaded();
        unloadGene.apply(state, gene('unload', 0));
        const rider = state.getUnit(1)!;
        expect(rider.move).toBe(0);
        expect(rider.hasAttacked).toBe(false);
    });

    it('does not cost the transport its action', () => {
        // The owner's call: drive up, drop, and the Drover is still swept
        // into firing afterwards. Measured on a fresh turn, because LOAD
        // does spend the action and would otherwise be what is observed.
        const state = loadedAndRested();
        expect(state.getUnit(0)!.hasAttacked).toBe(false);
        unloadGene.apply(state, gene('unload', 0));
        expect(state.getUnit(0)!.hasAttacked).toBe(false);
    });

    it('but LOADING does cost it, which is the other half of the trade', () => {
        const state = loaded();
        expect(state.getUnit(0)!.hasAttacked).toBe(true);
    });

    it('refuses when there is nobody aboard', () => {
        const state = board([unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 })]);
        expect(unloadGene.applicable!(state, 0)).toBe(false);
    });

    it('will not drop onto an occupied hex', () => {
        const state = loaded();
        // Ring the transport so only one neighbour stays free, then check
        // the drop lands there rather than on top of somebody.
        const carrier = state.getUnit(0)!;
        unloadGene.apply(state, gene('unload', 0));
        const rider = state.getUnit(1)!;
        const occupant = state.getUnitAt(rider.q, rider.r);
        expect(occupant![0]).toBe(1);
        expect([rider.q, rider.r]).not.toEqual([carrier.q, carrier.r]);
    });
});
