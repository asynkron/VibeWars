// FITTER -- Feint plus one gene: Pike repairing a damaged machine.
//
// One change, measurable on its own. That discipline is not stylistic here:
// Wolfpack moved seven weights at once and finished at 51.6% over 400
// matches -- indistinguishable from Feint -- while Gambit changed what the
// search DOES and finished at 71.9%. A combined engine cannot say which of
// its changes did the work, and this repo has already paid for that lesson
// once.
//
// The weight comes out of moveRandom and idle, the two slots the repo
// already treats as noise -- the same trade Aegis made. It is small on
// purpose: only Pike can ever use it, and randomGene rerolls a failed guard
// to moveTowards, so a roll on any other unit costs almost nothing.
//
// DEFAULT_ENGINE is not changed by this file. Promotion happens if and only
// if a tournament says so.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { REPAIR, repairGene } from '../genes/repair';

export const fitterEngine = createEngine({
    id: 'fitter',
    name: 'Fitter',
    notes: 'Feint plus Repair: infantry patches up a damaged machine, once every three turns, for the price of its turn.',
    planner: beamPlanGen,
    asyncPlanner: beamPlanParallel,
    options: {
        ...feintEngine.options,
        dialect: {
            ...feintEngine.options.dialect!,
            weights: [
                // Untouched, exactly as Feint has them.
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                // The one change.
                [REPAIR, 0.06],
                // Paid for out of the two noise slots.
                ['idle', 0.07],
                ['moveRandom', 0.07],
            ],
            extras: { [REPAIR]: repairGene },
        },
    },
});
