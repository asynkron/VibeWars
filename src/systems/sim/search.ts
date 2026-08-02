// Population + hillclimbing search over whole-turn plans.
//
// A candidate plan is a VARIABLE-LENGTH ordered list of genes -- as many
// commands as the plan needs, for any mix of units. Moving and attacking
// are separate per-turn resources (movement points vs hasAttacked), so a
// single unit can chain move -> move -> attack or attack -> retreat within
// one turn; evolution decides how many commands each unit gets by
// inserting/deleting genes, not a fixed slot count. applyGene() validates
// each gene against the current branch state, so invalid or exhausted
// actions simply no-op. Order matters across units too -- an early move
// can open a path or line of fire for a later gene.
//
// Search: seed a random population, evaluate each candidate on its own
// fork of the turn snapshot, then for K rounds keep the top quartile and
// refill with mutated survivors (insert / delete / replace / swap /
// reseed+retarget). Fitness gets a tiny per-gene parsimony penalty so
// among equally-scoring plans the shorter one wins -- otherwise genomes
// bloat with no-op genes. The reported score is the real, unpenalized one.
//
// Fully deterministic given `seed`: every random choice flows from one
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
    // Hard cap on plan length (defaults to 6 genes per own unit) -- a
    // safety rail against runaway genome growth, not a tuning knob.
    maxPlanLength?: number;
}

export interface TurnPlanResult {
    events: readonly GameEvent[];
    score: number;
    genes: Gene[];
}

interface Candidate {
    genes: Gene[];
    branch: SimState;
    score: number;   // real score, returned to the caller
    fitness: number; // score minus parsimony penalty, used for selection
}

const PARSIMONY_PENALTY = 0.001;

export function planTurn(snapshot: SimState, playerIndex: number, options: PlanTurnOptions = {}): TurnPlanResult {
    const { population = 32, rounds = 5, seed = 1 } = options;
    const rng = mulberry32(seed);

    const myUnits: number[] = [];
    const enemyIndexes: number[] = [];
    for (const [i, unit] of snapshot.liveUnits()) {
        (unit.playerIndex === playerIndex ? myUnits : enemyIndexes).push(i);
    }
    if (myUnits.length === 0) {
        return { events: [], score: scoreState(snapshot, playerIndex), genes: [] };
    }

    const maxPlanLength = options.maxPlanLength ?? myUnits.length * 6;

    const evaluate = (genes: Gene[]): Candidate => {
        const branch = snapshot.fork();
        for (const gene of genes) applyGene(branch, gene);
        const score = scoreState(branch, playerIndex);
        return { genes, branch, score, fitness: score - genes.length * PARSIMONY_PENALTY };
    };

    const shuffle = <T,>(items: T[]): T[] => {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    const randomUnit = (): number => myUnits[Math.floor(rng() * myUnits.length)];

    // Seed plans with 1-3 genes per unit, freely ordered, PLUS a trailing
    // attack attempt for every unit. The trailing attacks structurally bake
    // the move -> attack pattern into generation 0 (a unit that spent its
    // early genes closing distance gets to fire at the end); when invalid
    // they no-op and the parsimony penalty prunes them. Evolution grows or
    // shrinks everything from there.
    const randomPlan = (): Gene[] => {
        const owners: number[] = [];
        for (const unitIndex of myUnits) {
            const count = 1 + Math.floor(rng() * 3);
            for (let k = 0; k < count; k++) owners.push(unitIndex);
        }
        const body = shuffle(owners).map((unitIndex) => randomGene(snapshot, unitIndex, rng));
        const trailingAttacks = shuffle(myUnits).map((unitIndex): Gene => ({
            kind: 'attack',
            unitIndex,
            targetIndex: enemyIndexes.length > 0
                ? enemyIndexes[Math.floor(rng() * enemyIndexes.length)]
                : undefined,
            seed: Math.floor(rng() * 0x7fffffff),
        }));
        return [...body, ...trailingAttacks];
    };

    const mutate = (genes: Gene[]): Gene[] => {
        const copy = genes.map((g) => ({ ...g }));
        const op = rng();

        if (op < 0.25 && copy.length < maxPlanLength) {
            // Insert a new random gene at a random position.
            const pos = Math.floor(rng() * (copy.length + 1));
            copy.splice(pos, 0, randomGene(snapshot, randomUnit(), rng));
        } else if (op < 0.45 && copy.length > 1) {
            // Delete a random gene.
            copy.splice(Math.floor(rng() * copy.length), 1);
        } else if (op < 0.65 && copy.length > 0) {
            // Replace one gene (same unit, fresh action).
            const i = Math.floor(rng() * copy.length);
            copy[i] = randomGene(snapshot, copy[i].unitIndex, rng);
        } else if (op < 0.85 && copy.length >= 2) {
            // Swap execution order of two genes.
            const i = Math.floor(rng() * copy.length);
            let j = Math.floor(rng() * copy.length);
            if (j === i) j = (j + 1) % copy.length;
            [copy[i], copy[j]] = [copy[j], copy[i]];
        } else if (copy.length > 0) {
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
        candidates.sort((a, b) => b.fitness - a.fitness);
        const survivors = candidates.slice(0, Math.max(1, Math.floor(population / 4)));
        const next: Candidate[] = [...survivors];
        while (next.length < population) {
            const parent = survivors[Math.floor(rng() * survivors.length)];
            next.push(evaluate(mutate(parent.genes)));
        }
        candidates = next;
    }

    candidates.sort((a, b) => b.fitness - a.fitness);
    const best = candidates[0];
    return { events: best.branch.events, score: best.score, genes: best.genes };
}
