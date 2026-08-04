// HOLD DOOR -- park on the enemy's way into a depot so they cannot take it.
//
// A composite building is captured from exactly one hex, its isEntrance
// piece, and SimCommands only records a capture when a canCapture unit
// lands there. simDijkstra treats an occupied hex as impassable, so a body
// standing on the door does not merely discourage the capture -- it makes
// it unreachable while it lives.
//
// Nothing expresses that. moveToBuilding is the only gene that knows an
// entrance exists, and it exists to TAKE one: it is guarded on
// unitCanCapture and skips buildings the side already owns. So the intent
// "I cannot capture this, but I can stop you" has no way of being said, and
// no combination of moveTowards and standoff produces it except by the
// coincidence of a unit's cheapest aggressive move happening to be that
// exact hex.
//
// It is deliberately for units that CANNOT capture. Infantry standing on an
// unowned entrance captures it outright, which is strictly better and is
// what moveToBuilding is already for.
//
// The score already prices this move honestly, which is why the gene can be
// left to propose it without a thumb on the scale: score.ts docks
// buildingBlockPenalty for an own non-capturing unit sitting on an unowned
// entrance, because it blocks OUR infantry too. Against that the rollout
// weighs what the enemy taking the depot would cost -- buildingOwned plus
// captureYield, an order of magnitude more. The search decides; the gene
// only makes the option sayable.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { SimState } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const HOLD_DOOR = 'holdDoor';

function canCapture(state: SimState, unitIndex: number): boolean {
    const unit = state.getUnit(unitIndex);
    return !!unit && !!UnitSystem.unitTypesRecord[unit.type]?.canCapture;
}

// A door worth denying: a standing entrance this side does not own, that
// some enemy unit could actually walk into. Ours already being owned is not
// enough to skip it -- an owned depot can be RE-taken, and holding its door
// denies that too.
function doorToDeny(state: SimState, unitIndex: number): { q: number; r: number } | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;

    let threatened = false;
    for (const [, enemy] of state.liveUnits()) {
        if (enemy.playerIndex === unit.playerIndex) continue;
        if (UnitSystem.unitTypesRecord[enemy.type]?.canCapture) { threatened = true; break; }
    }
    if (!threatened) return null;

    let best: { q: number; r: number } | null = null;
    let bestDist = Infinity;
    for (const [, building] of state.liveBuildings()) {
        if (!building.isEntrance) continue;
        // Someone already standing there is holding it, including us.
        if (state.getUnitAt(building.q, building.r)) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, building.q, building.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = { q: building.q, r: building.r };
        }
    }
    return best;
}

export const holdDoorGene: GeneDefinition = {
    // Capturing units have moveToBuilding, which is strictly better for
    // them; without an enemy that can capture there is nothing to deny.
    applicable(state, unitIndex) {
        if (canCapture(state, unitIndex)) return false;
        return doorToDeny(state, unitIndex) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.move <= 0) return false;
        if (canCapture(state, gene.unitIndex)) return false;
        const door = doorToDeny(state, gene.unitIndex);
        if (!door) return false;

        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);

        // Only the door itself denies anything -- standing next to it stops
        // nothing, since the enemy walks past. So this gene either reaches
        // the hex or does not fire, unlike the movement genes that inch
        // toward a target over several turns.
        const key = `${door.q},${door.r}`;
        if (!reachable.has(key)) return false;
        if (door.q === unit.q && door.r === unit.r) return false;

        recordSimMove(state, gene.unitIndex, door.q, door.r, distances.get(key)!);
        return true;
    },
};
