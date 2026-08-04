// What the skill table has to be true of before anything reads it.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { UNIT_TYPES, unitTypesRecord, skillsFor, primarySkill, skillById } from './unitStats';
import { NO_COOLDOWNS, chargeSkill, isReady, tickCooldowns, type SkillDef } from './skills';

const TYPES = Object.keys(UNIT_TYPES);

describe('every unit\'s attack is its slot-0 skill', () => {
    it.each(TYPES)('%s', (type) => {
        // The convention the reference leaves as folklore -- Spells.First()
        // scattered through its callers, with PrimarySpellRange assuming it
        // separately. Pinned here, once.
        const skill = primarySkill(type)!;
        const config = unitTypesRecord[type];
        expect(skill).toBeDefined();
        expect(skillsFor(type)[0]).toBe(skill);
        expect(skill.effect.kind).toBe('attack');
        // And it says exactly what the unit already did. This is the
        // derivation the behaviour-neutral migration rests on: if these
        // ever disagree, routing attacks through the skill changes the
        // game.
        expect([skill.minRange, skill.maxRange]).toEqual([config.minRange, config.maxRange]);
        if (skill.effect.kind === 'attack') {
            expect([skill.effect.minDamage, skill.effect.maxDamage])
                .toEqual([config.minDamage, config.maxDamage]);
            expect(skill.effect.attackEffect).toBe(config.attackEffect ?? 'projectile');
        }
    });

    it('gives every attack a zero cooldown', () => {
        // The reference writes Cooldown => 1 for "no cooldown", because
        // AttacksLeft was already stopping the second cast. Copying that
        // would badge every attack in the game with a "1".
        for (const type of TYPES) expect(primarySkill(type)!.cooldown).toBe(0);
    });

    it('gives every skill a unique id within its unit', () => {
        // Ids, not indices. The reference addresses spells by slot across
        // its sim/live boundary and casts the wrong one if the lists ever
        // differ.
        for (const type of TYPES) {
            const ids = skillsFor(type).map((s) => s.id);
            expect(new Set(ids).size, `${type} has duplicate skill ids`).toBe(ids.length);
            for (const id of ids) expect(skillById(type, id)!.id).toBe(id);
        }
    });

    it('authors no cooldown longer than the default engine can see', () => {
        // Feint plays at beam depth 3, so its own plies are 0 and 2 -- one
        // own-turn of lookahead. A cooldown longer than that is invisible
        // to the search, which spends it as though it were free.
        for (const type of TYPES) {
            for (const skill of skillsFor(type)) {
                expect(skill.cooldown, `${type}'s ${skill.name}`).toBeLessThanOrEqual(3);
            }
        }
    });

    it('caches, since the beam asks per candidate per unit per depth', () => {
        expect(skillsFor('Bulwark')).toBe(skillsFor('Bulwark'));
    });

    it('answers for a type that does not exist instead of throwing', () => {
        expect(skillsFor('NoSuchUnit')).toEqual([]);
        expect(primarySkill('NoSuchUnit')).toBeUndefined();
    });
});

describe('cooldowns', () => {
    const rationed: SkillDef = { ...primarySkill('Pike')!, id: 'test:rationed', cooldown: 3 };
    const free: SkillDef = primarySkill('Pike')!;

    it('reads absent as ready', () => {
        expect(isReady(NO_COOLDOWNS, 'anything')).toBe(true);
        expect(isReady(undefined, 'anything')).toBe(true);
    });

    it('blocks a charged skill and nothing else', () => {
        const after = chargeSkill(NO_COOLDOWNS, rationed);
        expect(isReady(after, rationed.id)).toBe(false);
        expect(isReady(after, 'some:other')).toBe(true);
    });

    it('allocates nothing for a zero-cooldown skill', () => {
        // Every attack in the game takes this path, hundreds of times per
        // AI turn across forked states.
        expect(chargeSkill(NO_COOLDOWNS, free)).toBe(NO_COOLDOWNS);
    });

    it('counts down and comes back', () => {
        let state = chargeSkill(NO_COOLDOWNS, rationed);
        for (let turn = 0; turn < rationed.cooldown; turn++) {
            expect(isReady(state, rationed.id), `still charged at turn ${turn}`).toBe(false);
            state = tickCooldowns(state);
        }
        expect(isReady(state, rationed.id)).toBe(true);
    });

    it('drops entries rather than keeping zeros', () => {
        let state = chargeSkill(NO_COOLDOWNS, { ...rationed, cooldown: 1 });
        state = tickCooldowns(state);
        expect(Object.keys(state)).toEqual([]);
    });

    it('returns the same object when there is nothing to tick', () => {
        // The turn boundary runs this over every unit on the board, every
        // turn, and almost every one of them has nothing charged.
        expect(tickCooldowns(NO_COOLDOWNS)).toBe(NO_COOLDOWNS);
    });

    it('does not mutate what it was given', () => {
        const before = chargeSkill(NO_COOLDOWNS, rationed);
        const snapshot = { ...before };
        tickCooldowns(before);
        expect(before).toEqual(snapshot);
    });
});
