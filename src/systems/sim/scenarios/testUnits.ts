// The scenario roster: Boll, Kloss and Pyramid -- a ball, a block and a
// pyramid. Deliberately NOT game units: each is one tactical property
// turned up so far that a scenario can ask a question with it and read
// the answer off the outcome.
//
//   Kloss    the block. 30 hp, deals ~1. It cannot win a fight; all it
//            can do is STAND somewhere -- which is the point. Any value
//            it produces comes from where it stands.
//   Pyramid  the glass cannon. 2 hp, hits hard, and shoots at range 2
//            EXACTLY -- never adjacent. Anything that touches it kills
//            it, so any value it produces comes from what stands between
//            it and the enemy.
//   Boll     the ball. Fast (move 5), one-shots a Pyramid, grinds a
//            Kloss down in five turns. The question every scenario asks
//            is: can the defenders arrange themselves so that this thing
//            never gets to choose its target?
//
// Registered at TEST TIME into unitTypesRecord rather than authored in
// unitStats.ts: no map spawns them, no model exists for them, and vitest
// isolates module graphs per test file, so the live roster never sees
// them. Registration is idempotent. The stats live here so a scenario
// file reads as geometry + question, not as a stat block.

import { unitTypesRecord } from '../../../shared/hexengine/unitStats';

const LAND_ONLY = {
    WATER: null,
    SAND: 1,
    GRASS: 1,
    FOREST: 1.5,
    MOUNTAIN: null,
};

const SCENARIO_UNITS: Record<string, unknown> = {
    Kloss: {
        symbol: 'K',
        name: 'Kloss',
        unitClass: 'tank' as const,
        maxHp: 30,
        hp: 30,
        move: 2,
        minRange: 1,
        maxRange: 1,
        minDamage: 0,
        maxDamage: 2,
        attack: 1,
        model: 'assets/units/bulwark-heavy-tank.glb', // never rendered
        scale: 0.2,
        rotation: 0,
        attackEffect: 'cannon',
        footprintTexture: 'assets/textures/tracks2.png',
        terrainCosts: LAND_ONLY,
        usePlayerColor: false,
        sounds: { movement: 'engine_heavy', attack: 'rlauncher2' },
    },
    Pyramid: {
        symbol: 'A',
        name: 'Pyramid',
        unitClass: 'artillery' as const,
        maxHp: 2,
        hp: 2,
        move: 2,
        // Range 2 EXACTLY: adjacent is a dead zone, so the unit is
        // helpless against anything that reaches it.
        minRange: 2,
        maxRange: 2,
        minDamage: 4,
        maxDamage: 6,
        attack: 5,
        model: 'assets/units/kestrel-bombard-artillery.glb', // never rendered
        scale: 0.2,
        rotation: 0,
        attackEffect: 'cannon',
        footprintTexture: 'assets/textures/tracks2.png',
        terrainCosts: LAND_ONLY,
        usePlayerColor: false,
        sounds: { movement: 'engine_heavy', attack: 'rlauncher2' },
    },
    Boll: {
        symbol: 'B',
        name: 'Boll',
        unitClass: 'tank' as const,
        maxHp: 14,
        hp: 14,
        move: 5,
        minRange: 1,
        maxRange: 1,
        minDamage: 5,
        maxDamage: 7,
        attack: 6,
        model: 'assets/units/lynx-light-ifv.glb', // never rendered
        scale: 0.2,
        rotation: 0,
        attackEffect: 'cannon',
        footprintTexture: 'assets/textures/tracks2.png',
        terrainCosts: LAND_ONLY,
        usePlayerColor: false,
        sounds: { movement: 'engine_heavy', attack: 'rlauncher2' },
    },
};

// Idempotent: a second call is a no-op, so scenario files can all call it
// without coordinating.
export function registerScenarioUnits(): void {
    for (const [type, config] of Object.entries(SCENARIO_UNITS)) {
        if (!unitTypesRecord[type]) {
            (unitTypesRecord as Record<string, unknown>)[type] = config;
        }
    }
}
