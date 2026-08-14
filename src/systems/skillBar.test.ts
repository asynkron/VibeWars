// The three states a skill button can be in, and the one rule the reference
// does not enforce.

import '../test/threeStub';
import { describe, it, expect, beforeEach } from 'vitest';
import { showSkillsFor, armedSkill } from './skillBar';
import { chargeSkill, NO_COOLDOWNS, PIKE_REPAIR, DROVER_LOAD, DROVER_UNLOAD } from '../shared/hexengine/skills';
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
        expect(buttons().map((b) => b.dataset.skill)).toEqual(['Pike:attack', 'Pike:repair', 'Pike:fire']);
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

describe('the live executor spends what the skill says it spends', () => {
    // A regression with a story: the cooldown was charged in the executor
    // and the spent action was set in AIController's replay arm. So a
    // PLAYER could repair and then still shoot, while SimState.apply --
    // reading the same spendsAction flag -- believed the action was gone.
    // Both halves looked right in isolation, which is why nothing caught it
    // until the hp and the hasAttacked flag were read in the same breath.
    it('PIKE_REPAIR says it costs the action', () => {
        expect(PIKE_REPAIR.spendsAction).toBe(true);
    });

    it('and UNLOAD says it does not', () => {
        expect(DROVER_UNLOAD.spendsAction).toBe(false);
        expect(DROVER_LOAD.spendsAction).toBe(true);
    });
});

describe('a spent action closes the bar', () => {
    beforeEach(() => { document.body.replaceChildren(); showSkillsFor(null); });

    it('disables every skill that costs the action once it is gone', () => {
        // The bar asked isReady -- the COOLDOWN only. A unit that had
        // already fired still got its attack auto-armed and every
        // spendsAction button lit, so the player was offered casts that
        // castArmedSkill then silently refused, because it checks the real
        // rule. Unload survives, and should: it does not cost the action.
        showSkillsFor(unit('Drover', { hasAttacked: true }));
        const disabled = Object.fromEntries(buttons().map((b) => [b.dataset.skill, b.disabled]));

        expect(disabled[DROVER_LOAD.id], 'offered a cast the unit cannot pay for').toBe(true);
        expect(disabled[DROVER_UNLOAD.id], 'Unload costs no action and should survive').toBe(false);
    });

    it('does not auto-arm Unload after Load spends the Drover action', () => {
        showSkillsFor(unit('Drover', { hasAttacked: true }));
        expect(armedSkill()!.id).toBe('Drover:attack');
        expect(buttons().find((button) => button.dataset.skill === DROVER_UNLOAD.id)!.disabled).toBe(false);
    });
});
