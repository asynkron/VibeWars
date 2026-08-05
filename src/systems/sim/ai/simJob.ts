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
    events: GameEvent[];
    value: number;
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

    const children: SimJobChild[] = [];
    for (let index = 0; index < job.count; index++) {
        const branch = parent.fork();
        // The child's own stream, created BEFORE the reset because the turn
        // start now rolls the wildfire and must draw from it. Serial and
        // parallel share this function, which is what keeps a beam node's
        // board identical however it was evaluated.
        const rng = mulberry32(combineSeed(job.seed, index));
        if (job.resetTurn) startTurn(branch, job.side, rng);

        for (const gene of randomPlanFor(branch, job.side, rng, job.genesPerUnit, dialect)) {
            applyGene(branch, gene, dialect.extras);
        }
        sweepAttacks(branch, job.side, dialect.sweep);

        children.push({
            index,
            // Only what THIS turn added; the caller already holds the rest.
            events: branch.events.slice(parentEventCount),
            value: scoreState(branch, job.scoreFor, weights),
        });
    }
    return job.keep ? pruneChildren(children, job.keep) : children;
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
        // `acted` is events.length > 0, the same test beam.ts makes.
        const acting = sorted.filter((child) => child.events.length > 0);
        const pool = acting.length > 0 ? acting : sorted;
        for (const child of pool.slice(-keep.opponent)) chosen.add(child);
    }

    // Back into job order, so nothing downstream can depend on arrival.
    return [...chosen].sort((a, b) => a.index - b.index);
}
