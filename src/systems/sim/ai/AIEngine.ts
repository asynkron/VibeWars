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
    Planner,
    AsyncPlanner,
    TurnPlanResult,
    planTurnGen,
    drivePlanner,
    drivePlannerAsync,
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
    // The search algorithm itself. Defaults to search.ts's hillclimb; an
    // engine may bring a different one (a beam tree, say) and still be a
    // drop-in for the live game and the tournament, because everything
    // downstream only ever sees planTurn/planTurnAsync.
    planner?: Planner;
    // Used by planTurnAsync only. The live game gets this; headless
    // batches, tournaments and tests keep the synchronous generator, so a
    // worker pool is never spun up to play a thousand matches in node.
    // The two must agree -- see AsyncPlanner.
    asyncPlanner?: AsyncPlanner;
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
    const { id, name, notes, options, planner, asyncPlanner } = definition;
    // Resolved when a turn is planned, NOT when this runs. Engine modules
    // call createEngine at module scope, and reading planTurnGen here makes
    // that call order-sensitive: any import path that reaches an engine
    // while search.ts is still initialising throws on the binding. Looking
    // it up lazily costs nothing and removes the hazard.
    const plan = (snapshot: SimState, playerIndex: number, seed: number) =>
        (planner ?? planTurnGen)(snapshot, playerIndex, { ...options, seed });

    return {
        id,
        name,
        notes,
        options,
        planTurn: (snapshot, playerIndex, seed) => drivePlanner(plan(snapshot, playerIndex, seed)),
        planTurnAsync: (snapshot, playerIndex, seed, onProgress) =>
            asyncPlanner
                ? asyncPlanner(snapshot, playerIndex, { ...options, seed }, onProgress)
                : drivePlannerAsync(plan(snapshot, playerIndex, seed), onProgress),
        // The budget rides along; the ALGORITHM does not change, because a
        // cheaper budget must never turn one engine into another.
        withBudget: (budget) => createEngine({ id, name, notes, planner, asyncPlanner, options: { ...options, ...budget } }),
    };
}
