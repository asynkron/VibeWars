// The three states a skill button can be in, and the one rule the reference
// does not enforce.

import '../test/threeStub';
import { describe, it, expect, beforeEach } from 'vitest';
import { showSkillsFor, armedSkill } from './skillBar';
import { chargeSkill, NO_COOLDOWNS, PIKE_REPAIR } from '../shared/hexengine/skills';
import type { GameUnit } from '../types';

const unit = (type: string, over: Partial<GameUnit> = {}): GameUnit => ({
    type, q: 0, r: 0, playerIndex: 0, hp: 4, maxHp: 4, move: 2, attack: 3,
    minRange: 1, maxRange: 1, hasAttacked: false, cooldowns: NO_COOLDOWNS,
    visualUnit: {} as any, ...over,
});

const buttons = () =>
    Array.from(document.getElementById('skill-bar')!.children) as HTMLButtonElement[];

describe('the skill bar', () => {
    beforeEach(() => { document.body.replaceChildren(); showSkillsFor(null); });

    it('shows one button per skill, attack first', () => {
        showSkillsFor(unit('Pike'));
        expect(buttons().map((b) => b.dataset.skill)).toEqual(['Pike:attack', 'Pike:repair']);
    });

    it('arms the attack by default', () => {
        // So a player who never touches the bar plays exactly the game they
        // played before it existed.
        showSkillsFor(unit('Pike'));
        expect(armedSkill()!.id).toBe('Pike:attack');
        expect(buttons()[0].classList.contains('is-selected')).toBe(true);
    });

    it('badges a charged skill and refuses the click', () => {
        // The reference renders TurnsLeft and then lets you click anyway --
        // neither SelectSpell nor AnimateSpellCast checks Ready, so its
        // legality rests entirely on the UI not offering the option.
        showSkillsFor(unit('Pike', { cooldowns: chargeSkill(NO_COOLDOWNS, PIKE_REPAIR) }));
        const repair = buttons()[1];
        expect(repair.disabled).toBe(true);
        expect(repair.textContent).toContain(String(PIKE_REPAIR.cooldown));

        repair.click();
        expect(armedSkill()!.id).toBe('Pike:attack');
    });

    it('arms a ready skill when clicked', () => {
        showSkillsFor(unit('Pike'));
        buttons()[1].click();
        expect(armedSkill()!.id).toBe('Pike:repair');
        expect(buttons()[1].classList.contains('is-selected')).toBe(true);
        expect(buttons()[0].classList.contains('is-selected')).toBe(false);
    });

    it('shows a single button for a unit with only its attack', () => {
        showSkillsFor(unit('Bulwark'));
        expect(buttons().map((b) => b.dataset.skill)).toEqual(['Bulwark:attack']);
    });

    it('never badges an attack, because every attack is cooldown 0', () => {
        showSkillsFor(unit('Bulwark'));
        expect(buttons()[0].textContent).toBe('⚔');
    });

    it('hides itself when nothing is selected', () => {
        showSkillsFor(unit('Pike'));
        showSkillsFor(null);
        expect(document.getElementById('skill-bar')!.style.display).toBe('none');
        expect(armedSkill()).toBeNull();
    });
});
