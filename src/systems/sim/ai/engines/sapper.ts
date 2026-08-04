// SAPPER -- Feint with all three of the unreachable-mechanic genes at once:
// mend, sink and holdDoor.
//
// A sapper repairs, digs and denies ground, which is exactly what these
// three do. None of them is about winning a firefight; each is about using
// something on the board that the fighting genes cannot reach.
//
// THIS ONE BREAKS THE ONE-CHANGE RULE ON PURPOSE, and it is worth being
// clear about the cost. If Sapper wins, this engine cannot say WHICH gene
// won -- that is the mistake Wolfpack made with seven weights at once. The
// difference is that the three single-gene engines exist alongside it
// (Mender, Dredge, Gatekeeper), so a win here can be decomposed afterwards
// instead of being a dead end. Combined first is the right order when the
// individual effects are expected to be small: three small edges may show
// together where none shows alone, and there is no point spending an hour
// per gene on questions that a combined run can rule out in one.
//
// WEIGHTS. Every purposeful slot is left exactly where Feint has it, and
// the whole 0.15 comes out of moveRandom and idle -- the two that were
// already noise. The three new weights are deliberately unequal, because
// how often a gene should be ROLLED is not how useful it is when it fires:
//
//   mend     0.07  Any damaged unit qualifies, and by mid-game most are.
//                  The commonest of the three by far.
//   sink     0.05  Needs an artillery piece AND an enemy standing on ground
//                  already near the waterline. Its own guard makes it rare;
//                  the weight only has to be enough to be sampled.
//   holdDoor 0.03  The narrowest by some way: a non-capturing unit that can
//                  REACH an unheld entrance this turn, while the enemy
//                  still has someone who could capture. Almost always
//                  inapplicable, and decisive when it is not.
//
// A rare weight is not a weak one here. The beam generates up to 160
// children per node at depth 0, so even 0.03 is sampled about five times
// per node per level -- and a roll whose guard fails is simply rerolled to
// moveTowards, so a narrow gene costs close to nothing when it does not
// apply.
//
// SCREEN IS DELIBERATELY LEFT OUT. It is the one new gene that has already
// been measured -- Aegis against Feint, 120 matches, no measurable
// difference -- so including it would add a known-neutral term to a test of
// three unknown ones.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { feintEngine } from './feint';
import { MEND, mendGene } from '../genes/mend';
import { SINK, sinkGene } from '../genes/sink';
import { HOLD_DOOR, holdDoorGene } from '../genes/holdDoor';

export const sapperEngine = createEngine({
    id: 'sapper',
    name: 'Sapper',
    notes: 'Feint plus three genes for mechanics no other gene can ask for: heal at our own depot, drown a unit by digging out its ground, and hold a door shut.',
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
                // New, weighted by how often they can apply at all.
                [MEND, 0.07],
                [SINK, 0.05],
                [HOLD_DOOR, 0.03],
                // Paid for entirely out of the two noise slots.
                ['idle', 0.03],        // Feint 0.10
                ['moveRandom', 0.02],  // Feint 0.10
            ],
            extras: {
                [MEND]: mendGene,
                [SINK]: sinkGene,
                [HOLD_DOOR]: holdDoorGene,
            },
        },
    },
});
