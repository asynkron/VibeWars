// Map selection: which map to play is chosen via the ?map=<key> URL
// parameter. The full map definitions (terrain, roads, spawns) live in
// src/systems/maps/, but the SIZE must be known here, import-free --
// render.ts and others read MAP_CONFIG.ROWS/COLS while modules are still
// evaluating, and importing the providers from here would create an
// import cycle. mapRegistry.selectedMapProvider() asserts this table
// stays in sync with the providers.
const MAP_SIZES: Record<string, { rows: number; cols: number }> = {
    mirror8: { rows: 8, cols: 8 },
    random50: { rows: 50, cols: 50 },
};

const DEFAULT_MAP_KEY = 'mirror8';

function pickMapKey(): string {
    if (typeof window !== 'undefined' && window.location?.search) {
        const requested = new URLSearchParams(window.location.search).get('map');
        if (requested && MAP_SIZES[requested]) return requested;
    }
    return DEFAULT_MAP_KEY;
}

const MAP_KEY = pickMapKey();

// Map and camera constants
const MAP_CONFIG = {
    ROWS: MAP_SIZES[MAP_KEY].rows,
    COLS: MAP_SIZES[MAP_KEY].cols,
    HEX_RADIUS: 1,
    TILT_ANGLE: 0,
    CAMERA: {
        INITIAL_HEIGHT: 15,
        MIN_HEIGHT: 5,
        MAX_HEIGHT: 50,
        ZOOM_SPEED: 1
    },
    MINIMAP: {
        WIDTH: 300,
        HEIGHT: 300
    }
};

// Terrain generation constants
const TERRAIN_CONFIG = {
    PERLIN_SCALE: 10,
    VALLEY_OFFSET: 2.2, // Offset to create valleys in terrain height
    HEIGHT_SCALE: 8     // Maximum height variation scale
};

// Player definitions
const players = [
    { id: 'human', color: 0x0050FF, units: [] },
    { id: 'cpu1', color: 0xFF5000, units: [] }
];

// Highlight colors
const HIGHLIGHT_COLORS = {
    VISIBLE_AREA: 0xFFFFFF, // Yellow for visible area in minimap
    SELECTED: 0x00FF00,     // Green for selected unit
    MOVE_RANGE: 0xFAFFA0,   // Goldenrod for move range
    ATTACK_RANGE: 0x8B0000, // Dark red for attack range
    CANT_ATTACK: 0x808080,  // Gray for can't attack
    OWN_UNIT: 0x40C4FF      // Cyan outline marking the ground tile under each of the player's own units
};

// Visual effect colors
const VISUAL_COLORS = {
    PATH: 0xFF0000,         // Red for path lines
    HEX_BORDER: 0x000000,   // Black for hex borders
    FOG: 0x87CEEB,          // Sky blue for fog
    BACKGROUND_LIGHT: 0xF0F0F0, // Light gray for background
    BACKGROUND_DARK: 0x333333   // Dark gray for background
};

// Visual offsets
const VISUAL_OFFSETS = {
    UNIT_OFFSET: 0.0,      // Height offset for units above terrain
    PATH_HEIGHT: 0.2,      // Height for path visualization
    HIGHLIGHT_OFFSET: 0.1, // Height offset for hex highlights
    FOOTPRINT_OFFSET: 0.01
};

// Debug settings
const DEBUG_SETTINGS = {
    SHOW_UNIT_BOUNDING_BOXES: true, // Show red wireframe boxes around units
    SHOW_GROUND_LEVEL: true         // Show green squares at y=0
};

const CRATER_COLOR = '#3A2B1B';

export {
    MAP_CONFIG, MAP_KEY, TERRAIN_CONFIG, players, HIGHLIGHT_COLORS, VISUAL_COLORS,
    VISUAL_OFFSETS, DEBUG_SETTINGS, CRATER_COLOR,
};