// GAMBIT -- the challenger that changes the SEARCH rather than the
// weights. Named for what makes it different: it is willing to play a move
// that scores badly now, because it plays the consequences out far enough
// to see what the move buys.
//
// The hypothesis, from HeroesOfBlazor's AIBrain: you do not need a threat
// term in the evaluation to keep units out of bad matchups, or a "free
// kill" term to send them after good ones. The search finds both by itself
// -- if it actually plays the outcome out, and if it does not delete the
// candidate before doing so.
//
// Baseline fails that measurably. A Bulwark five hexes from a Halberd it
// ONE-SHOTS (10 damage into 8 hp, while the Halberd does 2 back into 10)
// will not close. Measured at every seed, it homes on distance 5 -- one
// hex outside the Halberd's reach of move 2 + range 2 -- backing off from
// 4 and advancing from 6. It only ever enters when it can strike the same
// turn. The cause is not the weights: closing costs 20 points of chip
// damage inside the 2-ply rollout that decides which candidates survive,
// and the 180-point kill lands two turns later, where only the deep stage
// could see it -- and the deep stage never gets the plan, because the
// cheap stage already culled it.
//
// So Gambit swaps in beam.ts: five full turns deep, both sides played the
// same way, and the WORST-scoring children kept alive at its own levels
// alongside the best.
//
// It also gives unit types different worth (baseline values everything at
// unitBase + hp*hpWeight, so a Sabre and a Pike at equal health are equal).
// HeroesOfBlazor multiplies hp by a per-type Score for the same reason.
// This is a second, smaller change riding along -- if Gambit wins, the
// tournament cannot say which of the two did it, and a follow-up engine
// that changes only one of them is the way to find out.
//
// COMPUTE IS DELIBERATELY NOT EQUAL HERE, unlike Wolfpack. Measured on the
// shipped map at the tournament budget, Gambit spends about 1370 ms per
// turn against baseline's 123 -- roughly ELEVEN TIMES the thinking time.
// That is the experiment rather than a flaw in it: the question is whether
// searching this hard pays for itself at all. If Gambit only just wins, it
// has answered "no" as clearly as a loss would. The tournament prints the
// ratio next to the result so the two can be read together.
//
// The hillclimb's population/rounds fields are inherited from baseline and
// simply unread by a beam search; beam.childCounts is this engine's dial.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';

export const gambitEngine = createEngine({
    id: 'gambit',
    name: 'Gambit',
    notes: 'Beam tree five turns deep that keeps its worst-looking moves alive, plus per-type unit worth.',
    planner: beamPlanGen,
    // Same search, fanned out across workers, for the live game only.
    // Proven to return the identical plan -- see beamParallel.test.ts.
    asyncPlanner: beamPlanParallel,
    options: {
        // --- The beam, in HeroesOfBlazor's own proportions: 7 best plus 4
        // --- sacrifices kept per own node, one reply per opponent node.
        // --- Selection is PER NODE, not pooled across the level -- see
        // --- beam.ts, where doing it globally collapsed the whole search.
        beam: {
            depth: 5,
            childCounts: [80, 60, 30, 20, 16],
            keepBest: 7,
            keepWorst: 4,
            keepOpponent: 1,
            genesPerUnit: 3,
        },

        // --- How the board is valued. Same terms and weights as baseline,
        // --- so the score is not what is being tested here...
        score: {
            unitBase: 100,
            hpWeight: 10,
            armySize: 3,
            aggression: 1,
            buildingOwned: 25,
            captureYield: 150,
            buildingBlockPenalty: 15,
            capturePull: 3,

            // ...except for this. Roughly: reach and speed are worth more
            // than raw hit points, which the flat model already counts.
            // Kestrel and Mortar shell from 2-3 hexes and are never shot
            // back at by what they hit; Nightjar crosses four hexes and
            // one-shots any tank; Pike is the only class that can take a
            // building at all.
            typeValue: {
                Bulwark: 1.0,   // the reference: a plain line tank
                Sabre: 1.0,
                Drover: 0.95,
                Lynx: 0.9,      // fast but only 2-4 damage
                Halberd: 1.05,  // range 2 and the only answer to air
                Kestrel: 1.25,  // outranges everything it shoots at
                Mortar: 1.35,   // same, harder hitting
                Nightjar: 1.3,  // 4 move, one-shots tanks
                Shrike: 1.35,   // 5 move, 6-9 damage
                Pike: 1.2,      // captures; nothing else does
                Road: 1.1,
                Gunboat: 0.9,
                // The scenario units, at DELIBERATELY neutral 1.0: every
                // choke hold-rate was calibrated before they had entries
                // (a missing type reads as 1.0), and a value here changes
                // how the search prices them. Tune only with the scenario
                // battery re-run beside the change.
                Kloss: 1.0,
                Pyramid: 1.0,
                Boll: 1.0,
            },
        },

        // --- Gene generation is baseline's, untouched: the point is the
        // --- search, not a different move vocabulary.
        dialect: {
            weights: [
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveRandom', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                ['idle', 0.10],
            ],
            extras: {},
            focusFireChance: 0.5,
            sweep: {
                killBonus: 100,
                friendlyFirePenalty: 1.5,
            },
        },

        // --- Inherited from baseline, unread by the beam. Kept so the
        // --- three engines diff cleanly against each other.
        population: 24,
        rounds: 4,
        lookaheadPlies: 2,
        replyCandidates: 6,
        finalists: 4,
        deepPlies: 2,
        replyPopulation: 8,
        replyRounds: 2,
        parsimonyPenalty: 0.001,
        immediateWeight: 0.01,
        survivorFraction: 0.25,
        initGenesPerUnit: 3,
        replyGenesPerUnit: 2,
        maxGenesPerUnit: 6,
        mutation: { insert: 0.25, remove: 0.20, replace: 0.20, swap: 0.20 },
    },
});
