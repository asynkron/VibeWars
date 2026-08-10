// Map selection: which map to play is chosen via the ?map=<key> URL
// parameter. The full map definitions (terrain, roads, spawns) live in
// src/systems/maps/, but the SIZE must be known here, import-free --
// render.ts and others read MAP_CONFIG.ROWS/COLS while modules are still
// evaluating, and importing the providers from here would create an
// import cycle. mapRegistry.selectedMapProvider() asserts this table
// stays in sync with the providers.
const MAP_SIZES: Record<string, { rows: number; cols: number }> = {
    // Authored, symmetric, deterministic -- the competitive maps.
    mirror8: { rows: 8, cols: 8 },
    rotor12x18: { rows: 18, cols: 12 },
    ford10: { rows: 10, cols: 10 },
    crown14: { rows: 14, cols: 14 },
    // Random, perlin-generated. One generator, three sizes.
    random20: { rows: 20, cols: 20 },
    random30: { rows: 30, cols: 30 },
    random50: { rows: 50, cols: 50 },
    // Scenario boards -- asymmetric tactical questions. See
    // maps/ChokeMapProvider.ts and systems/sim/scenarios/.
    choke: { rows: 10, cols: 7 },
    chokeRetreat: { rows: 10, cols: 7 },
    chokeTwin: { rows: 9, cols: 8 },
    grove: { rows: 3, cols: 17 },
};

const DEFAULT_MAP_KEY = 'rotor12x18';

function urlParam(name: string): string | null {
    if (typeof window === 'undefined' || !window.location?.search) return null;
    return new URLSearchParams(window.location.search).get(name);
}

function pickMapKey(): string {
    const requested = urlParam('map');
    if (requested && MAP_SIZES[requested]) return requested;
    return DEFAULT_MAP_KEY;
}

const MAP_KEY = pickMapKey();

// The start menu navigates to ?map=<key>&mode=<mode> rather than booting in
// place, because MAP_CONFIG.ROWS/COLS below are read at MODULE SCOPE by
// render.ts and others -- the grid size is fixed before any menu can run,
// so changing maps means a fresh load. `mode` riding along on the same
// navigation is what lets that be one click and one reload rather than two.
const START_MODE = urlParam('mode');

// How hard the CPU thinks. Read here with the rest of the match setup so it
// rides in the same URL, which is what makes a match linkable and what makes
// changing it exactly one reload.
const AI_DIFFICULTY = urlParam('difficulty');

// Map and camera constants
const MAP_CONFIG = {
    ROWS: MAP_SIZES[MAP_KEY].rows,
    COLS: MAP_SIZES[MAP_KEY].cols,
    HEX_RADIUS: 1,
    TILT_ANGLE: 0,
    CAMERA: {
        INITIAL_HEIGHT: 15,
        // Keep the camera clear of units, tall vegetation and near-plane
        // distortion even when the player keeps scrolling inward.
        MIN_HEIGHT: 15,
        MAX_HEIGHT: 50,
        ZOOM_SPEED: 1
    },
    MINIMAP: {
        WIDTH: 300,
        HEIGHT: 300,
        // Distance from the top of the window, leaving room for the view
        // toolbar above it. The minimap is drawn into the WebGL canvas by
        // render.ts while its click target is a DOM overlay, so BOTH read
        // this -- a hardcoded top in the stylesheet would drift.
        TOP: 56
    }
};

// Terrain generation constants for the random (perlin) maps. Read only by
// PerlinMapProvider.
//
// HEIGHT_SCALE AND VALLEY_OFFSET USED TO BE 8 AND 2.2, AND THAT PUT THE
// WHOLE MAP ON THE WRONG SCALE. A tile's height is
//
//     terrain base + noise * HEIGHT_SCALE + variation - VALLEY_OFFSET
//
// so at 8 the noise term alone spanned eight units, and every land tile
// landed somewhere between 1.9 and 12 -- while the terrain table the rest of
// the engine is built around puts sand at 0.70, grass at 0.90-1.20, forest
// at 1.10-1.70 and mountain at 1.60. The random map was living an order of
// magnitude above every other map, and two things read world height
// directly:
//
//   THE GROUND SHADER picks its look from world Y -- sand, grass, forest,
//   then rock from 1.60 upward. Every land tile on the map was past the rock
//   band, so the whole thing rendered as granite. It was not mountainous
//   terrain: on a 50x50 map only 74
//   tiles of 2500 are actually MOUNTAIN, and 1150 are grass. It was grass,
//   painted as rock.
//
//   THE SHORELINE snaps a land tile's water-facing corners down to the
//   waterline so the beach meets the water. From 1.9-12 that is a two to
//   twelve unit cliff around every lake -- the "craters".
//
// 1.2 and 0.6 put the noise term in the same range as the authored maps'
// relief, so the same shader bands and the same shoreline rule produce the
// same look they were designed for. The generator itself is untouched: same
// noise, same scale, same terrain thresholds, same map.
const TERRAIN_CONFIG = {
    PERLIN_SCALE: 10,
    VALLEY_OFFSET: 0.6, // Offset to create valleys in terrain height
    HEIGHT_SCALE: 1.2   // Maximum height variation scale
};

// Player definitions
const players = [
    { id: 'human', color: 0x0A40F2, units: [] },
    { id: 'cpu1', color: 0xFF5000, units: [] }
];

// Highlight colors
const HIGHLIGHT_COLORS = {
    VISIBLE_AREA: 0xFFFFFF, // Yellow for visible area in minimap
    SELECTED: 0x00FF00,     // Green for selected unit
    MOVE_RANGE: 0xFAFFA0,   // Goldenrod for move range
    ATTACK_RANGE: 0x8B0000, // Dark red for attack range
    CANT_ATTACK: 0x808080,  // Gray for can't attack
    OWN_UNIT: 0x40C4FF,     // Cyan outline marking the ground tile under each of the player's own units
    SKILL_TARGET: 0xFF8C1A   // Amber: a hex the armed skill can actually be cast on
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
    MAP_CONFIG, MAP_KEY, MAP_SIZES, START_MODE, AI_DIFFICULTY, TERRAIN_CONFIG, players, HIGHLIGHT_COLORS, VISUAL_COLORS,
    VISUAL_OFFSETS, DEBUG_SETTINGS, CRATER_COLOR,
};
