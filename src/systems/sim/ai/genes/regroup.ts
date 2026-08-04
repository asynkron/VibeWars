// REGROUP -- an engine-contributed gene: move to the reachable hex that
// minimises total distance to friendly units.
//
// The shipped gene set has no way to express concentration of force. Every
// movement gene is oriented on an ENEMY (moveTowards, moveAway, standoff)
// or a building (moveToBuilding) or nothing (moveRandom), and the score's
// aggression term pulls each unit at its OWN nearest enemy -- which, on a
// wide map with enemies spread out, pulls the army apart into a line of
// duels. Regroup is the counter-pressure: it costs a unit its turn to close
// on its own side, in exchange for arriving somewhere as a group.
//
// It is deliberately a GENE rather than a score term. As a score term it
// would apply to every plan at once and just bias the whole search inward;
// as a gene the hillclimber can hand it to two units and not the third,
// which is what concentrating a flank actually looks like.
//
// Movement goes through recordSimMove, so a regrouping infantry that lands
// on an enemy building still captures it -- the same rule every builtin
// movement gene gets.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import { SimState } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const REGROUP = 'regroup';

// Summed distance from a hex to every listed ally. Sum rather than nearest:
// nearest-ally is satisfied by pairing off, which is the very spreading
// this gene exists to undo.
function spreadAt(q: number, r: number, allies: Array<{ q: number; r: number }>): number {
    let total = 0;
    for (const ally of allies) total += HexCoord.getDistance(q, r, ally.q, ally.r);
    return total;
}

function alliesOf(state: SimState, unitIndex: number): Array<{ q: number; r: number }> {
    const unit = state.getUnit(unitIndex);
    if (!unit) return [];
    const allies: Array<{ q: number; r: number }> = [];
    for (const [i, other] of state.liveUnits()) {
        if (i === unitIndex || other.playerIndex !== unit.playerIndex) continue;
        allies.push({ q: other.q, r: other.r });
    }
    return allies;
}

export const regroupGene: GeneDefinition = {
    // Pointless for a lone survivor -- randomGene rerolls it to moveTowards.
    applicable(state, unitIndex) {
        return alliesOf(state, unitIndex).length > 0;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.move <= 0) return false;
        const allies = alliesOf(state, gene.unitIndex);
        if (allies.length === 0) return false;

        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
        // Staying put is the bar to beat, exactly as in moveTowards: a gene
        // that "acts" without improving anything just burns movement the
        // rest of the plan could have used.
        let bestSpread = spreadAt(unit.q, unit.r, allies);
        let bestCost = Infinity;
        let bestKey: string | null = null;

        for (const key of reachable) {
            const [q, r] = key.split(',').map(Number);
            if (q === unit.q && r === unit.r) continue;
            const spread = spreadAt(q, r, allies);
            const cost = distances.get(key)!;
            // Tighter wins; among equally tight hexes the cheapest wins, but
            // only once some hex has already beaten standing still.
            if (spread < bestSpread || (spread === bestSpread && cost < bestCost && bestKey !== null)) {
                bestSpread = spread;
                bestCost = cost;
                bestKey = key;
            }
        }

        if (bestKey === null) return false;
        const [toQ, toR] = bestKey.split(',').map(Number);
        recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
        return true;
    },
};
