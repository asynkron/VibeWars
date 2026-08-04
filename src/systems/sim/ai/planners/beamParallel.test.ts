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
import { SimWorkerPool } from '../workerPool';
import { runSimJob, snapshotToWire, snapshotFromWire } from '../simJob';
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
});
