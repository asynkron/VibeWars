// One unit of AI work, defined so it can run either on the main thread or
// in a worker WITHOUT the two being different code.
//
// THE GRANULARITY. The beam generates `count` independent children per
// node: fork, apply a random turn, sweep attacks, score. Those are the
// fan-out. Shipping a whole SimState per child would spend more on
// structured-clone than the child costs to compute, so nothing is shipped:
// a SimState IS `snapshot + event log`, so a node is fully identified by
// the events that got it there. The snapshot goes to each worker ONCE per
// turn; a job is a short event list plus a seed.
//
// DETERMINISM. Every child's seed derives from (jobSeed, childIndex), and
// results carry their childIndex back, so the caller can order them by
// index rather than by whichever worker answered first. Two runs with the
// same seeds produce the same plan whatever the thread timing did -- which
// is what makes a parallel search comparable to a serial one at all.

import { SimState, GameEvent } from '../SimState';
import { randomPlanFor, FireForesight } from '../search';
import { applyGene, sweepAttacks, GeneDialect, DEFAULT_DIALECT, startTurn} from '../SimCommands';
import { scoreState, ScoreWeights, DEFAULT_SCORE_WEIGHTS } from '../score';
import { mulberry32, combineSeed } from '../resolveAttack';
import { extrasFromKinds } from './genes/registry';

export interface SimJob {
    // Events replayed onto the snapshot to reach the parent node. Empty at
    // depth 0.
    parentEvents: readonly GameEvent[];
    // Whose turn this level simulates.
    side: number;
    // The side the SCORE is from -- always the searching player, at every
    // depth, so one number is comparable all the way down.
    scoreFor: number;
    // Whether this level needs a turnStarted first (every depth but 0).
    resetTurn: boolean;
    count: number;
    seed: number;
    genesPerUnit: number;
    // First child index this job covers, for a job that is one CHUNK of a
    // node's children. Child seeds derive from (seed, ABSOLUTE index), so a
    // node split across workers produces bit-identical children to the same
    // node run whole -- which is what lets the planner chunk a wide level
    // without the plan changing. Omitted means 0: the whole node.
    startIndex?: number;
    // Collapse children whose RESULTING BOARD is identical before pruning,
    // keeping the lowest index of each duplicate group. Random plans
    // repeat outcomes constantly -- idle-heavy turns, the same board
    // reached by different gene orders -- and at width 80 the same turn
    // can occupy several of the dozen keep slots. Deduplicated, the slots
    // go to DISTINCT outcomes: effective width up, zero extra rollouts.
    //
    // Identity is a STATE HASH (see SimState.stateHash), not the event log the
    // first draft compared: two children that walked different routes to
    // the same board are the same outcome to the search, and an event-log
    // key kept both. The hash is also what lets dedup ride the metadata
    // round -- a hash is metadata -- which is what dissolved the old
    // mutual exclusion between dedupe and the spread protocol.
    //
    // BEFORE pruning, not after, or the pruned dozen could be one outcome
    // seven times. The planner runs a second pass across chunk boundaries;
    // together they select exactly what an unchunked dedup would -- see
    // the chunked identity test.
    dedupe?: boolean;
    // Metadata mode: every child comes back as (index, value, acted) with
    // an EMPTY events array. The rollouts still run in full -- the value
    // has to come from somewhere -- but nothing heavy crosses the wire.
    // This is round one of the spread-sacrifice protocol: selection needs
    // the WHOLE ranking, and shipping whole rankings is the exact cost the
    // keep-pruning exists to avoid, so the planner selects on metadata and
    // then fetches only its picks. Composes with `dedupe`: the state hash
    // rides along as metadata, so duplicates collapse before selection
    // even though no logs are shipped.
    meta?: boolean;
    // Round two: recompute exactly these ABSOLUTE child indices, events
    // included. A child is a pure function of (seed, index) -- the same
    // fact that lets chunks split a node -- so re-running a dozen picks
    // costs a dozen rollouts, not a shipped level. count/startIndex are
    // ignored when this is present.
    indices?: readonly number[];
    // How many children the caller can possibly select, so the rest never
    // have to be shipped. Optional: omitted means "return everything", which
    // is what the tests and any non-beam caller want.
    //
    // A profiled 20-second search moved 30.8 MB from the workers and threw
    // away 99.8% of it -- 1900 children per job, each carrying a full event
    // array, structured-cloned on both sides, sorted, and discarded down to
    // a handful. The deserialize is what shows up as main-thread long tasks
    // during "AI thinking" even though the search itself runs off-thread.
    keep?: SimJobKeep;
}

// The three slices a beam level can take. Named after the beam's own options
// because they must be the same numbers -- see pruneChildren.
export interface SimJobKeep {
    best: number;
    worst: number;
    opponent: number;
}

export interface SimJobChild {
    // Position in the job, so results can be ordered independently of
    // arrival. See the header.
    index: number;
    // The events of THIS child's turn only, not including parentEvents.
    // Empty in metadata mode even when the turn acted -- see SimJob.meta.
    events: GameEvent[];
    value: number;
    // Whether this child's turn did anything. Derivable from events when
    // they are shipped; carried explicitly because metadata-mode children
    // ship without them and the opponent selection still needs the fact.
    acted: boolean;
    // Hash of the board this child's turn produced -- see
    // SimState.stateHash.
    // Present only when the job asked for dedup (it is what dedup keys
    // on), absent otherwise so the common path pays nothing for it. Plain
    // data, so it crosses postMessage with the rest of the child.
    stateHash?: string;
}

// Everything a job needs that is not the snapshot. Kept separate because
// the snapshot is sent once and this rides along with each job.
export interface SimJobConfig {
    dialect?: GeneDialect;
    // The custom genes, BY NAME, for the config that crosses postMessage.
    // A dialect's own `extras` holds functions, which structured clone
    // refuses -- see genes/registry.ts. When this is present it replaces
    // whatever `dialect.extras` says; the serial callers omit it and pass
    // their dialect whole.
    extraKinds?: readonly string[];
    score?: ScoreWeights;
    // Frozen-future foresight -- see PlanTurnOptions.foresight and
    // frozenFutureValue below. Plain data, crosses postMessage.
    foresight?: FireForesight;
}

// Run one job against a snapshot. Pure: same inputs, same output, on any
// thread.
export function runSimJob(snapshot: SimState, job: SimJob, config: SimJobConfig = {}): SimJobChild[] {
    const base = config.dialect ?? DEFAULT_DIALECT;
    // Rebuilt on this side of the wire when the caller sent names. Done
    // here rather than in the worker entry point so both paths -- serial
    // beam and parallel pool -- run the identical assembly, which is what
    // beamParallel.test.ts's serial-vs-parallel identity check rests on.
    const dialect = config.extraKinds
        ? { ...base, extras: extrasFromKinds(config.extraKinds) }
        : base;
    const weights = config.score ?? DEFAULT_SCORE_WEIGHTS;

    // Replay to the parent once, then fork per child -- forking shares the
    // frozen base and copies only the log, so this is far cheaper than
    // replaying the parent `count` times.
    const parent = snapshot.fork();
    for (const event of job.parentEvents) parent.record(event);
    const parentEventCount = parent.events.length;

    const first = job.startIndex ?? 0;
    const wanted: readonly number[] = job.indices
        ?? Array.from({ length: job.count }, (_, offset) => first + offset);
    const children: SimJobChild[] = [];
    for (const index of wanted) {
        const branch = parent.fork();
        // The child's own stream, created BEFORE the reset because the turn
        // start now rolls the wildfire and must draw from it. Serial and
        // parallel share this function, which is what keeps a beam node's
        // board identical however it was evaluated -- including a round-two
        // recompute by index, which must land on the same board the
        // metadata round scored.
        const rng = mulberry32(combineSeed(job.seed, index));
        if (job.resetTurn) startTurn(branch, job.side, rng);

        for (const gene of randomPlanFor(branch, job.side, rng, job.genesPerUnit, dialect)) {
            applyGene(branch, gene, dialect.extras);
        }
        // A null sweep is an engine that shoots only through its genes --
        // see GeneDialect.sweep.
        if (dialect.sweep) sweepAttacks(branch, job.side, dialect.sweep);

        children.push({
            index,
            // Only what THIS turn added; the caller already holds the rest.
            events: job.meta ? [] : branch.events.slice(parentEventCount),
            value: frozenFutureValue(branch, job, weights, config.foresight),
            acted: branch.events.length > parentEventCount,
            // O(1): SimState maintains the hash incrementally as events
            // apply -- see SimState.stateHash. Shipped only when dedup
            // will compare it. All of a job's branches fork the same
            // parent, which is the hash's comparability requirement.
            ...(job.dedupe ? { stateHash: branch.stateHash } : {}),
        });
    }
    const distinct = job.dedupe ? dedupeChildren(children) : children;
    return job.keep ? pruneChildren(distinct, job.keep) : distinct;
}

// -------- Frozen-future foresight. --------
//
// Score the child's board, and -- when fire is on it -- also the board
// `foresight.turns` DECISION-FREE turns later: alternating startTurns with
// no genes, so the only things that happen are the passive dynamics the
// turn reset owns (fire spreads and ages, units standing in flame burn
// and die, cooldowns tick, factory repair drips). The returned value is
// now + weight * (future - now).
//
// This is the quiescence idea applied to physics instead of captures: a
// lit fire is a FORCED sequence whose payoff needs ~15 turns but zero
// decisions, so the beam can see it at depth 3 for the price of ticking
// the fire rules -- no recursive search, no children, no replies. The
// discount weight is honesty about the freeze: nobody dodges in this
// future, so it overstates flame damage against anything mobile.
//
// Guarded on hasFire, which makes it FREE on the boards that have no fire
// -- almost every board, almost all of the time -- and bit-identical to
// not existing at all: the value path does not even fork. The rollout
// also stops early the moment the last flame burns out, so the cost is
// bounded by the fire's own lifetime, not by `turns`.
//
// DETERMINISM. The frozen dice derive from (job.seed, side) alone -- NOT
// from the child index -- so every child of a node faces the same future
// weather and differences in value come only from differences on their
// boards. It also keeps the serial planner, the chunked planner and a
// round-two recompute bit-identical, same as every other seed here.
function frozenFutureValue(
    branch: SimState,
    job: SimJob,
    weights: ScoreWeights,
    foresight: FireForesight | undefined
): number {
    const now = scoreState(branch, job.scoreFor, weights);
    if (!foresight || foresight.weight === 0) return now;
    // The two passive dynamics worth rolling forward: fire, and factory
    // production (a delivery due in N owner-turns arrives in the frozen
    // future and scores as the material it is -- which is what makes an
    // owned factory worth holding and a blocked one worth besieging).
    // Neither present: free, and the value path does not even fork.
    if (!branch.hasFire && !branch.hasProduction) return now;

    const future = branch.fork();
    const rng = mulberry32(combineSeed(job.seed, 0x50f7));
    for (let tick = 0; tick < foresight.turns; tick++) {
        if (!future.hasFire && !future.hasProduction) break;
        startTurn(future, (job.side + 1 + tick) % 2, rng);
    }
    return now + foresight.weight * (scoreState(future, job.scoreFor, weights) - now);
}

// Collapse identical outcomes, keeping the FIRST (lowest-index) copy of
// each -- children arrive in index order, so first is lowest. Identity is
// the RESULTING BOARD, via the child's stateHash: two children whose turns
// leave the same board are the same outcome whatever route their events
// took, and their values are equal by construction because the score is a
// function of the state. (Children built without a hash -- tests, older
// callers -- fall back to the event log verbatim, which is the stricter
// key: it never merges what the hash would keep apart.) Lowest index
// rather than any other choice because index breaks value ties everywhere
// else in the beam, so the survivor is the copy selection would have
// preferred anyway.
export function dedupeChildren(children: SimJobChild[]): SimJobChild[] {
    const seen = new Set<string>();
    const distinct: SimJobChild[] = [];
    for (const child of children) {
        const key = child.stateHash ?? JSON.stringify(child.events);
        if (seen.has(key)) continue;
        seen.add(key);
        distinct.push(child);
    }
    return distinct;
}

// The state hash dedup keys on lives in SimState (see SimState.stateHash):
// maintained incrementally as events apply, so reading it here is O(1)
// per child instead of a walk over the whole board. The first draft
// walked -- every unit, every building, all 216 tiles, per child -- and
// the walk measured 1.53x total thinking time for rollouts it saved that
// were cheaper than itself.

// The snapshot as plain data, for structured-clone to a worker. SimState
// holds no functions, but it is a class instance with private fields, so
// it is rebuilt on the far side rather than cloned directly.
export interface SnapshotWire {
    cols: number;
    rows: number;
    tiles: any[];
    units: any[];
    buildings: any[];
}

export function snapshotToWire(state: SimState): SnapshotWire {
    const tiles: any[] = [];
    for (let r = 0; r < state.rows; r++) {
        for (let q = 0; q < state.cols; q++) tiles.push({ ...state.getTile(q, r) });
    }
    const units: any[] = [];
    for (let i = 0; i < state.unitCount; i++) {
        const unit = state.getUnit(i);
        // Dead units must keep their INDEX -- events address units by it --
        // so a hole is sent as a corpse at 0 hp rather than dropped.
        units.push(unit ? { ...unit } : { type: 'Bulwark', q: 0, r: 0, playerIndex: 0, hp: 0, maxHp: 1, move: 0, attack: 0, minRange: 1, maxRange: 1, hasAttacked: true });
    }
    const buildings: any[] = [];
    for (let i = 0; i < state.buildingCount; i++) buildings.push({ ...state.getBuilding(i) });
    return { cols: state.cols, rows: state.rows, tiles, units, buildings };
}

export function snapshotFromWire(wire: SnapshotWire): SimState {
    return SimState.snapshot({
        map: {
            cols: wire.cols,
            rows: wire.rows,
            getTile: (q: number, r: number) => wire.tiles[r * wire.cols + q],
        },
        units: wire.units,
        buildings: wire.buildings,
    });
}


// Everything the caller could still choose, and nothing else.
//
// A SUPERSET, NOT A TOP-K. The obvious pruning -- return the best `keepBest`
// -- would silently delete the beam's sacrifice slots: it keeps the WORST
// children alongside the best on purpose, because a move that scores badly
// now is exactly the one whose consequences need playing out, and greedy
// selection deletes it first. It would also break the opponent levels, which
// take the worst children of those that ACTED, and an idle child can be
// globally worst without being in that set.
//
// So all three slices come home, sorted the way the caller sorts. The caller
// re-sorts and slices as before and cannot tell the difference -- which the
// neutrality fixtures check, since they hash the event log of whole matches
// played by this beam.
function pruneChildren(children: SimJobChild[], keep: SimJobKeep): SimJobChild[] {
    const total = keep.best + keep.worst + keep.opponent;
    if (children.length <= total) return children;

    // The caller's comparator, exactly: value descending, index breaking ties.
    const sorted = [...children].sort((a, b) => b.value - a.value || a.index - b.index);

    const chosen = new Set<SimJobChild>();
    for (const child of sorted.slice(0, keep.best)) chosen.add(child);
    if (keep.worst > 0) {
        for (const child of sorted.slice(keep.best).slice(-keep.worst)) chosen.add(child);
    }
    if (keep.opponent > 0) {
        // The same acted test beam.ts makes, off the explicit flag now that
        // metadata-mode children can act without shipping their events.
        const acting = sorted.filter((child) => child.acted);
        const pool = acting.length > 0 ? acting : sorted;
        for (const child of pool.slice(-keep.opponent)) chosen.add(child);
    }

    // Back into job order, so nothing downstream can depend on arrival.
    return [...chosen].sort((a, b) => a.index - b.index);
}
