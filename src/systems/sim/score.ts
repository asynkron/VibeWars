// Position evaluation for the AI search. Reads only through SimState, so
// everything a candidate plan changed -- kills, damage, terrain sunk into
// water -- is reflected in the number.
//
// Every term is WEIGHTED, and the weights arrive as an argument rather
// than living in module constants: two AI engines competing in the same
// process must be able to value the board differently. DEFAULT_SCORE_WEIGHTS
// holds the values this function used when they were hardcoded, so
// scoreState(state, side) with no weights behaves exactly as before.
//
// Terms:
//   - material+health: `unitBase` per living unit plus `hpWeight` per
//     remaining hp, positive for own units, negative for enemies. Derived
//     from live stats rather than the old AISystem's hardcoded per-type
//     table, so new unit types count automatically.
//   - aggression: minus the distance from each own unit to its nearest
//     enemy. Without it every no-contact plan scores equal and the AI never
//     advances; with it, closing distance breaks ties while staying far too
//     small to outweigh actual damage dealt.
//   - buildings: `buildingOwned` per owned standing building, plus
//     `captureYield` when this side opened a factory during the rollout
//     (yieldedTo). The yield value is a fixed EXPECTED value of an average
//     unit -- the sim can't see the actual hidden prize, so this is what the
//     AI "knows" without cheating. A capture-pull term marches
//     capture-capable units toward the nearest capturable building.

import { HexCoord } from '../../shared/hexengine/HexCoord';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { SimState, SimUnit } from './SimState';

export interface ScoreWeights {
    // Flat value of a unit being alive at all, before its hp is counted.
    unitBase: number;
    // Value per remaining hit point.
    hpWeight: number;
    // Quadratic army-size pressure (HeroesOfBlazor's count-multiplied
    // fitness): each ADDITIONAL enemy unit costs increasingly more, so
    // FINISHING units off beats spreading the same damage across many --
    // and the value of a kill is highest when the enemy army is large.
    armySize: number;
    // Per hex of distance from each own unit to its nearest enemy.
    aggression: number;
    // Per standing building owned (and the same, negative, per enemy-owned).
    buildingOwned: number;
    // Opening a factory yields a real unit -- value it like one (a unit is
    // unitBase + hp*hpWeight; a mid-tier prize like the Sabre is 150). The
    // sim can't see the actual hidden type, so this fixed expected value IS
    // the yielded unit's score contribution until the live game spawns the
    // real thing.
    captureYield: number;
    // An own non-infantry unit parked on a factory it can't capture blocks
    // its own side's infantry from taking it.
    buildingBlockPenalty: number;
    // Infantry march toward open factories much harder than the generic
    // aggression gradient -- a capture is worth a unit, closing with the
    // enemy is worth a tiebreak.
    capturePull: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
    unitBase: 100,
    hpWeight: 10,
    armySize: 3,
    aggression: 1,
    buildingOwned: 25,
    captureYield: 150,
    buildingBlockPenalty: 15,
    capturePull: 3,
};

export function scoreState(
    state: SimState,
    playerIndex: number,
    weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
): number {
    let score = 0;
    const own: SimUnit[] = [];
    const enemies: SimUnit[] = [];

    for (const [, unit] of state.liveUnits()) {
        const value = weights.unitBase + unit.hp * weights.hpWeight;
        if (unit.playerIndex === playerIndex) {
            score += value;
            own.push(unit);
        } else {
            score -= value;
            enemies.push(unit);
        }
    }

    // Quadratic head-count term: see ScoreWeights.armySize.
    score += weights.armySize * (own.length * own.length - enemies.length * enemies.length);

    for (const unit of own) {
        let nearest = Infinity;
        for (const enemy of enemies) {
            nearest = Math.min(nearest, HexCoord.getDistance(unit.q, unit.r, enemy.q, enemy.r));
        }
        if (nearest !== Infinity) score -= weights.aggression * nearest;
    }

    for (const [, building] of state.liveBuildings()) {
        if (building.ownerIndex === playerIndex) score += weights.buildingOwned;
        else if (building.ownerIndex !== null) score -= weights.buildingOwned;
        if (building.yieldedTo === playerIndex) score += weights.captureYield;
        else if (building.yieldedTo !== null) score -= weights.captureYield;
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
        if (nearest !== Infinity) score -= weights.capturePull * nearest;
    }

    // Blocking penalty: an own NON-capture unit standing on a factory the
    // side doesn't own accomplishes nothing (only infantry captures) and
    // physically blocks its own infantry from taking it.
    for (const unit of own) {
        if (UnitSystem.unitTypesRecord[unit.type]?.canCapture) continue;
        const found = state.getBuildingAt(unit.q, unit.r);
        if (found && found[1].ownerIndex !== playerIndex) score -= weights.buildingBlockPenalty;
    }

    return score;
}
