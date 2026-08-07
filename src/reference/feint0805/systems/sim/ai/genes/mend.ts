// MEND -- withdraw to a building we already own, and heal.
//
// This is the one gene whose absence can be pointed at in a single line.
// SimState.FACTORY_REPAIR_HP is 2: a unit that STARTS its turn standing on a
// building its own side holds gets two hit points back, and the simulation
// applies it in the turnStarted branch, so the beam can already SEE the
// benefit. It just has no way to propose it, because
// nearestCapturableBuildingIndex -- the target finder every
// moveToBuilding gene resolves through -- skips them:
//
//     if (building.ownerIndex === unit.playerIndex) continue;
//
// Every other movement gene is oriented on an enemy. So "pull back to our
// depot" is not merely unlikely for the search to assemble; it is
// unsayable. That is the bar a new gene has to clear, and three earlier
// genes that merely rephrased something moveTowards could reach all
// measured as no difference.
//
// Two hit points is worth 20 points of score at hpWeight 10, and more than
// that in practice: a Kestrel at 1 hp dies to anything, and at 3 it is a
// full-strength artillery piece again. The gene only proposes the move --
// whether spending a turn on it beats spending it shooting is exactly what
// the search is for.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import { SimState } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const MEND = 'mend';

// The nearest standing building this side owns. Unlike the capture finder
// this wants OUR buildings, and does not care about the entrance: healing
// happens on any piece of the structure, so a depot's back wall mends just
// as well as its door -- and is likely to be the safer place to stand.
function nearestOwnBuilding(state: SimState, unitIndex: number): { q: number; r: number } | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: { q: number; r: number } | null = null;
    let bestDist = Infinity;
    for (const [, building] of state.liveBuildings()) {
        if (building.ownerIndex !== unit.playerIndex) continue;
        const dist = HexCoord.getDistance(unit.q, unit.r, building.q, building.r);
        if (dist < bestDist) {
            bestDist = dist;
            best = { q: building.q, r: building.r };
        }
    }
    return best;
}

export const mendGene: GeneDefinition = {
    // Only a hurt unit, and only if there is somewhere to heal. A
    // full-health unit walking home is pure waste, and randomGene rerolls
    // this to moveTowards.
    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hp >= unit.maxHp) return false;
        return nearestOwnBuilding(state, unitIndex) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.move <= 0 || unit.hp >= unit.maxHp) return false;
        const home = nearestOwnBuilding(state, gene.unitIndex);
        if (!home) return false;

        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);

        // Standing still is the bar to beat, as in every movement gene: a
        // gene that "acts" without improving anything burns movement the
        // rest of the plan could have used. Reaching the tile exactly is
        // what pays -- the heal is for standing ON it -- so plain distance
        // is the right measure and landing on it wins outright at 0.
        const cols = state.cols;
        const startKey = unit.r * cols + unit.q;
        let bestDist = HexCoord.getDistance(unit.q, unit.r, home.q, home.r);
        let bestCost = Infinity;
        let bestKey: number | null = null;

        for (const key of reachable) {
            if (key === startKey) continue;
            const q = key % cols;
            const dist = HexCoord.getDistance(q, (key - q) / cols, home.q, home.r);
            const cost = distances.get(key)!;
            if (dist < bestDist || (dist === bestDist && cost < bestCost && bestKey !== null)) {
                bestDist = dist;
                bestCost = cost;
                bestKey = key;
            }
        }

        if (bestKey === null) return false;
        const toQ = bestKey % cols;
        recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
        return true;
    },
};
