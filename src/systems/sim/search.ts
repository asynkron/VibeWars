// Population + hillclimbing search over whole-turn plans, with adversarial
// multi-turn lookahead -- the old-chess-engine idea: a candidate plan is
// NOT judged by the board right after our own moves, but by the board
// several simulated turns into the future.
//
// A candidate plan is a VARIABLE-LENGTH ordered list of genes -- as many
// commands as the plan needs, for any mix of units. Moving and attacking
// are separate per-turn resources, so a single unit can chain
// move -> move -> attack within one turn; evolution decides how many
// commands each unit gets by inserting/deleting genes. applyGene()
// validates each gene against the current branch state, so invalid or
// exhausted actions simply no-op.
//
// Evaluation with lookahead (the user's "simulate my commands, then the
// enemy's, repeat"): after applying the candidate's own genes, the rollout
// alternates simulated turns -- turnStarted event (resets that side's
// movement/attacks, mirroring GameState.nextTurn), then a best-of-K
// opponent-model reply generated against the CURRENT rollout state -- for
// `lookaheadPlies` turns. The horizon state is what gets scored. This is
// what teaches the search that flying a lone helicopter into the enemy
// line "wins" the aggression term now but loses the helicopter to the
// reply. Rollouts are seeded from a fingerprint of the candidate's genes,
// so the same plan always meets the same replies: fitness is noise-free
// and the whole search stays deterministic per seed.
//
// Only the FIRST turn's events (the candidate's own genes applied to a
// clean fork) are returned for execution -- lookahead is evaluation only.
//
// Selection: keep the top quartile each round, refill with mutated
// survivors (insert / delete / replace / swap / reseed+retarget). Fitness
// carries a tiny per-gene parsimony penalty so equally-scoring shorter
// plans win; the reported score is the real, unpenalized horizon score.

import { SimState, GameEvent } from './SimState';
import { Gene, applyGene, randomGene } from './SimCommands';
import { mulberry32, combineSeed } from './resolveAttack';
import { scoreState } from './score';

export interface PlanTurnOptions {
    population?: number;
    rounds?: number;
    seed?: number;
    // Hard cap on plan length (defaults to 6 genes per own unit) -- a
    // safety rail against runaway genome growth, not a tuning knob.
    maxPlanLength?: number;
    // How many simulated reply-turns to look ahead when evaluating a
    // candidate (0 = score right after our own moves, like before).
    lookaheadPlies?: number;
    // Width of the opponent model: each rollout turn picks the best of
    // this many random plans for the side to move.
    replyCandidates?: number;
}

export interface TurnPlanResult {
    events: readonly GameEvent[];
    score: number;
    genes: Gene[];
}

interface Candidate {
    genes: Gene[];
    branch: SimState;
    score: number;   // real horizon score, returned to the caller
    fitness: number; // score minus parsimony penalty, used for selection
}

const PARSIMONY_PENALTY = 0.001;

// Small immediate-score admixture in fitness (future discounting): when
// two plans reach the same horizon score -- e.g. "kill the enemy now" vs
// "retreat and trust the opponent model to walk into my guns later" --
// prefer the one that banks the gain immediately. Large enough to break
// such ties, far too small to override a real lookahead difference.
const IMMEDIATE_WEIGHT = 0.01;

// Stable identity for a plan, so its rollout rng (and therefore the
// opponent's replies) is identical every time the same plan is evaluated.
function fingerprint(genes: Gene[]): number {
    let h = 0x9e3779b9;
    for (const g of genes) {
        h = combineSeed(h, g.kind.charCodeAt(0), g.unitIndex, g.targetIndex ?? -1, g.seed);
    }
    return h;
}

// Units a player currently has alive in the given state.
function unitsOf(state: SimState, playerIndex: number): number[] {
    const result: number[] = [];
    for (const [i, unit] of state.liveUnits()) {
        if (unit.playerIndex === playerIndex) result.push(i);
    }
    return result;
}

function shuffleWith<T>(rng: () => number, items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Random plan for a side against the given state: 1..maxBodyGenes random
// genes per unit, freely ordered, plus a trailing attack attempt per unit
// (bakes move -> attack into generation 0; invalid attacks no-op).
function randomPlanFor(state: SimState, playerIndex: number, rng: () => number, maxBodyGenes: number): Gene[] {
    const myUnits = unitsOf(state, playerIndex);
    const enemies: number[] = [];
    for (const [i, unit] of state.liveUnits()) {
        if (unit.playerIndex !== playerIndex) enemies.push(i);
    }

    const owners: number[] = [];
    for (const unitIndex of myUnits) {
        const count = 1 + Math.floor(rng() * maxBodyGenes);
        for (let k = 0; k < count; k++) owners.push(unitIndex);
    }
    const body = shuffleWith(rng, owners).map((unitIndex) => randomGene(state, unitIndex, rng));
    const trailingAttacks = shuffleWith(rng, myUnits).map((unitIndex): Gene => ({
        kind: 'attack',
        unitIndex,
        targetIndex: enemies.length > 0 ? enemies[Math.floor(rng() * enemies.length)] : undefined,
        seed: Math.floor(rng() * 0x7fffffff),
    }));
    return [...body, ...trailingAttacks];
}

// Opponent model: best of K random plans for `playerIndex`, judged by that
// side's own score. Cheap and greedy on purpose -- it just has to punish
// obvious blunders, not play perfectly.
function bestReply(state: SimState, playerIndex: number, rng: () => number, k: number): Gene[] {
    let bestGenes: Gene[] = [];
    let bestScore = -Infinity;
    for (let i = 0; i < k; i++) {
        const genes = randomPlanFor(state, playerIndex, rng, 2);
        const probe = state.fork();
        for (const gene of genes) applyGene(probe, gene);
        const score = scoreState(probe, playerIndex);
        if (score > bestScore) {
            bestScore = score;
            bestGenes = genes;
        }
    }
    return bestGenes;
}

export function planTurn(snapshot: SimState, playerIndex: number, options: PlanTurnOptions = {}): TurnPlanResult {
    const {
        population = 24,
        rounds = 4,
        seed = 1,
        lookaheadPlies = 2,
        replyCandidates = 6,
    } = options;
    const rng = mulberry32(seed);

    const myUnits = unitsOf(snapshot, playerIndex);
    const enemyIndexes: number[] = [];
    for (const [i, unit] of snapshot.liveUnits()) {
        if (unit.playerIndex !== playerIndex) enemyIndexes.push(i);
    }
    if (myUnits.length === 0) {
        return { events: [], score: scoreState(snapshot, playerIndex), genes: [] };
    }

    const maxPlanLength = options.maxPlanLength ?? myUnits.length * 6;
    // Two-player assumption (matches GameState's fixed player pair).
    const opponentIndex = 1 - playerIndex;

    const evaluate = (genes: Gene[]): Candidate => {
        const branch = snapshot.fork();
        for (const gene of genes) applyGene(branch, gene);
        const immediateScore = scoreState(branch, playerIndex);

        // Roll the future forward: alternate opponent/own simulated turns
        // and score at the horizon instead of right now.
        let horizon = branch;
        if (lookaheadPlies > 0 && enemyIndexes.length > 0) {
            horizon = branch.fork();
            const rolloutRng = mulberry32(combineSeed(seed, fingerprint(genes)));
            let side = opponentIndex;
            for (let ply = 0; ply < lookaheadPlies; ply++) {
                horizon.record({ type: 'turnStarted', playerIndex: side });
                const reply = bestReply(horizon, side, rolloutRng, replyCandidates);
                for (const gene of reply) applyGene(horizon, gene);
                side = side === playerIndex ? opponentIndex : playerIndex;
            }
        }

        const score = scoreState(horizon, playerIndex);
        const fitness = score + immediateScore * IMMEDIATE_WEIGHT - genes.length * PARSIMONY_PENALTY;
        return { genes, branch, score, fitness };
    };

    const randomPlan = (): Gene[] => randomPlanFor(snapshot, playerIndex, rng, 3);

    const mutate = (genes: Gene[]): Gene[] => {
        const copy = genes.map((g) => ({ ...g }));
        const op = rng();

        if (op < 0.25 && copy.length < maxPlanLength) {
            // Insert a new random gene at a random position.
            const pos = Math.floor(rng() * (copy.length + 1));
            const unitIndex = myUnits[Math.floor(rng() * myUnits.length)];
            copy.splice(pos, 0, randomGene(snapshot, unitIndex, rng));
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
