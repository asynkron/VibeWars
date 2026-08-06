// Standing benchmark for the simulation hot path. Gated on BENCH=1 so the
// normal suite never pays for it. Times feint's serial planner at the live
// difficulty widths and digests the chosen events -- a pure optimisation
// must leave every digest untouched and only move the clock, which is the
// same bargain the neutrality fixtures enforce at match scale.
//
//   BENCH=1 npx vitest run perfBench --disable-console-intercept
//
// Reference points on this machine (2026-08-06): the string-keyed
// pathfinding baseline ran opening/medium at 7529 ms and midgame/medium at
// 11199 ms; hex-index keys, the allocation-free hexDistance and the
// cost-field cache brought them to ~3200 ms with identical digests.

import '../../test/threeStub';
import { describe, it } from 'vitest';
import { rotor12x18MapProvider } from '../maps/Rotor12x18MapProvider';
import { stateFromProvider, runHeadlessMatch } from './headless';
import { SimState } from './SimState';
import { startTurn } from './SimCommands';
import { mulberry32, combineSeed } from './resolveAttack';
import { feintEngine } from './ai/engines/feint';

declare const process: { env: Record<string, string | undefined> };

const now = () => performance.now();

// Same rolling FNV-1a the headless digest uses, over one turn's events.
const digestOf = (events: readonly unknown[]): string => {
    const text = JSON.stringify(events);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(hash >>> 0).toString(16).padStart(8, '0')}:${events.length}`;
};

// Play `halfTurns` cheap half-turns from the map start, mirroring the
// headless loop, and return a snapshot ready for the next side to plan.
function stateAfter(halfTurns: number): { snapshot: SimState; side: number } {
    let state = stateFromProvider(rotor12x18MapProvider);
    const cheap = feintEngine.withBudget({ beamChildCounts: [24, 12, 8], beamDepth: 3 });
    for (let turn = 0; turn < halfTurns; turn++) {
        const side = turn % 2;
        startTurn(state, side, mulberry32(combineSeed(99, turn)));
        const snapshot = state.condense();
        const { events } = cheap.planTurn(snapshot, side, combineSeed(99, turn));
        state = snapshot;
        for (const event of events) state.record(event);
    }
    const side = halfTurns % 2;
    startTurn(state, side, mulberry32(combineSeed(99, halfTurns)));
    return { snapshot: state.condense(), side };
}

// batch = feint's own beam ([80, 60, 30, 20, 16] at depth 3). low/medium
// pin the original reference points at depth 3 -- their digests are the
// regression anchor and must never move. The -live entries are the actual
// difficulty budgets at their true depths, reachable since beamParallel
// started honouring beamDepth; they had no baseline before that fix.
const BUDGETS: Record<string, object> = {
    batch: {},
    low: { beamChildCounts: [160, 120, 60, 40, 32], beamDepth: 3 },
    medium: { beamChildCounts: [1400, 1000, 620, 400, 260], beamDepth: 3 },
    'medium-live': { beamChildCounts: [1400, 1000, 620, 400, 260], beamDepth: 4 },
    'hard-live': { beamChildCounts: [2600, 1900, 1200, 800, 520], beamDepth: 5 },
};

describe.skipIf(!process.env.BENCH)('planner benchmark', () => {
    it('times feint at live widths on opening and midgame boards', { timeout: 600_000 }, () => {
        const opening = stateAfter(0);
        const midgame = stateAfter(8);

        // Warm the JIT off the clock.
        feintEngine.planTurn(opening.snapshot, opening.side, 1);

        for (const [stateName, at] of [['opening', opening], ['midgame', midgame]] as const) {
            for (const [budgetName, budget] of Object.entries(BUDGETS)) {
                const engine = feintEngine.withBudget(budget);
                const start = now();
                const { events } = engine.planTurn(at.snapshot, at.side, 42);
                const ms = now() - start;
                console.log(`bench ${stateName}/${budgetName}: ${ms.toFixed(0).padStart(6)} ms  digest ${digestOf(events)}`);
            }
        }
    });

    it('times a capped headless match', { timeout: 600_000 }, () => {
        const start = now();
        const result = runHeadlessMatch(rotor12x18MapProvider, { seed: 7, maxTurns: 24 });
        const ms = now() - start;
        console.log(`bench match: ${ms.toFixed(0)} ms wall, planMs [${result.planMs.map((v) => v.toFixed(0)).join(', ')}], digest ${result.eventDigest} (${result.reason})`);
    });
});
