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

import { HexCoord } from '../../shared/hexengine/HexCoord';
import { SimState, SimUnit } from './SimState';

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

    return score;
}
