// WOLFPACK -- the challenger. A copy of baseline.ts with edits; read it
// side by side with that file and the differences ARE the hypothesis.
//
// The hypothesis: baseline fights as a line of duels. Its aggression term
// pulls each unit at its own nearest enemy, so on a wide map the army fans
// out and trades one-for-one. Wolfpack tries to arrive as a mass and
// finish what it starts:
//
//   regroup gene (new)      units can spend a turn closing on their own side
//   armySize      3 -> 5    a kill is worth more when it thins their line
//   aggression    1 -> 1.5  a steeper approach, so contact happens together
//   capturePull   3 -> 4    infantry commits to the factory instead of drifting
//   captureYield 150 -> 170 opening a factory is worth more than an average unit
//   focusFire   0.5 -> 0.65 aim at the weakest legal target more often
//   friendlyFire 1.5 -> 2.0 massed units splash each other; be warier of it
//   immediate  0.01 -> 0.02 bank the gain now, trust the opponent model less
//   moveRandom  0.10 -> 0.04, idle 0.10 -> 0.08, moveAway 0.10 -> 0.08,
//   standoff    0.10 -> 0.12  -- the budget for regroup comes out of noise
//
// The SEARCH BUDGET is deliberately identical to baseline's. An engine that
// simply thinks longer wins for an uninteresting reason; holding population,
// rounds, finalists and the reply searches fixed makes the tournament a test
// of the ideas above and nothing else.

import { createEngine } from '../AIEngine';
import { REGROUP, regroupGene } from '../genes/regroup';

export const wolfpackEngine = createEngine({
    id: 'wolfpack',
    name: 'Wolfpack',
    notes: 'Concentration of force: a regroup gene, steeper aggression, and a heavier price on the enemy\'s head count.',
    options: {
        // --- Search shape. IDENTICAL to baseline on purpose (see above).
        population: 24,
        rounds: 4,
        lookaheadPlies: 2,
        replyCandidates: 6,
        finalists: 4,
        deepPlies: 2,
        replyPopulation: 8,
        replyRounds: 2,

        // --- How the board is valued.
        score: {
            unitBase: 100,
            hpWeight: 10,
            armySize: 5,        // baseline 3
            aggression: 1.5,    // baseline 1
            buildingOwned: 25,
            captureYield: 170,  // baseline 150
            buildingBlockPenalty: 15,
            capturePull: 4,     // baseline 3
        },

        // --- Which genes exist and how often each is rolled. Weights still
        // --- sum to 1.00; regroup is paid for out of moveRandom and idle.
        dialect: {
            weights: [
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.12],       // baseline 0.10
                [REGROUP, 0.08],          // new
                ['idle', 0.08],           // baseline 0.10
                ['moveAway', 0.08],       // baseline 0.10
                ['moveToBuilding', 0.10],
                ['moveRandom', 0.04],     // baseline 0.10
            ],
            extras: { [REGROUP]: regroupGene },
            focusFireChance: 0.65,        // baseline 0.5
            sweep: {
                killBonus: 100,
                friendlyFirePenalty: 2.0, // baseline 1.5
            },
        },

        // --- Evolution.
        parsimonyPenalty: 0.001,
        immediateWeight: 0.02,  // baseline 0.01
        survivorFraction: 0.25,
        initGenesPerUnit: 3,
        replyGenesPerUnit: 2,
        maxGenesPerUnit: 6,
        mutation: {
            insert: 0.22,   // baseline 0.25
            remove: 0.20,
            replace: 0.24,  // baseline 0.20
            swap: 0.20,
            // remainder 0.14 -> reseed+retarget (baseline 0.15)
        },
    },
});
