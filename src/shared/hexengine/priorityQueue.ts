// A binary-heap priority queue -- pure data structure, no imports.
//
// It lived in PathfindingSystem, which imports HexCoord, TerrainSystem and
// GridSystem, so the simulation layer pulled the whole renderer in to get
// a heap. PathfindingSystem re-exports it, so its own callers are
// unchanged. See systems/sim/workerSafety.test.ts for why this matters.

export interface HeapEntry<T> {
    item: T;
    priority: number;
}

export class PriorityQueue<T> {
    heap: HeapEntry<T>[];

    constructor() {
        this.heap = [];
    }

    enqueue(item: T, priority: number): void {
        this.heap.push({ item, priority });
        this._bubbleUp(this.heap.length - 1);
    }

    dequeue(): T | null {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const end = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = end;
            this._sinkDown(0);
        }
        return min.item;
    }

    isEmpty(): boolean {
        return this.heap.length === 0;
    }

    _bubbleUp(n: number): void {
        const element = this.heap[n];
        while (n > 0) {
            const parentN = Math.floor((n - 1) / 2);
            const parent = this.heap[parentN];
            if (element.priority >= parent.priority) break;
            this.heap[parentN] = element;
            this.heap[n] = parent;
            n = parentN;
        }
    }

    _sinkDown(n: number): void {
        const length = this.heap.length;
        const element = this.heap[n];
        while (true) {
            let leftN = 2 * n + 1;
            let rightN = 2 * n + 2;
            let swap: number | null = null;

            if (leftN < length) {
                const left = this.heap[leftN];
                if (left.priority < element.priority) {
                    swap = leftN;
                }
            }
            if (rightN < length) {
                const right = this.heap[rightN];
                if (
                    (swap === null && right.priority < element.priority) ||
                    (swap !== null && right.priority < this.heap[swap].priority)
                ) {
                    swap = rightN;
                }
            }
            if (swap === null) break;
            this.heap[n] = this.heap[swap];
            this.heap[swap] = element;
            n = swap;
        }
    }
}
