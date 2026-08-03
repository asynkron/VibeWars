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
import type { Building, GameUnit } from '../../types';

// Neutral (unowned) buildings render in gray; owned ones in player color.
const NEUTRAL_TINT = 0x888888;

// Model is ~14.4 units wide; scale 0.1 gives a ~1.4 footprint on our
// radius-1 hexes.
const BUILDING_TYPES: Record<string, { model: string; scale: number }> = {
    factory: { model: 'assets/buildings/factory-building.glb', scale: 0.1 },
};

class BuildingSystem {
    static async loadBuildingModels(): Promise<void> {
        await ModelSystem.loadModels(BUILDING_TYPES);
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
        visual.position.set(hex.userData.x, TerrainSystem.getHeight(hex), hex.userData.z);
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

        building.ownerIndex = unit.playerIndex;
        this.attachVisual(building); // retint

        if (building.hiddenUnitType) {
            const type = building.hiddenUnitType;
            building.hiddenUnitType = null;
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
