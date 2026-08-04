// Extracted to priorityQueue.ts, which imports nothing -- see there.
export { PriorityQueue } from './priorityQueue';
import { PriorityQueue } from './priorityQueue';
import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { GridSystem } from './GridSystem';



// PriorityQueue implementation using a binary heap


class PathfindingSystem {
    // Heuristic function: estimates hex distance between two grid coordinates
    // for A*'s priority ordering. Delegates to HexCoord.getDistance, which
    // converts q/r (odd-q offset coordinates, not axial) to cube coordinates
    // before computing distance -- applying an axial distance formula
    // directly to offset coordinates, as this used to do, undercounts
    // distance across a column-shift boundary and produces an inadmissible
    // heuristic in that direction.
    static heuristic(a: { q: number; r: number }, b: { q: number; r: number } | null): number {
        if (!b) return 0;
        // Scaled by the CHEAPEST possible step cost (roads: 0.5). With the
        // raw hex distance the heuristic OVERESTIMATES along roads (h says
        // 1/step, reality is 0.5/step) -- inadmissible A* then reports
        // inflated path costs, and callers with a move budget (getPath's
        // maxCost) see "unreachable" for road paths the AI simulation
        // (plain Dijkstra, no heuristic) correctly found. That silent
        // divergence made replayed AI moves -- and the attacks that
        // depended on them -- vanish.
        return 0.5 * HexCoord.getDistance(a.q, a.r, b.q, b.r);
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
