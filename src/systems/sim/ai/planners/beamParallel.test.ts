// A parallel search is only worth having if it plays the same game as the
// serial one. These tests exist to catch the failure that would otherwise
// go unnoticed for a long time: a search that is faster and subtly worse.
//
// Under vitest there is no Worker, so the pool runs its synchronous
// fallback -- which is the point of that fallback existing. It calls the
// SAME runSimJob the worker calls, so what is exercised here is the real
// job code and the real selection, only without the threads.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import { drivePlanner } from '../../search';
import { beamPlanGen } from './beam';
import { beamPlanParallel } from './beamParallel';
import { SimWorkerPool, SimJobRunner } from '../workerPool';
import { runSimJob, snapshotToWire, snapshotFromWire, dedupeChildren, SimJob, SimJobConfig } from '../simJob';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';

const mk = (type: string, q: number, r: number, playerIndex: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange, hasAttacked: false };
};

function board(units: any[], buildings: any[] = [], cols = 12, rows = 12) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units,
        buildings,
    });
}

const BEAM = { depth: 3, childCounts: [12, 6, 4], keepBest: 3, keepWorst: 2, keepOpponent: 1, genesPerUnit: 3 };
const setup = () => board([mk('Bulwark', 3, 3, 0), mk('Nightjar', 4, 2, 0), mk('Halberd', 7, 7, 1), mk('Kestrel', 8, 8, 1)]);

describe('the parallel beam plays the same game as the serial one', () => {
    it('returns the identical plan for the same seed', () => {
        // THE test. Both planners run the same selection over the same
        // seeded children, so the executed turn must match event for event.
        return (async () => {
            for (const seed of [1, 7, 42]) {
                const serial = drivePlanner(beamPlanGen(setup(), 0, { seed, beam: BEAM }));
                const pool = new SimWorkerPool(0);
                const parallel = await beamPlanParallel(setup(), 0, { seed, beam: BEAM }, undefined, pool);
                expect(parallel.events, `seed ${seed}`).toEqual(serial.events);
                expect(parallel.score, `seed ${seed}`).toBeCloseTo(serial.score, 6);
            }
        })();
    }, 60_000);

    it('is deterministic across repeated runs', async () => {
        const run = async () => {
            const pool = new SimWorkerPool(0);
            return (await beamPlanParallel(setup(), 0, { seed: 5, beam: BEAM }, undefined, pool)).events;
        };
        expect(await run()).toEqual(await run());
    }, 60_000);

    it('does not depend on the order results come back in', async () => {
        // Workers answer in whatever order they finish. Shuffling the
        // per-job result arrays must change nothing, because selection
        // sorts by the index the job assigned.
        const pool = new SimWorkerPool(0);
        const shuffling = new SimWorkerPool(0);
        const original = shuffling.run.bind(shuffling);
        (shuffling as any).run = async (jobs: any, config: any) => {
            const results = await original(jobs, config);
            return results.map((group: any[]) => [...group].reverse());
        };
        const a = await beamPlanParallel(setup(), 0, { seed: 11, beam: BEAM }, undefined, pool);
        const b = await beamPlanParallel(setup(), 0, { seed: 11, beam: BEAM }, undefined, shuffling);
        expect(b.events).toEqual(a.events);
    }, 60_000);

    it('reports progress once per level', async () => {
        const pool = new SimWorkerPool(0);
        const seen: number[] = [];
        await beamPlanParallel(setup(), 0, { seed: 3, beam: BEAM }, (p) => seen.push(p.done), pool);
        expect(seen).toEqual([1, 2, 3]);
    }, 60_000);

    it('returns an empty plan for a side with no units', async () => {
        const pool = new SimWorkerPool(0);
        const state = board([mk('Halberd', 7, 7, 1)]);
        const plan = await beamPlanParallel(state, 0, { seed: 1, beam: BEAM }, undefined, pool);
        expect(plan.events).toEqual([]);
    });

    it('refuses to run before it has a snapshot', async () => {
        const pool = new SimWorkerPool(0);
        await expect(pool.run([], {})).rejects.toThrow(/setSnapshot/);
    });
});

describe('chunked dispatch', () => {
    // jsdom has no Worker, and the real pool's fallback deliberately never
    // chunks -- so a stub that CLAIMS to be parallel is the only way to
    // drive the chunk-building and reassembly code at all. It runs the
    // same runSimJob inline, like a pool of very obedient workers.
    const stubRunner = (size: number): SimJobRunner => {
        let snapshot: SimState | null = null;
        return {
            parallel: true,
            size,
            setSnapshot(s: SimState) { snapshot = s; },
            run: async (jobs: SimJob[], config: SimJobConfig) =>
                jobs.map((job) => runSimJob(snapshot!, job, config)),
        };
    };

    it('chunks of a node reproduce the whole node child for child', () => {
        // The seed contract: a child's stream comes from (seed, ABSOLUTE
        // index), so where the chunk boundaries fall cannot matter.
        const state = board([mk('Bulwark', 3, 3, 0), mk('Halberd', 7, 7, 1)]);
        const job = { parentEvents: [], side: 0, scoreFor: 0, resetTurn: false, seed: 5, genesPerUnit: 3 };
        const whole = runSimJob(state, { ...job, count: 30 });
        const chunked = [0, 10, 20].flatMap((start) =>
            runSimJob(state, { ...job, count: 10, startIndex: start }));
        expect(chunked).toEqual(whole);
    });

    it('the chunked planner returns the unchunked plan', async () => {
        // Wide enough that the chunker genuinely splits (MIN_CHUNK is 32),
        // against the serial planner as ground truth -- at the engine's own
        // odd depth and at an even depth, so the final-level readout is
        // held to the identity guarantee too. The dedupe variant holds the
        // cross-chunk second pass to the same standard: a duplicate that
        // survives per-chunk dedup in two chunks at once must still leave
        // the selection the serial planner made.
        const wide = [96, 48, 24];
        for (const seed of [1, 13]) {
            for (const variant of [
                { label: 'odd depth', opts: { beam: BEAM, beamChildCounts: wide } },
                { label: 'even depth', opts: { beam: BEAM, beamChildCounts: wide, beamDepth: 4 } },
                { label: 'dedupe', opts: { beam: { ...BEAM, dedupeChildren: true }, beamChildCounts: wide } },
            ]) {
                const opts = { seed, ...variant.opts };
                const serial = drivePlanner(beamPlanGen(setup(), 0, opts));
                const chunked = await beamPlanParallel(setup(), 0, opts, undefined, stubRunner(4));
                expect(chunked.events, `seed ${seed} ${variant.label}`).toEqual(serial.events);
                expect(chunked.score, `seed ${seed} ${variant.label}`).toBeCloseTo(serial.score, 6);
            }
        }
    }, 60_000);

    it('dedupe collapses identical BOARDS to the lowest-index copy', () => {
        // A single unit with move 1 on open grass: twenty random turns
        // land on a handful of outcomes, so duplicates are guaranteed.
        const state = board([mk('Bulwark', 3, 3, 0), mk('Halberd', 9, 9, 1)]);
        const job = { parentEvents: [], side: 0, scoreFor: 0, resetTurn: false, count: 20, seed: 3, genesPerUnit: 1 };

        const raw = runSimJob(state, job);
        const deduped = runSimJob(state, { ...job, dedupe: true });

        expect(deduped.length).toBeLessThan(raw.length);
        // Same as collapsing the raw run by hand -- replay each raw child
        // and keep the first copy of each resulting BOARD. The comparison
        // strips stateHash first: the raw run was asked for no hashes and
        // the deduped run carries them, and the identity under test is
        // which children survive, not which fields ride along.
        const seen = new Set<string>();
        const manual = raw.filter((child) => {
            const played = state.fork();
            for (const event of child.events) played.record(event);
            const key = played.stateHash;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        expect(deduped.map(({ stateHash, ...rest }) => rest)).toEqual(manual);
    });

    it('dedupe merges different routes to the same board -- the event-log key never could', () => {
        // Two hand-built children: the same two moves in opposite order.
        // Different logs, identical board -- one survivor, the lowest
        // index, and its hash says why.
        const state = board([mk('Bulwark', 3, 3, 0), mk('Lynx', 5, 5, 0), mk('Halberd', 11, 11, 1)]);
        const moveA = { type: 'unitMoved', unitIndex: 0, toQ: 4, toR: 3, moveSpent: 1 } as const;
        const moveB = { type: 'unitMoved', unitIndex: 1, toQ: 6, toR: 5, moveSpent: 1 } as const;

        const oneWay = state.fork();
        oneWay.record(moveA); oneWay.record(moveB);
        const otherWay = state.fork();
        otherWay.record(moveB); otherWay.record(moveA);

        expect(oneWay.stateHash).toBe(otherWay.stateHash);
        // And a board that differs by one hex does NOT collide.
        const different = state.fork();
        different.record(moveA);
        expect(different.stateHash).not.toBe(oneWay.stateHash);

        const asChild = (index: number, events: any[], hash: string) =>
            ({ index, events, value: 0, acted: true, stateHash: hash });
        const survivors = dedupeChildren([
            asChild(0, [moveA, moveB], oneWay.stateHash),
            asChild(1, [moveB, moveA], otherWay.stateHash),
            asChild(2, [moveA], different.stateHash),
        ]);
        expect(survivors.map((child) => child.index)).toEqual([0, 2]);
    });

    it('spread mode selects on metadata, refetches, and matches the serial plan', async () => {
        // The two-phase protocol end to end: round one metadata (chunked),
        // selection in the planner, round two recompute by index. Held to
        // the serial planner at odd and even depths, so the spread rule,
        // the refetch and the final-level readout all sit under the same
        // identity guarantee as everything else.
        const wide = [96, 48, 24];
        for (const seed of [1, 13]) {
            for (const beamDepth of [undefined, 4]) {
                const opts = { seed, beam: { ...BEAM, spreadWorst: true }, beamChildCounts: wide, beamDepth };
                const serial = drivePlanner(beamPlanGen(setup(), 0, opts));
                const chunked = await beamPlanParallel(setup(), 0, opts, undefined, stubRunner(4));
                expect(chunked.events, `seed ${seed} depth ${beamDepth ?? BEAM.depth}`).toEqual(serial.events);
                expect(chunked.score, `seed ${seed} depth ${beamDepth ?? BEAM.depth}`).toBeCloseTo(serial.score, 6);
            }
        }
    }, 60_000);

    it('dedupe and spread compose, and both planners still play the identical game', async () => {
        // These used to be mutually exclusive: dedup compared event logs
        // and the spread's metadata round ships none. The state hash is
        // itself metadata, so the combination is now legal -- and it must
        // be the SAME search in both planners, chunked or not, or an
        // engine could exist that plays differently serial and live.
        const wide = [96, 48, 24];
        const combo = { ...BEAM, spreadWorst: true, dedupeChildren: true };
        for (const seed of [1, 13]) {
            for (const beamDepth of [undefined, 4]) {
                const opts = { seed, beam: combo, beamChildCounts: wide, beamDepth };
                const serial = drivePlanner(beamPlanGen(setup(), 0, opts));
                const chunked = await beamPlanParallel(setup(), 0, opts, undefined, stubRunner(4));
                expect(chunked.events, `seed ${seed} depth ${beamDepth ?? BEAM.depth}`).toEqual(serial.events);
                expect(chunked.score, `seed ${seed} depth ${beamDepth ?? BEAM.depth}`).toBeCloseTo(serial.score, 6);
            }
        }
    }, 60_000);

    it('plays the budget depth, not the engine depth', async () => {
        // REGRESSION: this planner read beam.depth alone, so the live
        // difficulty's depth never reached a real game -- Hard was Feint's
        // own 3, only wider. The serial planner's depth test could not
        // catch it, because only the browser takes this code path.
        const pool = new SimWorkerPool(0);
        const totals: number[] = [];
        await beamPlanParallel(setup(), 0, { seed: 3, beam: BEAM, beamDepth: 5 }, (p) => totals.push(p.total), pool);
        expect(totals).toEqual([5, 5, 5, 5, 5]);
    }, 60_000);
});

describe('the snapshot survives the trip to a worker', () => {
    it('rebuilds tiles, units and buildings unchanged', () => {
        const state = board(
            [mk('Bulwark', 3, 3, 0), mk('Halberd', 7, 7, 1)],
            [{ type: 'factory', q: 5, r: 5, hiddenUnitType: 'Sabre', isEntrance: true }]
        );
        const rebuilt = snapshotFromWire(snapshotToWire(state));

        expect(rebuilt.cols).toBe(state.cols);
        expect(rebuilt.unitCount).toBe(state.unitCount);
        expect(rebuilt.getUnit(0)).toEqual(state.getUnit(0));
        expect(rebuilt.getBuilding(0)).toEqual(state.getBuilding(0));
        expect(rebuilt.getTile(5, 5)).toEqual(state.getTile(5, 5));
    });

    it('keeps a dead unit occupying its index', () => {
        // Events address units BY INDEX, so a hole in the array would
        // silently retarget every later unit's move once the state made the
        // trip to a worker.
        const state = board([mk('Bulwark', 3, 3, 0), mk('Nightjar', 4, 4, 0), mk('Halberd', 7, 7, 1)]);
        state.record({ type: 'unitDied', unitIndex: 1 });
        expect(state.getUnit(1)).toBeNull();

        const rebuilt = snapshotFromWire(snapshotToWire(state));
        expect(rebuilt.unitCount).toBe(3);
        expect(rebuilt.getUnit(2)!.type).toBe('Halberd');
    });
});

describe('runSimJob', () => {
    it('returns only the events of its own turn', () => {
        // The parent's path is already held by the caller; repeating it
        // would double every move when the child's path is assembled.
        const state = board([mk('Bulwark', 3, 3, 0), mk('Halberd', 7, 7, 1)]);
        const parentEvents = [{ type: 'unitMoved' as const, unitIndex: 0, toQ: 4, toR: 3, moveSpent: 1 }];
        const children = runSimJob(state, {
            parentEvents, side: 0, scoreFor: 0, resetTurn: false, count: 3, seed: 9, genesPerUnit: 2,
        });
        expect(children).toHaveLength(3);
        for (const child of children) {
            expect(child.events).not.toContainEqual(parentEvents[0]);
        }
    });

    it('gives each child its index, in order', () => {
        const state = board([mk('Bulwark', 3, 3, 0), mk('Halberd', 7, 7, 1)]);
        const children = runSimJob(state, {
            parentEvents: [], side: 0, scoreFor: 0, resetTurn: false, count: 5, seed: 2, genesPerUnit: 2,
        });
        expect(children.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
    });

    it('is deterministic in its seed', () => {
        const state = board([mk('Bulwark', 3, 3, 0), mk('Halberd', 7, 7, 1)]);
        const job = { parentEvents: [], side: 0, scoreFor: 0, resetTurn: false, count: 4, seed: 77, genesPerUnit: 3 };
        expect(runSimJob(state, job)).toEqual(runSimJob(state, job));
    });

    it('a null sweep means genes are the only guns', () => {
        // Two units standing adjacent, and a dialect that can only roll
        // idle: with the sweep every child shoots anyway, with sweep null
        // nothing ever does. This is the flag quickdraw is built on.
        const adjacent = () => {
            const spot = { q: 4, r: 3 };
            return board([mk('Bulwark', 3, 3, 0), { ...mk('Halberd', spot.q, spot.r, 1) }]);
        };
        const idleOnly = (sweep: any) => ({
            dialect: { weights: [['idle', 1]] as any, extras: {}, focusFireChance: 0, sweep },
        });
        const job = { parentEvents: [], side: 0, scoreFor: 0, resetTurn: false, count: 5, seed: 11, genesPerUnit: 1 };

        const swept = runSimJob(adjacent(), job, idleOnly({ killBonus: 100, friendlyFirePenalty: 1.5 }));
        expect(swept.some((child) => child.events.some((e: any) => e.type === 'unitAttacked'))).toBe(true);

        const unswept = runSimJob(adjacent(), job, idleOnly(null));
        for (const child of unswept) {
            expect(child.events.filter((e: any) => e.type === 'unitAttacked')).toHaveLength(0);
        }
    });
});
