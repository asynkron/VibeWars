// Dredge -- Feint plus one gene: shell the ground under a unit standing near the waterline until it drowns.
//
// ONE CHANGE, like Feint and Aegis before it. Wolfpack moved seven weights
// at once and its result was unreadable even before it turned out to be
// noise. So this spreads Feint's options and touches nothing but the
// dialect -- same beam, same depth, same score, same budget -- and a test
// pins that. Whatever the tournament says, it says about the gene.
//
// The gene it adds asks for something no attack gene can: a target chosen
// by the HEIGHT OF THE GROUND under it rather than by the damage a shot
// would do. Craters lower terrain, a tile crossing into WATER drowns the
// land unit on it, and that kill is worth a whole unit regardless of its
// health -- so the right target is often the one sweepAttacks ranks last.
// The guard is strict because the arithmetic is: about 0.086 of height per
// barrage, so only ground already near the waterline is worth committing
// to. See sink.ts.
//
// The 0.08 comes out of moveRandom and idle, the two slots that were
// already noise, so the weights still sum to 1.00 and nothing purposeful
// was displaced.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { SINK, sinkGene } from '../genes/sink';

export const dredgeEngine = createEngine({
    id: 'dredge',
    name: 'Dredge',
    notes: 'Feint plus a sink gene: shell the ground under a unit standing near the waterline until it drowns.',
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
                [SINK, 0.08],       // new
                ['idle', 0.08],        // Feint 0.10
                ['moveRandom', 0.04],  // Feint 0.10
            ],
            extras: { [SINK]: sinkGene },
        },
    },
});
