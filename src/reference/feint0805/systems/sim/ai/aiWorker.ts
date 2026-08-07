// The worker end of the parallel search. Deliberately thin: it holds the
// turn's snapshot and calls runSimJob, which is the same function the
// main-thread fallback calls. Nothing about the search lives here, so the
// two paths cannot drift.
//
// This file only loads because the simulation layer was cut free of the
// renderer -- a worker has no canvas, and importing anything that
// constructs a WebGLRenderer or a TextureLoader would fail at module
// evaluation. systems/sim/workerSafety.test.ts is what keeps that true.

import { SimState } from '../SimState';
import { runSimJob, snapshotFromWire, SimJob, SimJobConfig, SnapshotWire } from './simJob';

let snapshot: SimState | null = null;

type Incoming =
    | { kind: 'snapshot'; wire: SnapshotWire }
    | { kind: 'job'; id: number; job: SimJob; config: SimJobConfig };

self.onmessage = (event: MessageEvent<Incoming>) => {
    const message = event.data;

    if (message.kind === 'snapshot') {
        snapshot = snapshotFromWire(message.wire);
        (self as any).postMessage({ kind: 'ready' });
        return;
    }

    if (message.kind === 'job') {
        if (!snapshot) {
            // A job before a snapshot is a protocol bug in the pool, not a
            // recoverable state -- say so rather than return empty results
            // the search would silently treat as "no good moves".
            (self as any).postMessage({ kind: 'error', id: message.id, message: 'job before snapshot' });
            return;
        }
        try {
            const children = runSimJob(snapshot, message.job, message.config);
            (self as any).postMessage({ kind: 'done', id: message.id, children });
        } catch (error: any) {
            (self as any).postMessage({ kind: 'error', id: message.id, message: String(error?.message ?? error) });
        }
    }
};
