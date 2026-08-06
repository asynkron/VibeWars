// QUICKDRAW -- Parthian with NO attack sweep: every shot must come from an
// explicit gene, fired exactly where it sits in the plan. No floor, no
// safety net. You live by your own draw.
//
// The hypothesis, and it is Roger's: the sweep fires from FINAL positions,
// so in the dominant emergent pattern -- no explicit attack gene, sweep
// picks up the shot at the end -- any movement left after the shot is
// dead, and the search drifts toward park-and-shoot. The rules allow
// moving after shooting; the floor structurally cannot use it. Remove the
// floor and timing moves INTO the genome, where hit-and-run makes
// shoot-then-move cheap to express and the search judges when it is
// right. If the shooting genes are frequent enough, the problem the sweep
// solved -- plans that forget to shoot -- should solve itself.
//
// THIS BREAKS THE ONE-CHANGE RULE ON PURPOSE, like Sapper, and says so.
// Removing the sweep without touching the weights is not a fair test of
// the idea: the old weights were tuned for a world where shots were free
// at the end of every plan, so a third of quickdraw's rolls now carry the
// shot themselves. attack 0.30 stays where every engine has it;
// hitAndRun doubles to 0.20 -- frequent enough to be the timing tool, per
// the hypothesis; the movement genes and the noise slots pay. If
// quickdraw wins, the follow-up ablations (sweepless parthian with old
// weights; sweeping quickdraw) can say which part did it.
//
// What to expect if the hypothesis is WRONG: plans that walk into range
// and deal nothing because no shooting gene came up, an army that
// occasionally forgets the whole point -- and a loss that says the floor
// was earning its keep.
//
// MEASURED: the hypothesis is wrong, cleanly, at both widths. Parthian
// (same engine plus the sweep) won 242-150 over 400 matches at width 80
// -- a 61.5% share, interval 56.6-66.1% -- and 71-45 over 120 at six
// times the width, 60.8%, interval 51.9-69.1%, at 1.00-1.01x compute.
// Even with half the gene mass carrying shots, enough plans still leave
// damage on the table for the floor to be worth ~11 points of share, and
// wider search does not close the gap. The lesson pairs with Parthian's:
// the genome is where TIMING belongs (hit-and-run beat plain Talus), and
// the floor is where the GUARANTEE belongs -- the two compose rather than
// compete. This engine stays registered as the measurement that proved it.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { parthianEngine } from './parthian';
import { HIT_AND_RUN, hitAndRunGene } from '../genes/hitAndRun';

export const quickdrawEngine = createEngine({
    id: 'quickdraw',
    name: 'Quickdraw',
    notes: 'Parthian with no attack sweep at all -- every shot is an explicit gene, and hit-and-run carries the timing.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...parthianEngine.options,
        dialect: {
            ...parthianEngine.options.dialect!,
            weights: [
                ['attack', 0.30],
                [HIT_AND_RUN, 0.20],
                ['moveTowards', 0.18],
                ['standoff', 0.10],
                ['moveAway', 0.08],
                ['moveToBuilding', 0.08],
                ['moveRandom', 0.03],
                ['idle', 0.03],
            ],
            extras: {
                [HIT_AND_RUN]: hitAndRunGene,
            },
            // The change this engine is named for.
            sweep: null,
        },
    },
});
