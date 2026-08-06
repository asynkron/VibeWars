// TALUS -- Feint with the sacrifice slots taken from a spread through the
// worse half of the ranking instead of off its absolute bottom. A clone
// with ONE value changed, in the ablation style feint.ts set. Named for
// the rubble band at the foot of a cliff, which is where this engine goes
// looking for its sacrifices.
//
// The hypothesis. keepWorst exists because a move that looks bad now is
// exactly the move whose consequences need playing out -- but "the worst
// of the ranking" and "an interesting sacrifice" are only the same thing
// when the ranking is short. At width 80 the bottom four are plausible
// feints; at the live width of 2600 the bottom of the ranking is suicide
// noise -- a unit walking into fire or parking its transport in the guns
// -- and four slots spent there are four slots wasted. Spread picks (see
// beam.ts sacrificePicks) sample the whole bad-but-not-catastrophic band
// instead.
//
// MEASURED, and the result is two-sided. At the tournament budget (width
// 80) it won decisively: 248-152 over 400 matches against Feint, a 62.0%
// share with a 95% interval of 57.2-66.6%, at 1.02x compute parity. At
// SIX TIMES the width (480, via BEAM_SCALE=6) the edge disappears: 120
// matches could not separate the two (feint 53.8%, interval 44.9-62.4%).
// The opposite of the header's own prediction -- the spread was expected
// to need large widths and instead only shows at small ones, where the
// remainder is short and its absolute bottom is at its most degenerate.
// Never measured WORSE than Feint at any width, so it holds the DEFAULT
// seat (see engineRegistry.ts) -- but at the live widths of 1400-2600 the
// honest claim is "at least as good", not "better".
//
// The parallel planner runs it as a TWO-PHASE level, because the spread
// selects from the node's whole ranking and the worker keep-pruning ships
// exactly not-that: round one returns every child as metadata, selection
// happens in the planner with the same sacrificePicks the serial planner
// uses, and round two recomputes only the picked children by absolute
// index. beamParallel.test.ts holds the two planners to event-for-event
// identity, same as it always has.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';

export const talusEngine = createEngine({
    id: 'talus',
    name: 'Talus',
    notes: 'Feint with sacrifice slots spread through the worse half of the ranking instead of its absolute bottom.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...feintEngine.options,
        beam: {
            ...feintEngine.options.beam,
            // The one changed value.
            spreadWorst: true,
        },
    },
});
