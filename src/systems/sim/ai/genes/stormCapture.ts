// STORM CAPTURE -- the Pike's door-kick: shoot the defender if one is in
// the bracket, then spend the movement walking at the building -- onto its
// entrance when it reaches, which IS the capture (recordSimMove derives
// it). The assault member of the press family, and the one whose ordering
// matters most: a capturer that walks first and hopes to shoot later has
// already spent the movement it needed, and the sweep's shot comes when
// the walking is over -- too late to have cleared the door first.
//
// Movement is delegated to moveToBuilding verbatim: same nearest-door
// choice, same dead-end fallback around ridges, same capture-on-arrival.

import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import * as HexCoord from '../../../../shared/hexengine/hexMath';
import {
    GeneDefinition,
    applyGene,
    nearestCapturableBuildingIndex,
    nearestTargetableEnemyIndex,
} from '../../SimCommands';

export const STORM_CAPTURE = 'stormCapture';

export const stormCaptureGene: GeneDefinition = {
    // Inapplicable rolls become idle, not advance: this family exists to
    // ADD tactics, and the default fallback would instead tilt the whole
    // army forward by the family's combined weight on every board where
    // these never fire -- see GeneDefinition.fallback.
    fallback: 'idle',

    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || !UnitSystem.unitTypesRecord[unit.type]?.canCapture) return false;
        return nearestCapturableBuildingIndex(state, unitIndex) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || !UnitSystem.unitTypesRecord[unit.type]?.canCapture) return false;

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

        const stormed = applyGene(state, {
            kind: 'moveToBuilding',
            unitIndex: gene.unitIndex,
            buildingIndex: gene.buildingIndex,
            seed: gene.seed,
        });
        return shot || stormed;
    },
};
