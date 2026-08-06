// THE WATER CHOKE. A river seals the map except for one crossing. South
// of it: a Kloss (99 hp, deals NOTHING -- pure architecture) and a
// Pyramid (kills, dies to a touch, cannot shoot anything adjacent).
// North: a Boll -- fast enough to cross and one-shot the Pyramid the
// moment the crossing is open. The board's economy is skewed on purpose
// (see gambit.ts typeValue): the Pyramid's death is the attacker's whole
// win and rings like a klaxon through every rollout, while chipping the
// Kloss earns nothing -- position is the only currency.
//
// The right play is a formation, not a move: the Kloss STANDS ON the
// crossing -- an occupied hex is impassable, so the door is shut -- and
// the Pyramid stands exactly two hexes behind it, where it can shell the
// only hex the Boll can threaten from (the crossing's lone northern
// neighbour) while nothing can ever reach it. Held, the formation wins the
// long game: the Boll either stands in the shelling and dies, or keeps
// out of range and loses the stalemate on points. Broken -- the crossing
// left open even once -- the Boll walks through and deletes the Pyramid,
// which under the skewed economy is the whole match.
//
// So one match answers the question the tournaments cannot: not "is this
// engine better", but "does it actually find the right move". Over in a
// few seconds, deterministic, and readable from the picture below.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { scenario } from './scenario';
import { runHeadlessMatch } from '../headless';
import { requireEngine } from '../ai/engineRegistry';
import { CHOKE_PICTURE, RETREAT_PICTURE, TWIN_PICTURE, CHOKE_LEGEND } from '../../maps/ChokeMapProvider';

declare const process: { env: Record<string, string | undefined> };

// The board comes from the PLAYABLE map -- Boll, Kloss and Pyramid are
// real roster units and ?map=choke is this exact fight in the live game.
// One picture, two consumers, no drift.
const CHOKE = scenario('water-choke', CHOKE_PICTURE, CHOKE_LEGEND);

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
    // Re-measured under the skewed economy: the klaxon lifted plain
    // parthian to 6/6 -- the payoff signal now drowns the aggression
    // noise. The gate stays at 4 to absorb dice.
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
        console.log(`choke hold ${held}/6: ${outcomes.join(' | ')}`);
        expect(held, outcomes.join(' | ')).toBeGreaterThanOrEqual(4);
    }, 480_000);
});

describe('the retreat: walk back through the door and shut it', () => {
    // Same board, same units -- the Kloss starts on the WRONG side, in the
    // Boll's half. Standing to fight is a slow loss; the only winning line
    // retreats under fire through the crossing and stops on it. Purposeful
    // withdrawal is the exact move an aggression gradient resists, which
    // is why this board exists.
    const RETREAT = scenario('choke-retreat', RETREAT_PICTURE, CHOKE_LEGEND);

    it('is UNSOLVED: the default engine never finds the withdrawal', () => {
        // 0 of 6, every seed an elimination on turn 12: the Kloss fights
        // where it stands and dies in five turns instead of walking back
        // through the door. The kill this fails to prevent lands beyond
        // the depth-3 horizon at the moment the retreat must begin, and
        // by the time it is visible the walk is too long -- the exact
        // shape of gap this board was authored to expose.
        //
        // PINNED AT THE FAILURE ON PURPOSE, fixture-style: when a gene, a
        // depth or a budget teaches an engine the withdrawal, this line
        // goes red -- and then it must be RAISED into a real gate for the
        // new ability, with the change that earned it named in the commit.
        const engine = requireEngine('parthian');
        let held = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(RETREAT, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[0].includes('Pyramid');
            if (ok) held++;
            outcomes.push(`seed ${seed}: ${ok ? 'held' : `BROKE (${result.reason}, ${result.turns}t)`}`);
        }
        console.log(`retreat hold ${held}/6: ${outcomes.join(' | ')}`);
        expect(held, outcomes.join(' | ')).toBe(0);
    }, 480_000);

    it('bastion finds it: the blockade gene lifts the board off zero', () => {
        // The gene built FROM this board's autopsy, gated at its measured
        // truth: 2 of 6 -- not solved, but no longer unspeakable. Parthian
        // stays pinned at 0 above; the day bastion's rate rises, raise
        // this gate with it.
        const engine = requireEngine('bastion');
        let held = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(RETREAT, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[0].includes('Pyramid');
            if (ok) held++;
            outcomes.push(`seed ${seed}: ${ok ? 'held' : `BROKE (${result.reason}, ${result.turns}t)`}`);
        }
        console.log(`retreat bastion ${held}/6: ${outcomes.join(' | ')}`);
        expect(held, outcomes.join(' | ')).toBeGreaterThanOrEqual(2);
    }, 480_000);
});

describe('the twin pass: two tiles, two Klosses, one answer', () => {
    // Roger's pair exam. One body in a two-wide pass buys nothing -- the
    // hex metric prices the detour around one of two adjacent tiles at
    // zero -- so the only winning line is COMPOSED: both Klosses in the
    // cut, placed across turns by genes that see each other's bodies.
    const TWIN = scenario('choke-twin', TWIN_PICTURE, CHOKE_LEGEND);

    it('is UNSOLVED by the default engine', () => {
        // Pinned at the failure, retreat-style: red here means something
        // taught the default composition, and this must become a gate.
        const engine = requireEngine('parthian');
        let held = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(TWIN, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[0].includes('Pyramid');
            if (ok) held++;
            outcomes.push(`seed ${seed}: ${ok ? 'held' : 'BROKE'}`);
        }
        console.log(`twin parthian ${held}/6: ${outcomes.join(' | ')}`);
        expect(held, outcomes.join(' | ')).toBe(0);
    }, 480_000);

    it('bastion composes the pair: measured at 3 of 6', () => {
        const engine = requireEngine('bastion');
        let held = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(TWIN, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[0].includes('Pyramid');
            if (ok) held++;
            outcomes.push(`seed ${seed}: ${ok ? 'held' : 'BROKE'}`);
        }
        console.log(`twin bastion ${held}/6: ${outcomes.join(' | ')}`);
        expect(held, outcomes.join(' | ')).toBeGreaterThanOrEqual(3);
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
