// BuildingSystem -- static map buildings (factories) with hidden units.
//
// A factory sits on a hex as that hex's DECORATOR (hex.userData.decorator),
// which buys two behaviors for free from GridSystem:
//   - updateDecoratorTransparency dims the model when a unit stands on the
//     tile (so the capturing unit stays visible), and
//   - convertHexToWater removes the decorator when the tile sinks -- a
//     barrage that drowns the tile visibly destroys the factory. The
//     bookkeeping side of that is onTileSunk(), called from
//     GridSystem.modifyHexHeight's water branch.
//
// Capture rule: a canCapture unit (infantry) ending its move on a building
// its side doesn't own takes it -- hooked into UnitSystem.move()'s
// finalizeStep, the single write path for persistent movement, so player
// and AI captures go through the same code. The first capture yields the
// hidden unit onto a free neighboring tile; re-captures only flip
// ownership/tint.

import { GridSystem } from './GridSystem';
import { HexCoord } from './HexCoord';
import { ModelSystem } from './ModelSystem';
import { TerrainSystem } from './TerrainSystem';
import { UnitSystem } from './UnitSystem';
import { VisualizationSystem } from './VisualizationSystem';
import { getGameState } from '../../systems/gameStateStore';
import { selectedMapProvider } from '../../systems/maps/mapRegistry';
import { PRODUCTION_INTERVAL } from './production';
import type { Building, GameUnit } from '../../types';

// Neutral (unowned) buildings render in gray; owned ones in player color.
const NEUTRAL_TINT = 0x888888;

// Model is ~14.4 units wide; scale 0.12 gives a ~1.73 footprint on our
// radius-1 hexes -- that is the hex's own width across the flats, so the
// building fills its tile without spilling over the edges into the
// neighbours. yOffset is a per-model vertical correction on top of the
// computed ground height.
// The depot pieces are HEX TILES, not buildings standing inside a hex:
// their x spans -7.20..7.20, i.e. corner to corner of a radius-7.2 hex. To
// make their edges actually meet they must be scaled to exactly the tile's
// own radius -- 1/7.2 -- not to the factory's 0.12, which deliberately
// leaves a standalone building at 86% of its tile.
const DEPOT_SCALE = 1 / 7.2;

const BUILDING_TYPES: Record<string, { model: string; scale: number; yOffset: number; keepOrigin?: boolean }> = {
    factory: { model: 'assets/buildings/factory-building.glb', scale: 0.12, yOffset: 0 },
    forgeDepotN: { model: 'assets/buildings/forge-depot-tile-n.glb', scale: DEPOT_SCALE, yOffset: 0, keepOrigin: true },
    forgeDepotS: { model: 'assets/buildings/forge-depot-tile-s.glb', scale: DEPOT_SCALE, yOffset: 0, keepOrigin: true },
    forgeDepotE: { model: 'assets/buildings/forge-depot-tile-e.glb', scale: DEPOT_SCALE, yOffset: 0, keepOrigin: true },
    forgeDepotW: { model: 'assets/buildings/forge-depot-tile-w.glb', scale: DEPOT_SCALE, yOffset: 0, keepOrigin: true },
};

class BuildingSystem {
    static async loadBuildingModels(): Promise<void> {
        await ModelSystem.loadModels(BUILDING_TYPES);
    }

    // The standing pieces of one structure. A composite building (the forge
    // depot's four hexes) is owned as a unit, so every operation that
    // changes ownership has to run over the whole group -- otherwise the
    // pieces tint independently and a depot ends up half one colour and
    // half the other.
    private static groupOf(building: Building): Building[] {
        if (!building.groupId) return [building];
        return getGameState().buildings.filter(
            (b: Building) => b.groupId === building.groupId && !b.destroyed
        );
    }

    // Can a capture happen on this tile? A building with no group is its
    // own way in; a grouped one needs the piece to be marked. Defaulting a
    // grouped piece to true would make every wall of a depot capturable,
    // which is the rule this exists to enforce. Keep in sync with
    // SimState.snapshot's isEntrance default -- if the two disagree, the
    // AI plans captures the live game refuses to perform.
    private static isEntrance(building: Building): boolean {
        return building.isEntrance ?? !building.groupId;
    }

    private static tintFor(ownerIndex: number | null): number {
        if (ownerIndex === null) return NEUTRAL_TINT;
        return getGameState().players[ownerIndex].color;
    }

    // Create (or replace, on ownership change) the building's visual and
    // register it as the hex's decorator.
    private static attachVisual(building: Building): void {
        const hex = HexCoord.findHex(building.q, building.r);
        const base = ModelSystem.getModel(BUILDING_TYPES[building.type].model);
        if (!hex || !base) return;

        if (building.visual && hex.userData.decorator === building.visual) {
            hex.remove(building.visual);
            hex.userData.decorator = null;
        }
        const visual = ModelSystem.createModelWithColor(
            base,
            this.tintFor(building.ownerIndex),
            false,
            null,
            'teamCamo'
        );
        const groundY = TerrainSystem.getHeight(hex) + BUILDING_TYPES[building.type].yOffset;
        visual.position.set(hex.userData.x, groundY, hex.userData.z);
        if (building.rotationDeg) {
            visual.rotation.y = (building.rotationDeg * Math.PI) / 180;
        }
        hex.userData.decorator = visual;
        hex.add(visual);
        building.visual = visual;
        // Dim immediately if a unit is standing on the tile (the capturing
        // unit is, at retint time).
        GridSystem.updateDecoratorTransparency(hex);
    }

    // Populate gameState.buildings from the selected map provider's
    // authored spawns and create their visuals. Call after the map exists
    // and building models are loaded.
    static initializeBuildings(gameState: { buildings: Building[] }): void {
        const spawns = selectedMapProvider().buildings ?? [];
        for (const spawn of spawns) {
            const building: Building = {
                type: spawn.type,
                q: spawn.q,
                r: spawn.r,
                ownerIndex: null,
                hiddenUnitType: spawn.hiddenUnitType,
                groupId: spawn.groupId,
                isEntrance: spawn.isEntrance,
                rotationDeg: spawn.rotationDeg,
                destroyed: false,
                visual: null,
            };
            gameState.buildings.push(building);
            this.attachVisual(building);
        }
    }

    static getBuildingAt(q: number, r: number): Building | undefined {
        return getGameState().buildings.find((b: Building) => b.q === q && b.r === r && !b.destroyed);
    }

    // The unit just came to rest on (unit.q, unit.r): take the building
    // there if the capture rules allow it. Returns true if a capture
    // happened. Called from UnitSystem.move()'s finalizeStep -- and safe
    // to call for any unit; non-infantry simply does nothing.
    static tryCapture(unit: GameUnit): boolean {
        if (!UnitSystem.unitTypesRecord[unit.type]?.canCapture) return false;
        const building = this.getBuildingAt(unit.q, unit.r);
        if (!building || building.ownerIndex === unit.playerIndex) return false;
        // The door rule: a composite is taken from the piece that has one.
        // Its back and side walls are scenery you can stand on.
        if (!this.isEntrance(building)) return false;

        // Whole structure at once -- see groupOf. Every piece retints, so a
        // captured depot changes colour in one step instead of standing
        // half in one player's colour and half in the other's.
        const pieces = this.groupOf(building);
        for (const piece of pieces) {
            piece.ownerIndex = unit.playerIndex;
            // The conqueror waits a full production cycle -- mirrors
            // SimState's buildingCaptured rule exactly, or the AI would
            // plan around deliveries the real game refuses.
            piece.productionCountdown = PRODUCTION_INTERVAL;
            this.attachVisual(piece); // retint
        }

        // The prize comes out of the door the capture came through, wherever
        // in the group it was stored -- a unit appearing behind the back
        // wall would have had no way out.
        for (const piece of pieces) {
            if (!piece.hiddenUnitType) continue;
            const type = piece.hiddenUnitType;
            piece.hiddenUnitType = null;
            // The prize IS the product line: from here on the factory
            // builds this type every cycle (production.ts). Recorded on
            // the ENTRANCE piece -- the countdown ticks there -- however
            // deep in the group the prize was stored.
            building.productType = type;
            this.yieldHiddenUnit(building, type, unit.playerIndex);
        }
        return true;
    }

    // Spawn the factory's hidden unit on a free tile next to it: first the
    // adjacent ring, then distance 2. If literally every candidate tile is
    // blocked (extremely unlikely on our maps), the unit is lost.
    private static yieldHiddenUnit(building: Building, type: string, playerIndex: number): void {
        const gameState = getGameState();
        const config = UnitSystem.unitTypesRecord[type];
        const ring2: Array<{ q: number; r: number }> = [];
        for (let dq = -2; dq <= 2; dq++) {
            for (let dr = -2; dr <= 2; dr++) {
                const q = building.q + dq;
                const r = building.r + dr;
                if (HexCoord.getDistance(building.q, building.r, q, r) === 2) ring2.push({ q, r });
            }
        }
        const candidates: Array<{ q: number; r: number }> = [
            ...HexCoord.getNeighbors(building.q, building.r),
            ...ring2,
        ];
        for (const c of candidates) {
            const tile = gameState.map.getTile(c.q, c.r);
            if (!tile) continue;
            if (config.terrainCosts[tile.type] == null) continue; // impassable for this unit type
            if (gameState.getUnitAt(c.q, c.r)) continue;
            if (this.getBuildingAt(c.q, c.r)) continue; // don't spawn on the other factory
            gameState.spawnUnit(type, c.q, c.r, playerIndex);
            // Same off-by-one resync as initGame: the marker update during
            // creation ran before the unit was in gameState.units.
            VisualizationSystem.updateOwnUnitMarkers(gameState.units);
            return;
        }
        console.warn(`Factory at (${building.q},${building.r}): no free tile to yield ${type} -- unit lost`);
    }

    // The tile at (q, r) sank into water; any building there is destroyed.
    // The visual is already gone (convertHexToWater removed the hex
    // decorator) -- this keeps the bookkeeping in step.
    static onTileSunk(q: number, r: number): void {
        const building = this.getBuildingAt(q, r);
        if (!building) return;
        building.destroyed = true;
        building.visual = null;
    }
}

export { BuildingSystem };
