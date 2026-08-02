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
  position: { x: number; y: number; z: number; copy(v: any): any; set(x: number, y: number, z: number): any };
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

// A single unit type's static config, see UnitSystem.unitTypes.
export interface UnitTypeConfig {
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
  attackEffect?: string;
  footprintTexture?: string | null;
  terrainCosts: Record<string, number | null>;
  usePlayerColor: boolean;
  replaceColor?: number;
  sounds: { movement: string | null; attack: string | null };
}

// A player as defined in constants.js's `players` array.
export interface PlayerColorConfig {
  id: string;
  color: number;
  units: any[];
}

// A player as tracked by GameState (distinct shape from PlayerColorConfig).
export interface GamePlayer {
  id: number;
  name: string;
  color: number;
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
