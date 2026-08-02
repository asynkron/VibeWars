// Map and camera constants
const MAP_CONFIG = {
    ROWS: 50,
    COLS: 50,
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
    CANT_ATTACK: 0x808080   // Gray for can't attack
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

const WATER_FOAM_COLOR = 0x236DA6; // Hex color for water foam
const CRATER_COLOR = '#3A2B1B';
console.log('constants.js loaded');