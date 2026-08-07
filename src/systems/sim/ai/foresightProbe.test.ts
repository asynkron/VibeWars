// Standing probe, env-gated, never part of the suite: parthian with
// frozen-future foresight against parthian without it, head to head at
// the tournament budget.
//
//   FORESIGHT_PROBE=20 npx vitest run foresightProbe --disable-console-intercept
//
// rotor12x18 has no forests, so the only fires there are burning wrecks
// (WRECK_FIRE_CHANCE on mechanical deaths). The probe asks two things at
// once: does pricing wreck-fire futures help or hurt on an ordinary
// board, and does the hasFire guard keep the compute parity honest. The
// grove exam (fireGrove.test.ts) measures the gain side directly.
//
// MEASURED (2026-08-07, 20 seed pairs = 40 matches, rotor12x18): dead
// even -- 20W 20L, 50.0% [35.2-64.8], compute parity 1.04x WITHOUT
// foresight (i.e. the foresight side was not even measurably slower).
// Exactly what the guard promises: on a board where fire barely exists,
// the feature neither helps, hurts, nor costs. The grove gate carries
// the gain; this probe carries the "and it is free" half.

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { runTournament, formatTournament } from './tournament';
import { createEngine } from './AIEngine';
import { beamPlanGen } from './planners/beam';
import { beamPlanParallel } from './planners/beamParallel';
import { parthianEngine } from './engines/parthian';
import { rotor12x18MapProvider } from '../../maps/Rotor12x18MapProvider';

declare const process: { env: Record<string, string | undefined> };

const ROUNDS = Number(process.env.FORESIGHT_PROBE ?? 0);

describe.skipIf(!ROUNDS)('foresight probe', () => {
    it(`parthian vs parthian-without-foresight, ${ROUNDS} seed pairs`, () => {
        const { foresight: _dropped, ...optionsWithout } = parthianEngine.options as any;
        const without = createEngine({
            id: 'parthian-blind', name: 'Parthian utan foresight', notes: 'probe',
            planner: beamPlanGen, asyncPlanner: beamPlanParallel,
            options: optionsWithout,
        });
        const result = runTournament(parthianEngine, without, {
            provider: rotor12x18MapProvider,
            rounds: ROUNDS,
        });
        console.log(formatTournament(parthianEngine, without, result));
    }, 3_600_000);
});
