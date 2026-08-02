// Ambient bridges to classic (non-module) <script> globals that haven't been
// converted to real ES modules yet. As each file is migrated to src/*.ts with
// a proper `export`, remove its entry here and `import` it for real instead.
//
// Everything is typed `any` on purpose during the migration (see tsconfig.json).

// three.js + loaders, loaded via CDN <script> tags in index.html
declare const THREE: any;

// shared/hexengine/utils.js + perlinNoise.js
declare const addColorVariation: any;
declare const getVertexOffset: any;
declare const getVertexOffsets: any;
declare const getHexIntersects: any;
declare const clamp: any;
declare const perlinNoise: any;

// getMinimapWorldPosition is referenced by game.js's minimap drag/click
// handlers but is never defined anywhere in the codebase (pre-existing bug,
// left as-is during this migration -- see PR notes).
declare const getMinimapWorldPosition: any;

// window.gameState, set by game.ts's initGame() and read bare (via the
// classic sloppy-mode global fallback) by setupEventListeners()
declare const gameState: any;

// constants.js
declare const MAP_CONFIG: any;
declare const TERRAIN_CONFIG: any;
declare const players: any;
declare const HIGHLIGHT_COLORS: any;
declare const VISUAL_COLORS: any;
declare const VISUAL_OFFSETS: any;
declare const DEBUG_SETTINGS: any;
declare const WATER_FOAM_COLOR: any;
declare const CRATER_COLOR: any;

// shared/hexengine/*.js
declare const HEX_ENGINE: any;
declare const HexCoord: any;
declare const Tile: any;
declare const GameMap: any;
declare const TerrainSystem: any;
declare const GridSystem: any;
declare const hexGrid: any;

// window extension for values assigned ad hoc across classic scripts
interface Window {
  [key: string]: any;
}
