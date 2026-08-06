// A pool of workers that run beam children, with a synchronous fallback.
//
// THE FALLBACK IS NOT A CONVENIENCE. Both paths call the same runSimJob, so
// "parallel" and "serial" cannot compute different things -- and the tests,
// which run under jsdom where Worker is not available, exercise the real
// job code rather than a mock of it. workerPool.test.ts asserts the two
// paths agree child for child.
//
// THE SNAPSHOT GOES ONCE. A SimState is snapshot + event log, so a job
// carries only the events that reach its parent. Sending state per child
// would cost more in structured-clone than the child costs to compute.
//
// ORDER INDEPENDENCE. Results come back in whatever order the workers
// finish, and are re-sorted by the index the job assigned. Two runs with
// the same seed produce the same plan regardless of thread timing, which is
// the only way a parallel search stays comparable to a serial one.

import { SimState } from '../SimState';
import { runSimJob, snapshotToWire, SimJob, SimJobChild, SimJobConfig } from './simJob';

// Leave a core for the main thread: the UI still has to draw while the AI
// thinks, which is half the reason for doing this.
function defaultWorkerCount(): number {
    const cores = (typeof navigator !== 'undefined' && (navigator as any).hardwareConcurrency) || 4;
    return Math.max(1, Math.min(8, cores - 1));
}

interface Pending {
    resolve: (children: SimJobChild[]) => void;
    reject: (error: Error) => void;
}

// What the parallel planner needs from a pool: enough to fan jobs out and
// get ordered results back. SimWorkerPool is the real one; tests hand in a
// stub that claims `parallel: true` and runs runSimJob inline -- the only
// way jsdom (which has no Worker) can exercise the chunked dispatch path,
// since the real pool's fallback deliberately refuses to chunk.
export interface SimJobRunner {
    readonly parallel: boolean;
    // Worker count, 0 when the fallback runs everything on this thread.
    // The planner sizes its chunk fan-out from this.
    readonly size: number;
    setSnapshot(snapshot: SimState): void;
    run(jobs: SimJob[], config: SimJobConfig): Promise<SimJobChild[][]>;
}

export class SimWorkerPool implements SimJobRunner {
    private workers: Worker[] = [];
    private idle: Worker[] = [];
    private queue: Array<{ job: SimJob; config: SimJobConfig; pending: Pending }> = [];
    private pendingById = new Map<number, Pending>();
    private workerOf = new Map<number, Worker>();
    private nextId = 1;
    private snapshot: SimState | null = null;

    // False when Worker is unavailable (jsdom, node) or construction threw.
    // Everything still works; it just runs here.
    readonly parallel: boolean;

    constructor(size: number = defaultWorkerCount()) {
        this.parallel = this.spawn(size);
    }

    get size(): number {
        return this.workers.length;
    }

    private spawn(size: number): boolean {
        if (typeof Worker === 'undefined') return false;
        try {
            for (let i = 0; i < size; i++) {
                const worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = (event: MessageEvent<any>) => this.onMessage(worker, event.data);
                // A worker that dies takes its job with it; fail that job
                // rather than hang the turn forever.
                worker.onerror = () => this.failAllOn(worker, new Error('AI worker crashed'));
                this.workers.push(worker);
            }
            this.idle = [...this.workers];
            return this.workers.length > 0;
        } catch {
            for (const worker of this.workers) worker.terminate();
            this.workers = [];
            this.idle = [];
            return false;
        }
    }

    private onMessage(worker: Worker, message: any): void {
        if (message?.kind === 'ready') return;
        const pending = this.pendingById.get(message?.id);
        if (!pending) return;
        this.pendingById.delete(message.id);
        this.workerOf.delete(message.id);
        this.idle.push(worker);

        if (message.kind === 'done') pending.resolve(message.children);
        else pending.reject(new Error(message?.message ?? 'AI worker failed'));

        this.pump();
    }

    private failAllOn(worker: Worker, error: Error): void {
        for (const [id, w] of [...this.workerOf]) {
            if (w !== worker) continue;
            this.pendingById.get(id)?.reject(error);
            this.pendingById.delete(id);
            this.workerOf.delete(id);
        }
    }

    private pump(): void {
        while (this.queue.length > 0 && this.idle.length > 0) {
            const next = this.queue.shift()!;
            const worker = this.idle.pop()!;
            const id = this.nextId++;
            this.pendingById.set(id, next.pending);
            this.workerOf.set(id, worker);
            worker.postMessage({ kind: 'job', id, job: next.job, config: next.config });
        }
    }

    // Broadcast the turn's snapshot. Call once per turn, before any job.
    setSnapshot(snapshot: SimState): void {
        this.snapshot = snapshot;
        if (!this.parallel) return;
        const wire = snapshotToWire(snapshot);
        for (const worker of this.workers) worker.postMessage({ kind: 'snapshot', wire });
    }

    // Run every job, returning results in the SAME ORDER as the input.
    async run(jobs: SimJob[], config: SimJobConfig): Promise<SimJobChild[][]> {
        if (!this.snapshot) throw new Error('SimWorkerPool.run before setSnapshot');

        if (!this.parallel) {
            // Identical work, on this thread. Yields between jobs so the
            // page can still paint -- the serial path is what a browser
            // without workers gets, and it should not freeze either.
            const results: SimJobChild[][] = [];
            for (const job of jobs) {
                results.push(runSimJob(this.snapshot, job, config));
                await Promise.resolve();
            }
            return results;
        }

        return Promise.all(jobs.map((job) => new Promise<SimJobChild[]>((resolve, reject) => {
            this.queue.push({ job, config, pending: { resolve, reject } });
            this.pump();
        })));
    }

    dispose(): void {
        for (const worker of this.workers) worker.terminate();
        this.workers = [];
        this.idle = [];
        this.queue = [];
        this.pendingById.clear();
        this.workerOf.clear();
    }
}

// One pool for the page: workers are expensive to spawn and the AI plans
// one turn at a time.
let shared: SimWorkerPool | null = null;

export function getSimWorkerPool(): SimWorkerPool {
    if (!shared) shared = new SimWorkerPool();
    return shared;
}
