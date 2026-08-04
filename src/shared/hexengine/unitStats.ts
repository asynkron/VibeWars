// The unit roster and the combat rules that read it -- as DATA and pure
// functions, with no dependency on three.js or on anything that renders.
//
// It used to live inside UnitSystem, which imports render.ts (constructing
// a WebGLRenderer at module scope), game.ts, GridSystem (whose class body
// runs `new THREE.TextureLoader()`), ModelSystem, AudioSystem and
// VisualizationSystem. That made the whole pure simulation layer --
// SimState, SimCommands, score, resolveAttack, the search -- transitively
// depend on a live WebGL context, purely to read a table of hit points.
//
// Splitting it out is what lets the AI run somewhere that has no canvas:
// a Web Worker, so a turn does not freeze the UI, and eventually several
// of them, since the beam search's children are independent simulations.
//
// UnitSystem re-exports every name below, so nothing else had to change.

import { primaryAttackSkill, type SkillDef } from './skills';
import type { UnitTypeConfig } from '../../types';

export const UNIT_TYPES = {
        "Road": {
            symbol: "E",
            name: "Road",
            unitClass: 'infantry' as const,
            maxHp: 2,
            hp: 2,
            move: 3,
            minRange: 1,
            maxRange: 2,
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/droid.obj",
            scale: 0.3,
            attackEffect: 'laser',  // laser beam attack
            footprintTexture: null,  // No footprints for droids
            terrainCosts: {
                WATER: null,
                SAND: 4,
                GRASS: 2,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: true,  // Use player color for this model
            sounds: {
                movement: 'step1',
                attack: 'laser'
            }
        },
        "Gunboat": {
            symbol: "O",
            name: "Gunboat",
            unitClass: 'naval' as const,
            maxHp: 10,
            hp: 10,
            move: 2,
            minRange: 1,
            maxRange: 2,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/boat1.obj",  // Bones for the barbaric orc
            scale: 0.2,
            rotation: 0,
            attackEffect: 'projectile',  // default projectile attack
            footprintTexture: 'assets/textures/tracks3.png',  // Boat tracks
            terrainCosts: {
                WATER: 1,
                SAND: null,
                GRASS: null,
                FOREST: null,
                MOUNTAIN: null
            },
            usePlayerColor: true,
            replaceColor: 0x22380F,  // Use player color for this model
            sounds: {
                movement: 'battleship_movement',
                attack: 'rlauncher1'
            }
        },
        "Bulwark": {
            symbol: "O",
            name: "Bulwark",
            unitClass: 'tank' as const,
            maxHp: 10,
            hp: 10,
            move: 2,
            minRange: 1,
            maxRange: 1,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/bulwark-heavy-tank.glb",  // new-models test swap (was tank_2_green.fbx)
            scale: 0.2,
            rotation: 0,
            attackEffect: 'cannon',  // main gun, not a rocket
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',  // tint only the model's teamCamo material slot
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher2'
            }
        },
        "Kestrel": {
            symbol: "O",
            name: "Kestrel",
            unitClass: 'artillery' as const,
            // Glass cannon: huge indirect firepower, but dies to almost
            // anything that reaches it -- closing in on artillery must pay.
            maxHp: 3,
            hp: 3,
            // Two, up from one. At move 1 a Kestrel that had picked the
            // wrong hex was stuck with it: everything else on the board
            // moves 2 or more, so it could neither follow an advance nor
            // break contact, and its 2-3 range was the only thing keeping
            // it alive. Two lets it reposition into its own firing bracket
            // in one turn instead of two, which is what artillery spends
            // its turns doing -- and it is still the slowest thing on the
            // map, so closing on it still pays.
            move: 2,
            minRange: 2,
            maxRange: 3,
            // Nerfed from 4-6: with full-strength splash + craters the
            // barrage dominated every match (and sank half the map).
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/units/kestrel-bombard-artillery.glb",  // bombard-artillery from new-models; same footprint as the old carrier
            scale: 0.16,
            rotation: 0,
            attackEffect: 'rocketBarrage',  // Changed from 'projectile' to 'rocketBarrage'
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',  // tint only the model's teamCamo material slot
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher2'
            }
        },
        "Sabre": {
            symbol: "O",
            name: "Sabre",
            unitClass: 'tank' as const,
            maxHp: 5,
            hp: 5,
            move: 3,
            minRange: 1,
            maxRange: 1,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/sabre-medium-tank.glb",  // new-models test swap (was tank_4_green.fbx)
            scale: 0.18,
            rotation: 0,
            attackEffect: 'cannon',  // main gun, not a rocket
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',  // tint only the model's teamCamo material slot
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher2'
            }
        },
        "Pike": {
            symbol: "E",
            name: "Pike",
            unitClass: 'infantry' as const,
            canCapture: true,  // the ONLY unit type that can capture buildings
            maxHp: 4,
            hp: 4,
            move: 2,
            minRange: 1,
            maxRange: 1,
            minDamage: 2,
            maxDamage: 4,
            attack: 3,
            model: "assets/units/infantry-squad.glb",
            scale: 0.35,
            rotation: 0,
            attackEffect: 'laser',  // squad volley
            footprintTexture: null,  // No tracks for infantry
            terrainCosts: {
                // Footsloggers: forests are no obstacle, and they're the
                // ONLY unit that can cross mountains -- infantry's niche.
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 1,
                MOUNTAIN: 2
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',  // tint only the model's teamCamo material slot
            sounds: {
                movement: 'step1',
                attack: 'laser'
            }
        },
        "Mortar": {
            symbol: "T",
            name: "Mortar",
            unitClass: 'artillery' as const,
            maxHp: 3,
            hp: 3,
            move: 1,
            minRange: 2,
            maxRange: 3,
            minDamage: 5,
            maxDamage: 7,
            attack: 6,
            model: "assets/tank_1_green.fbx",  // Big bridge for the big troll
            scale: 0.13,
            attackEffect: 'rocketBarrage',  // classic artillery barrage
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 2,
                GRASS: 1,
                FOREST: 3,
                MOUNTAIN: null
            },
            usePlayerColor: false,  // Keep original FBX materials
            replaceColor: 0x22380F,  // Dark green color to replace
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher3'
            }
        },
        "Drover": {
            symbol: "A",
            name: "Drover",
            unitClass: 'tank' as const,
            maxHp: 6,
            hp: 6,
            move: 3,
            minRange: 1,
            maxRange: 1,
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/units/drover-apc.glb",
            scale: 0.22,
            rotation: 0,
            attackEffect: 'cannon',  // main gun, not a rocket
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 1.5,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher1'
            }
        },
        "Halberd": {
            symbol: "H",
            name: "Halberd",
            unitClass: 'aa' as const,
            maxHp: 8,
            hp: 8,
            move: 2,
            minRange: 1,
            maxRange: 2,  // short standoff, anti-air role
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/halberd-aa-tank.glb",
            scale: 0.2,
            rotation: 0,
            attackEffect: 'projectile',
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher3'
            }
        },
        "Lynx": {
            symbol: "L",
            name: "Lynx",
            unitClass: 'tank' as const,
            maxHp: 5,
            hp: 5,
            move: 4,  // fast scout/skirmisher
            minRange: 1,
            maxRange: 1,
            minDamage: 2,
            maxDamage: 4,
            attack: 3,
            model: "assets/units/lynx-light-ifv.glb",
            scale: 0.22,
            rotation: 0,
            attackEffect: 'cannon',  // main gun, not a rocket
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 1.5,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher1'
            }
        },
        "Nightjar": {
            symbol: "N",
            name: "Nightjar",
            unitClass: 'air' as const,
            maxHp: 6,
            hp: 6,
            move: 4,  // flight
            minRange: 1,
            maxRange: 1,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/nightjar-attack-helo.glb",
            scale: 0.11,
            rotation: 0,
            flightAltitude: 1.2,  // hovers above terrain/units
            // Rocket flurry like the artillery barrage VISUALLY, but every
            // rocket goes at the target hex: several small hits on one
            // unit, no splash, no craters.
            attackEffect: 'rocketVolley',
            footprintTexture: null,  // Flies -- leaves no tracks
            terrainCosts: {
                // Flies over everything at a uniform cost, unlike ground units
                WATER: 1,
                SAND: 1,
                GRASS: 1,
                FOREST: 1,
                MOUNTAIN: 1
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'rotor',  // synthesised, see AudioSystem.createRotorBuffer
                attack: 'rlauncher2'
            }
        },
        "Shrike": {
            symbol: "S",
            name: "Shrike",
            unitClass: 'air' as const,
            maxHp: 4,  // fragile, hit-and-run
            hp: 4,
            move: 5,  // very fast
            minRange: 1,
            maxRange: 1,
            minDamage: 6,
            maxDamage: 9,
            attack: 7,
            model: "assets/units/shrike-attack-jet.glb",
            scale: 0.12,
            rotation: 0,
            flightAltitude: 2.5,  // cruises higher than the helicopter
            attackEffect: 'projectile',
            footprintTexture: null,  // Flies -- leaves no tracks
            terrainCosts: {
                WATER: 1,
                SAND: 1,
                GRASS: 1,
                FOREST: 1,
                MOUNTAIN: 1
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'jet',
                attack: 'rlauncher3'
            }
        }
    };

export const unitTypesRecord = UNIT_TYPES as unknown as Record<string, UnitTypeConfig>;

// Rock/paper/scissors combat triangle: AA shreds air, tanks crush AA,
// air hunts tanks. Attacking your own counter is penalized. Artillery,
// infantry, and naval fight everything at 1.0 -- artillery's edge is
// range + splash, not matchups.
export const CLASS_COUNTERS: Record<string, Record<string, number>> = {
    aa:   { air: 2.0, tank: 0.5 },
    tank: { aa: 2.0, air: 0.5 },
    air:  { tank: 2.0, aa: 0.5 },
};

// Hard targeting restrictions on top of the class-modifier triangle:
// artillery lobs shells and infantry carries small arms -- neither can
// touch an AIR unit at all (no attack, no barrage splash). Everything
// else may target anything.
export function canTarget(attackerType: string, defenderType: string): boolean {
    const attackerClass = unitTypesRecord[attackerType]?.unitClass;
    const defenderClass = unitTypesRecord[defenderType]?.unitClass;
    if (defenderClass !== 'air') return true;
    return attackerClass !== 'artillery' && attackerClass !== 'infantry';
}

export function getClassModifier(attackerType: string, defenderType: string): number {
    const attackerClass = unitTypesRecord[attackerType]?.unitClass;
    const defenderClass = unitTypesRecord[defenderType]?.unitClass;
    if (!attackerClass || !defenderClass) return 1.0;
    return CLASS_COUNTERS[attackerClass]?.[defenderClass] ?? 1.0;
}

export function getMovementCost(type: string, terrainType: string): number | null | undefined {
    return unitTypesRecord[type].terrainCosts[terrainType];
}

// ---------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------

// Every skill a unit type has, in slot order. Slot 0 is always its attack,
// derived from the damage and range fields above; anything after it is
// authored in the type's `extraSkills`.
//
// Cached per type because this is read on the hot path -- the beam asks it
// for every candidate gene of every unit at every depth -- and the answer is
// a pure function of a table that never changes at runtime.
const skillCache = new Map<string, readonly SkillDef[]>();

export function skillsFor(type: string): readonly SkillDef[] {
    let skills = skillCache.get(type);
    if (!skills) {
        const config = unitTypesRecord[type];
        if (!config) return [];
        skills = [
            primaryAttackSkill(type, config),
            ...((config.extraSkills ?? []) as readonly SkillDef[]),
        ];
        skillCache.set(type, skills);
    }
    return skills;
}

// A unit type's attack, which every unit has and which is always slot 0.
// Named rather than spelled `skillsFor(type)[0]` at each call site, so the
// convention lives in one place -- the reference leaves the same idea as
// `Spells.First()` scattered through its callers.
export function primarySkill(type: string): SkillDef | undefined {
    return skillsFor(type)[0];
}

export function skillById(type: string, skillId: string): SkillDef | undefined {
    return skillsFor(type).find((skill) => skill.id === skillId);
}
