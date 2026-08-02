// All hexengine/game files are now real ES modules (the JS->TS migration
// is complete). What's left here are genuinely permanent ambient globals,
// not migration-in-progress bridges:

// three.js + loaders, loaded via CDN <script> tags in index.html (not an
// npm dependency, so there's no module to import from).
declare const THREE: any;

// getMinimapWorldPosition is referenced by game.ts's minimap drag/click
// handlers but is never defined anywhere in the codebase (pre-existing bug,
// left as-is during the migration -- see git history for the increment that
// found it).
declare const getMinimapWorldPosition: any;

// window.gameState is set by game.ts's initGame() (a local variable in that
// function) and read bare by the sibling setupEventListeners() function,
// which has no closure access to it -- relies on the window fallback by
// design, not a migration artifact.
declare const gameState: any;

// window.hexGrid is intentionally exposed by GridSystem.ts as a public API
// for external scripting integrations (see GridSystem.ts's trailing comment).
declare const hexGrid: any;

// window extension for values assigned ad hoc across the codebase
interface Window {
  [key: string]: any;
}
