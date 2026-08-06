// HIT AND RUN -- close into the firing bracket, shoot, and fall back out
// of the target's reach: three actions from one gene. The cavalry tactic,
// and the counter to anything slow -- a Lynx that ends its turn beyond a
// Bulwark's move + range has traded its hit for nothing, because the
// Bulwark cannot answer next turn.
//
// The vocabulary could already spell it: moveTowards or standoff, then an
// explicit attack gene, then moveAway, in that order, on the same unit.
// But as three independent random draws the sequence is a lottery ticket,
// and the attack sweep cannot rescue a plan that moved in and out again --
// the sweep fires from FINAL positions, and the entire point of running
// away is that the final position is out of range. One gene makes the
// tactic a first-class thing the search samples constantly.
//
// Legality is the rules', not this gene's: no shipped skill ends movement
// (skills.test.ts pins exactly that), so move -> attack -> move is what
// the game already allows, sim and live alike, through the one skillCost.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { GeneDefinition, applyGene, nearestTargetableEnemyIndex, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const HIT_AND_RUN = 'hitAndRun';

export const hitAndRunGene: GeneDefinition = {
    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hasAttacked || unit.move <= 0) return false;
        return nearestTargetableEnemyIndex(state, unitIndex) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.hasAttacked || unit.move <= 0) return false;

        // The gene's own target if it is still a live, shootable enemy;
        // the nearest targetable one otherwise -- the attack gene's rule.
        // -1 means "none named", which getUnit's bounds check turns into
        // the same null a dead target gives.
        let targetIndex = gene.targetIndex ?? -1;
        let target = state.getUnit(targetIndex);
        if (!target || target.playerIndex === unit.playerIndex
            || !UnitSystem.canTarget(unit.type, target.type)) {
            const nearest = nearestTargetableEnemyIndex(state, gene.unitIndex);
            if (nearest === null) return false;
            targetIndex = nearest;
            target = state.getUnit(nearest)!;
        }

        // Leg one: step into the firing bracket, standoff's way -- the
        // farthest in-bracket hex, cheapest among ties -- so a ranged unit
        // strikes from the bracket's far edge and a melee one walks
        // adjacent by the shortest route, saving movement for the run.
        // Already in the bracket means no step at all.
        const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
        let moved = false;
        if (distance < unit.minRange || distance > unit.maxRange) {
            const cols = state.cols;
            const startKey = unit.r * cols + unit.q;
            const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            let bestKey: number | null = null;
            let bestDist = -Infinity;
            let bestCost = Infinity;
            for (const key of reachable) {
                if (key === startKey) continue;
                const q = key % cols;
                const d = HexCoord.getDistance(q, (key - q) / cols, target.q, target.r);
                if (d < unit.minRange || d > unit.maxRange) continue;
                const cost = distances.get(key)!;
                if (d > bestDist || (d === bestDist && cost < bestCost)) {
                    bestDist = d;
                    bestCost = cost;
                    bestKey = key;
                }
            }
            // The tactic executes whole or not at all: a unit that cannot
            // reach the bracket this turn has no shot to run from, and
            // plain advancing is moveTowards' job.
            if (bestKey === null) return false;
            const toQ = bestKey % cols;
            recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
            moved = true;
        }

        // Leg two: the shot, through the real attack gene, so splash,
        // craters, drowning and deaths resolve by the one set of rules.
        // This gene's contribution is the CHOREOGRAPHY, not new combat.
        const shot = applyGene(state, { kind: 'attack', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });

        // Leg three: run, whatever the shot did -- standing next to the
        // target after a miss is no better than after a hit. moveAway
        // flees WITH PURPOSE, beyond the target's move + range when any
        // reachable hex is, which is exactly the "it cannot answer next
        // turn" the tactic exists for. A dead target makes moveAway fall
        // back to the nearest enemy: reposition after the kill.
        const fled = applyGene(state, { kind: 'moveAway', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });

        return moved || shot || fled;
    },
};
