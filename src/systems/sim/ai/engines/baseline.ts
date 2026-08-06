// BASELINE -- the AI as shipped. Every value is spelled out rather than
// left to a default, for two reasons:
//
//   1. It is the control in an experiment. A control that silently tracks
//      whatever the defaults happen to be is not a control.
//   2. A challenger is a copy of this file with edits, so the diff between
//      two engines is the diff between two files -- readable in one screen
//      instead of reconstructed from override objects.
//
// AIEngine.test.ts asserts these values are identical to the module
// defaults in search.ts / score.ts / SimCommands.ts, so "baseline is the
// shipped AI" stays a checked fact rather than a comment.

import { createEngine } from '../AIEngine';

export const baselineEngine = createEngine({
    id: 'baseline',
    name: 'Baseline',
    notes: 'The shipped AI: material and hp, quadratic army size, aggression gradient, factory pull.',
    options: {
        // --- Search shape. Shared verbatim by every engine that wants a
        // --- fair comparison: budget differences decide matches on
        // --- thinking time rather than on ideas.
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
            armySize: 3,
            aggression: 1,
            buildingOwned: 25,
            captureYield: 150,
            buildingBlockPenalty: 15,
            capturePull: 3,
            // The hard rule's score mirror -- see ScoreWeights.vitalWorth.
            vitalWorth: 1500,
        },

        // --- Which genes exist and how often each is rolled.
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

        // --- Evolution.
        parsimonyPenalty: 0.001,
        immediateWeight: 0.01,
        survivorFraction: 0.25,
        initGenesPerUnit: 3,
        replyGenesPerUnit: 2,
        maxGenesPerUnit: 6,
        mutation: {
            insert: 0.25,
            remove: 0.20,
            replace: 0.20,
            swap: 0.20,
            // remainder 0.15 -> reseed+retarget
        },
    },
});
