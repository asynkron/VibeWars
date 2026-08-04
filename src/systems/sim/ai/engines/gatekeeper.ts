// Gatekeeper -- Feint plus one gene: stand on a depot entrance so the enemy cannot capture it.
//
// ONE CHANGE, like Feint and Aegis before it. Wolfpack moved seven weights
// at once and its result was unreadable even before it turned out to be
// noise. So this spreads Feint's options and touches nothing but the
// dialect -- same beam, same depth, same score, same budget -- and a test
// pins that. Whatever the tournament says, it says about the gene.
//
// The gene it adds says "I cannot take this, but I can stop you". A
// composite depot is captured from exactly one hex, and simDijkstra treats
// an occupied hex as impassable, so a body on the door makes the capture
// unreachable rather than merely discouraged. moveToBuilding is the only
// gene that knows an entrance exists and it is guarded on unitCanCapture --
// it exists to TAKE one. Denial had no way of being expressed.
//
// The 0.08 comes out of moveRandom and idle, the two slots that were
// already noise, so the weights still sum to 1.00 and nothing purposeful
// was displaced.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { HOLD_DOOR, holdDoorGene } from '../genes/holdDoor';

export const gatekeeperEngine = createEngine({
    id: 'gatekeeper',
    name: 'Gatekeeper',
    notes: 'Feint plus a holdDoor gene: stand on a depot entrance so the enemy cannot capture it.',
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
                [HOLD_DOOR, 0.08],       // new
                ['idle', 0.08],        // Feint 0.10
                ['moveRandom', 0.04],  // Feint 0.10
            ],
            extras: { [HOLD_DOOR]: holdDoorGene },
        },
    },
});
