// All hexengine/game files are now real ES modules (the JS->TS migration
// is complete). What's left here are genuinely permanent ambient globals,
// not migration-in-progress bridges:

// Transitional global surface assembled from the npm Three.js package in
// threeGlobal.ts. Engine modules can move to direct imports incrementally.
declare const THREE: any;

// getMinimapWorldPosition is referenced by game.ts's minimap drag/click
// handlers but is never defined anywhere in the codebase (pre-existing bug,
// left as-is during the migration -- see git history for the increment that
// found it).
declare const getMinimapWorldPosition: any;

// window extension for values assigned ad hoc across the codebase
// (window.HEX_ENGINE/.HEX_ENGINE_OPTIONS from options.ts, window.hexGrid/
// .GridSystem exposed by GridSystem.ts for external scripting integrations).
interface Window {
  [key: string]: any;
}
