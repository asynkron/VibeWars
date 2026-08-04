// AEGIS -- Feint plus one gene: screen, which puts a tough unit between a
// fragile one and what is coming for it.
//
// ONE CHANGE, on purpose. Wolfpack moved seven weights at once and its
// result was unreadable even before it turned out to be noise; Feint
// changed a single number and answered its question cleanly. So Aegis
// spreads Feint's options and touches nothing but the dialect: same beam,
// same depth, same score, same budget. Whatever the tournament says, it
// says about the gene.
//
// The hypothesis. The roster is not made of interchangeable bodies:
// Kestrel and Mortar have 3 hit points and shoot from two or three hexes,
// so they win any fight they are allowed to have and lose instantly to
// anything that reaches them. Every existing movement gene is about the
// mover's own business -- close, flee, kite, capture, wander -- and even
// Wolfpack's regroup only minimises its own distance to the pack. None can
// say "stand here, because someone else is standing there". A beam that
// searches five turns deep may well stumble into screening by accident;
// the question is whether being able to state it outright is worth a slot
// in the roulette.
//
// The 0.08 comes out of moveRandom and idle -- the two slots that were
// already noise -- so the weights still sum to 1.00 and nothing purposeful
// was displaced to make room.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { SCREEN, screenGene } from '../genes/screen';

export const aegisEngine = createEngine({
    id: 'aegis',
    name: 'Aegis',
    notes: 'Feint plus a screen gene: stand between the frailest ally and whatever is closing on it.',
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
                [SCREEN, 0.08],        // new
                ['idle', 0.08],        // Feint 0.10
                ['moveRandom', 0.04],  // Feint 0.10
            ],
            extras: { [SCREEN]: screenGene },
        },
    },
});
