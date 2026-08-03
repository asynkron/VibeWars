// Seeded, pure attack resolution -- the "resolve first, execute later"
// half of the AI design. All randomness in an attack (damage, rocket
// scatter) is decided HERE, before anything executes, and returned as
// facts. The simulation records those facts as events; the real game
// executes the same facts with visuals. Same seed -> identical outcome in
// every candidate plan and in the replayed reality, which also keeps
// hillclimbing evaluations noise-free.
//
// The rules mirror UnitSystem.attack + VisualizationSystem.
// showRocketBarrageEffect exactly:
//   - projectile/laser: single hit on the defender.
//   - rocketBarrage: damage hits EVERY unit on the defender's hex (x1) and
//     on each in-bounds neighbor hex (x SPLASH_FACTOR, floored) -- friendly
//     fire included -- independent of where the rockets visually land. Each
//     victim's damage is further scaled by the class counter triangle
//     (UnitSystem.getClassModifier: aa>air, tank>aa, air>tank). Craters:
//     6 rockets each pick a landing hex uniformly among
//     [defender hex, ...in-bounds neighbors] and lower it by CRATER_DELTA.
//   - rocketVolley (attack helicopters): visually a rocket flurry like the
//     barrage, but every rocket goes at the TARGET hex -- several small
//     hits on the same unit summing to the usual expected damage, no
//     splash to neighbors, no terrain damage (craterDelta 0).
//   - any other attackEffect deals no damage (mirrors the live if/else
//     chain, which silently does nothing for unknown effects).
//
// Damage is the expected value round((min+max)/2) rather than the live
// uniform roll, per SimState's determinism contract.

import { HexCoord } from '../../shared/hexengine/HexCoord';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { SimState } from './SimState';

export interface ResolvedHit {
    unitIndex: number;
    damage: number;
}

export interface ResolvedImpact {
    q: number;
    r: number;
    craterDelta: number;
}

export interface ResolvedAttack {
    attackerIndex: number;
    defenderIndex: number;
    hits: ResolvedHit[];
    impacts: ResolvedImpact[];
}

export const ROCKET_COUNT = 6; // showRocketBarrageEffect's projectileCount default
// Barrage tuning (nerfed from -0.5 / 0.5: one barrage no longer deletes
// whole neighborhoods or sinks terrain in a single strike). Craters are
// deliberately SHALLOW: sinking a typical grass tile (height ~1.0+) into
// water now takes on the order of ten crater hits on the SAME tile, so
// flooding stays a rare, earned event instead of the map ending up as
// open sea after every artillery duel.
export const CRATER_DELTA = -0.1;
export const SPLASH_FACTOR = 0.25;
// Helicopter volley: this many small rockets, all at the target hex.
export const VOLLEY_COUNT = 4;

// Small fast deterministic PRNG (mulberry32).
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Deterministic seed from e.g. (turnCounter, attackerIndex, defenderIndex),
// so the same attack resolves identically in every candidate plan.
export function combineSeed(...parts: number[]): number {
    let h = 0x9e3779b9;
    for (const p of parts) {
        h = Math.imul(h ^ (p + 0x9e3779b9), 0x85ebca6b);
        h ^= h >>> 13;
    }
    return h >>> 0;
}

export function expectedDamage(unitType: string): number {
    const stats = UnitSystem.unitTypesRecord[unitType];
    return Math.round((stats.minDamage + stats.maxDamage) / 2);
}

export function resolveAttack(
    state: SimState,
    attackerIndex: number,
    defenderIndex: number,
    seed: number
): ResolvedAttack | null {
    const attacker = state.getUnit(attackerIndex);
    const defender = state.getUnit(defenderIndex);
    if (!attacker || !defender) return null;

    const stats = UnitSystem.unitTypesRecord[attacker.type];
    const damage = expectedDamage(attacker.type);
    const hits: ResolvedHit[] = [];
    const impacts: ResolvedImpact[] = [];

    // Class targeting rule (mirrors UnitSystem.canTarget): artillery and
    // infantry can't attack air units at all.
    if (!UnitSystem.canTarget(attacker.type, defender.type)) {
        return { attackerIndex, defenderIndex, hits, impacts };
    }

    if (stats.attackEffect === 'projectile' || stats.attackEffect === 'laser') {
        const classModifier = UnitSystem.getClassModifier(attacker.type, defender.type);
        hits.push({ unitIndex: defenderIndex, damage: Math.floor(damage * classModifier) });
    } else if (stats.attackEffect === 'rocketBarrage') {
        // Splash hexes: defender's hex + all in-bounds neighbors.
        const splashHexes = [{ q: defender.q, r: defender.r }];
        for (const n of HexCoord.getNeighbors(defender.q, defender.r)) {
            if (n.q >= 0 && n.q < state.cols && n.r >= 0 && n.r < state.rows) {
                splashHexes.push({ q: n.q, r: n.r });
            }
        }

        // Damage every unit standing in the splash area (friendly fire
        // included, like the live rule).
        for (const hex of splashHexes) {
            const found = state.getUnitAt(hex.q, hex.r);
            if (!found) continue;
            const [unitIndex, victim] = found;
            // Shells can't touch air units hovering over the splash zone.
            if (!UnitSystem.canTarget(attacker.type, victim.type)) continue;
            const isPrimary = hex.q === defender.q && hex.r === defender.r;
            const classModifier = UnitSystem.getClassModifier(attacker.type, victim.type);
            hits.push({ unitIndex, damage: Math.floor(damage * (isPrimary ? 1 : SPLASH_FACTOR) * classModifier) });
        }

        // Craters: each rocket lands on a seeded-random splash hex.
        const rng = mulberry32(seed);
        for (let i = 0; i < ROCKET_COUNT; i++) {
            const target = splashHexes[Math.floor(rng() * splashHexes.length)];
            impacts.push({ q: target.q, r: target.r, craterDelta: CRATER_DELTA });
        }
    } else if (stats.attackEffect === 'rocketVolley') {
        // Several small rockets, all at the same target: the per-rocket
        // damages sum exactly to the usual single-shot total.
        const classModifier = UnitSystem.getClassModifier(attacker.type, defender.type);
        const total = Math.floor(damage * classModifier);
        const base = Math.floor(total / VOLLEY_COUNT);
        let remainder = total - base * VOLLEY_COUNT;
        for (let i = 0; i < VOLLEY_COUNT; i++) {
            const rocketDamage = base + (remainder-- > 0 ? 1 : 0);
            if (rocketDamage > 0) hits.push({ unitIndex: defenderIndex, damage: rocketDamage });
            // Every rocket flies at the target hex; no terrain damage.
            impacts.push({ q: defender.q, r: defender.r, craterDelta: 0 });
        }
    }
    // Any other attackEffect: no hits, no impacts (mirrors the live chain).

    return { attackerIndex, defenderIndex, hits, impacts };
}
