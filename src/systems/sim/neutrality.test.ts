// The fixture a refactor is measured against.
//
// Eight headless matches, played to completion, hashed event by event. The
// numbers below were generated from this file on unmodified main and
// committed; nothing derives them at runtime, which is the entire point --
// a fixture that recomputes itself proves nothing.
//
// WHY A DIGEST AND NOT THE RESULT. HeadlessMatchResult already reports the
// winner, the turn count, the survivors and the hp totals, and a change can
// leave every one of them untouched while playing a completely different
// match: two engines can both reach 6-3 on turn 22 by different routes.
// The digest covers every event in order -- each move, each shot, each
// crater -- so it is sensitive to anything the simulation actually did.
//
// WHAT TO DO WHEN IT FAILS. Ask whether the change was supposed to alter
// play. If it was not, this test has caught something. If it was, take the
// new numbers and say so in the commit message, so the diff records that
// behaviour moved deliberately -- which is what makes the fixture worth
// having when the next refactor claims to be neutral.

import './../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { runHeadlessMatch } from './headless';
import { rotor12x18MapProvider } from '../maps/Rotor12x18MapProvider';
import { mirror8MapProvider } from '../maps/Mirror8MapProvider';
import { getEngine } from './ai/engineRegistry';

// Deliberately spread across two maps, several seeds and both engines, so a
// change that only shows up on one board or one search shape still moves at
// least one row.
//
// The narrow budget is the same one headless.test.ts uses, and for the same
// reason: the default engine is a BEAM planner, which reads none of the
// hillclimb fields, so without beamChildCounts these matches run the shipped
// search at full width and the file becomes too slow to run every time. A
// fixture nobody runs is not a fixture.
const FAST_PLAN = {
    population: 8, rounds: 1, lookaheadPlies: 1, replyCandidates: 3, finalists: 0,
    beamChildCounts: [8, 4, 3, 2, 2],
};
const CASES: Array<{ name: string; map: any; seed: number; engines: [string, string]; digest: string }> = [
    { name: 'rotor12x18 parthian vs parthian, seed 1', map: rotor12x18MapProvider, seed: 1, engines: ['parthian', 'parthian'], digest: 'e94940fa:146' },
    { name: 'rotor12x18 parthian vs parthian, seed 2', map: rotor12x18MapProvider, seed: 2, engines: ['parthian', 'parthian'], digest: 'fefff3a9:90' },
    { name: 'rotor12x18 parthian vs baseline, seed 3', map: rotor12x18MapProvider, seed: 3, engines: ['parthian', 'baseline'], digest: '01c7d4e9:101' },
    { name: 'rotor12x18 baseline vs parthian, seed 4', map: rotor12x18MapProvider, seed: 4, engines: ['baseline', 'parthian'], digest: 'fcfc692b:87' },
    { name: 'mirror8 parthian vs parthian, seed 1', map: mirror8MapProvider, seed: 1, engines: ['parthian', 'parthian'], digest: '3852cc9f:103' },
    { name: 'mirror8 parthian vs parthian, seed 5', map: mirror8MapProvider, seed: 5, engines: ['parthian', 'parthian'], digest: 'a67bbc45:80' },
    { name: 'mirror8 baseline vs baseline, seed 6', map: mirror8MapProvider, seed: 6, engines: ['baseline', 'baseline'], digest: 'e6ab2eed:48' },
    { name: 'mirror8 parthian vs baseline, seed 7', map: mirror8MapProvider, seed: 7, engines: ['parthian', 'baseline'], digest: 'c3b0c77f:85' },
];

function play(testCase: typeof CASES[number]) {
    return runHeadlessMatch(testCase.map, {
        seed: testCase.seed,
        engines: [getEngine(testCase.engines[0])!, getEngine(testCase.engines[1])!],
        plan: FAST_PLAN,
    });
}

describe('play is unchanged', () => {
    it.each(CASES)('$name', (testCase) => {
        expect(play(testCase).eventDigest).toBe(testCase.digest);
    });

    it('is deterministic, or the fixture above means nothing', () => {
        // The assertion that makes the rest of the file trustworthy: the
        // same match played twice must hash the same, or a red row would
        // only ever mean "the search wandered".
        const first = play(CASES[0]);
        const second = play(CASES[0]);
        expect(second.eventDigest).toBe(first.eventDigest);
    });

    it('notices when play changes', () => {
        // And the other half: a digest that never moved would pass this
        // file forever. Two different seeds must disagree.
        expect(play(CASES[0]).eventDigest).not.toBe(play(CASES[1]).eventDigest);
    });
});
