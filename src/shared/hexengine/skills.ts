// The unit ability table -- HeroesOfBlazor's Spell, ported as DATA.
//
// The reference models a spell as an abstract class with a virtual
// Apply(caster, target, terrainDefence) that mutates the target in place.
// That shape is unavailable here, for three independent reasons -- any one
// of which alone would settle it:
//
//   1. workerSafety.test.ts walks the simulation's import graph and fails
//      the build if it reaches a renderer. A table read by resolveAttack
//      and by SimState has to be pure data, next to unitStats.
//   2. The search config crosses postMessage to each worker, which
//      structured-clones it. Functions do not survive that -- the bug
//      genes/registry.ts exists to fix. A skill holding behaviour would
//      walk straight back into it.
//   3. SimState is base + event log, and apply() is documented as staying
//      mechanical and never deriving new facts. A skill that reaches in and
//      mutates a unit is exactly what that architecture exists to prevent.
//
// So a skill DECLARES what it does, and the resolvers that already exist --
// resolveAttack for the simulation, resolveLiveAttack for the player -- read
// the declaration, exactly as they read attackEffect today. Behaviour lives
// in a small closed set of resolvers, never on the datum.
//
// It also explains the two empty Apply bodies in the reference. Freeze and
// Shield do nothing not out of laziness: Apply returns void, gets no board
// and no duration channel, and IUnit exposes three members. The abstraction
// supports "add hp" and "subtract hp" and nothing else, so the two spells
// that needed more were shipped as stubs -- on live units, with the AI
// casting them at random and putting them on a three-turn cooldown.

import type { UnitClass } from '../../types';

// Who a skill may be pointed at.
//
// The reference has `Friendly: bool` -- a binary partition over SIDES, with
// no unit predicate and no ground target. It cannot say "mechanical allies
// only" and it cannot say "an empty hex", which are precisely the two new
// skills. So this is a union from the start rather than a bool that grows a
// second bool later.
export type SkillTarget =
    | { kind: 'enemyUnit' }
    | {
        kind: 'allyUnit';
        // Narrower than side. A CLASS LIST rather than a predicate
        // function: this table crosses postMessage, and a list is
        // greppable, testable and clone-safe where a closure is none of
        // the three.
        classes?: readonly UnitClass[];
        onlyDamaged?: boolean;
        includeSelf?: boolean;
    }
    | { kind: 'emptyHex' };

export type SkillEffect =
    // Every attack in the game today. `attackEffect` keeps its exact
    // meaning and its exact five values: it is the visual-effect branch in
    // UnitSystem.attack and the damage-shape branch in resolveAttack.
    | { kind: 'attack'; minDamage: number; maxDamage: number; attackEffect: string }
    | { kind: 'repair'; hp: number }
    | { kind: 'load' }
    | { kind: 'unload' };
    // No status-effect member. Neither codebase has anywhere to store
    // "frozen until turn N", and the reference's two attempts at one are
    // the empty Apply bodies above. The union is the hook; do not add a
    // member until there is a real effect to put in it.

export interface SkillDef {
    // Stable string identity, used in the gene, in the event, in the
    // cooldown record and as the sidebar button's key.
    //
    // Deliberately NOT an array index. The reference addresses spells by
    // SLOT across its sim/live boundary -- AIUnit records Spells.IndexOf
    // and AiSpellCastAction replays Spells[SpellIndex] -- so the moment the
    // two lists differ in order or length it casts the wrong spell, with no
    // error anywhere.
    id: string;
    name: string;
    // Sidebar label: a GLYPH, not an image path. This repo ships no UI icon
    // pipeline, and building one is not part of this feature.
    glyph: string;

    target: SkillTarget;
    minRange: number;
    maxRange: number;

    // Turns before this skill may be used again. ZERO means every turn,
    // which is what every attack in this game is.
    //
    // The reference writes `Cooldown => 1` for the same thing: casting sets
    // TurnsLeft = 1, the owner's next turn-start decrements it to 0, and
    // AttacksLeft was already preventing a second cast. So its Sword and
    // CannonBall read as rationed and are not. Copying the 1 across would
    // be functionally identical and would print a "1" badge over every
    // attack in the game.
    //
    // HARD LIMIT: do not author a cooldown longer than the default engine
    // is deep. Feint plays at beam depth 3, so its own plies are 0 and 2 --
    // one own-turn of lookahead past the present. A two-turn cooldown's
    // re-use is inside that horizon and a three-turn cooldown's is at its
    // edge; anything longer is invisible to the search, which will spend it
    // as though it were free.
    cooldown: number;

    // Whether using this consumes the unit's action for the turn -- the
    // thing `hasAttacked` already tracks.
    spendsAction: boolean;
    // Whether using this ends the unit's movement. The reference sets
    // MovesLeft = 0 on every cast, inside a method named Animate*; kept
    // here as a field so it is a property of the skill rather than a rule
    // buried in a renderer.
    endsMovement: boolean;

    effect: SkillEffect;
}

// A unit's cooldown state: skill id -> turns remaining. Absent means ready.
//
// A plain record rather than the reference's SpellTimer objects, because it
// lives on SimUnit, which is forked hundreds of times per AI turn and
// structured-cloned to workers. An empty record is the overwhelmingly
// common case -- every unit, every turn, until a skill with a nonzero
// cooldown is actually used -- so the helpers below all return the SAME
// object when nothing changes, and the fork stays as cheap as it was.
export type Cooldowns = Readonly<Record<string, number>>;

export const NO_COOLDOWNS: Cooldowns = Object.freeze({});

export function isReady(cooldowns: Cooldowns | undefined, skillId: string): boolean {
    return !cooldowns || !cooldowns[skillId];
}

// Start a skill's cooldown. Returns the same object for a zero-cooldown
// skill, which is every attack in the game -- so the common path allocates
// nothing.
export function chargeSkill(cooldowns: Cooldowns | undefined, skill: SkillDef): Cooldowns {
    if (skill.cooldown <= 0) return cooldowns ?? NO_COOLDOWNS;
    return { ...(cooldowns ?? {}), [skill.id]: skill.cooldown };
}

// One turn passes for this unit. Returns the SAME object when nothing was
// on cooldown, so the turn boundary does not churn allocations across every
// unit on the board; and drops entries at zero rather than keeping them, so
// a record never grows without bound.
export function tickCooldowns(cooldowns: Cooldowns | undefined): Cooldowns {
    if (!cooldowns) return NO_COOLDOWNS;
    const keys = Object.keys(cooldowns);
    if (keys.length === 0) return cooldowns;
    const next: Record<string, number> = {};
    for (const key of keys) {
        const left = cooldowns[key] - 1;
        if (left > 0) next[key] = left;
    }
    return next;
}

// ---------------------------------------------------------------------
// Deriving the roster's skills
// ---------------------------------------------------------------------

// Every unit's existing attack, expressed as its slot-0 skill.
//
// DERIVED, NOT AUTHORED. Writing twelve attack skills by hand would be
// twelve chances to mistype a damage range, and the derivation is total:
// all twelve types carry minDamage, maxDamage, minRange, maxRange and
// attackEffect already. So this reads the same fields the old code read and
// produces a skill that says exactly what the unit always did -- which is
// what makes the migration provably behaviour-neutral rather than
// approximately so.
//
// Slot 0 being the attack is the reference's PrimarySpellRange convention,
// adopted deliberately and pinned by a test rather than left as folklore.
export function primaryAttackSkill(type: string, config: {
    minDamage: number; maxDamage: number; minRange: number; maxRange: number; attackEffect?: string;
}): SkillDef {
    return {
        id: `${type}:attack`,
        name: 'Attack',
        glyph: '⚔',
        target: { kind: 'enemyUnit' },
        minRange: config.minRange,
        maxRange: config.maxRange,
        // Zero, not the reference's 1. See the note on SkillDef.cooldown.
        cooldown: 0,
        spendsAction: true,
        endsMovement: false,
        effect: {
            kind: 'attack',
            minDamage: config.minDamage,
            maxDamage: config.maxDamage,
            attackEffect: config.attackEffect ?? 'projectile',
        },
    };
}

// Pike's repair crew. The owner's "Pike units could do repair on a
// mechanical unit, every x turns", and the reference's Heal is its model --
// but only its shape, not its details.
export const PIKE_REPAIR: SkillDef = {
    id: 'Pike:repair',
    name: 'Repair',
    glyph: '⚒',
    target: {
        kind: 'allyUnit',
        // "Mechanical" spelled as classes, which is genuinely new: the
        // reference's Friendly is a binary partition over SIDES with no
        // unit predicate at all, so it cannot express this. A Pike being
        // unable to repair a Pike falls out for free.
        classes: ['tank', 'aa', 'artillery', 'naval', 'air'],
        // The one unpunished failure mode in the reference: nothing there
        // stops the AI healing a full-health ally. The heal caps at max hp,
        // fitness is unchanged, so the rollout TIES with having done
        // nothing -- and a tie can survive a beam while burning the unit's
        // action and a three-turn cooldown. Enforced at target ENUMERATION
        // rather than in the effect, so the move is unsayable rather than
        // merely unlikely. Same discipline as mend.ts.
        onlyDamaged: true,
    },
    // Not 0. A repair crew has to reach the hull, and it excludes self.
    minRange: 1,
    maxRange: 1,
    // Three, matching the reference's Heal, and the most the default engine
    // can still see -- Feint's plies are 0 and 2, so this sits right at the
    // edge of its horizon. See the note on SkillDef.cooldown.
    cooldown: 3,
    // The owner's call. Pike is the ONLY unit that can capture, so this
    // makes it "repair or shoot or capture" -- a real cost on the only
    // capturing unit, which is what keeps a medic from being free.
    spendsAction: true,
    endsMovement: false,
    effect: { kind: 'repair', hp: 3 },
};
