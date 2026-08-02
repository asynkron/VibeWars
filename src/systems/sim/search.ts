// Population + hillclimbing search over whole-turn plans.
//
// A candidate plan is an ordered list of genes, one per AI unit (order
// matters -- an early move can open a path or line of fire for a later
// gene). Search: seed a random population, evaluate each candidate on its
// own fork of the turn snapshot, then for K rounds keep the top quartile
// and refill the population with mutated copies of survivors.
//
// Fully deterministic given `seed`: every random choice (initial genes,
// mutation ops, rocket scatter via per-gene seeds) flows from one
// mulberry32 stream. The returned events are the winning branch's log,
// ready to be replayed against the real game.

import { SimState, GameEvent } from './SimState';
import { Gene, applyGene, randomGene } from './SimCommands';
import { mulberry32 } from './resolveAttack';
import { scoreState } from './score';

export interface PlanTurnOptions {
    population?: number;
    rounds?: number;
    seed?: number;
}

export interface TurnPlanResult {
    events: readonly GameEvent[];
    score: number;
    genes: Gene[];
}

interface Candidate {
    genes: Gene[];
    branch: SimState;
    score: number;
}

export function planTurn(snapshot: SimState, playerIndex: number, options: PlanTurnOptions = {}): TurnPlanResult {
    const { population = 24, rounds = 4, seed = 1 } = options;
    const rng = mulberry32(seed);

    const myUnits: number[] = [];
    const enemyIndexes: number[] = [];
    for (const [i, unit] of snapshot.liveUnits()) {
        (unit.playerIndex === playerIndex ? myUnits : enemyIndexes).push(i);
    }
    if (myUnits.length === 0) {
        return { events: [], score: scoreState(snapshot, playerIndex), genes: [] };
    }

    const evaluate = (genes: Gene[]): Candidate => {
        const branch = snapshot.fork();
        for (const gene of genes) applyGene(branch, gene);
        return { genes, branch, score: scoreState(branch, playerIndex) };
    };

    const shuffle = <T,>(items: T[]): T[] => {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    const randomPlan = (): Gene[] => shuffle(myUnits).map((unitIndex) => randomGene(snapshot, unitIndex, rng));

    const mutate = (genes: Gene[]): Gene[] => {
        const copy = genes.map((g) => ({ ...g }));
        if (copy.length === 0) return copy;
        const op = rng();
        if (op < 0.4) {
            // Replace one unit's gene entirely.
            const i = Math.floor(rng() * copy.length);
            copy[i] = randomGene(snapshot, copy[i].unitIndex, rng);
        } else if (op < 0.7 && copy.length >= 2) {
            // Swap execution order of two genes.
            const i = Math.floor(rng() * copy.length);
            let j = Math.floor(rng() * copy.length);
            if (j === i) j = (j + 1) % copy.length;
            [copy[i], copy[j]] = [copy[j], copy[i]];
        } else {
            // Reseed + retarget one gene (same kind, new dice/target).
            const i = Math.floor(rng() * copy.length);
            copy[i] = {
                ...copy[i],
                seed: Math.floor(rng() * 0x7fffffff),
                targetIndex: enemyIndexes.length > 0
                    ? enemyIndexes[Math.floor(rng() * enemyIndexes.length)]
                    : copy[i].targetIndex,
            };
        }
        return copy;
    };

    let candidates: Candidate[] = Array.from({ length: population }, () => evaluate(randomPlan()));

    for (let round = 0; round < rounds; round++) {
        candidates.sort((a, b) => b.score - a.score);
        const survivors = candidates.slice(0, Math.max(1, Math.floor(population / 4)));
        const next: Candidate[] = [...survivors];
        while (next.length < population) {
            const parent = survivors[Math.floor(rng() * survivors.length)];
            next.push(evaluate(mutate(parent.genes)));
        }
        candidates = next;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return { events: best.branch.events, score: best.score, genes: best.genes };
}
