// Runs many headless matches between two engines and reports who is
// actually better -- which is harder than counting wins.
//
// THE SEAT PROBLEM. Player 0 moves first. On a rotationally symmetric map
// that is the only asymmetry left, and it is not nothing. If engine A
// always sat in seat 0 the tournament would measure "A plus the first
// move" against "B". So every match is played TWICE from the same seed:
// once with A in seat 0, once with A in seat 1. The seat advantage lands
// on both engines exactly equally and cancels out of the totals. `rounds`
// below counts these PAIRS -- N rounds is 2N matches.
//
// THE NOISE PROBLEM. The search is stochastic (seeded, but stochastic), so
// a 12-8 result is what a coin flip does one time in four. The result
// therefore carries a Wilson score interval on the winning share, and
// `decisive` is true only when that interval clears 0.5. A tournament that
// cannot tell the two engines apart says so instead of crowning a winner.
//
// THE COMPUTE PROBLEM. An engine that simply searches longer wins for an
// uninteresting reason, so the runner sums the wall-clock each side spent
// planning and reports it. A large gap there invalidates the comparison
// regardless of the win column.

import { AIEngine } from './AIEngine';
import { runHeadlessMatch } from '../headless';
import type { PlanTurnOptions } from '../search';
import type { MapProvider } from '../../maps/MapProvider';

// Budget for batch play. Far below the live game's per-turn think time --
// the point is many games, and both engines get the same clamp, so the
// comparison stays fair even though both play below their best.
export const TOURNAMENT_BUDGET: Omit<PlanTurnOptions, 'seed'> = {
    population: 16,
    rounds: 3,
    lookaheadPlies: 2,
    replyCandidates: 4,
    finalists: 2,
    deepPlies: 2,
    replyPopulation: 6,
    replyRounds: 1,
};

export interface TournamentOptions {
    provider: MapProvider;
    // Number of seed PAIRS. Each plays two matches, one per seating.
    rounds: number;
    // First seed; round i uses seed + i for both of its seatings.
    seed?: number;
    // Search budget clamp applied to both engines. Defaults to
    // TOURNAMENT_BUDGET; pass {} to let each engine use its own.
    budget?: Omit<PlanTurnOptions, 'seed'>;
    maxTurns?: number;
    // Called as each match finishes, for live progress on long runs.
    onMatch?: (match: TournamentMatch) => void;
}

export interface TournamentMatch {
    round: number;
    seed: number;
    // Engine id per seat; index is playerIndex.
    seats: [string, string];
    // Engine id, or null for a draw.
    winner: string | null;
    reason: string;
    turns: number;
    // Keyed by engine id.
    planMs: Record<string, number>;
}

export interface EngineTally {
    id: string;
    name: string;
    wins: number;
    draws: number;
    losses: number;
    // Win 1, draw 0.5 -- the usual chess scoring, so draws neither inflate
    // nor erase a lead.
    points: number;
    // Wins split by seat, which is how a first-mover effect shows itself.
    winsAsFirst: number;
    winsAsSecond: number;
    planMs: number;
}

export interface TournamentResult {
    a: EngineTally;
    b: EngineTally;
    matches: TournamentMatch[];
    // Wins by SEAT rather than by engine: [seat 0, seat 1]. With the
    // seating swapped every round, a large gap here is the first-mover
    // advantage, visible and separated from engine strength.
    seatWins: [number, number];
    draws: number;
    // A's share of the points, in [0, 1]. 0.5 is a dead heat.
    shareA: number;
    // 95% Wilson interval on shareA.
    interval: [number, number];
    // True when the interval excludes 0.5 -- i.e. the sample is big enough
    // to claim a winner at all.
    decisive: boolean;
    // The engine ahead on points, or null if level.
    leader: string | null;
}

// Wilson score interval, which behaves at small n and at shares near 0 or
// 1 where the normal approximation falls apart. Successes may be
// fractional (a draw is half a win), which the formula tolerates.
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
    if (n <= 0) return [0, 1];
    const p = successes / n;
    const denominator = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denominator;
    const spread = (z / denominator) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}

const emptyTally = (engine: AIEngine): EngineTally => ({
    id: engine.id,
    name: engine.name,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    winsAsFirst: 0,
    winsAsSecond: 0,
    planMs: 0,
});

export function runTournament(a: AIEngine, b: AIEngine, options: TournamentOptions): TournamentResult {
    const {
        provider,
        rounds,
        seed = 1000,
        budget = TOURNAMENT_BUDGET,
        maxTurns,
        onMatch,
    } = options;

    if (a.id === b.id) {
        throw new Error(`runTournament needs two distinct engines; both were "${a.id}"`);
    }

    const tallies: Record<string, EngineTally> = { [a.id]: emptyTally(a), [b.id]: emptyTally(b) };
    const matches: TournamentMatch[] = [];
    const seatWins: [number, number] = [0, 0];
    let draws = 0;

    for (let round = 0; round < rounds; round++) {
        const matchSeed = seed + round;
        // The same seed played from both seatings. Identical map, identical
        // per-turn seeds -- the only thing that changes is who moves first.
        for (const seating of [[a, b], [b, a]] as Array<[AIEngine, AIEngine]>) {
            const result = runHeadlessMatch(provider, {
                seed: matchSeed,
                engines: seating,
                plan: budget,
                ...(maxTurns === undefined ? {} : { maxTurns }),
            });

            const seats: [string, string] = [seating[0].id, seating[1].id];
            const winner = result.winner === -1 ? null : seats[result.winner];

            for (let seat = 0; seat < 2; seat++) {
                tallies[seats[seat]].planMs += result.planMs[seat];
            }

            if (winner === null) {
                draws++;
                for (const id of seats) {
                    tallies[id].draws++;
                    tallies[id].points += 0.5;
                }
            } else {
                seatWins[result.winner]++;
                const loser = seats[1 - result.winner];
                tallies[winner].wins++;
                tallies[winner].points += 1;
                if (result.winner === 0) tallies[winner].winsAsFirst++;
                else tallies[winner].winsAsSecond++;
                tallies[loser].losses++;
            }

            const match: TournamentMatch = {
                round,
                seed: matchSeed,
                seats,
                winner,
                reason: result.reason,
                turns: result.turns,
                planMs: { [seats[0]]: result.planMs[0], [seats[1]]: result.planMs[1] },
            };
            matches.push(match);
            onMatch?.(match);
        }
    }

    const played = matches.length;
    const shareA = played > 0 ? tallies[a.id].points / played : 0.5;
    const interval = wilsonInterval(tallies[a.id].points, played);
    const decisive = interval[0] > 0.5 || interval[1] < 0.5;
    const leader = tallies[a.id].points === tallies[b.id].points
        ? null
        : (tallies[a.id].points > tallies[b.id].points ? a.id : b.id);

    return {
        a: tallies[a.id],
        b: tallies[b.id],
        matches,
        seatWins,
        draws,
        shareA,
        interval,
        decisive,
        leader,
    };
}

// Human-readable summary, shared by the report test and any future CLI so
// there is one place that decides how a result is phrased.
export function formatTournament(a: AIEngine, b: AIEngine, result: TournamentResult): string {
    const lines: string[] = [];
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const played = result.matches.length;

    lines.push(`${a.name} (${a.id}) vs ${b.name} (${b.id}) -- ${played} matches, ${played / 2} seed pairs`);
    lines.push(`  ${a.id}: ${a.notes}`);
    lines.push(`  ${b.id}: ${b.notes}`);
    lines.push('');
    for (const tally of [result.a, result.b]) {
        lines.push(
            `  ${tally.id.padEnd(10)} ${String(tally.wins).padStart(3)}W ` +
            `${String(tally.losses).padStart(3)}L ${String(tally.draws).padStart(3)}D  ` +
            `${tally.points.toFixed(1).padStart(6)} pts  ` +
            `(first ${tally.winsAsFirst}, second ${tally.winsAsSecond})  ` +
            `${(tally.planMs / 1000).toFixed(1)}s thinking`
        );
    }
    lines.push('');
    lines.push(
        `  ${a.id} share ${pct(result.shareA)} ` +
        `[95% ${pct(result.interval[0])}..${pct(result.interval[1])}]`
    );
    lines.push(`  seat wins: first-mover ${result.seatWins[0]}, second ${result.seatWins[1]}, draws ${result.draws}`);

    // Compute parity: a big thinking-time gap invalidates the comparison
    // however clean the win column looks.
    const [slow, fast] = result.a.planMs >= result.b.planMs ? [result.a, result.b] : [result.b, result.a];
    const ratio = fast.planMs > 0 ? slow.planMs / fast.planMs : Infinity;
    lines.push(`  compute parity: ${slow.id} used ${ratio.toFixed(2)}x ${fast.id}'s thinking time`);

    lines.push('');
    if (!result.decisive) {
        lines.push(`  VERDICT: no measurable difference at ${played} matches -- the interval still spans 50%.`);
    } else {
        lines.push(`  VERDICT: ${result.leader} is ahead, and the interval clears 50%.`);
    }
    return lines.join('\n');
}
