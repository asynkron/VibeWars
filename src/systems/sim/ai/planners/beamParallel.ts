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
import { SimJob } from '../simJob';
import { SimWorkerPool, getSimWorkerPool } from '../workerPool';

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
    pool: SimWorkerPool = getSimWorkerPool()
): Promise<TurnPlanResult> {
    const {
        seed = 1,
        score: weights = DEFAULT_SCORE_WEIGHTS,
        dialect = DEFAULT_DIALECT,
        beam = DEFAULT_BEAM,
    } = options;
    const childCounts = options.beamChildCounts ?? beam.childCounts;

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

    for (let depth = 0; depth < beam.depth; depth++) {
        const side = depth % 2 === 0 ? playerIndex : opponentIndex;
        const isOwnLevel = side === playerIndex;
        const count = childCountAt(depth);

        const jobs: SimJob[] = level.map((node, nodeIndex) => ({
            parentEvents: node.path,
            side,
            // Always the searching side, at every depth, so one number is
            // comparable the whole way down.
            scoreFor: playerIndex,
            // The snapshot arrives already reset for the side to move.
            resetTurn: depth > 0,
            count,
            seed: combineSeed(seed, depth, nodeIndex),
            genesPerUnit: beam.genesPerUnit,
            // What this level can still choose. Everything else is scored
            // and dropped inside the job instead of being shipped home.
            keep: { best: beam.keepBest, worst: beam.keepWorst, opponent: beam.keepOpponent },
        }));

        const results = await pool.run(jobs, config);

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
                for (const child of usable.slice(-beam.keepOpponent)) nextLevel.push(toNode(child));
            }
        }

        if (nextLevel.length === 0) break;
        if (isOwnLevel && levelBest) best = levelBest;

        level = nextLevel;
        onProgress?.({ done: depth + 1, total: beam.depth, label: depth === 0 ? 'search' : 'verify' });
    }

    if (!best) return { events: [], score: scoreState(snapshot, playerIndex, weights), genes: [] };
    return { events: best.node.rootEvents, score: best.value, genes: [] };
}
