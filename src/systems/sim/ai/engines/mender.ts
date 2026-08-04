// Mender -- Feint plus one gene: pull a damaged unit back to a building we own and heal.
//
// ONE CHANGE, like Feint and Aegis before it. Wolfpack moved seven weights
// at once and its result was unreadable even before it turned out to be
// noise. So this spreads Feint's options and touches nothing but the
// dialect -- same beam, same depth, same score, same budget -- and a test
// pins that. Whatever the tournament says, it says about the gene.
//
// The gene it adds is the one whose absence can be pointed at in a single
// line of code. SimState.FACTORY_REPAIR_HP is 2 -- a unit starting its turn
// on a building its side owns heals -- and the beam can already see that in
// its rollouts. But nearestCapturableBuildingIndex, which every
// moveToBuilding resolves through, skips buildings the side already owns,
// and every other movement gene is oriented on an enemy. "Pull back to our
// depot" is not unlikely for the search to find; it is unsayable.
//
// The 0.08 comes out of moveRandom and idle, the two slots that were
// already noise, so the weights still sum to 1.00 and nothing purposeful
// was displaced.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { MEND, mendGene } from '../genes/mend';

export const menderEngine = createEngine({
    id: 'mender',
    name: 'Mender',
    notes: 'Feint plus a mend gene: pull a damaged unit back to a building we own and heal.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...feintEngine.options,
        dialect: {
            ...feintEngine.options.dialect!,
            weights: [
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                [MEND, 0.08],       // new
                ['idle', 0.08],        // Feint 0.10
                ['moveRandom', 0.04],  // Feint 0.10
            ],
            extras: { [MEND]: mendGene },
        },
    },
});
