import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { planTurn } from './search';
import { scoreState } from './score';
import { HexCoord } from '../../shared/hexengine/HexCoord';

const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });

function makeUnit(patch: any = {}) {
    return {
        type: 'Tank1', q: 2, r: 2, playerIndex: 1, hp: 10, maxHp: 10,
        move: 2, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false,
        ...patch,
    };
}

function makeState(units: any[]): SimState {
    return SimState.snapshot({
        map: { cols: 8, rows: 8, getTile: () => grass() },
        units,
    });
}

describe('scoreState', () => {
    it('rewards kills and dealt damage', () => {
        const state = makeState([
            makeUnit({ playerIndex: 1 }),
            makeUnit({ type: 'Droid', q: 4, r: 4, playerIndex: 0, hp: 2, maxHp: 2 }),
        ]);
        const before = scoreState(state, 1);
        state.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 2 });
        state.record({ type: 'unitDied', unitIndex: 1 });
        expect(scoreState(state, 1)).toBeGreaterThan(before);
    });

    it('rewards closing distance to the enemy (aggression term)', () => {
        const state = makeState([
            makeUnit({ q: 0, r: 0, playerIndex: 1 }),
            makeUnit({ q: 6, r: 6, playerIndex: 0 }),
        ]);
        const before = scoreState(state, 1);
        state.record({ type: 'unitMoved', unitIndex: 0, toQ: 2, toR: 2, moveSpent: 2 });
        expect(scoreState(state, 1)).toBeGreaterThan(before);
    });
});

describe('planTurn', () => {
    it('finds the kill when an enemy is in range', () => {
        // AI tank adjacent to a 2hp droid: any sane plan attacks and kills.
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const snapshot = makeState([
            makeUnit({ playerIndex: 1 }),
            makeUnit({ type: 'Droid', q: neighbor.q, r: neighbor.r, playerIndex: 0, hp: 2, maxHp: 2 }),
        ]);
        const result = planTurn(snapshot, 1, { population: 16, rounds: 3, seed: 42 });

        expect(result.score).toBeGreaterThan(scoreState(snapshot, 1)); // beats doing nothing
        expect(result.events.some((e) => e.type === 'unitDied' && e.unitIndex === 1)).toBe(true);
    });

    it('is deterministic given the seed', () => {
        const build = () => makeState([
            makeUnit({ q: 1, r: 1, playerIndex: 1 }),
            makeUnit({ q: 3, r: 3, playerIndex: 1, type: 'Tank2', minRange: 3, maxRange: 5 }),
            makeUnit({ q: 6, r: 6, playerIndex: 0 }),
        ]);
        const a = planTurn(build(), 1, { population: 12, rounds: 2, seed: 7 });
        const b = planTurn(build(), 1, { population: 12, rounds: 2, seed: 7 });
        expect(a.events).toEqual(b.events);
        expect(a.score).toBe(b.score);
        expect(a.genes).toEqual(b.genes);
    });

    it('replaying the winning events onto a fresh fork reproduces the score', () => {
        const snapshot = makeState([
            makeUnit({ q: 1, r: 1, playerIndex: 1 }),
            makeUnit({ q: 5, r: 5, playerIndex: 0, hp: 4, maxHp: 10 }),
        ]);
        const result = planTurn(snapshot, 1, { population: 12, rounds: 2, seed: 11 });

        const replayed = snapshot.fork();
        result.events.forEach((e) => replayed.record(e));
        expect(scoreState(replayed, 1)).toBe(result.score);
    });

    it('returns an empty plan when the player has no units', () => {
        const snapshot = makeState([makeUnit({ playerIndex: 0 })]);
        const result = planTurn(snapshot, 1, { seed: 1 });
        expect(result.events).toEqual([]);
        expect(result.genes).toEqual([]);
    });
});
