// MIRAGE -- Feint with duplicate children collapsed before selection.
// A clone with ONE value changed, in the ablation style feint.ts set: it
// spreads Feint's options so the two stay provably identical apart from
// the flag under test.
//
// The hypothesis. Random whole-turn plans repeat outcomes constantly --
// idle-heavy turns, the same destination reached by different gene
// orders -- and the beam's dozen keep slots are selected by value, so one
// outcome can sit in several of them at once. Deduplicated (by event log,
// before pruning -- see SimJob.dedupe), every slot holds a DISTINCT
// outcome: effective width goes up at zero extra rollouts.
//
// MEASURED, twice, and the prediction above was exactly backwards. At the
// tournament width of 80 it beat Feint: 222-175 over 400 matches, a 55.9%
// share with a 95% interval of 51.0-60.7%, at 1.01x compute parity. At six
// times the width (BEAM_SCALE=6) the edge is gone -- 120 matches could not
// separate the two (feint 52.9%, interval 44.0-61.6%). Same shape Talus
// showed: these selection refinements pay where the ranking is short and
// slots are scarce, not where width already buys redundancy. Talus won by
// more at the width that separates them, and the two flags cannot combine
// (dedup needs the event logs the spread protocol does not ship), so the
// default seat went to Talus -- see engineRegistry.ts.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';

export const mirageEngine = createEngine({
    id: 'mirage',
    name: 'Mirage',
    notes: 'Feint with identical child outcomes collapsed before selection -- keep slots go to distinct futures.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...feintEngine.options,
        beam: {
            ...feintEngine.options.beam,
            // The one changed value.
            dedupeChildren: true,
        },
    },
});
