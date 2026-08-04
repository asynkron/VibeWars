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
// After every applied plan (own or opponent, evaluation or execution) an
// ATTACK SWEEP fires every unit that still has a net-positive legal shot
// -- attacks have no in-turn downside, so "moved into range but didn't
// shoot" is never a plan the search can output or be fooled by.
//
// Two-stage evaluation (progressive deepening, the exponential-blowup
// tamer): the hillclimb judges every candidate with a CHEAP rollout --
// best-of-K random opponent replies for `lookaheadPlies` turns. Then the
// top `finalists` distinct plans get the EXPENSIVE treatment: a deep
// rollout where each opponent (and own) reply comes from a real nested
// planTurn with a small budget and no lookahead of its own. That keeps
// the recursion bounded (breadth x 1 deep level, never deep x deep) while
// making the final choice against a competent opponent model. Both
// stages are seeded from a fingerprint of the candidate's genes, so
// fitness is noise-free and the whole search is deterministic per seed.
//
// Only the FIRST turn's events (the candidate's own genes + attack sweep
// applied to a clean fork) are returned for execution -- lookahead is
// evaluation only.
//
// Selection: keep the top quartile each round, refill with mutated
// survivors (insert / delete / replace / swap / reseed+retarget). Fitness
// carries a tiny per-gene parsimony penalty so equally-scoring shorter
// plans win; the reported score is the real, unpenalized horizon score.

import { SimState, GameEvent } from './SimState';
import { Gene, GeneDialect, DEFAULT_DIALECT, applyGene, randomGene, sweepAttacks } from './SimCommands';
import { mulberry32, combineSeed } from './resolveAttack';
import { scoreState, ScoreWeights, DEFAULT_SCORE_WEIGHTS } from './score';

// How often each mutation operator is picked, as a share of 1. Whatever
// the four leave over goes to reseed+retarget.
export interface MutationRates {
    insert: number;
    remove: number;
    replace: number;
    swap: number;
}

export const DEFAULT_MUTATION_RATES: MutationRates = {
    insert: 0.25,
    remove: 0.20,
    replace: 0.20,
    swap: 0.20,
    // remainder 0.15 -> reseed+retarget
};

export interface PlanTurnOptions {
    population?: number;
    rounds?: number;
    seed?: number;
    // Hard cap on plan length (defaults to 6 genes per own unit) -- a
    // safety rail against runaway genome growth, not a tuning knob.
    maxPlanLength?: number;
    // How many simulated reply-turns to look ahead when evaluating a
    // candidate during the cheap hillclimb stage (0 = pure greedy, which
    // also disables the finalist deepening below).
    lookaheadPlies?: number;
    // Width of the cheap opponent model: each rollout turn picks the best
    // of this many random plans for the side to move.
    replyCandidates?: number;
    // Deep stage: the top `finalists` distinct plans are re-scored with a
    // rollout `deepPlies` turns long where every reply is a real nested
    // search (population `replyPopulation`, `replyRounds` rounds, no
    // lookahead of its own). 0 finalists disables the stage.
    finalists?: number;
    deepPlies?: number;
    replyPopulation?: number;
    replyRounds?: number;

    // --- Engine personality. Everything below is what makes one AI engine
    // --- different from another; the defaults are the shipped behaviour.

    // How the board is valued.
    score?: ScoreWeights;
    // Which genes exist, how often each is rolled, and how the post-plan
    // attack sweep values a shot.
    dialect?: GeneDialect;
    // Per-gene fitness cost, so equally-scoring shorter plans win.
    parsimonyPenalty?: number;
    // Share of the immediate (pre-lookahead) score mixed into fitness --
    // future discounting, see IMMEDIATE_WEIGHT's note below.
    immediateWeight?: number;
    // Fraction of the population kept as breeding stock each round.
    survivorFraction?: number;
    // Upper bound on how many genes each unit gets in a freshly generated
    // plan (1..n, drawn per unit) -- population init and the cheap
    // opponent model use their own value.
    initGenesPerUnit?: number;
    replyGenesPerUnit?: number;
    // Cap on plan length as a multiple of the side's unit count, used when
    // maxPlanLength is not given outright.
    maxGenesPerUnit?: number;
    mutation?: MutationRates;

    // Settings for an engine-supplied planner rather than this hillclimb.
    // They live in the same bundle so an engine stays one option object and
    // withBudget keeps working; the hillclimb simply never reads them.
    // Typed loosely here to keep search.ts from depending on the planners
    // that depend on it -- each planner narrows its own.
    beam?: any;
    // How WIDE a beam planner searches, overridable by a budget while the
    // engine keeps everything else about its beam. Depth and the beam's
    // keep-counts are what an engine believes; width is what it can afford.
    // Folding the whole beam object into a budget instead would let
    // LIVE_BUDGET silently hand a shallow engine someone else's depth.
    beamChildCounts?: number[];
}

export interface TurnPlanResult {
    events: readonly GameEvent[];
    score: number;
    genes: Gene[];
}

// Progress ticks yielded by the search between units of work, so a UI can
// show a thinking bar. `label` is a coarse phase name.
export interface PlanProgress {
    done: number;
    total: number;
    label: string;
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

const SURVIVOR_FRACTION = 0.25;
const INIT_GENES_PER_UNIT = 3;
const REPLY_GENES_PER_UNIT = 2;
const MAX_GENES_PER_UNIT = 6;

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
// genes per unit, freely ordered. (The attack sweep now guarantees
// trailing shots, so generation 0 no longer needs explicit attack genes
// appended -- but a few random attack genes still arise via KIND_WEIGHTS.)
export function randomPlanFor(
    state: SimState,
    playerIndex: number,
    rng: () => number,
    maxBodyGenes: number,
    dialect: GeneDialect
): Gene[] {
    const myUnits = unitsOf(state, playerIndex);
    const owners: number[] = [];
    for (const unitIndex of myUnits) {
        const count = 1 + Math.floor(rng() * maxBodyGenes);
        for (let k = 0; k < count; k++) owners.push(unitIndex);
    }
    return shuffleWith(rng, owners).map((unitIndex) => randomGene(state, unitIndex, rng, dialect));
}

// Cheap opponent model: best of K random plans for `playerIndex` (attack
// sweep included), judged by that side's own score. It just has to punish
// obvious blunders during the hillclimb -- the finalist stage brings the
// competent opponent.
//
// The opponent is modelled with THIS engine's own dialect and weights. An
// engine has no knowledge of what it is playing against, so the only
// honest opponent model it can build is itself.
function bestReply(
    state: SimState,
    playerIndex: number,
    rng: () => number,
    k: number,
    dialect: GeneDialect,
    scoreWeights: ScoreWeights,
    genesPerUnit: number
): SimState {
    let best: SimState | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < k; i++) {
        const genes = randomPlanFor(state, playerIndex, rng, genesPerUnit, dialect);
        const probe = state.fork();
        for (const gene of genes) applyGene(probe, gene, dialect.extras);
        sweepAttacks(probe, playerIndex, dialect.sweep);
        const score = scoreState(probe, playerIndex, scoreWeights);
        if (score > bestScore) {
            bestScore = score;
            best = probe;
        }
    }
    return best ?? state.fork();
}

// The search core as a generator: yields progress ticks between units of
// work so drivers can either run it to completion synchronously
// (planTurn) or yield to the event loop between ticks (planTurnAsync).
export function* planTurnGen(
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions
): Generator<PlanProgress, TurnPlanResult> {
    const {
        population = 24,
        rounds = 4,
        seed = 1,
        lookaheadPlies = 2,
        replyCandidates = 6,
        finalists = 4,
        deepPlies = 2,
        replyPopulation = 8,
        replyRounds = 2,
        score: scoreWeights = DEFAULT_SCORE_WEIGHTS,
        dialect = DEFAULT_DIALECT,
        parsimonyPenalty = PARSIMONY_PENALTY,
        immediateWeight = IMMEDIATE_WEIGHT,
        survivorFraction = SURVIVOR_FRACTION,
        initGenesPerUnit = INIT_GENES_PER_UNIT,
        replyGenesPerUnit = REPLY_GENES_PER_UNIT,
        maxGenesPerUnit = MAX_GENES_PER_UNIT,
        mutation = DEFAULT_MUTATION_RATES,
    } = options;
    const rng = mulberry32(seed);

    // Everything an engine's personality is made of, forwarded verbatim to
    // the nested searches below so a deep rollout is played by the SAME
    // engine rather than by the defaults.
    const personality = {
        score: scoreWeights,
        dialect,
        parsimonyPenalty,
        immediateWeight,
        survivorFraction,
        initGenesPerUnit,
        replyGenesPerUnit,
        maxGenesPerUnit,
        mutation,
    };

    const myUnits = unitsOf(snapshot, playerIndex);
    const enemyIndexes: number[] = [];
    for (const [i, unit] of snapshot.liveUnits()) {
        if (unit.playerIndex !== playerIndex) enemyIndexes.push(i);
    }
    if (myUnits.length === 0) {
        return { events: [], score: scoreState(snapshot, playerIndex, scoreWeights), genes: [] };
    }

    const maxPlanLength = options.maxPlanLength ?? myUnits.length * maxGenesPerUnit;
    // Two-player assumption (matches GameState's fixed player pair).
    const opponentIndex = 1 - playerIndex;

    // Greedy mode (lookaheadPlies 0) also disables the deep stage: the
    // caller asked for "score right after my own moves", so the reported
    // score must be exactly reproducible by replaying the events.
    const deepFinalists = lookaheadPlies > 0 && enemyIndexes.length > 0
        ? Math.max(0, finalists)
        : 0;
    const totalTicks = 1 + rounds + (deepFinalists > 0 ? deepFinalists : 0);
    let ticks = 0;

    const evaluate = (genes: Gene[]): Candidate => {
        const branch = snapshot.fork();
        for (const gene of genes) applyGene(branch, gene, dialect.extras);
        sweepAttacks(branch, playerIndex, dialect.sweep);
        const immediateScore = scoreState(branch, playerIndex, scoreWeights);

        // Cheap rollout: alternate opponent/own simulated turns with the
        // best-of-K random opponent model, score at the horizon.
        let horizon = branch;
        if (lookaheadPlies > 0 && enemyIndexes.length > 0) {
            const rolloutRng = mulberry32(combineSeed(seed, fingerprint(genes)));
            horizon = branch.fork();
            let side = opponentIndex;
            for (let ply = 0; ply < lookaheadPlies; ply++) {
                horizon.record({ type: 'turnStarted', playerIndex: side });
                horizon = bestReply(horizon, side, rolloutRng, replyCandidates, dialect, scoreWeights, replyGenesPerUnit);
                side = side === playerIndex ? opponentIndex : playerIndex;
            }
        }

        const score = scoreState(horizon, playerIndex, scoreWeights);
        const fitness = score + immediateScore * immediateWeight - genes.length * parsimonyPenalty;
        return { genes, branch, score, fitness };
    };

    // Deep evaluation for a finalist: roll `deepPlies` future turns where
    // every reply (theirs AND ours) is a real small search -- greedy, no
    // lookahead of its own, so recursion is bounded to one nesting level.
    const deepEvaluate = (candidate: Candidate): number => {
        let state = candidate.branch.fork();
        let side = opponentIndex;
        for (let ply = 0; ply < deepPlies; ply++) {
            state.record({ type: 'turnStarted', playerIndex: side });
            const snap = state.condense();
            const reply = planTurn(snap, side, {
                ...personality,
                population: replyPopulation,
                rounds: replyRounds,
                seed: combineSeed(seed, fingerprint(candidate.genes), ply),
                lookaheadPlies: 0, // bounds the recursion
            });
            for (const event of reply.events) snap.record(event);
            state = snap;
            side = side === playerIndex ? opponentIndex : playerIndex;
        }
        return scoreState(state, playerIndex, scoreWeights);
    };

    const randomPlan = (): Gene[] => randomPlanFor(snapshot, playerIndex, rng, initGenesPerUnit, dialect);

    // Cumulative thresholds for the mutation roulette; the remainder after
    // swap falls through to reseed+retarget.
    const opInsert = mutation.insert;
    const opRemove = opInsert + mutation.remove;
    const opReplace = opRemove + mutation.replace;
    const opSwap = opReplace + mutation.swap;

    const mutate = (genes: Gene[]): Gene[] => {
        const copy = genes.map((g) => ({ ...g }));
        const op = rng();

        if (op < opInsert && copy.length < maxPlanLength) {
            // Insert a new random gene at a random position.
            const pos = Math.floor(rng() * (copy.length + 1));
            const unitIndex = myUnits[Math.floor(rng() * myUnits.length)];
            copy.splice(pos, 0, randomGene(snapshot, unitIndex, rng, dialect));
        } else if (op < opRemove && copy.length > 1) {
            // Delete a random gene.
            copy.splice(Math.floor(rng() * copy.length), 1);
        } else if (op < opReplace && copy.length > 0) {
            // Replace one gene (same unit, fresh action).
            const i = Math.floor(rng() * copy.length);
            copy[i] = randomGene(snapshot, copy[i].unitIndex, rng, dialect);
        } else if (op < opSwap && copy.length >= 2) {
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
    yield { done: ++ticks, total: totalTicks, label: 'search' };

    for (let round = 0; round < rounds; round++) {
        candidates.sort((a, b) => b.fitness - a.fitness);
        const survivors = candidates.slice(0, Math.max(1, Math.floor(population * survivorFraction)));
        const next: Candidate[] = [...survivors];
        while (next.length < population) {
            const parent = survivors[Math.floor(rng() * survivors.length)];
            next.push(evaluate(mutate(parent.genes)));
        }
        candidates = next;
        yield { done: ++ticks, total: totalTicks, label: 'search' };
    }

    candidates.sort((a, b) => b.fitness - a.fitness);

    if (deepFinalists === 0) {
        const best = candidates[0];
        return { events: best.branch.events, score: best.score, genes: best.genes };
    }

    // Deep stage: distinct top plans, re-scored against the competent
    // opponent model; ties broken by the cheap fitness (which already
    // carries immediacy + parsimony).
    const seen = new Set<number>();
    const finalCandidates: Candidate[] = [];
    for (const candidate of candidates) {
        const fp = fingerprint(candidate.genes);
        if (seen.has(fp)) continue;
        seen.add(fp);
        finalCandidates.push(candidate);
        if (finalCandidates.length >= deepFinalists) break;
    }

    let best = finalCandidates[0];
    let bestDeep = -Infinity;
    for (const candidate of finalCandidates) {
        const deep = deepEvaluate(candidate);
        if (deep > bestDeep || (deep === bestDeep && candidate.fitness > best.fitness)) {
            bestDeep = deep;
            best = candidate;
        }
        yield { done: ++ticks, total: totalTicks, label: 'verify' };
    }

    return { events: best.branch.events, score: bestDeep, genes: best.genes };
}

// A whole-turn search algorithm, written as a generator so it can be run
// either synchronously or with yields to the event loop. Engines may bring
// their own -- see AIEngine's `planner` -- which is how a genuinely
// different search (a beam tree, say) plugs in beside this hillclimb
// without either having to know about the other.
export type Planner = (
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions
) => Generator<PlanProgress, TurnPlanResult>;

// A planner that cannot run synchronously -- because it waits on workers.
// An engine may supply one alongside its generator: the generator serves
// planTurn (headless batches, tournaments, tests), the async one serves
// planTurnAsync (the live game). They are required to produce the same
// plan, which beamParallel.test.ts checks event for event.
export type AsyncPlanner = (
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions,
    onProgress?: (progress: PlanProgress) => void
) => Promise<TurnPlanResult>;

// Run a planner to completion on this tick.
export function drivePlanner(gen: Generator<PlanProgress, TurnPlanResult>): TurnPlanResult {
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
}

// Identical result to drivePlanner (same generator, same seeds), but
// yields to the event loop between work units and reports progress -- so
// the page can animate an "AI thinking" bar while the search runs on the
// main thread.
export async function drivePlannerAsync(
    gen: Generator<PlanProgress, TurnPlanResult>,
    onProgress?: (progress: PlanProgress) => void
): Promise<TurnPlanResult> {
    let step = gen.next();
    while (!step.done) {
        onProgress?.(step.value);
        await new Promise((resolve) => setTimeout(resolve, 0));
        step = gen.next();
    }
    return step.value;
}

export function planTurn(snapshot: SimState, playerIndex: number, options: PlanTurnOptions = {}): TurnPlanResult {
    return drivePlanner(planTurnGen(snapshot, playerIndex, options));
}

export async function planTurnAsync(
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions = {},
    onProgress?: (progress: PlanProgress) => void
): Promise<TurnPlanResult> {
    return drivePlannerAsync(planTurnGen(snapshot, playerIndex, options), onProgress);
}
