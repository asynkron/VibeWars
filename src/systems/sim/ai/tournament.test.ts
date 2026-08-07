// Tests the tournament's fairness machinery, not who wins -- who wins is
// what the report run is for, and it changes whenever an engine is tuned.
//
// The machinery has to be right or the report lies: seats must alternate,
// draws must count half to each side, and the significance test must
// refuse to call a coin flip.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { runTournament, wilsonInterval, formatTournament, TOURNAMENT_BUDGET } from './tournament';
import { baselineEngine } from './engines/baseline';
import { parthianEngine } from './engines/parthian';
import { mirror8MapProvider } from '../../maps/Mirror8MapProvider';

// Tiny budget: these tests care about bookkeeping, not play strength.
const TINY = { population: 6, rounds: 1, lookaheadPlies: 1, replyCandidates: 2, finalists: 0 };

describe('wilsonInterval', () => {
    it('spans everything when nothing has been played', () => {
        expect(wilsonInterval(0, 0)).toEqual([0, 1]);
    });

    it('brackets the observed share', () => {
        const [lo, hi] = wilsonInterval(60, 100);
        expect(lo).toBeLessThan(0.6);
        expect(hi).toBeGreaterThan(0.6);
    });

    it('narrows as the sample grows', () => {
        const width = (s: number, n: number) => {
            const [lo, hi] = wilsonInterval(s, n);
            return hi - lo;
        };
        expect(width(600, 1000)).toBeLessThan(width(60, 100));
        expect(width(60, 100)).toBeLessThan(width(6, 10));
    });

    it('still calls 6-4 a coin flip, and 600-400 not', () => {
        // The whole reason the interval is here: a 60% win rate over ten
        // games is noise, and over a thousand it is a result.
        const [smallLo, smallHi] = wilsonInterval(6, 10);
        expect(smallLo).toBeLessThan(0.5);
        expect(smallHi).toBeGreaterThan(0.5);
        const [bigLo] = wilsonInterval(600, 1000);
        expect(bigLo).toBeGreaterThan(0.5);
    });

    it('never leaves [0, 1] even at the extremes', () => {
        for (const [s, n] of [[0, 5], [5, 5], [0, 1], [1, 1]]) {
            const [lo, hi] = wilsonInterval(s, n);
            expect(lo).toBeGreaterThanOrEqual(0);
            expect(hi).toBeLessThanOrEqual(1);
        }
    });
});

describe('runTournament', () => {
    const run = (rounds: number) => runTournament(baselineEngine, parthianEngine, {
        provider: mirror8MapProvider,
        rounds,
        seed: 500,
        budget: TINY,
    });

    it('plays every seed from both seatings', () => {
        const result = run(3);
        expect(result.matches).toHaveLength(6);
        for (let round = 0; round < 3; round++) {
            const pair = result.matches.filter((m) => m.round === round);
            expect(pair).toHaveLength(2);
            // Same seed, mirrored seats -- that is what cancels the
            // first-mover advantage.
            expect(pair[0].seed).toBe(pair[1].seed);
            expect(pair[0].seats).toEqual([...pair[1].seats].reverse());
        }
    }, 120_000);

    it('gives each engine the first move exactly half the time', () => {
        const result = run(4);
        const firstSeat = result.matches.map((m) => m.seats[0]);
        expect(firstSeat.filter((id) => id === baselineEngine.id)).toHaveLength(4);
        expect(firstSeat.filter((id) => id === parthianEngine.id)).toHaveLength(4);
    }, 120_000);

    it('books every match to exactly one outcome per engine', () => {
        const result = run(3);
        const played = result.matches.length;
        for (const tally of [result.a, result.b]) {
            expect(tally.wins + tally.losses + tally.draws).toBe(played);
            expect(tally.points).toBeCloseTo(tally.wins + tally.draws * 0.5, 10);
            expect(tally.winsAsFirst + tally.winsAsSecond).toBe(tally.wins);
        }
        // One side's win is the other's loss; draws are shared.
        expect(result.a.wins).toBe(result.b.losses);
        expect(result.a.draws).toBe(result.b.draws);
        // Total points are conserved: one point per match, however split.
        expect(result.a.points + result.b.points).toBeCloseTo(played, 10);
    }, 120_000);

    it('accounts for every match in the seat columns too', () => {
        const result = run(3);
        expect(result.seatWins[0] + result.seatWins[1] + result.draws).toBe(result.matches.length);
    }, 120_000);

    it('calls a winner only when its own interval clears 50%', () => {
        // Where the boundary actually sits at six matches: a clean sweep or
        // five-and-a-draw clears it, five-one does not. Asserting instead
        // that six matches can NEVER be decisive would be wrong, and would
        // turn red the day a challenger sweeps -- which is exactly the day
        // the tournament is working.
        expect(wilsonInterval(6, 6)[0]).toBeGreaterThan(0.5);
        expect(wilsonInterval(5.5, 6)[0]).toBeGreaterThan(0.5);
        expect(wilsonInterval(5, 6)[0]).toBeLessThan(0.5);

        // And the reported flag is the reported interval's verdict, not a
        // separately computed one that could drift from it.
        const result = run(3);
        const [lo, hi] = wilsonInterval(result.a.points, result.matches.length);
        expect(result.interval[0]).toBeCloseTo(lo, 10);
        expect(result.interval[1]).toBeCloseTo(hi, 10);
        expect(result.decisive).toBe(lo > 0.5 || hi < 0.5);
    }, 120_000);

    it('is reproducible from the same seed', () => {
        const strip = (r: ReturnType<typeof run>) => r.matches.map((m) => [m.seed, m.seats, m.winner, m.turns]);
        expect(strip(run(2))).toEqual(strip(run(2)));
    }, 120_000);

    it('refuses to run an engine against itself', () => {
        expect(() => runTournament(baselineEngine, baselineEngine, {
            provider: mirror8MapProvider, rounds: 1, budget: TINY,
        })).toThrow(/distinct/);
    });

    it('reports the result in a form that explains itself', () => {
        const text = formatTournament(baselineEngine, parthianEngine, run(2));
        expect(text).toContain(baselineEngine.notes);
        expect(text).toContain(parthianEngine.notes);
        expect(text).toContain('compute parity');
        expect(text).toContain('VERDICT');
    }, 120_000);
});

describe('TOURNAMENT_BUDGET', () => {
    it('is cheaper than what either engine asks for on its own', () => {
        // Batch play has to be affordable; if this ever drifts above the
        // engines' own budget the "many matches" promise quietly dies.
        expect(TOURNAMENT_BUDGET.population!).toBeLessThan(baselineEngine.options.population!);
        expect(TOURNAMENT_BUDGET.rounds!).toBeLessThanOrEqual(baselineEngine.options.rounds!);
    });
});
