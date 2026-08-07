import type { FireTile } from './shared/hexengine/fire';
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
export interface TerrainTypeConfig {
  name: string;
  moveCost: number;
  baseHeight: number;
  heightVariation: number;
  heightModifier: number;
  threshold: number;
  impassable: boolean;
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
  // A VITAL unit is its side's whole reason to exist: lose the last one
  // and the match ends immediately, whatever else is still standing. The
  // scenario boards' hard rule -- the Pyramid dies, the Boll has won.
  vital?: boolean;
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
  // Skills BEYOND the attack every unit already has. The attack itself is
  // derived from the fields above (see skills.primaryAttackSkill) and is
  // always slot 0, so this list is only the extras -- Pike's Repair,
  // Drover's Load and Unload.
  //
  // Typed as unknown[] here because types.ts is imported by everything and
  // must stay dependency-free; Skills.skillsFor does the narrowing.
  extraSkills?: readonly unknown[];
  // How many units this type can carry, and which classes. Absent means it
  // is not a transport -- which is every type but the Drover.
  capacity?: number;
  carries?: readonly UnitClass[];
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
  // Skill id -> turns remaining, mirroring SimUnit.cooldowns. The live game
  // and the simulation carry the same per-unit state, because the AI's plan
  // is replayed against this side and the two must agree about what is
  // still available.
  //
  // Typed loosely here for the same reason as extraSkills: types.ts is
  // imported by everything and stays dependency-free.
  cooldowns?: Readonly<Record<string, number>>;
  // Mirrors SimUnit.carriedBy: the transport carrying this unit, or null.
  // Held as a reference rather than an index because the live side has no
  // stable unit indices -- the simulation's indices are per-snapshot.
  carriedBy?: GameUnit | null;
  visualUnit: Object3DLike;
  engineSound?: { source: any; gainNode: any } | null;
}

// A fully-resolved attack outcome for the live execution path: every
// random decision (damage rolls, rocket landing hexes) already made.
// UnitSystem.attack builds one itself for player attacks and accepts one
// from the AI replay, so simulation facts and executed reality match.
export interface ResolvedAttackOutcome {
  // Tiles a destroyed machine set alight, ALREADY ROLLED.
  //
  // The channel that makes the 50% wreck fire happen exactly once. The live
  // game never replays a unitDied event -- it re-derives deaths from the
  // damage -- so a roll on the live death path would throw fresh dice against
  // the ones the AI already searched with. Present means "a plan decided
  // this, apply it"; absent means "a player swung, roll now".
  ignitions?: Array<{ q: number; r: number }>;
  damages: Array<{ unit: GameUnit; damage: number }>;
  impacts: Array<{ q: number; r: number; craterDelta: number }>;
}

// A building placed on the map (currently only factories). Ownership is
// per-player-index; null means neutral. A factory may hold one hidden unit
// that is yielded (spawned next to the building) the first time a
// canCapture unit takes the tile; hiddenUnitType is nulled after that, so
// re-captures only flip ownership. `visual` is the THREE group decorating
// the hex (see BuildingSystem).
// A building's model key. The forge depot is FOUR pieces on four adjacent
// hexes -- each piece is its own building, so capture, tinting, decorator
// transparency and tile-sinking all keep working per hex exactly as they
// did for the single-tile factory.
export type BuildingType = 'factory' | 'forgeDepotN' | 'forgeDepotS' | 'forgeDepotE' | 'forgeDepotW';

export interface Building {
  type: BuildingType;
  q: number;
  r: number;
  ownerIndex: number | null;
  hiddenUnitType: string | null;
  // Pieces sharing a groupId are ONE structure and are owned as one: take
  // any piece and the whole thing changes hands and retints together. A
  // half-owned depot standing in two players' colours is not a state the
  // game has. Undefined (or unique) means the building stands alone.
  groupId?: string;
  // The way in. A composite is taken only by standing on the piece that
  // has the door -- walking onto its back wall does nothing. A building
  // with no group is its own entrance; a grouped one needs exactly one
  // piece marked, or the structure cannot be captured at all.
  isEntrance?: boolean;
  destroyed: boolean;
  // Y rotation in degrees, applied to the model. The depot's southern copy
  // is the northern one turned half a turn, so its pieces must turn with
  // it or their joining edges would face the wrong way.
  rotationDeg?: number;
  visual?: Object3DLike | null;
}

// A building as authored by a MapProvider -- spawn-time data only.
export interface BuildingSpawn {
  type: BuildingType;
  q: number;
  r: number;
  hiddenUnitType: string | null;
  // See Building.groupId: pieces sharing one are captured and tinted as a
  // single structure.
  groupId?: string;
  // See Building.isEntrance: exactly one piece of a group carries the door.
  isEntrance?: boolean;
  rotationDeg?: number;
}

// A GameMap tile, see MapSystem's Tile class.
// Extends FireTile so the live board satisfies the shared fire rules
// structurally, exactly as SimTile does. One rule, two boards.
export interface TileLike extends FireTile {
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
