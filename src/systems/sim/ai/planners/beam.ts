// A BEAM TREE search over whole turns, modelled on HeroesOfBlazor's
// AIBrain. It exists to test a specific claim: that you do not need a
// "threat" term in the evaluation to stop a unit walking into a bad
// matchup -- the search will discover it, provided it actually plays the
// consequences out far enough and does not throw away the plans it needs
// to play out.
//
// The hillclimb in search.ts fails that second condition, measurably. A
// tank five hexes from an AA it one-shots will not close: stepping into
// the AA's reach costs 2 chip damage NOW, and the kill it sets up is two
// turns away -- past the 2-ply rollout that decides which candidates
// survive. The plan is culled before the deep stage ever scores it. The
// tank ends up homing on the exact edge of the AA's threat range and
// waiting there, which reads as fear of a unit it beats 2-to-1.
//
// Two mechanisms answer that:
//
//   DEPTH. Every level is a full turn for the side to move, generated the
//   same way for both sides -- no cheap random opponent model, no greedy
//   nested search. A payoff two or three turns out is inside the horizon
//   rather than beyond it.
//
//   SACRIFICE RETENTION. At the searching side's own levels the beam keeps
//   the `keepWorst` WORST-scoring children alongside the best. This is the
//   part that matters. A move that looks bad now is exactly the move whose
//   consequences need playing out, and pure greedy selection deletes it
//   before that can happen. HoB's comment on the same line reads "only use
//   sacrificing moves if simulating current".
//
// Opponent levels keep the children that are WORST for us, i.e. the
// opponent's own best replies -- so the line is scored against an opponent
// playing well rather than against one flailing. When an opponent level is
// the LAST one, the root is read off it: the kept reply's value is the
// line's score AFTER the opponent's answer, which is the number the whole
// design says a move must be judged by. An even depth used to compute that
// final level and throw it away.

import { SimState, GameEvent } from '../../SimState';
import { PlanTurnOptions, PlanProgress, TurnPlanResult } from '../../search';
import { DEFAULT_DIALECT } from '../../SimCommands';
import { scoreState, DEFAULT_SCORE_WEIGHTS } from '../../score';
import { combineSeed } from '../../resolveAttack';
import { runSimJob } from '../simJob';

export interface BeamOptions {
    // Turns played out per line. Depth 1 is pure greedy.
    depth: number;
    // Random whole turns generated per node, indexed by depth. Shorter than
    // `depth` is fine -- the last entry repeats.
    childCounts: number[];
    // Kept per node at the searching side's own levels.
    keepBest: number;
    // Also kept there, from the BOTTOM of the ranking. The whole point;
    // see the header. Zero makes this a plain greedy beam.
    keepWorst: number;
    // Kept per node at opponent levels, chosen as the opponent's best
    // (i.e. our worst). One mirrors HeroesOfBlazor.
    keepOpponent: number;
    // Upper bound on genes per unit in a generated turn.
    genesPerUnit: number;
}

export const DEFAULT_BEAM: BeamOptions = {
    depth: 5,
    childCounts: [40, 20, 14, 10, 8],
    keepBest: 4,
    keepWorst: 2,
    keepOpponent: 1,
    genesPerUnit: 3,
};

interface Node {
    // Every event from the snapshot to this node. The child generator
    // replays it, which is also exactly what a worker needs -- see simJob.
    path: GameEvent[];
    // Events of the depth-0 turn this line descends from -- the only turn
    // that will actually be executed. Everything deeper is evaluation.
    rootEvents: readonly GameEvent[];
    // Score of that depth-0 turn on its own, used to break ties between
    // lines that reach the same leaf value.
    rootImmediate: number;
}

export function* beamPlanGen(
    snapshot: SimState,
    playerIndex: number,
    options: PlanTurnOptions
): Generator<PlanProgress, TurnPlanResult> {
    const {
        seed = 1,
        score: weights = DEFAULT_SCORE_WEIGHTS,
        dialect = DEFAULT_DIALECT,
        beam = DEFAULT_BEAM,
    } = options;
    // Width may be overridden by a budget; depth and the keep-counts may
    // not. See PlanTurnOptions.beamChildCounts.
    const childCounts = options.beamChildCounts ?? beam.childCounts;
    // Depth gets the same treatment as width, and for the same reason: a
    // live game has time to think that a headless batch does not. Explicit
    // and separate, so depth can only ever change because someone asked
    // for it -- handing over a whole beam object would carry it silently.
    const beamDepth = options.beamDepth ?? beam.depth;

    const hasUnits = [...snapshot.liveUnits()].some((u) => u[1].playerIndex === playerIndex);
    if (!hasUnits) {
        return { events: [], score: scoreState(snapshot, playerIndex, weights), genes: [] };
    }

    // Two-player assumption, same as the hillclimb's.
    const opponentIndex = 1 - playerIndex;
    const childCountAt = (depth: number) =>
        childCounts[Math.min(depth, childCounts.length - 1)] ?? 1;

    let level: Node[] = [{ path: [], rootEvents: [], rootImmediate: 0 }];
    let best: Node | null = null;
    let bestValue = -Infinity;

    for (let depth = 0; depth < beamDepth; depth++) {
        const side = depth % 2 === 0 ? playerIndex : opponentIndex;
        const isOwnLevel = side === playerIndex;
        const childCount = childCountAt(depth);

        // Grouped BY PARENT, and selected per group. Pooling every parent's
        // children into one ranking and cutting globally looks equivalent
        // and is not: with keepOpponent 1 it leaves a single survivor for
        // the whole level, so every root line but one is discarded -- and
        // since the opponent's cut takes our WORST, the survivor is
        // whichever of our opening turns went worst. The search then
        // "chooses" it, because nothing else is left to compare against.
        // Children come from runSimJob -- the SAME function a worker calls,
        // so the serial and parallel planners cannot compute different
        // things. Seeds derive from (seed, depth, node, child) rather than
        // from one shared stream, which is what lets a child be generated
        // anywhere and still land in the same place.
        const byParent: Array<Array<{ node: Node; value: number }>> = level.map((parent, p) => {
            const children = runSimJob(snapshot, {
                parentEvents: parent.path,
                side,
                // Always the searching side, at every depth, so one number
                // is comparable the whole way down.
                scoreFor: playerIndex,
                // The snapshot arrives already reset for the side to move
                // (the caller records turnStarted before condensing), so
                // only deeper turns need their own reset.
                resetTurn: depth > 0,
                count: childCount,
                seed: combineSeed(seed, depth, p),
                genesPerUnit: beam.genesPerUnit,
            // What this level can still choose. Everything else is scored
            // and dropped inside the job instead of being shipped home.
            keep: { best: beam.keepBest, worst: beam.keepWorst, opponent: beam.keepOpponent },
            }, { dialect, score: weights });

            return children.map((child) => ({
                node: {
                    path: [...parent.path, ...child.events],
                    rootEvents: depth === 0 ? child.events : parent.rootEvents,
                    rootImmediate: depth === 0 ? child.value : parent.rootImmediate,
                } as Node,
                value: child.value,
                index: child.index,
                // Whether this child's own turn did anything at all.
                acted: child.events.length > 0,
            }));
        });

        const nextLevel: Node[] = [];
        let levelBest: { node: Node; value: number } | null = null;

        for (const group of byParent) {
            if (group.length === 0) continue;
            group.sort((a: any, b: any) => b.value - a.value || a.index - b.index);

            if (isOwnLevel) {
                const top = group.slice(0, beam.keepBest);
                // The sacrifice slots, taken from the bottom of what the
                // best-slice did not already claim. A move that scores
                // badly now is exactly the move whose consequences need
                // playing out; greedy selection deletes it first.
                const remaining = group.slice(beam.keepBest);
                const bottom = beam.keepWorst > 0 ? remaining.slice(-beam.keepWorst) : [];
                for (const entry of [...top, ...bottom]) nextLevel.push(entry.node);
                if (!levelBest || group[0].value > levelBest.value) levelBest = group[0];
            } else {
                // The opponent picks what hurts us most, so our worst-scoring
                // children are their best replies. Prefer replies that
                // actually did something, mirroring HeroesOfBlazor -- an idle
                // reply flatters our line for no reason.
                const acting = group.filter((entry: any) => entry.acted);
                const pool = acting.length > 0 ? acting : group;
                for (const entry of pool.slice(-beam.keepOpponent)) {
                    nextLevel.push(entry.node);
                    // At the LAST level their kept reply is the line's final
                    // word -- our score after their best answer -- so the
                    // root is read off it. An even depth used to compute
                    // this whole level and throw it away, returning the
                    // pre-reply pick as if the level had never run.
                    if (depth === beamDepth - 1 && (!levelBest || entry.value > levelBest.value)) {
                        levelBest = entry;
                    }
                }
            }
        }

        if (nextLevel.length === 0) break;

        // The line to play is read off OUR levels -- re-read at each one so
        // an early break still leaves a usable answer -- and off the FINAL
        // level whichever side it is. Never off an intermediate opponent
        // level, and never off a single node's score before the reply to it
        // has been played: a turn-1 gain that has not paid for its
        // consequences yet is exactly what a greedy search would pick, and
        // the whole point here is not to be one. Ending on the opponent's
        // reply is the one case where the after-reply number exists, and
        // reading it is what makes an even depth mean something.
        if ((isOwnLevel || depth === beamDepth - 1) && levelBest) {
            best = levelBest.node;
            bestValue = levelBest.value;
        }

        level = nextLevel;
        yield { done: depth + 1, total: beamDepth, label: depth === 0 ? 'search' : 'verify' };
    }

    if (!best) {
        return { events: [], score: scoreState(snapshot, playerIndex, weights), genes: [] };
    }
    return { events: best.rootEvents, score: bestValue, genes: [] };
}
