// The unit info panel: who is that, and what can it do.
//
// INSPECTING IS NOT COMMANDING, and keeping the two apart is the whole
// design. game.ts's selectUnit refuses anything that is not the current
// human player's own unit, because selection is what a move or an attack
// is issued against -- letting it take an enemy would let a click order the
// enemy around. Inspection has no such stake: any unit, either side, on
// anybody's turn, including a match where both sides are AI and there is no
// human turn at all. So it is a separate piece of state that shares nothing
// with the selection but the click that sets it.
//
// The portrait is a real render of the unit's own model rather than an
// authored icon, so a model or a team colour changing cannot leave a stale
// picture behind.

import { players } from '../constants';
import { ModelSystem } from '../shared/hexengine/ModelSystem';
import { UnitSystem } from '../shared/hexengine/UnitSystem';
import { skillsFor } from '../shared/hexengine/unitStats';
import { isReady, type SkillDef } from '../shared/hexengine/skills';
import { getGameStateOrNull } from './gameStateStore';

const PORTRAIT_SIZE = 200;

// The order the matchups are listed in. Fixed, so the row a player learns
// to look at stays where it was; anything not named here is appended, so a
// class added later shows up instead of silently vanishing.
const CLASS_ORDER = ['infantry', 'tank', 'aa', 'artillery', 'air', 'naval'];

// One real unit type per class.
//
// THE PANEL ASKS THE SAME FUNCTIONS COMBAT ASKS. canTarget and
// getClassModifier are written in terms of unit TYPES, not classes, so
// answering "how does this fare against air" means naming a type that is
// air and putting it through the real rule. Reading CLASS_COUNTERS here
// instead would restate the targeting restrictions in a second place, and
// the first thing to drift would be the panel quietly promising an
// artillery piece it can shoot down a helicopter.
let classReps: [string, string][] | null = null;
function representatives(): [string, string][] {
    if (classReps) return classReps;
    const found = new Map<string, string>();
    for (const [type, config] of Object.entries(UnitSystem.unitTypesRecord)) {
        const unitClass = (config as any)?.unitClass;
        if (!unitClass || found.has(unitClass)) continue;
        found.set(unitClass, type);
    }
    const ordered = CLASS_ORDER.filter((c) => found.has(c));
    const rest = [...found.keys()].filter((c) => !CLASS_ORDER.includes(c));
    classReps = [...ordered, ...rest].map((c) => [c, found.get(c)!] as [string, string]);
    return classReps;
}

// A SECOND, TINY RENDERER, made once and only if a portrait is ever asked
// for. Rendering these through the main renderer would mean either a
// render target and a pixel readback inside the frame loop, or drawing a
// portrait over the board; this costs one small GL context and stays
// entirely out of the way of the game's own rendering.
//
// preserveDrawingBuffer, because toDataURL on a canvas whose buffer has
// been presented reads back empty otherwise.
let portraitRenderer: any = null;
const portraits = new Map<string, string>();

function renderPortrait(type: string, playerIndex: number): string | null {
    const config = UnitSystem.unitTypesRecord[type];
    const source = config?.model ? ModelSystem.getModel(config.model) : null;
    if (!source) return null;

    if (!portraitRenderer) {
        portraitRenderer = new THREE.WebGLRenderer({
            alpha: true, antialias: true, preserveDrawingBuffer: true,
        });
        portraitRenderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE);
        portraitRenderer.setClearColor(0x000000, 0);
    }

    const teamSlots = config.teamColorMaterial
        ? [config.teamColorMaterial]
        : [];
    const model = config.rawMaterials
        ? (teamSlots.length
            ? ModelSystem.cloneWithTeamTint(source, players[playerIndex].color, teamSlots)
            : ModelSystem.cloneUntouched(source))
        : ModelSystem.createModelWithColor(
            source,
            players[playerIndex].color,
            config.usePlayerColor,
            config.replaceColor,
            config.teamColorMaterial
        );

    const scene = new THREE.Scene();
    scene.add(model);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(2, 3, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.45);
    fill.position.set(-2, 1, -1.5);
    scene.add(fill);

    // Frame the model from its own bounds, so a big tank and a small
    // infantry squad both fill the same box.
    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001);

    // ISOMETRIC: equal parts across, up and toward the viewer, which is the
    // three-quarter view a strategy game shows a unit in. Orthographic, so
    // nothing near the camera is exaggerated.
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 20);
    camera.position.copy(centre).add(new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(radius * 4));
    camera.lookAt(centre);

    portraitRenderer.render(scene, camera);
    const url = portraitRenderer.domElement.toDataURL('image/png');

    scene.remove(model);
    return url;
}

function portraitFor(type: string, playerIndex: number): string | null {
    const key = `${type}:${playerIndex}`;
    if (portraits.has(key)) return portraits.get(key)!;
    const url = renderPortrait(type, playerIndex);
    // Cached even when it fails, so a unit with no model does not retry a
    // render on every click.
    portraits.set(key, url ?? '');
    return url;
}

// What a skill actually does, in a few words.
//
// Read off the effect union rather than from a description field, because
// there is no description field -- the numbers live on the effect and this
// is the only place that has to turn them into a sentence. A skill whose
// kind is not handled falls back to its own name, which is wrong-looking
// rather than blank, and blank is the failure that goes unnoticed.
function effectSummary(skill: SkillDef): string {
    const effect = skill.effect as any;
    switch (effect.kind) {
        case 'repair': return `Restores ${effect.hp} HP`;
        case 'load': return 'Picks up an ally';
        case 'unload': return 'Sets its passenger down';
        case 'startFire': return `Sets the ground alight for ${effect.turns} turns`;
        case 'attack': return `${effect.minDamage}-${effect.maxDamage} damage`;
        default: return skill.name;
    }
}

function build(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'unit-info';
    panel.innerHTML = `
        <div class="unit-info-head">
            <span class="unit-info-name"></span>
            <span class="unit-info-owner"></span>
        </div>
        <div class="unit-info-class"></div>
        <div class="unit-info-portrait"><img alt=""></div>
        <div class="unit-info-skills"></div>
        <div class="unit-info-body">
            <dl class="unit-info-stats"></dl>
            <div class="unit-info-vs-label">VERSUS</div>
            <div class="unit-info-vs"></div>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

class UnitInfoPanel {
    private static panel: HTMLElement | null = null;
    private static unit: any = null;
    // What the panel is currently showing, as one comparable string. HP was
    // not enough once cooldowns went on it: a skill coming off cooldown
    // changes nothing about the unit's health and everything about what the
    // panel should say.
    private static shown = '';

    private static element(): HTMLElement {
        if (!this.panel) this.panel = document.getElementById('unit-info') ?? build();
        return this.panel;
    }

    static show(unit: any): void {
        if (!unit) return this.hide();
        const panel = this.element();
        this.unit = unit;
        this.shown = UnitInfoPanel.signature(unit);

        const config = UnitSystem.unitTypesRecord[unit.type] ?? {};
        const player = players[unit.playerIndex];
        const colour = '#' + (player?.color ?? 0xffffff).toString(16).padStart(6, '0');

        const image = panel.querySelector('img') as HTMLImageElement;
        const url = portraitFor(unit.type, unit.playerIndex);
        image.src = url || '';
        image.style.visibility = url ? 'visible' : 'hidden';

        (panel.querySelector('.unit-info-name') as HTMLElement).textContent = config.name ?? unit.type;
        const owner = panel.querySelector('.unit-info-owner') as HTMLElement;
        const state = getGameStateOrNull();
        const mine = state ? state.isPlayerTurn(unit.playerIndex) : false;
        owner.textContent = mine ? 'ACTIVE SIDE' : '';
        owner.style.color = colour;

        (panel.querySelector('.unit-info-class') as HTMLElement).textContent =
            String(config.unitClass ?? '').toUpperCase();

        const range = config.minRange === config.maxRange
            ? `${config.maxRange}`
            : `${config.minRange}–${config.maxRange}`;
        const rows: [string, string][] = [
            ['HP', `${unit.hp} / ${unit.maxHp}`],
            ['Attack', `${config.attack ?? '—'}`],
            ['Damage', `${config.minDamage ?? '—'}–${config.maxDamage ?? '—'}`],
            ['Range', range],
            ['Move', `${unit.move} / ${config.move ?? '—'}`],
        ];
        if (config.flightAltitude) rows.push(['Flies', 'yes']);
        if (config.canCapture) rows.push(['Captures', 'yes']);

        const stats = panel.querySelector('.unit-info-stats') as HTMLElement;
        stats.innerHTML = rows
            .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
            .join('');

        // Matchups. A unit that cannot touch a class at all is a different
        // statement from one that hits it at half strength, so they get
        // different chips rather than a 0.
        const chips = representatives().map(([unitClass, repType]) => {
            if (!UnitSystem.canTarget(unit.type, repType)) {
                return `<span class="vs-chip is-none">${unitClass}<b>—</b></span>`;
            }
            const modifier = UnitSystem.getClassModifier(unit.type, repType);
            const tone = modifier > 1 ? 'is-strong' : modifier < 1 ? 'is-weak' : 'is-even';
            return `<span class="vs-chip ${tone}">${unitClass}<b>×${modifier.toFixed(1)}</b></span>`;
        });
        const vs = panel.querySelector('.unit-info-vs') as HTMLElement;
        vs.innerHTML = chips.join('');

        // SLOT 0 IS THE ATTACK and it is already spelled out above as
        // Attack / Damage / Range -- see skillsFor, where the convention is
        // stated. Listing it again as a "special" would make every unit in
        // the game look like it has one.
        const extras = skillsFor(unit.type).slice(1);
        const skills = panel.querySelector('.unit-info-skills') as HTMLElement;
        panel.classList.toggle('has-skills', extras.length > 0);
        skills.innerHTML = extras.length === 0 ? '' :
            `<div class="unit-info-vs-label">SPECIAL</div>` + extras.map((skill) => {
                const turnsLeft = unit.cooldowns?.[skill.id] ?? 0;
                const ready = isReady(unit.cooldowns, skill.id);
                const range = skill.minRange === skill.maxRange
                    ? `${skill.maxRange}` : `${skill.minRange}-${skill.maxRange}`;
                const meta = [
                    `range ${range}`,
                    skill.cooldown > 0 ? `cooldown ${skill.cooldown}` : 'every turn',
                ];
                if (skill.spendsAction) meta.push('spends action');
                return `<div class="unit-skill ${ready ? '' : 'is-cooling'}">
                    <div class="unit-skill-head"><span class="unit-skill-glyph">${skill.glyph}</span>
                    <span class="unit-skill-name">${skill.name}</span>
                    <span class="unit-skill-state">${ready ? 'READY' : turnsLeft + 'T'}</span></div>
                    <div class="unit-skill-what">${effectSummary(skill)}</div>
                    <div class="unit-skill-meta">${meta.join(' &middot; ')}</div>
                </div>`;
            }).join('');

        panel.classList.add('is-open');
    }

    static hide(): void {
        this.unit = null;
        this.panel?.classList.remove('is-open');
    }

    // Called each frame. The panel is a live readout, not a snapshot: a unit
    // being shot at while you look at it has to show the damage, and one
    // that dies has to stop being shown at all.
    static update(): void {
        if (!this.unit) return;
        const state = getGameStateOrNull();
        if (!state || !state.units.includes(this.unit)) return this.hide();
        if (UnitInfoPanel.signature(this.unit) !== this.shown) this.show(this.unit);
    }

    private static signature(unit: any): string {
        return `${unit.hp}|${unit.move}|${JSON.stringify(unit.cooldowns ?? {})}`;
    }

    static get inspected(): any {
        return this.unit;
    }
}

export { UnitInfoPanel };
