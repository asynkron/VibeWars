import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { resolveAttack, expectedDamage, mulberry32, combineSeed, ROCKET_COUNT, CRATER_DELTA } from './resolveAttack';
import { HexCoord } from '../../shared/hexengine/HexCoord';

const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });

function makeUnit(patch: any = {}) {
    return {
        type: 'Tank1', q: 2, r: 2, playerIndex: 1, hp: 10, maxHp: 10,
        move: 2, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false,
        ...patch,
    };
}

function makeState(units: any[]): SimState {
    return SimState.snapshot({
        map: { cols: 6, rows: 6, getTile: () => grass() },
        units,
    });
}

describe('expectedDamage', () => {
    it('is round((min+max)/2) from the type config', () => {
        // Tank1: minDamage 4, maxDamage 6 -> 5
        expect(expectedDamage('Tank1')).toBe(5);
        // Artillery: 5..7 -> 6
        expect(expectedDamage('Artillery')).toBe(6);
    });
});

describe('resolveAttack: projectile/laser', () => {
    it('single hit on the defender, no craters', () => {
        // Tank1 = projectile, Droid = laser
        const state = makeState([
            makeUnit({ type: 'Tank1', q: 1, r: 1, playerIndex: 1 }),
            makeUnit({ type: 'Droid', q: 2, r: 2, playerIndex: 0, hp: 2, maxHp: 2 }),
        ]);
        const resolved = resolveAttack(state, 0, 1, 42)!;
        expect(resolved.hits).toEqual([{ unitIndex: 1, damage: 5 }]);
        expect(resolved.impacts).toEqual([]);
    });

    it('null when attacker or defender is dead', () => {
        const state = makeState([makeUnit(), makeUnit({ q: 3, r: 3, playerIndex: 0 })]);
        state.record({ type: 'unitDied', unitIndex: 1 });
        expect(resolveAttack(state, 0, 1, 42)).toBeNull();
    });
});

describe('resolveAttack: rocketBarrage', () => {
    it('splashes every unit on target + neighbor hexes, friendly fire included', () => {
        // Tank2 uses rocketBarrage, expected damage (4+6)/2 = 5, splash floor(2.5) = 2.
        const defenderPos = { q: 2, r: 2 };
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const farAway = { q: 5, r: 5 };
        const state = makeState([
            makeUnit({ type: 'Tank2', q: 0, r: 0, playerIndex: 1 }),                    // attacker
            makeUnit({ type: 'Droid', ...defenderPos, playerIndex: 0, hp: 2 }),          // primary target
            makeUnit({ type: 'Tank1', q: neighbor.q, r: neighbor.r, playerIndex: 1 }),   // AI's own unit in splash!
            makeUnit({ type: 'Tank3', ...farAway, playerIndex: 0 }),                     // outside splash
        ]);
        const resolved = resolveAttack(state, 0, 1, 7)!;

        const byIndex = new Map(resolved.hits.map((h) => [h.unitIndex, h.damage]));
        expect(byIndex.get(1)).toBe(5);   // primary x1
        expect(byIndex.get(2)).toBe(2);   // splash floor(5*0.5) -- friendly fire
        expect(byIndex.has(3)).toBe(false);
        expect(byIndex.has(0)).toBe(false); // attacker far away, not hit

        expect(resolved.impacts).toHaveLength(ROCKET_COUNT);
        for (const impact of resolved.impacts) {
            expect(impact.craterDelta).toBe(CRATER_DELTA);
            const dist = HexCoord.getDistance(impact.q, impact.r, 2, 2);
            expect(dist).toBeLessThanOrEqual(1); // target hex or a neighbor
        }
    });

    it('same seed gives identical impacts, different seeds diverge', () => {
        const state = makeState([
            makeUnit({ type: 'Tank2', q: 0, r: 0, playerIndex: 1 }),
            makeUnit({ type: 'Droid', q: 2, r: 2, playerIndex: 0 }),
        ]);
        const a = resolveAttack(state, 0, 1, 1234)!;
        const b = resolveAttack(state, 0, 1, 1234)!;
        expect(a).toEqual(b);

        // Different seeds should (overwhelmingly likely) scatter differently.
        const c = resolveAttack(state, 0, 1, 5678)!;
        expect(c.impacts).not.toEqual(a.impacts);
    });
});

describe('prng helpers', () => {
    it('mulberry32 is deterministic per seed and outputs [0, 1)', () => {
        const a = mulberry32(99);
        const b = mulberry32(99);
        for (let i = 0; i < 100; i++) {
            const va = a();
            expect(va).toBe(b());
            expect(va).toBeGreaterThanOrEqual(0);
            expect(va).toBeLessThan(1);
        }
    });

    it('combineSeed mixes its inputs (order matters)', () => {
        expect(combineSeed(1, 2, 3)).toBe(combineSeed(1, 2, 3));
        expect(combineSeed(1, 2, 3)).not.toBe(combineSeed(3, 2, 1));
    });
});
