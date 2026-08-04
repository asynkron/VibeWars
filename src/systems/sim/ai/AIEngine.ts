// An AI ENGINE is one complete way of playing the game: how it values a
// board, which genes it can express, how it mutates plans, how much it
// searches. Two engines can be instantiated side by side in one process
// and play each other, which is the whole point -- a tweak is only worth
// keeping if it beats what it replaced over many games.
//
// The engine is a thin, named binding of a PlanTurnOptions bundle. All the
// machinery still lives in search.ts / score.ts / SimCommands.ts; what
// moved out of those files is the VALUES, which is exactly the part a
// variant needs to own.
//
// An engine models its opponent as ITSELF: search.ts forwards the whole
// personality into its own nested rollouts. An engine has no idea what it
// is playing against, so that is the only honest model it can build -- and
// it means a match between two engines is a genuine clash of world views,
// not one engine simulating the other.

import { SimState } from '../SimState';
import {
    PlanTurnOptions,
    PlanProgress,
    TurnPlanResult,
    planTurn,
    planTurnAsync,
} from '../search';

// Everything except the seed, which is per-turn rather than per-engine.
export type EngineOptions = Omit<PlanTurnOptions, 'seed'>;

export interface EngineDefinition {
    // Stable key used on the command line and in reports.
    id: string;
    // Human-readable name for report headers.
    name: string;
    // One line on what this engine believes. Printed by the tournament so
    // a result table explains itself.
    notes: string;
    options: EngineOptions;
}

export interface AIEngine {
    readonly id: string;
    readonly name: string;
    readonly notes: string;
    // The full option bundle, exposed so tests and reports can diff two
    // engines instead of taking a claim about them on faith.
    readonly options: EngineOptions;

    planTurn(snapshot: SimState, playerIndex: number, seed: number): TurnPlanResult;
    planTurnAsync(
        snapshot: SimState,
        playerIndex: number,
        seed: number,
        onProgress?: (progress: PlanProgress) => void
    ): Promise<TurnPlanResult>;

    // The same personality at a different search budget: the live game
    // wants a slow, deep search, a thousand headless matches want a fast
    // shallow one. Overriding the budget must NOT be able to change what
    // the engine believes, so this returns a new engine rather than
    // mutating this one.
    withBudget(budget: EngineOptions): AIEngine;
}

export function createEngine(definition: EngineDefinition): AIEngine {
    const { id, name, notes, options } = definition;
    return {
        id,
        name,
        notes,
        options,
        planTurn: (snapshot, playerIndex, seed) => planTurn(snapshot, playerIndex, { ...options, seed }),
        planTurnAsync: (snapshot, playerIndex, seed, onProgress) =>
            planTurnAsync(snapshot, playerIndex, { ...options, seed }, onProgress),
        withBudget: (budget) => createEngine({ id, name, notes, options: { ...options, ...budget } }),
    };
}
