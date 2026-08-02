import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { GridSystem } from './GridSystem';

interface HeapEntry<T> {
    item: T;
    priority: number;
}

// PriorityQueue implementation using a binary heap
class PriorityQueue<T> {
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

class PathfindingSystem {
    // Heuristic function: calculates hex distance between two HexCoord objects.
    // For axial coordinates, the distance formula is:
    // distance = (|q1 - q2| + |r1 - r2| + |(q1+r1) - (q2+r2)|) / 2.
    static heuristic(a: { q: number; r: number }, b: { q: number; r: number } | null): number {
        if (!b) return 0;
        const dq = Math.abs(a.q - b.q);
        const dr = Math.abs(a.r - b.r);
        const ds = Math.abs((a.q + a.r) - (b.q + b.r));
        return (dq + dr + ds) / 2;
    }

    // Note: Function signature remains the same.
    static dijkstra(startQ: number, startR: number, maxCost: number = Infinity, unit: any, endQ: number | null = null, endR: number | null = null) {
        const distances = new Map<string, number>();
        const previous = new Map<string, string>();
        const reachable = new Set<string>();
        const closedSet = new Set<string>(); // New closed set to track visited nodes

        // Initialize distances for every hex in hexGrid
        GridSystem.hexGrid.forEach((hex: any) => {
            const coord = new HexCoord(hex.userData.q, hex.userData.r);
            const key = coord.getKey();
            distances.set(key, Infinity);
        });

        const startCoord = new HexCoord(startQ, startR);
        const startKey = startCoord.getKey();
        distances.set(startKey, 0);
        reachable.add(startKey);

        // Determine if a target is specified and compute its key
        let endCoord: HexCoord | null = null;
        const endKey = (endQ !== null && endR !== null)
            ? (endCoord = new HexCoord(endQ, endR)).getKey()
            : null;

        // Use a priority queue for the frontier. Priority = current cost + heuristic.
        const frontier = new PriorityQueue<string>();
        frontier.enqueue(startKey, 0 + (endCoord ? this.heuristic(startCoord, endCoord) : 0));

        while (!frontier.isEmpty()) {
            const currentKey = frontier.dequeue()!;

            // Skip if this node has already been fully processed.
            if (closedSet.has(currentKey)) continue;
            closedSet.add(currentKey);

            const currentDistance = distances.get(currentKey)!;

            // If the smallest cost node exceeds maxCost, stop searching.
            if (currentDistance > maxCost) break;
            // If we've reached the target, break out.
            if (endKey && currentKey === endKey) break;

            const currentCoord = HexCoord.fromKey(currentKey);
            const currentHex = currentCoord.getHex();
            if (!currentHex) continue;

            // Get neighbors (you may pass a visited set if your implementation supports it)
            const validNeighbors = currentCoord.getValidNeighbors();

            validNeighbors.forEach(({ coord, hex }: { coord: HexCoord; hex: any }) => {
                if (coord.isOccupied()) return;

                const neighborKey = coord.getKey();
                // Skip neighbors that have already been processed.
                if (closedSet.has(neighborKey)) return;

                const cost = TerrainSystem.getMoveCost(hex, unit);
                // Skip if terrain is impassable (null or 0 cost)
                if (!cost) return;

                const newDistance = currentDistance + cost;
                if (newDistance < distances.get(neighborKey)!) {
                    distances.set(neighborKey, newDistance);
                    previous.set(neighborKey, currentKey);
                    if (newDistance <= maxCost) {
                        reachable.add(neighborKey);
                        // Priority is new cost plus heuristic distance to target (if available)
                        const h = endCoord ? this.heuristic(coord, endCoord) : 0;
                        frontier.enqueue(neighborKey, newDistance + h);
                    }
                }
            });
        }

        return { distances, previous, reachable };
    }

    // getPath remains unchanged in its API.
    static getPath(q1: number, r1: number, q2: number, r2: number, move: number, unit: any): any[] {
        const startCoord = new HexCoord(q1, r1);
        const endCoord = new HexCoord(q2, r2);

        const { previous, reachable } = this.dijkstra(startCoord.q, startCoord.r, move, unit, q2, r2);
        const path: any[] = [];
        let currentKey = endCoord.getKey();

        if (!reachable.has(currentKey)) {
            return [];
        }

        while (previous.has(currentKey)) {
            const coord = HexCoord.fromKey(currentKey);
            const hex = coord.getHex();
            if (hex) {
                path.unshift(hex);
            }
            currentKey = previous.get(currentKey)!;
        }

        const startHex = startCoord.getHex();
        if (startHex) {
            path.unshift(startHex);
        }

        return path.slice(1);
    }

}

export { PathfindingSystem };
