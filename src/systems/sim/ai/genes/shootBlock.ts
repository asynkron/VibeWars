// SHOOT AND BLOCK -- fire if anything is in the bracket, then spend the
// rest of the movement standing in the nearest deniable doorway. The
// defensive member of the press family: hit-and-run leaves, shootAdvance
// keeps coming, this one takes the ground and SHUTS it -- an occupied
// entrance cannot be captured, and holdDoor.ts owns that rule.
//
// The shot is optional, the block is the point: a unit with no target
// still walks to the door (that is holdDoor's own behaviour, delegated
// verbatim), and a unit with a target gets the shot IN before its body
// becomes furniture -- the ordering the sweep can never produce, because
// by sweep time the unit is already standing in the doorway it wants to
// shoot out of.

import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import * as HexCoord from '../../../../shared/hexengine/hexMath';
import { GeneDefinition, applyGene, nearestTargetableEnemyIndex } from '../../SimCommands';
import { holdDoorGene } from './holdDoor';

export const SHOOT_BLOCK = 'shootBlock';

export const shootBlockGene: GeneDefinition = {
    // Inapplicable rolls become idle, not advance: this family exists to
    // ADD tactics, and the default fallback would instead tilt the whole
    // army forward by the family's combined weight on every board where
    // these never fire -- see GeneDefinition.fallback.
    fallback: 'idle',

    // Exactly holdDoor's own guard: a door worth denying, a unit that is
    // not itself a capturer. The shot needs no guard -- it simply does not
    // happen when nothing is in the bracket.
    applicable(state, unitIndex) {
        return holdDoorGene.applicable?.(state, unitIndex) ?? true;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit) return false;

        let shot = false;
        if (!unit.hasAttacked) {
            const targetIndex = nearestTargetableEnemyIndex(state, gene.unitIndex);
            if (targetIndex !== null) {
                const target = state.getUnit(targetIndex)!;
                const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
                if (distance >= unit.minRange && distance <= unit.maxRange
                    && UnitSystem.canTarget(unit.type, target.type)) {
                    shot = applyGene(state, { kind: 'attack', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });
                }
            }
        }

        // The block, through holdDoor itself: same door choice, same
        // whole-or-nothing reachability rule, same recordSimMove.
        const blocked = holdDoorGene.apply(state, { ...gene, kind: 'holdDoor' });
        return shot || blocked;
    },
};
