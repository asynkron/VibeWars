// SCREEN -- put a tough unit between a fragile one and whatever is coming
// for it.
//
// Nothing in the shipped gene set can express this. Every movement gene is
// oriented on the unit's OWN business: close with an enemy, back away from
// one, kite at range, walk to a building, wander. Wolfpack's regroup is the
// closest and is still about the mover -- it minimises its own distance to
// the pack. None of them can say "stand here, because someone else is
// standing there".
//
// The roster makes that expensive. Kestrel and Mortar have 3 hit points and
// hit from two or three hexes away, so they win a fight they are allowed to
// have and lose instantly to anything that reaches them. A Bulwark has ten
// and takes 2 from the AA it one-shots. Bodies are not interchangeable
// here, and the search has no way to trade one for another on purpose.
//
// The move: stand ADJACENT to the ward, on the side the threat is coming
// from. Adjacency rather than "somewhere on the line" because the hex grid
// is coarse -- at these distances the only square that reliably blocks an
// approach is the one the attacker would have to step through, and a unit
// hovering near the midpoint just puts itself in the open.
//
// It does NOT reserve the hex or block pathing: the sim has no zone of
// control. What it buys is that the enemy's cheapest approach is now
// occupied by the unit that wants to be shot at, which the search can then
// play out for itself.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { SimState, SimUnit } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const SCREEN = 'screen';

// Who is worth screening: an ally this unit can outlast. maxHp is the
// proxy -- it is what actually decides who survives a hit, and it does not
// need a hand-maintained list of which classes count as fragile.
function wardFor(state: SimState, unitIndex: number): SimUnit | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let ward: SimUnit | null = null;
    for (const [i, other] of state.liveUnits()) {
        if (i === unitIndex || other.playerIndex !== unit.playerIndex) continue;
        if (other.maxHp >= unit.maxHp) continue;
        // The frailest, then the one already hurt.
        if (!ward || other.maxHp < ward.maxHp || (other.maxHp === ward.maxHp && other.hp < ward.hp)) {
            ward = other;
        }
    }
    return ward;
}

// What is closing on the ward, and can actually hurt it.
function threatTo(state: SimState, ward: SimUnit, playerIndex: number): SimUnit | null {
    let threat: SimUnit | null = null;
    let best = Infinity;
    for (const [, enemy] of state.liveUnits()) {
        if (enemy.playerIndex === playerIndex) continue;
        if (!UnitSystem.canTarget(enemy.type, ward.type)) continue;
        const distance = HexCoord.getDistance(enemy.q, enemy.r, ward.q, ward.r);
        if (distance < best) {
            best = distance;
            threat = enemy;
        }
    }
    return threat;
}

export const screenGene: GeneDefinition = {
    // Pointless without someone frailer to stand in front of and something
    // to stand in front of them from. randomGene rerolls to moveTowards.
    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit) return false;
        const ward = wardFor(state, unitIndex);
        return !!ward && !!threatTo(state, ward, unit.playerIndex);
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.move <= 0) return false;
        const ward = wardFor(state, gene.unitIndex);
        if (!ward) return false;
        const threat = threatTo(state, ward, unit.playerIndex);
        if (!threat) return false;

        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);

        // Standing still is the bar to beat, as in every other movement
        // gene: a gene that "acts" without improving anything just burns
        // movement the rest of the plan could have used.
        const scoreOf = (q: number, r: number) => {
            const toWard = HexCoord.getDistance(q, r, ward.q, ward.r);
            // Only hexes touching the ward screen anything -- see the header.
            if (toWard > 1) return Infinity;
            // Among those, the one nearest the threat is the one it would
            // have to come through.
            return HexCoord.getDistance(q, r, threat.q, threat.r);
        };

        const cols = state.cols;
        const startKey = unit.r * cols + unit.q;
        let bestScore = scoreOf(unit.q, unit.r);
        let bestCost = Infinity;
        let bestKey: number | null = null;

        for (const key of reachable) {
            if (key === startKey) continue;
            const q = key % cols;
            const value = scoreOf(q, (key - q) / cols);
            const cost = distances.get(key)!;
            if (value < bestScore || (value === bestScore && cost < bestCost && bestKey !== null)) {
                bestScore = value;
                bestCost = cost;
                bestKey = key;
            }
        }

        if (bestKey === null) return false;
        const toQ = bestKey % cols;
        const toR = (bestKey - toQ) / cols;
        // Through recordSimMove, so a screening infantryman that happens to
        // land on an enemy building still captures it.
        recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
        return true;
    },
};
