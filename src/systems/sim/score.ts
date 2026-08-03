// Position evaluation for the AI search. Reads only through SimState, so
// everything a candidate plan changed -- kills, damage, terrain sunk into
// water -- is reflected in the number.
//
// Terms:
//   - material+health: 100 per living unit plus 10 per remaining hp,
//     positive for own units, negative for enemies. Derived from live
//     stats rather than the old AISystem's hardcoded per-type table, so
//     new unit types count automatically.
//   - aggression: minus the distance from each own unit to its nearest
//     enemy (weight 1). Without it every no-contact plan scores equal and
//     the AI never advances; with it, closing distance breaks ties while
//     staying far too small to outweigh actual damage dealt.
//   - buildings: BUILDING_OWNED per owned standing building, plus
//     CAPTURE_YIELD_VALUE when this side opened a factory during the
//     rollout (yieldedTo). The yield value is a fixed EXPECTED value of an
//     average unit -- the sim can't see the actual hidden prize, so this
//     is what the AI "knows" without cheating. A capture-pull term (same
//     weight-1 scale as aggression) marches capture-capable units toward
//     the nearest capturable building.

import { HexCoord } from '../../shared/hexengine/HexCoord';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { SimState, SimUnit } from './SimState';

export const BUILDING_OWNED = 25;
// Opening a factory yields a real unit -- value it like one (the material
// term counts a unit as 100 + hp*10; a mid-tier prize like the Sabre is
// 150). The sim can't see the actual hidden type, so this fixed expected
// value IS the yielded unit's score contribution until the live game
// spawns the real thing.
export const CAPTURE_YIELD_VALUE = 150;
// An own non-infantry unit parked on a factory it can't capture blocks
// its own side's infantry from taking it.
export const BUILDING_BLOCK_PENALTY = 15;
// Infantry march toward open factories much harder than the generic
// aggression gradient -- a capture is worth a unit, closing with the
// enemy is worth a tiebreak.
const CAPTURE_PULL_WEIGHT = 3;

export function scoreState(state: SimState, playerIndex: number): number {
    let score = 0;
    const own: SimUnit[] = [];
    const enemies: SimUnit[] = [];

    for (const [, unit] of state.liveUnits()) {
        const value = 100 + unit.hp * 10;
        if (unit.playerIndex === playerIndex) {
            score += value;
            own.push(unit);
        } else {
            score -= value;
            enemies.push(unit);
        }
    }

    for (const unit of own) {
        let nearest = Infinity;
        for (const enemy of enemies) {
            nearest = Math.min(nearest, HexCoord.getDistance(unit.q, unit.r, enemy.q, enemy.r));
        }
        if (nearest !== Infinity) score -= nearest;
    }

    for (const [, building] of state.liveBuildings()) {
        if (building.ownerIndex === playerIndex) score += BUILDING_OWNED;
        else if (building.ownerIndex !== null) score -= BUILDING_OWNED;
        if (building.yieldedTo === playerIndex) score += CAPTURE_YIELD_VALUE;
        else if (building.yieldedTo !== null) score -= CAPTURE_YIELD_VALUE;
    }

    // Capture pull: infantry that idles far from an open factory is
    // leaving value on the table, so close that distance -- weighted well
    // above the aggression term so the factory wins the gradient tug-of-war
    // for capture-capable units.
    for (const unit of own) {
        if (!UnitSystem.unitTypesRecord[unit.type]?.canCapture) continue;
        let nearest = Infinity;
        for (const [, building] of state.liveBuildings()) {
            if (building.ownerIndex === playerIndex) continue;
            nearest = Math.min(nearest, HexCoord.getDistance(unit.q, unit.r, building.q, building.r));
        }
        if (nearest !== Infinity) score -= CAPTURE_PULL_WEIGHT * nearest;
    }

    // Blocking penalty: an own NON-capture unit standing on a factory the
    // side doesn't own accomplishes nothing (only infantry captures) and
    // physically blocks its own infantry from taking it.
    for (const unit of own) {
        if (UnitSystem.unitTypesRecord[unit.type]?.canCapture) continue;
        const found = state.getBuildingAt(unit.q, unit.r);
        if (found && found[1].ownerIndex !== playerIndex) score -= BUILDING_BLOCK_PENALTY;
    }

    return score;
}
