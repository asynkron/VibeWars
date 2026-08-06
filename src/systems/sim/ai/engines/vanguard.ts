// VANGUARD -- Parthian plus the rest of the press family: shoot-and-
// advance, shoot-and-block, storm-capture. Four genes that all answer the
// same observation (Roger's): the sweep fires from FINAL positions, so
// movement left after its shot is dead, and "shoot, THEN spend the rest
// of the move doing something" is a shape the search almost never draws
// as independent genes. Hit-and-run proved the shape pays (58.5% over
// Talus, effect held at width); these are its siblings, one per use of
// the leftover movement: leave (hitAndRun), keep coming (shootAdvance),
// shut the door (shootBlock), kick the door in (stormCapture).
//
// COMBINED FIRST, LIKE SAPPER, AND FOR SAPPER'S REASON: the individual
// effects are expected to be small and the singles can be split out
// afterwards if the family wins. A loss here rules out all three in one
// run; a win starts the decomposition.
//
// WEIGHTS, second draft, and the first is a story worth keeping. Draft
// one diluted hitAndRun to 0.06 to fund the siblings, and the water choke
// failed the seeds it was first run on. Chasing that failure produced two
// fixes that stand on their own logic -- the dead-zone guard in
// shootAdvance, and fallback: 'idle' on the whole family so genes that
// cannot apply on a board add NOTHING instead of rerolling into advance
// pressure (the old convention; see GeneDefinition.fallback) -- and one
// humbling control: an eight-seed probe showed the choke's margins are
// seed-noisy between healthy engines (parthian itself holds 6 of 8), so
// the scenario could convict the sweepless and the hillclimb, but not a
// weight table. What remains is the principled shape: Parthian's
// purposeful weights untouched, hitAndRun's earned 0.10 included, the
// siblings additive at 0.02 each out of the noise slots. The verdict on
// whether they PAY is the tournament's, as always.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { parthianEngine } from './parthian';
import { HIT_AND_RUN, hitAndRunGene } from '../genes/hitAndRun';
import { SHOOT_ADVANCE, shootAdvanceGene } from '../genes/shootAdvance';
import { SHOOT_BLOCK, shootBlockGene } from '../genes/shootBlock';
import { STORM_CAPTURE, stormCaptureGene } from '../genes/stormCapture';

export const vanguardEngine = createEngine({
    id: 'vanguard',
    name: 'Vanguard',
    notes: 'Parthian plus the full press family: shoot then advance, shoot then block the door, shoot then storm the capture.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...parthianEngine.options,
        dialect: {
            ...parthianEngine.options.dialect!,
            weights: [
                // Untouched, exactly as Parthian has them -- hitAndRun's
                // earned 0.10 included.
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                [HIT_AND_RUN, 0.10],
                // The siblings, additive, funded from noise alone.
                [SHOOT_ADVANCE, 0.02],
                [SHOOT_BLOCK, 0.02],
                [STORM_CAPTURE, 0.02],
                ['moveRandom', 0.02],
                ['idle', 0.02],
            ],
            extras: {
                [HIT_AND_RUN]: hitAndRunGene,
                [SHOOT_ADVANCE]: shootAdvanceGene,
                [SHOOT_BLOCK]: shootBlockGene,
                [STORM_CAPTURE]: stormCaptureGene,
            },
        },
    },
});
