// Standing probe, env-gated, never part of the suite: parthian with the
// generic useSkill gene in its dialect against parthian without it, head
// to head at the tournament budget.
//
//   SKILL_PROBE=20 npx vitest run skillProbe --disable-console-intercept
//
// The question is cost, not gain: rotor12x18 has no forests to burn and
// Pikes rarely idle next to damaged machines, so useSkill mostly rolls
// its idle fallback there -- the probe asks whether spending 0.02 of the
// roulette on it hurts on an ordinary board. The grove exam
// (fireGrove.test.ts) asks the gain side.
//
// MEASURED (2026-08-07, 20 seed pairs = 40 matches, rotor12x18): 58.8%
// for the useSkill side, 95% interval 43.4-72.6% -- no measurable
// difference, point estimate leaning FOR, at 1.02-1.06x compute. The
// word costs nothing on a board without uses for it, which is exactly
// what fallback: 'idle' promises; it stays in the default dialect on
// robustness grounds (see useSkill.ts's header for the failure it
// prevents).

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { runTournament, formatTournament } from './tournament';
import { createEngine } from './AIEngine';
import { beamPlanGen } from './planners/beam';
import { beamPlanParallel } from './planners/beamParallel';
import { parthianEngine } from './engines/parthian';
import { USE_SKILL } from './genes/useSkill';
import { rotor12x18MapProvider } from '../../maps/Rotor12x18MapProvider';

declare const process: { env: Record<string, string | undefined> };

const ROUNDS = Number(process.env.SKILL_PROBE ?? 0);

describe.skipIf(!ROUNDS)('useSkill probe', () => {
    it(`parthian vs parthian-without-useSkill, ${ROUNDS} seed pairs`, () => {
        const dialect = parthianEngine.options.dialect!;
        const { [USE_SKILL]: _dropped, ...extrasWithout } = dialect.extras as Record<string, unknown>;
        const without = createEngine({
            id: 'parthian-noskill', name: 'Parthian utan useSkill', notes: 'probe',
            planner: beamPlanGen, asyncPlanner: beamPlanParallel,
            options: {
                ...parthianEngine.options,
                dialect: {
                    ...dialect,
                    // The pre-useSkill roulette: idle gets its 0.02 back.
                    weights: [
                        ...dialect.weights.filter(([kind]) => kind !== USE_SKILL),
                        ['idle', 0.02],
                    ] as any,
                    extras: extrasWithout as any,
                },
            },
        });
        const result = runTournament(parthianEngine, without, {
            provider: rotor12x18MapProvider,
            rounds: ROUNDS,
        });
        console.log(formatTournament(parthianEngine, without, result));
    }, 3_600_000);
});
