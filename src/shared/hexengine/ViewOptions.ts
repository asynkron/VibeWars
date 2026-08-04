// Display toggles: hex grid on/off, procedural texture detail on/off,
// minimap on/off. One place so the toolbar, the shaders and the render
// loop cannot drift apart.
//
// How the shader half works, because it is not obvious. onBeforeCompile
// runs PER MATERIAL, and the uniform map it hands you belongs to that
// material -- a shared customProgramCacheKey makes the ground materials
// share one compiled program, but not one set of uniforms. Writing a
// toggle into "the" ground shader would therefore only reach whichever
// material you happened to have.
//
// So the uniform OBJECTS below are shared by reference: every material
// gets the same `{ value }` box assigned into its map, and three.js reads
// `.value` at draw time. Flipping it once flips every tile on the map,
// with no traversal of the scene graph and no material recompiles.
//
// The minimap is a plain boolean instead, because it is not a shader
// effect -- render.ts simply skips drawing it.

export interface ViewOptions {
    grid: boolean;
    textures: boolean;
    minimap: boolean;
    // Frame time and draw calls. A development readout, so it is off by
    // default and deliberately NOT a shader uniform -- see frameStats.ts.
    stats: boolean;
}

const STORAGE_KEY = 'vibewars.viewOptions';

const DEFAULTS: ViewOptions = {
    // The grid reads as part of the game rather than a debug overlay --
    // it is how a player counts the moves a unit has left.
    grid: true,
    textures: true,
    // Off: the map is small enough to read directly, and the minimap costs
    // a second render pass every frame to show it again.
    minimap: false,
    stats: false,
};

function load(): ViewOptions {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULTS };
        const stored = JSON.parse(raw);
        // Only keys we know, only booleans -- a stale or hand-edited entry
        // must not be able to introduce a third state.
        return {
            grid: typeof stored.grid === 'boolean' ? stored.grid : DEFAULTS.grid,
            textures: typeof stored.textures === 'boolean' ? stored.textures : DEFAULTS.textures,
            minimap: typeof stored.minimap === 'boolean' ? stored.minimap : DEFAULTS.minimap,
            stats: typeof stored.stats === 'boolean' ? stored.stats : DEFAULTS.stats,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export const viewOptions: ViewOptions = load();

// Shared by reference into every terrain, water and decal material -- see
// the header. Never replace these objects, only their `.value`.
export const VIEW_UNIFORMS = {
    showGrid: { value: viewOptions.grid ? 1 : 0 },
    showTextures: { value: viewOptions.textures ? 1 : 0 },
};

type Listener = (options: ViewOptions) => void;
const listeners: Listener[] = [];

export function onViewOptionsChanged(listener: Listener): void {
    listeners.push(listener);
}

export function setViewOption<K extends keyof ViewOptions>(key: K, value: ViewOptions[K]): void {
    viewOptions[key] = value;
    VIEW_UNIFORMS.showGrid.value = viewOptions.grid ? 1 : 0;
    VIEW_UNIFORMS.showTextures.value = viewOptions.textures ? 1 : 0;
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(viewOptions));
    } catch {
        // Private browsing or a full quota: the toggle still works for
        // this session, it just will not be remembered.
    }
    for (const listener of listeners) listener(viewOptions);
}

export function toggleViewOption(key: keyof ViewOptions): boolean {
    setViewOption(key, !viewOptions[key]);
    return viewOptions[key];
}
