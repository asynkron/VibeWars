// The live depth dial, which is what the difficulty setting turns.
//
// Worth pinning because the failure is silent: beamDepth arriving as
// undefined does not throw, it just plays the engine's own shallow depth,
// and a Hard game would be indistinguishable from a Low one.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from '../../SimState';
import { NO_COOLDOWNS } from '../../../../shared/hexengine/skills';
import { feintEngine } from '../engines/feint';
import { beamPlanGen } from './beam';

const tile = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1,
    vegetated: false, burning: 0, burned: false });

const unit = (o: any): SimUnit => ({
    hp: 6, maxHp: 6, move: 2, attack: 4, minRange: 1, maxRange: 1,
    hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...o });

const board = () => SimState.snapshot({
    map: { cols: 8, rows: 8, getTile: tile },
    units: [
        unit({ type: 'Bulwark', q: 1, r: 1, playerIndex: 0 }),
        unit({ type: 'Bulwark', q: 5, r: 5, playerIndex: 1 }),
    ],
    buildings: [],
});

// The planner reports progress as {done, total}; total IS the beam depth it
// is running, which makes it the honest way to observe the dial from outside.
function depthPlayed(engine: { options: any }): number {
    // Driven through the beam planner directly with the engine's resolved
    // options -- which is exactly how createEngine calls it, and the only
    // way to observe the depth from outside without a live game.
    const generator = beamPlanGen(board(), 0, { ...engine.options, seed: 1 });
    let total = 0;
    for (let step = generator.next(); !step.done; step = generator.next()) {
        if (step.value?.total) total = Math.max(total, step.value.total);
    }
    return total;
}

describe('beam depth follows the live budget', () => {
    it('plays the engine\'s own depth when nothing overrides it', () => {
        expect(depthPlayed(feintEngine)).toBe(3);
    });

    it('plays the budget\'s depth when one is given', () => {
        expect(depthPlayed(feintEngine.withBudget({ beamDepth: 5 }))).toBe(5);
        expect(depthPlayed(feintEngine.withBudget({ beamDepth: 4 }))).toBe(4);
    });

    it('never drops below the cooldown horizon', () => {
        // skills.ts refuses to author a cooldown longer than the default
        // engine is deep, and the authored skills sit at exactly 3. A
        // difficulty that searched shallower would spend them as if free.
        expect(depthPlayed(feintEngine)).toBeGreaterThanOrEqual(3);
    });
});
