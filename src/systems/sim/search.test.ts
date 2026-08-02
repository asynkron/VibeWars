import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { planTurn } from './search';
import { scoreState } from './score';
import { HexCoord } from '../../shared/hexengine/HexCoord';

const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });

function makeUnit(patch: any = {}) {
    return {
        type: 'Bulwark', q: 2, r: 2, playerIndex: 1, hp: 10, maxHp: 10,
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

    it('chains move + attack for one unit in the same turn (regression)', () => {
        // Bulwark has range 1 and move 2; the 2hp Droid sits at distance 2.
        // The kill requires moving adjacent AND attacking in one turn --
        // with single-command-per-unit plans this was impossible (units
        // either moved or attacked, never both).
        const snapshot = makeState([
            makeUnit({ q: 2, r: 2, playerIndex: 1, move: 2, minRange: 1, maxRange: 1 }),
            makeUnit({ type: 'Droid', q: 4, r: 2, playerIndex: 0, hp: 2, maxHp: 2 }),
        ]);
        expect(HexCoord.getDistance(2, 2, 4, 2)).toBe(2);

        const result = planTurn(snapshot, 1, { population: 24, rounds: 4, seed: 3 });

        expect(result.events.some((e) => e.type === 'unitMoved' && e.unitIndex === 0)).toBe(true);
        expect(result.events.some((e) => e.type === 'unitDied' && e.unitIndex === 1)).toBe(true);
    });

    it('lookahead refuses the lone suicide rush that greedy search loves', () => {
        // A lone Shrike (move 5, range 1, 4 hp, expected damage 8) with an
        // enemy Bulwark (10 hp, expected damage 5) at distance 6. Greedy
        // (no lookahead): fly adjacent and attack -- +80 score from damage,
        // looks great. With lookahead the Bulwark's reply kills the 4hp
        // Shrike, a terrible trade -- the plan must not end adjacent.
        const build = () => makeState([
            makeUnit({ type: 'Shrike', q: 1, r: 1, playerIndex: 1, hp: 4, maxHp: 4, move: 5, minRange: 1, maxRange: 1 }),
            makeUnit({ type: 'Bulwark', q: 7, r: 1, playerIndex: 0, hp: 10, maxHp: 10, move: 2 }),
        ]);
        expect(HexCoord.getDistance(1, 1, 7, 1)).toBe(6);

        const greedy = planTurn(build(), 1, { population: 24, rounds: 4, seed: 5, lookaheadPlies: 0 });
        expect(greedy.events.some((e) => e.type === 'unitAttacked' && e.attackerIndex === 0)).toBe(true);

        const farsighted = planTurn(build(), 1, { population: 24, rounds: 4, seed: 5, lookaheadPlies: 2 });
        const replayed = build().fork();
        farsighted.events.forEach((e) => replayed.record(e));
        const shrike = replayed.getUnit(0)!;
        const bulwark = replayed.getUnit(1)!;
        // Not parked next to the enemy tank at end of turn.
        expect(HexCoord.getDistance(shrike.q, shrike.r, bulwark.q, bulwark.r)).toBeGreaterThan(1);
    });

    it('is deterministic given the seed', () => {
        const build = () => makeState([
            makeUnit({ q: 1, r: 1, playerIndex: 1 }),
            makeUnit({ q: 3, r: 3, playerIndex: 1, type: 'Kestrel', minRange: 3, maxRange: 5 }),
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
        // lookahead 0: with lookahead, `score` is the horizon score (after
        // simulated replies), which the executed first-turn events alone
        // can't reproduce by design.
        const result = planTurn(snapshot, 1, { population: 12, rounds: 2, seed: 11, lookaheadPlies: 0 });

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
