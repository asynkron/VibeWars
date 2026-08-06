// THE WATER CHOKE. A river seals the map except for one crossing. South
// of it: a Kloss (30 hp, deals nothing) and a Pyramid (kills in three
// hits, dies to a touch, and cannot shoot anything adjacent). North: a
// Boll -- fast enough to cross and one-shot the Pyramid the moment the
// crossing is open.
//
// The right play is a formation, not a move: the Kloss STANDS ON the
// crossing -- an occupied hex is impassable, so the door is shut -- and
// the Pyramid stands exactly two hexes behind it, where it can shell the
// only hex the Boll can threaten from ((3,3), the crossing's lone northern
// neighbour) while nothing can ever reach it. Held, the formation wins the
// long game with the WEAKER army: the Boll either stands in the shelling
// and dies in three turns, or keeps out of range and loses the stalemate
// on points, 32 hp to 14. Broken -- the crossing left open even once
// before turn one ends -- the Boll walks through, deletes the Pyramid,
// and grinds the Kloss down at leisure: 6 damage a turn against 1 back.
//
// So one match answers the question the tournaments cannot: not "is this
// engine better", but "does it actually find the right move". Over in a
// few seconds, deterministic, and readable from the picture below.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { registerScenarioUnits } from './testUnits';
import { scenario } from './scenario';
import { runHeadlessMatch } from '../headless';
import { requireEngine } from '../ai/engineRegistry';

declare const process: { env: Record<string, string | undefined> };

registerScenarioUnits();

const CHOKE = scenario('water-choke', [
    '...B...',
    '.......',
    '.......',
    '.......',
    '~~~.~~~',
    '.......',
    '...K...',
    '.......',
    '...A...',
], {
    K: { type: 'Kloss', player: 0 },
    A: { type: 'Pyramid', player: 0 },
    B: { type: 'Boll', player: 1 },
});

// Enough width for the beam to discover the formation, small enough that
// the whole match runs in seconds.
const PLAN = { beamChildCounts: [48, 24, 12], beamDepth: 3 };

describe('water choke: block the door, shell over the wall', () => {
    // A RATE, not a single match. Formation-holding at this width is
    // seed-marginal for every healthy beam engine -- the first draft
    // asserted three individual seeds, and a probe across eight showed
    // the default engine holding six with the failures landing on
    // different seeds per engine. What separates CLASSES is total: the
    // old hillclimb and the sweepless quickdraw lose every seed, a
    // healthy engine holds most. The gate sits between those, so it
    // catches a class regression without flaking on dice.
    it('the default engine holds the crossing most of the time', () => {
        const engine = requireEngine('parthian');
        let held = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(CHOKE, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[0].includes('Pyramid');
            if (ok) held++;
            outcomes.push(`seed ${seed}: ${ok ? 'held' : `BROKE (${result.reason}, ${result.turns}t)`}`);
        }
        expect(held, outcomes.join(' | ')).toBeGreaterThanOrEqual(4);
    }, 480_000);
});

// SCENARIO_SURVEY=1 -- not part of the suite: run the same board across
// every beam engine and print who solves it. The scenario as an
// instrument rather than a gate.
describe.skipIf(!process.env.SCENARIO_SURVEY)('water choke survey', () => {
    it('prints every engine against the choke', () => {
        for (const id of ['baseline', 'feint', 'talus', 'mirage', 'parthian', 'quickdraw', 'vanguard']) {
            const engine = requireEngine(id);
            const result = runHeadlessMatch(CHOKE, {
                seed: 1, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const pyramid = result.survivors[0].includes('Pyramid') ? 'Pyramid lever' : 'Pyramid DOG';
            console.log(`choke ${id.padEnd(10)} vinnare ${result.winner} | ${pyramid} | ${result.reason} | ${result.turns} turns`);
        }
    }, 600_000);
});
