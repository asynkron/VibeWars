// BASTION -- Parthian plus the blockade gene: stand where your body buys
// the most road. A clone with ONE addition, in the ablation style, so a
// tournament result answers exactly one question.
//
// The hypothesis comes straight off the retreat board's autopsy. The
// defense there loses on a single decision -- a wall that proves it can
// stand unmoved for nine turns under fire, standing in the wrong doorway
// -- and the dissection showed why no search depth fixes it: the winning
// line was never GENERATED. Every existing gene advances, flees, kites or
// shoots; none proposes a hex because of what standing on it denies. The
// blockade gene adds that word (see genes/blockade.ts), and the beam
// already knows how to judge it: a block that works shows the protectee
// alive in the reply, a block that fails is culled.
//
// Weights: Parthian's purposeful slots untouched, blockade at 0.05 out of
// the noise budget, fallback idle -- the press family's rules.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { parthianEngine } from './parthian';
import { HIT_AND_RUN, hitAndRunGene } from '../genes/hitAndRun';
import { BLOCKADE, blockadeGene } from '../genes/blockade';

export const bastionEngine = createEngine({
    id: 'bastion',
    name: 'Bastion',
    notes: 'Parthian plus a blockade gene: stand on the hex that maximizes the enemy\'s path cost to our most fragile unit.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...parthianEngine.options,
        dialect: {
            ...parthianEngine.options.dialect!,
            weights: [
                // Untouched, exactly as Parthian has them.
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                [HIT_AND_RUN, 0.10],
                // The one new word, funded from noise.
                [BLOCKADE, 0.05],
                ['moveRandom', 0.03],
                ['idle', 0.02],
            ],
            extras: {
                [HIT_AND_RUN]: hitAndRunGene,
                [BLOCKADE]: blockadeGene,
            },
        },
    },
});
