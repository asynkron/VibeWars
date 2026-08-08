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
import { getGameStateOrNull } from './gameStateStore';

const PORTRAIT_SIZE = 200;

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

    const model = ModelSystem.createModelWithColor(
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

function build(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'unit-info';
    panel.innerHTML = `
        <div class="unit-info-portrait"><img alt=""></div>
        <div class="unit-info-body">
            <div class="unit-info-head">
                <span class="unit-info-name"></span>
                <span class="unit-info-owner"></span>
            </div>
            <div class="unit-info-class"></div>
            <dl class="unit-info-stats"></dl>
        </div>`;
    document.body.appendChild(panel);
    return panel;
}

class UnitInfoPanel {
    private static panel: HTMLElement | null = null;
    private static unit: any = null;
    private static shownHp = -1;

    private static element(): HTMLElement {
        if (!this.panel) this.panel = document.getElementById('unit-info') ?? build();
        return this.panel;
    }

    static show(unit: any): void {
        if (!unit) return this.hide();
        const panel = this.element();
        this.unit = unit;
        this.shownHp = unit.hp;

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
        panel.style.borderLeftColor = colour;

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
        if (this.unit.hp !== this.shownHp) this.show(this.unit);
    }

    static get inspected(): any {
        return this.unit;
    }
}

export { UnitInfoPanel };
