// Standing probe, env-gated, never part of the suite: parthian with
// state-hash dedup against parthian without, head to head at the
// tournament budget.
//
//   DEDUP_PROBE=20 npx vitest run dedupProbe --disable-console-intercept
//
// MEASURED TWICE (2026-08-06, 20 seed pairs = 40 matches each,
// rotor12x18), and the two runs answer different questions:
//
//   walk-the-board hash:  47.5% [32.9-62.5], compute 1.53x
//   incremental hash:     43.8% [29.6-59.0], compute 1.02x
//
// The second run is AFTER the hash moved into SimState and became
// incremental (delta-XOR per write instead of a board walk per child) --
// which erased the compute cost exactly as predicted. What it did not do
// is surface a strength effect: both intervals span 50%, both point
// estimates lean under it, and the retreat scenario held fewer seeds
// with dedup on. So parthian ships with dedupeChildren OFF: the flag is
// free now, but free is not a reason -- a play-changing flag enters
// through a win, and 80 combined matches have not shown one. Worth
// rerunning at more rounds if a small effect is suspected.

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { runTournament, formatTournament } from './tournament';
import { createEngine } from './AIEngine';
import { beamPlanGen } from './planners/beam';
import { beamPlanParallel } from './planners/beamParallel';
import { parthianEngine } from './engines/parthian';
import { rotor12x18MapProvider } from '../../maps/Rotor12x18MapProvider';

declare const process: { env: Record<string, string | undefined> };

const ROUNDS = Number(process.env.DEDUP_PROBE ?? 0);

describe.skipIf(!ROUNDS)('dedup probe', () => {
    it(`parthian+dedup vs parthian, ${ROUNDS} seed pairs`, () => {
        const withDedup = createEngine({
            id: 'parthian-dedup', name: 'Parthian+dedup', notes: 'probe',
            planner: beamPlanGen, asyncPlanner: beamPlanParallel,
            options: {
                ...parthianEngine.options,
                beam: { ...(parthianEngine.options as any).beam, dedupeChildren: true },
            } as any,
        });
        const without = createEngine({
            id: 'parthian-plain', name: 'Parthian plain', notes: 'probe',
            planner: beamPlanGen, asyncPlanner: beamPlanParallel,
            options: {
                ...parthianEngine.options,
                beam: { ...(parthianEngine.options as any).beam, dedupeChildren: false },
            } as any,
        });
        const result = runTournament(withDedup, without, {
            provider: rotor12x18MapProvider,
            rounds: ROUNDS,
        });
        console.log(formatTournament(withDedup, without, result));
    }, 3_600_000);
});
