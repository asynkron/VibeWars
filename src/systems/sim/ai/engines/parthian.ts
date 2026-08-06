// PARTHIAN -- Talus plus the hit-and-run gene: close into the bracket,
// shoot, and fall back beyond the target's reach, three actions from one
// roll. Named for the Parthian shot, which is this tactic with horses.
//
// The hypothesis. The counter to slow armour is not outshooting it but
// never being where it can answer: a fast unit that strikes and ends its
// turn outside the target's move + range has dealt its damage for free.
// The sequence already exists in the vocabulary as three independent genes
// in the right order on the same unit -- a lottery ticket the search
// rarely draws, and one the attack sweep cannot substitute for, because
// the sweep fires from final positions and the final position of a
// hit-and-run is deliberately out of range. One gene makes the tactic as
// samplable as 'attack' itself. See genes/hitAndRun.ts.
//
// WEIGHTS. Every purposeful slot stays exactly where Talus (i.e. Feint)
// has it, and the new gene's 0.10 is paid entirely out of the two noise
// slots, following Sapper's precedent: how often a tactic is ROLLED is a
// budget question, and noise is the cheapest thing in the budget. The
// gene's own guard rerolls it to moveTowards when no shootable enemy
// exists, so a dead roll costs close to nothing.
//
// MEASURED, and it won -- and kept winning where the selection tweaks did
// not. Against Talus at the tournament width of 80: 232-164 over 400
// matches, a 58.5% share, 95% interval 53.6-63.2%, at 1.07x compute. At
// SIX times the width the point estimate did not move -- 58.8% over 120
// matches -- though that sample is one match short of certifying (the
// interval's far edge grazes 50.2%). Talus and Mirage both collapsed to
// ~46% at that width; this effect held its size, which is what a real
// tactic looks like as opposed to a selection artifact. It also beat the
// sweepless Quickdraw at both widths -- see quickdraw.ts for that story.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { talusEngine } from './talus';
import { HIT_AND_RUN, hitAndRunGene } from '../genes/hitAndRun';

export const parthianEngine = createEngine({
    id: 'parthian',
    name: 'Parthian',
    notes: 'Talus plus a hit-and-run gene: step into the bracket, shoot, fall back beyond the target\'s reach.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...talusEngine.options,
        dialect: {
            ...talusEngine.options.dialect!,
            weights: [
                // Untouched, exactly as Talus has them.
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                // The one new tactic.
                [HIT_AND_RUN, 0.10],
                // Paid for entirely out of the two noise slots (Talus 0.10 each).
                ['moveRandom', 0.05],
                ['idle', 0.05],
            ],
            extras: {
                [HIT_AND_RUN]: hitAndRunGene,
            },
        },
    },
});
