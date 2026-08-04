// CONVOY -- Feint plus the transport: Load and Unload.
//
// Two genes rather than one, which breaks the one-change rule on purpose and
// is worth being explicit about. They are not independent: Unload can never
// fire without Load having fired first, so shipping them separately would
// measure a gene that is unreachable and then a gene that is finally
// reachable. The pair IS the change.
//
// Weight comes out of moveRandom and idle, the two slots the repo already
// treats as noise. Only the Drover can roll either, and randomGene rerolls a
// failed guard to moveTowards, so any other unit rolling one simply
// advances.
//
// DEFAULT_ENGINE is not changed here. Promotion happens if a tournament says
// so, and until then the shipped AI plays exactly as it did.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { LOAD, loadGene, UNLOAD, unloadGene } from '../genes/transport';

export const convoyEngine = createEngine({
    id: 'convoy',
    name: 'Convoy',
    notes: 'Feint plus the APC: pick infantry up, drive it forward, put it down still able to act.',
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
                // The change. Unload is weighted higher than Load: a loaded
                // transport that never puts its passenger down is strictly
                // worse than never having loaded, so the exit needs to be
                // easier to find than the entrance.
                [LOAD, 0.04],
                [UNLOAD, 0.06],
                // Paid for out of the two noise slots.
                ['idle', 0.05],
                ['moveRandom', 0.05],
            ],
            extras: { [LOAD]: loadGene, [UNLOAD]: unloadGene },
        },
    },
});
