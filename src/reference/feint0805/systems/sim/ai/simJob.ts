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
import { randomPlanFor } from '../search';
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
    // Collapse children whose event logs are identical before pruning,
    // keeping the lowest index of each duplicate group. Random plans
    // repeat outcomes constantly -- idle-heavy turns, the same move
    // reached by different gene orders -- and at width 80 the same turn
    // can occupy several of the dozen keep slots. Deduplicated, the slots
    // go to DISTINCT outcomes: effective width up, zero extra rollouts.
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
    // then fetches only its picks. Incompatible with `dedupe`, which has
    // nothing to compare without the logs.
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

    if (job.dedupe && job.meta) {
        // Dedup compares event logs and metadata mode ships none. The
        // planners refuse the flag combination too; this is the backstop.
        throw new Error('SimJob.dedupe and SimJob.meta are mutually exclusive');
    }

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
            value: scoreState(branch, job.scoreFor, weights),
            acted: branch.events.length > parentEventCount,
        });
    }
    const distinct = job.dedupe ? dedupeChildren(children) : children;
    return job.keep ? pruneChildren(distinct, job.keep) : distinct;
}

// Collapse identical outcomes, keeping the FIRST (lowest-index) copy of
// each -- children arrive in index order, so first is lowest. Identity is
// the event log verbatim: two children with the same events reached the
// same board by the same facts, and their values are equal by
// construction. Lowest index rather than any other choice because index
// breaks value ties everywhere else in the beam, so the survivor is the
// copy selection would have preferred anyway.
export function dedupeChildren(children: SimJobChild[]): SimJobChild[] {
    const seen = new Set<string>();
    const distinct: SimJobChild[] = [];
    for (const child of children) {
        const key = JSON.stringify(child.events);
        if (seen.has(key)) continue;
        seen.add(key);
        distinct.push(child);
    }
    return distinct;
}

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
