// FEINT -- Gambit looking three turns instead of five. A clone of
// gambit.ts with ONE value changed, which is the whole design: Wolfpack
// changed seven things at once and its result was unreadable even before
// it turned out to be noise.
//
// The question it answers. Gambit beats baseline handily, but it also
// spends about eleven times the thinking time, so "deeper search wins"
// and "more search wins" are still tangled together. Depth 3 costs about a
// fifth of depth 5 -- the beam's node count roughly quintuples over the
// last two levels -- so Feint lands near baseline's own budget while
// keeping every other idea Gambit has: the sacrifice slots, the per-node
// selection, the per-type unit worth, the same gene dialect.
//
// So the three-way result is readable:
//
//   Feint beats baseline           -> the win is the SEARCH SHAPE, and
//                                     cheap. Depth 5 is optional.
//   Feint loses to baseline        -> the win was bought with compute, and
//                                     Gambit is only worth it when there is
//                                     time to spend.
//   Feint ~ Gambit                 -> depth past 3 buys nothing; take the
//                                     five-fold saving.
//   Feint << Gambit, both > base   -> depth is the active ingredient and it
//                                     keeps paying. Then the follow-up is a
//                                     compute-matched depth-3 engine
//                                     (widen childCounts ~5x) to separate
//                                     "deeper" from "more" for good.
//
// This one SPREADS Gambit's options instead of copying them out, against
// the advice in the README. That advice is for engines expressing their own
// hypothesis, where a readable diff beats a shared reference. An ablation
// is the opposite case: if a later tweak to Gambit's weights failed to
// reach here, the two would stop being comparable and the experiment would
// quietly become meaningless. A test also pins that they differ only in
// beam.depth, so neither the sharing nor the intent can rot silently.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { gambitEngine } from './gambit';

export const feintEngine = createEngine({
    id: 'feint',
    name: 'Feint',
    notes: 'Gambit at depth 3 instead of 5 -- the ablation that asks whether the win is the search shape or the search volume.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...gambitEngine.options,
        beam: {
            ...gambitEngine.options.beam,
            // The one changed value.
            depth: 3,
        },
    },
});
