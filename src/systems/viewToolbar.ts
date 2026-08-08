// The toolbar above the minimap: three toggles for how the world is drawn.
//
// Built here rather than in index.html because two of the three have to
// stay in step with things only the code knows -- the minimap's DOM click
// target has to disappear with the minimap it points at, and the button
// states have to reflect whatever was restored from storage rather than
// whatever the markup happened to say.

import { MAP_CONFIG } from '../constants';
import { viewOptions, toggleViewOption, ViewOptions } from '../shared/hexengine/ViewOptions';
import { FrameStats } from './frameStats';
import { renderer, setBloomEnabled } from '../render';

interface ToggleSpec {
    key: keyof ViewOptions;
    label: string;
    title: string;
}

const TOGGLES: ToggleSpec[] = [
    { key: 'grid', label: 'Grid', title: 'Hex grid lines over the terrain' },
    { key: 'textures', label: 'Textures', title: 'Procedural ground detail, roads and tracks' },
    { key: 'minimap', label: 'Minimap', title: 'The overview map below' },
    { key: 'bloom', label: 'Bloom', title: 'Glow around the depots and the surf -- the most expensive pass in the frame' },
    { key: 'grass', label: 'Grass', title: 'Real grass blades on turf tiles, drawn when the camera is close' },
    { key: 'stats', label: 'Stats', title: 'Frame time, draw calls and triangles' },
];

// The minimap's DOM overlay is only a click target -- the map itself is
// drawn into the WebGL canvas by render.ts. Hiding one without the other
// leaves either an invisible click trap or a map that ignores clicks.
function syncMinimapOverlay(options: ViewOptions): void {
    const overlay = document.getElementById('minimap-overlay');
    if (!overlay) return;
    overlay.style.display = options.minimap ? 'block' : 'none';
}

export function initViewToolbar(): void {
    if (document.getElementById('view-toolbar')) return;

    const overlay = document.getElementById('minimap-overlay');
    if (overlay) {
        // One source of truth for where the minimap sits: render.ts places
        // the drawn map from the same constant.
        overlay.style.top = `${MAP_CONFIG.MINIMAP.TOP}px`;
        overlay.style.width = `${MAP_CONFIG.MINIMAP.WIDTH}px`;
        overlay.style.height = `${MAP_CONFIG.MINIMAP.HEIGHT}px`;
    }

    const toolbar = document.createElement('div');
    toolbar.id = 'view-toolbar';

    for (const spec of TOGGLES) {
        const button = document.createElement('button');
        button.className = 'view-toggle';
        button.textContent = spec.label;
        button.title = spec.title;
        button.dataset.key = spec.key;

        const paint = () => {
            const on = viewOptions[spec.key];
            button.classList.toggle('is-on', on);
            // Announced as well as coloured -- these are toggles, and a
            // pressed state is the standard way to say so.
            button.setAttribute('aria-pressed', String(on));
        };
        paint();

        button.addEventListener('click', () => {
            toggleViewOption(spec.key);
            paint();
            if (spec.key === 'minimap') syncMinimapOverlay(viewOptions);
            if (spec.key === 'bloom') setBloomEnabled(viewOptions.bloom);
            if (spec.key === 'stats') FrameStats.setEnabled(viewOptions.stats, renderer);
        });

        toolbar.appendChild(button);
    }

    document.body.appendChild(toolbar);
    syncMinimapOverlay(viewOptions);
    FrameStats.setEnabled(viewOptions.stats, renderer);
}
