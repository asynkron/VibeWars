import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { runHeadlessMatch, stateFromProvider } from './headless';
import { mirror8MapProvider } from '../maps/Mirror8MapProvider';

// Small search budget keeps these fast; the point is the loop mechanics,
// not AI strength.
const FAST = { population: 8, rounds: 1, lookaheadPlies: 1, replyCandidates: 3 };

describe('stateFromProvider', () => {
    it('builds the full mirrored setup as pure sim state', () => {
        const state = stateFromProvider(mirror8MapProvider);
        expect(state.cols).toBe(8);
        expect(state.unitCount).toBe(8); // 4 per side
        // Both sides present, mirrored rows.
        const [p0, p1] = [[...state.liveUnits()].filter(([, u]) => u.playerIndex === 0),
                          [...state.liveUnits()].filter(([, u]) => u.playerIndex === 1)];
        expect(p0.length).toBe(4);
        expect(p1.length).toBe(4);
        p0.forEach(([, u]) => expect(u.r).toBe(7));
        p1.forEach(([, u]) => expect(u.r).toBe(0));
    });
});

describe('runHeadlessMatch', () => {
    it('plays a complete match to a decisive or drawn end', () => {
        const result = runHeadlessMatch(mirror8MapProvider, { seed: 42, plan: FAST });
        expect([0, 1, -1]).toContain(result.winner);
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result.turns).toBeGreaterThan(0);
        // Someone lost units along the way, or it stalemated -- either way
        // the totals are consistent with the survivors.
        const [hp0, hp1] = result.hpTotals;
        expect(hp0).toBeGreaterThanOrEqual(0);
        expect(hp1).toBeGreaterThanOrEqual(0);
        if (result.winner === 0) expect(result.survivors[0].length).toBeGreaterThan(0);
        if (result.winner === 1) expect(result.survivors[1].length).toBeGreaterThan(0);
    });

    it('is deterministic given the seed', () => {
        const a = runHeadlessMatch(mirror8MapProvider, { seed: 7, plan: FAST });
        const b = runHeadlessMatch(mirror8MapProvider, { seed: 7, plan: FAST });
        expect(b).toEqual(a);
    });
});
