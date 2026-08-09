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
//   - projectile/laser/cannon: single hit on the defender.
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

import * as HexCoord from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { scaleDamageByHealth } from '../../shared/hexengine/combatDamage';
import { SimState } from './SimState';
import type { SkillDef } from '../../shared/hexengine/skills';

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

// The same number, read off a SKILL rather than off the unit. Every unit's
// slot-0 skill is derived from the very fields expectedDamage reads, so for
// today's roster the two agree exactly -- which is what makes routing
// attacks through skills a change in where the number comes from and not in
// what it is.
//
// expectedDamage keeps its signature untouched on purpose: eleven
// assertions in resolveAttack.test.ts call it by unit type, and rewriting
// them would mean rewriting the tests that are supposed to be judging this
// change.
export function skillDamage(skill: SkillDef): number {
    if (skill.effect.kind !== 'attack') return 0;
    return Math.round((skill.effect.minDamage + skill.effect.maxDamage) / 2);
}

export function resolveAttack(
    state: SimState,
    attackerIndex: number,
    defenderIndex: number,
    seed: number,
    // Which of the attacker's skills is firing. TRAILING AND OPTIONAL
    // because thirteen call sites already exist, eleven of them assertions
    // in resolveAttack.test.ts that are meant to be judging this change
    // rather than being rewritten by it. Omitted means the unit's primary
    // attack, which is what every call meant before skills existed.
    skillId?: string
): ResolvedAttack | null {
    const attacker = state.getUnit(attackerIndex);
    const defender = state.getUnit(defenderIndex);
    if (!attacker || !defender) return null;

    // The skill is the source of the damage and of the effect shape now.
    // Falling back to the unit table when a skill cannot be found keeps a
    // unit type that somehow has none from silently becoming harmless --
    // the same failure the 'cannon' comment below warns about.
    const skill = (skillId ? UnitSystem.skillById(attacker.type, skillId) : undefined)
        ?? UnitSystem.primarySkill(attacker.type);
    const stats = UnitSystem.unitTypesRecord[attacker.type];
    const attackEffect = skill?.effect.kind === 'attack' ? skill.effect.attackEffect : stats.attackEffect;
    const damage = skill ? skillDamage(skill) : expectedDamage(attacker.type);
    const healthScaled = (resolvedDamage: number) =>
        scaleDamageByHealth(resolvedDamage, attacker.hp, attacker.maxHp);
    const hits: ResolvedHit[] = [];
    const impacts: ResolvedImpact[] = [];

    // Class targeting rule (mirrors UnitSystem.canTarget): artillery and
    // infantry can't attack air units at all.
    if (!UnitSystem.canTarget(attacker.type, defender.type)) {
        return { attackerIndex, defenderIndex, hits, impacts };
    }

    // Single-target effects. 'cannon' and 'flak' MUST be listed here:
    // anything not matched below deals no damage at all, so a new effect
    // name silently makes the unit harmless to the search. Flak is a burst
    // of many rounds on screen and one damage number here, exactly like the
    // cannon -- the volley below is the effect that splits its total, and
    // this is not that.
    if (attackEffect === 'projectile' || attackEffect === 'laser'
        || attackEffect === 'cannon' || attackEffect === 'flak') {
        const classModifier = UnitSystem.getClassModifier(attacker.type, defender.type);
        hits.push({ unitIndex: defenderIndex, damage: healthScaled(Math.floor(damage * classModifier)) });
    } else if (attackEffect === 'rocketBarrage') {
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
            hits.push({
                unitIndex,
                damage: healthScaled(Math.floor(damage * (isPrimary ? 1 : SPLASH_FACTOR) * classModifier)),
            });
        }

        // Craters: each rocket lands on a seeded-random splash hex.
        const rng = mulberry32(seed);
        for (let i = 0; i < ROCKET_COUNT; i++) {
            const target = splashHexes[Math.floor(rng() * splashHexes.length)];
            impacts.push({ q: target.q, r: target.r, craterDelta: CRATER_DELTA });
        }
    } else if (attackEffect === 'rocketVolley') {
        // Several small rockets, all at the same target: the per-rocket
        // damages sum exactly to the usual single-shot total.
        const classModifier = UnitSystem.getClassModifier(attacker.type, defender.type);
        const total = healthScaled(Math.floor(damage * classModifier));
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
