// Factory production: the whole rule, in one place, for both sides of
// the game -- the same split fire.ts made, for the same reason: every
// rule written twice in this codebase has drifted.
//
// THE RULE. An owned factory (entrance piece) with a known product line
// delivers one unit of that line every PRODUCTION_INTERVAL of its
// owner's turns. The countdown ticks at the owner's turn start; capture
// resets it, so a conqueror waits a full cycle for the first delivery.
// The unit appears on the entrance hex itself when nothing stands there,
// otherwise on the first free, walkable neighbour -- and when everything
// is blocked, production WAITS (the countdown holds at due) and tries
// again next turn. Blocking a factory's door is therefore a real siege
// tactic, on both sides of the rule.
//
// WHAT THE PRODUCT LINE IS. The factory's hidden capture prize is also
// its product: a factory that yielded a Sabre keeps building Sabres.
// The simulation is deliberately blind to an UNOPENED factory's content
// (see SimState.snapshot), so when a search line captures a factory
// inside a rollout, its product line becomes EXPECTED_PRODUCT -- the
// same "an average unit" expectation captureYield already prices --
// while the live game records the real type at yield time and the next
// snapshot corrects the guess. A factory authored with no hidden unit
// has no product line and never produces.
//
// Everything here is pure and import-free from the renderer: the AI
// searches over it inside a Web Worker.

import { hexNeighbors } from './hexMath';
import { unitTypesRecord } from './unitStats';

// Owner turns between deliveries.
export const PRODUCTION_INTERVAL = 4;

// What a rollout assumes a factory it just captured will build -- the
// mid-tier stand-in the score's captureYield expectation is also priced
// on. The live game never spawns this guess; it knows the real type.
export const EXPECTED_PRODUCT = 'Sabre';

// The board face this module needs -- SimState and the live GameState
// both satisfy it structurally.
export interface ProductionBoard {
    getTile(q: number, r: number): { type: string } | null;
    // Truthy when a unit stands on the hex (cargo excluded, as both
    // sides' getUnitAt already do).
    isOccupied(q: number, r: number): boolean;
    // Truthy when a standing building occupies the hex.
    isBuilding(q: number, r: number): boolean;
}

// Where the delivered unit appears: the entrance hex itself first, then
// the neighbours in hexNeighbors order (stable, so the choice is
// deterministic -- a replayed plan and the live game must agree). Null
// means everything is blocked and production waits.
export function pickProductionSpot(
    board: ProductionBoard,
    entrance: { q: number; r: number },
    unitType: string
): { q: number; r: number } | null {
    const costs = unitTypesRecord[unitType]?.terrainCosts;
    if (!costs) return null;
    const walkable = (q: number, r: number): boolean => {
        const tile = board.getTile(q, r);
        return !!tile && costs[tile.type] != null;
    };
    if (walkable(entrance.q, entrance.r) && !board.isOccupied(entrance.q, entrance.r)) {
        return { q: entrance.q, r: entrance.r };
    }
    for (const spot of hexNeighbors(entrance.q, entrance.r)) {
        if (!walkable(spot.q, spot.r)) continue;
        if (board.isOccupied(spot.q, spot.r)) continue;
        // Not onto another building's tile -- the yield rule's convention.
        if (board.isBuilding(spot.q, spot.r)) continue;
        return spot;
    }
    return null;
}
