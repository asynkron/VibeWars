// The skill bar: one button per skill of the selected unit.
//
// HeroesOfBlazor's SpellsComponent, ported to plain DOM. The reference is
// twenty lines of Blazor -- a div per spell, the icon as a background
// image, a "selected" class, and the cooldown number rendered inside when
// the spell is not Ready -- and every one of those ideas carries over. What
// does not carry is the mechanism: this repo has no component framework, so
// this follows viewToolbar.ts, which builds its buttons the same way and
// repaints them with a local `paint` closure.
//
// Two differences from the reference, both deliberate:
//
//   GLYPHS, NOT ICONS. Its twelve PNGs are swords and heal runes; there is
//   no UI icon pipeline here and building one is not part of this feature.
//
//   A SKILL ON COOLDOWN IS DISABLED, not merely numbered. The reference
//   renders TurnsLeft and then lets you click anyway -- SelectSpell has no
//   Ready check, and neither does AnimateSpellCast, so legality rests
//   entirely on the UI not offering the illegal option. Here the button is
//   disabled and the click is refused, because "the UI never offers it" is
//   not a rule, it is a hope.

import type { GameUnit } from '../types';
import { skillsFor } from '../shared/hexengine/unitStats';
import { type SkillDef, skillReady } from '../shared/hexengine/skills';

let bar: HTMLDivElement | null = null;
let selectedUnit: GameUnit | null = null;
let selectedSkillId: string | null = null;

// Notified whenever the armed skill changes, so the map can show what the
// skill can be cast on.
//
// A callback rather than a direct call into the renderer: this module is
// tested in jsdom against a stubbed THREE, and an import of
// VisualizationSystem here would drag a canvas into that test.
let onArmed: ((unit: GameUnit | null, skill: SkillDef | null) => void) | null = null;

export function setArmedListener(fn: (unit: GameUnit | null, skill: SkillDef | null) => void): void {
    onArmed = fn;
}

function announceArmed(): void {
    onArmed?.(selectedUnit, armedSkill());
}

function element(): HTMLDivElement {
    // Re-attached rather than merely remembered. Holding the node in a
    // module variable and trusting it is fine until something removes it --
    // and then every repaint lands in a detached element, the bar silently
    // stops appearing, and nothing anywhere errors. Checking `isConnected`
    // costs nothing and turns a silent failure into no failure at all.
    if (bar?.isConnected) return bar;
    bar = document.createElement('div');
    bar.id = 'skill-bar';
    document.body.appendChild(bar);
    return bar;
}

// Which skill the player has armed. The move the map's click handler has to
// resolve against, so it is read rather than guessed.
export function armedSkill(): SkillDef | null {
    if (!selectedUnit || !selectedSkillId) return null;
    return skillsFor(selectedUnit.type).find((s) => s.id === selectedSkillId) ?? null;
}

// Show the bar for a unit, or hide it when nothing is selected.
//
// The reference resets to slot 0 whenever the selected unit changes, which
// is right and is why its primary attack is always armed by default -- the
// player who never touches the bar plays exactly the game they played
// before it existed. Kept.
export function showSkillsFor(unit: GameUnit | null): void {
    selectedUnit = unit;
    const root = element();
    root.replaceChildren();

    if (!unit) {
        root.style.display = 'none';
        selectedSkillId = null;
        return;
    }

    const skills = skillsFor(unit.type);
    if (skills.length === 0) {
        root.style.display = 'none';
        selectedSkillId = null;
        return;
    }
    root.style.display = 'flex';

    // Always return to slot 0. In particular, spending Load must not
    // automatically arm the still-usable Unload: a non-attack skill consumes
    // every subsequent map click by design, which made selection and movement
    // appear locked after a loaded Drover drove away. Unusable skills remain
    // disabled below; selecting the primary skill does not make it usable.
    selectedSkillId = skills[0].id;

    for (const skill of skills) {
        const button = document.createElement('button');
        button.className = 'skill';
        button.dataset.skill = skill.id;
        button.title = `${skill.name} — range ${skill.minRange}-${skill.maxRange}`
            + (skill.cooldown > 0 ? `, every ${skill.cooldown} turns` : '');

        const glyph = document.createElement('span');
        glyph.className = 'skill-glyph';
        glyph.textContent = skill.glyph;
        button.appendChild(glyph);

        // The cooldown badge, drawn only while it is counting -- the
        // reference's `@if (spell.Ready) {} else { @(spell.TurnsLeft) }`,
        // and the reason every attack in the game is cooldown 0 rather
        // than the reference's 1, which would badge all of them.
        const left = unit.cooldowns?.[skill.id] ?? 0;
        if (left > 0) {
            const badge = document.createElement('span');
            badge.className = 'skill-cooldown';
            badge.textContent = String(left);
            button.appendChild(badge);
        }

        const ready = skillReady(unit, skill);
        button.disabled = !ready;
        button.classList.toggle('is-selected', skill.id === selectedSkillId);

        button.addEventListener('click', () => {
            if (!ready) return;
            selectedSkillId = skill.id;
            repaint();
            announceArmed();
        });

        root.appendChild(button);
    }
}

// Repaint selection state without rebuilding, so clicking a skill does not
// flicker the row.
function repaint(): void {
    if (!bar?.isConnected) return;
    for (const child of Array.from(bar.children)) {
        const button = child as HTMLButtonElement;
        button.classList.toggle('is-selected', button.dataset.skill === selectedSkillId);
    }
}

// Called after anything that could have changed a cooldown -- a turn
// boundary, a cast -- so the badges do not go stale while a unit stays
// selected.
export function refreshSkillBar(): void {
    if (selectedUnit) showSkillsFor(selectedUnit);
}
