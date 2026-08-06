// The beam search with its child generation fanned out across workers.
//
// The beam is unusually well suited to this: at every level each surviving
// node generates its children independently -- fork, apply a random turn,
// sweep, score -- and with keepBest 7 + keepWorst 4 there are eleven nodes
// per own level, each wanting twenty to a hundred and sixty children. That
// is the fan-out, and it is the ONLY thing that moves off this thread.
//
// SELECTION STAYS HERE, and stays identical to beam.ts: best-and-worst per
// node at our levels, the opponent's best reply at theirs, the line read
// off the deepest own level. Splitting the selection would have been the
// easy way to make the parallel search quietly play differently from the
// serial one.
//
// DETERMINISM SURVIVES. Child seeds derive from (level seed, node index,
// child index) and results are ordered by index, never by which worker
// answered first. Same seed, same plan, however the threads interleaved --
// which is what makes the two planners comparable at all, and what
// beamParallel.test.ts checks against the serial one directly.

import { SimState, GameEvent } from '../../SimState';
import { PlanTurnOptions, PlanProgress, TurnPlanResult } from '../../search';
import { scoreState, DEFAULT_SCORE_WEIGHTS } from '../../score';
import { DEFAULT_DIALECT } from '../../SimCommands';
import { combineSeed } from '../../resolveAttack';
import { DEFAULT_BEAM } from './beam';
import { SimJob, SimJobChild } from '../simJob';
import { SimJobRunner, getSimWorkerPool } from '../workerPool';

// A level's parallelism is its job count, and the top of the tree has ONE
// node -- so without chunking the WIDEST level of the whole search (the
// root's) ran on a single worker while the rest sat idle. Chunks carry an
// absolute startIndex, so a split node's children are bit-identical to the
// same node run whole -- see SimJob.startIndex.
//
// Never slice finer than this: a chunk re-clones the whole parent event
// path across postMessage, so tiny chunks spend more on cloning than they
// buy in overlap.
const MIN_CHUNK = 32;
// Aim for this many chunks per worker, so one unlucky long chunk evens out
// across the pool instead of parking the level on a single core.
const CHUNKS_PER_WORKER = 4;

interface Node {
    // Every event from the snapshot to this node, so a job can replay it.
    path: GameEvent[];
    // The depth-0 turn this line descends from -- the only turn that will
    // be executed. Everything deeper is evaluation.
    rootEvents: GameEvent[];
}

export async function beamPlanParallel(
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions,
    onProgress?: (progress: PlanProgress) => void,
    pool: SimJobRunner = getSimWorkerPool()
): Promise<TurnPlanResult> {
    const {
        seed = 1,
        score: weights = DEFAULT_SCORE_WEIGHTS,
        dialect = DEFAULT_DIALECT,
        beam = DEFAULT_BEAM,
    } = options;
    const childCounts = options.beamChildCounts ?? beam.childCounts;
    // The live depth dial, mirroring beam.ts exactly. This planner read
    // `beam.depth` alone for a while, and the failure was silent and total:
    // every difficulty played the engine's own depth in the browser, and
    // only in the browser -- the serial planner honoured the budget, the
    // tests pin the serial planner, and the tournament passes no depth.
    const beamDepth = options.beamDepth ?? beam.depth;

    const hasUnits = [...snapshot.liveUnits()].some(([, u]) => u.playerIndex === playerIndex);
    if (!hasUnits) {
        return { events: [], score: scoreState(snapshot, playerIndex, weights), genes: [] };
    }

    const opponentIndex = 1 - playerIndex;
    const childCountAt = (depth: number) => childCounts[Math.min(depth, childCounts.length - 1)] ?? 1;
    // The config CROSSES postMessage, so it must be structured-cloneable
    // and a GeneDefinition is not: it holds functions. The genes travel as
    // names and runSimJob rebuilds them from genes/registry.ts on the far
    // side. Sending `dialect` whole is what made ?ai=aegis throw
    // DataCloneError on every AI turn in a real browser.
    const config = {
        dialect: { ...dialect, extras: {} },
        extraKinds: Object.keys(dialect.extras),
        score: weights,
    };

    pool.setSnapshot(snapshot);

    let level: Node[] = [{ path: [], rootEvents: [] }];
    let best: { node: Node; value: number } | null = null;

    for (let depth = 0; depth < beamDepth; depth++) {
        const side = depth % 2 === 0 ? playerIndex : opponentIndex;
        const isOwnLevel = side === playerIndex;
        const count = childCountAt(depth);

        // How finely to split each node's children -- see MIN_CHUNK. Sized
        // so the LEVEL, not the node, fills the pool: one root node at
        // width 2600 becomes dozens of chunks instead of one worker's
        // afternoon. Deep levels with many nodes already saturate the pool
        // and get one chunk per node, i.e. exactly the old shape. The
        // serial fallback never chunks -- same work either way, and the
        // per-chunk parent replay is pure overhead with no one to share it.
        const targetChunks = pool.parallel ? Math.max(1, pool.size) * CHUNKS_PER_WORKER : 1;
        const chunksPerNode = Math.max(1, Math.min(
            Math.ceil(targetChunks / level.length),
            Math.ceil(count / MIN_CHUNK)
        ));
        const chunkSize = Math.ceil(count / chunksPerNode);

        const jobs: SimJob[] = [];
        // Which node each chunk belongs to, for reassembly below.
        const owner: number[] = [];
        level.forEach((node, nodeIndex) => {
            for (let start = 0; start < count; start += chunkSize) {
                jobs.push({
                    parentEvents: node.path,
                    side,
                    // Always the searching side, at every depth, so one number
                    // is comparable the whole way down.
                    scoreFor: playerIndex,
                    // The snapshot arrives already reset for the side to move.
                    resetTurn: depth > 0,
                    count: Math.min(chunkSize, count - start),
                    startIndex: start,
                    // Per NODE, not per chunk: child seeds come from
                    // (this, absolute index), so the split is invisible.
                    seed: combineSeed(seed, depth, nodeIndex),
                    genesPerUnit: beam.genesPerUnit,
                    // What this level can still choose. Everything else is
                    // scored and dropped inside the job instead of being
                    // shipped home.
                    keep: { best: beam.keepBest, worst: beam.keepWorst, opponent: beam.keepOpponent },
                });
                owner.push(nodeIndex);
            }
        });

        const chunkResults = await pool.run(jobs, config);
        // Reassemble per node. Each chunk pruned to the keep-superset over
        // its OWN children; every child the whole-node prune would keep is
        // in some chunk's superset (top-k of the union is top-k in its own
        // chunk, and likewise from the bottom), and the selection below
        // re-sorts and slices with the same comparator -- so the survivors
        // are identical to the unchunked planner's, which the chunked
        // identity test in beamParallel.test.ts holds it to.
        const results: SimJobChild[][] = level.map(() => []);
        chunkResults.forEach((children, jobIndex) => {
            results[owner[jobIndex]].push(...children);
        });

        const nextLevel: Node[] = [];
        let levelBest: { node: Node; value: number } | null = null;

        for (let nodeIndex = 0; nodeIndex < level.length; nodeIndex++) {
            const parent = level[nodeIndex];
            // By index, never by arrival -- see the header.
            const group = [...results[nodeIndex]].sort((a, b) =>
                b.value - a.value || a.index - b.index);
            if (group.length === 0) continue;

            const toNode = (child: { events: GameEvent[] }): Node => ({
                path: [...parent.path, ...child.events],
                rootEvents: depth === 0 ? child.events : parent.rootEvents,
            });

            if (isOwnLevel) {
                const top = group.slice(0, beam.keepBest);
                // The sacrifice slots: a move that scores badly now is
                // exactly the one whose consequences need playing out.
                const remaining = group.slice(beam.keepBest);
                const bottom = beam.keepWorst > 0 ? remaining.slice(-beam.keepWorst) : [];
                for (const child of [...top, ...bottom]) nextLevel.push(toNode(child));
                if (!levelBest || group[0].value > levelBest.value) {
                    levelBest = { node: toNode(group[0]), value: group[0].value };
                }
            } else {
                // The opponent picks what hurts us most, and prefers a reply
                // that actually did something.
                const acting = group.filter((child) => child.events.length > 0);
                const usable = acting.length > 0 ? acting : group;
                for (const child of usable.slice(-beam.keepOpponent)) {
                    nextLevel.push(toNode(child));
                    // At the LAST level their kept reply is the line's final
                    // word -- our score after their best answer -- so the
                    // root is read off it. An even depth used to compute
                    // this whole level and throw it away, returning the
                    // pre-reply pick as if the level had never run.
                    if (depth === beamDepth - 1 && (!levelBest || child.value > levelBest.value)) {
                        levelBest = { node: toNode(child), value: child.value };
                    }
                }
            }
        }

        if (nextLevel.length === 0) break;
        // Own levels as before, plus the final level whichever side it is
        // -- mirroring beam.ts exactly, which the identity test enforces.
        if ((isOwnLevel || depth === beamDepth - 1) && levelBest) best = levelBest;

        level = nextLevel;
        onProgress?.({ done: depth + 1, total: beamDepth, label: depth === 0 ? 'search' : 'verify' });
    }

    if (!best) return { events: [], score: scoreState(snapshot, playerIndex, weights), genes: [] };
    return { events: best.node.rootEvents, score: best.value, genes: [] };
}
