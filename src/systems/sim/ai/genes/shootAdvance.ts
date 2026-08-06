// SHOOT AND ADVANCE -- fire from where you stand, then spend the movement
// the shot did not need pressing FORWARD. Hit-and-run's mirror twin: that
// gene banks damage and leaves; this one banks damage and keeps coming,
// which is how you use movement left over after a kill instead of parking
// on the firing spot -- the exact dead-movement pattern the sweep bakes in
// (it fires last, so what is left after ITS shot is always wasted).
//
// Deliberately NARROW: the target must be in the bracket NOW. Walking into
// range first is hit-and-run's or moveTowards' job; this gene is the
// follow-through after the line already made contact.
//
// AND NEVER FOR STANDOFF WEAPONS. A unit whose minRange is above 1 that
// advances after shooting walks INTO its own dead zone -- the one place
// on the board it is guaranteed harmless -- so for that bracket shape the
// press is wrong by construction, no measurement needed. Mortar and
// Kestrel have exactly that shape on the shipped roster. The first draft
// lacked this guard and the water-choke scenario flagged the family the
// same day it existed; the choke's margins later proved seed-noisy
// between healthy engines, but this guard never rested on them.
// Pressing is for weapons that still work up close.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { GeneDefinition, applyGene, nearestTargetableEnemyIndex } from '../../SimCommands';

export const SHOOT_ADVANCE = 'shootAdvance';

export const shootAdvanceGene: GeneDefinition = {
    // Inapplicable rolls become idle, not advance: this family exists to
    // ADD tactics, and the default fallback would instead tilt the whole
    // army forward by the family's combined weight on every board where
    // these never fire -- see GeneDefinition.fallback.
    fallback: 'idle',

    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hasAttacked || unit.minRange > 1) return false;
        const nearest = nearestTargetableEnemyIndex(state, unitIndex);
        if (nearest === null) return false;
        const target = state.getUnit(nearest)!;
        const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
        return distance >= unit.minRange && distance <= unit.maxRange;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.hasAttacked || unit.minRange > 1) return false;

        // The gene's own target if it is a live, shootable enemy in the
        // bracket; the nearest targetable one otherwise.
        let targetIndex = gene.targetIndex ?? -1;
        let target = state.getUnit(targetIndex);
        if (!target || target.playerIndex === unit.playerIndex
            || !UnitSystem.canTarget(unit.type, target.type)) {
            const nearest = nearestTargetableEnemyIndex(state, gene.unitIndex);
            if (nearest === null) return false;
            targetIndex = nearest;
            target = state.getUnit(nearest)!;
        }
        const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
        if (distance < unit.minRange || distance > unit.maxRange) return false;

        const shot = applyGene(state, { kind: 'attack', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });
        if (!shot) return false;

        // The press: whatever movement remains goes toward the enemy. A
        // dead target makes moveTowards fall back to the nearest one, which
        // is exactly the after-a-kill case this gene exists for.
        const advanced = applyGene(state, { kind: 'moveTowards', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });
        return shot || advanced;
    },
};
