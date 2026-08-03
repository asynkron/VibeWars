// Shared domain types for the hex engine and game. Introduced during the
// "tighten any to real types" pass that followed the JS->TS module migration.
//
// three.js itself stays untyped (see global.d.ts's `declare const THREE: any`)
// because the runtime version is an old CDN build (r128) and the npm
// @types/three package tracks a much newer API -- pulling it in risked
// false type errors from API drift with no real safety benefit. Object3DLike
// below is a deliberately loose structural type covering only the members
// this codebase actually touches on THREE.Object3D/Group/Mesh instances.

export interface Object3DLike {
  position: { x: number; y: number; z: number; copy(v: any): any; set(x: number, y: number, z: number): any; clone(): any };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): any };
  userData: any;
  children: Object3DLike[];
  name: string;
  parent: Object3DLike | null;
  visible: boolean;
  renderOrder: number;
  castShadow: boolean;
  receiveShadow: boolean;
  add(...objects: Object3DLike[]): any;
  remove(...objects: Object3DLike[]): any;
  getObjectByName(name: string): Object3DLike | undefined;
  clone(recursive?: boolean): Object3DLike;
  traverse(callback: (obj: any) => void): void;
  [key: string]: any;
}

export type HexGroup = Object3DLike;

// A single terrain type's config (WATER/SAND/GRASS/FOREST/MOUNTAIN), see
// TerrainSystem.terrainTypes.
export interface TerrainDecoration {
  model: string;
  color: number;
  chance: number;
}

export interface TerrainTypeConfig {
  name: string;
  moveCost: number;
  baseHeight: number;
  heightVariation: number;
  heightModifier: number;
  threshold: number;
  impassable: boolean;
  decorations: TerrainDecoration[];
  material: { color: number; metalness: number; roughness: number };
}

// Combat class for rock/paper/scissors matchups -- see
// UnitSystem.CLASS_COUNTERS: aa beats air, tank beats aa, air beats tank.
export type UnitClass = 'tank' | 'air' | 'aa' | 'artillery' | 'infantry' | 'naval';

// A single unit type's static config, see UnitSystem.unitTypes.
export interface UnitTypeConfig {
  unitClass: UnitClass;
  // Only unit types with canCapture may take control of buildings by
  // standing on their tile (design rule: infantry only). Consumed by the
  // upcoming buildings/factory feature.
  canCapture?: boolean;
  symbol: string;
  name: string;
  maxHp: number;
  hp: number;
  move: number;
  minRange: number;
  maxRange: number;
  minDamage: number;
  maxDamage: number;
  attack: number;
  model?: string;
  scale?: number;
  rotation?: number;
  // Height above terrain to render this unit type at (e.g. helicopters,
  // jets). Copied onto each unit's visualUnit.userData.flightAltitude at
  // creation time, so it's a per-type default that a specific unit instance
  // can still override individually by mutating its own userData.
  flightAltitude?: number;
  // Small per-model vertical correction added on top of the computed
  // ground height -- for models whose visual base doesn't quite match
  // their bounding box (skids, ground clutter baked into the mesh, etc).
  yOffset?: number;
  attackEffect?: string;
  footprintTexture?: string | null;
  terrainCosts: Record<string, number | null>;
  usePlayerColor: boolean;
  replaceColor?: number;
  // Name of a glTF material (e.g. "teamCamo") to tint with the player color,
  // leaving every other material's texture/color untouched. Alternative to
  // usePlayerColor (recolors everything) and replaceColor (recolors any
  // material whose *current* color is close to a target) for models that
  // were authored with a dedicated team-color material slot.
  teamColorMaterial?: string;
  sounds: { movement: string | null; attack: string | null };
}

// A player as defined in constants.js's `players` array.
export interface PlayerColorConfig {
  id: string;
  color: number;
  units: any[];
}

// Who drives a player's turns: a human at the input, or the search AI.
export type PlayerController = 'human' | 'cpu';

// A player as tracked by GameState (distinct shape from PlayerColorConfig).
export interface GamePlayer {
  id: number;
  name: string;
  color: number;
  controller: PlayerController;
}

// A unit as tracked in GameState.units -- the game-logic representation,
// distinct from its `visualUnit` (the THREE.Object3D that renders it).
export interface GameUnit {
  type: string;
  q: number;
  r: number;
  playerIndex: number;
  hp: number;
  maxHp: number;
  move: number;
  attack: number;
  minRange: number;
  maxRange: number;
  hasAttacked: boolean;
  visualUnit: Object3DLike;
  engineSound?: { source: any; gainNode: any } | null;
}

// A fully-resolved attack outcome for the live execution path: every
// random decision (damage rolls, rocket landing hexes) already made.
// UnitSystem.attack builds one itself for player attacks and accepts one
// from the AI replay, so simulation facts and executed reality match.
export interface ResolvedAttackOutcome {
  damages: Array<{ unit: GameUnit; damage: number }>;
  impacts: Array<{ q: number; r: number; craterDelta: number }>;
}

// A building placed on the map (currently only factories). Ownership is
// per-player-index; null means neutral. A factory may hold one hidden unit
// that is yielded (spawned next to the building) the first time a
// canCapture unit takes the tile; hiddenUnitType is nulled after that, so
// re-captures only flip ownership. `visual` is the THREE group decorating
// the hex (see BuildingSystem).
export interface Building {
  type: 'factory';
  q: number;
  r: number;
  ownerIndex: number | null;
  hiddenUnitType: string | null;
  destroyed: boolean;
  visual?: Object3DLike | null;
}

// A building as authored by a MapProvider -- spawn-time data only.
export interface BuildingSpawn {
  type: 'factory';
  q: number;
  r: number;
  hiddenUnitType: string | null;
}

// A GameMap tile, see MapSystem's Tile class.
export interface TileLike {
  height: number;
  type: string;
  color: number;
  hasRoad: boolean;
  moveCost: number;
}

// Camera transform matrices threaded through render.ts's setupCamera/
// setupMinimap/updateCamera* functions.
export interface CameraMatrices {
  localToWorldMatrix: any;
  worldToLocalMatrix: any;
  localCameraPos?: any;
}
