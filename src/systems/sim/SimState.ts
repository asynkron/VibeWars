// Pure, render-free, event-sourced game state for AI simulation.
//
// The model: ONE flatten of the live game per AI turn (the live state is
// entangled with THREE objects / visualUnit refs, so it can't be used as a
// simulation base directly), then every change is a GameEvent applied on
// top. A SimState is conceptually `base + event log`; the override maps
// below are just a materialized cache of the log so reads stay O(1) even
// inside pathfinding loops that touch many tiles.
//
// Why events (not deep copies) are the source of truth:
//   - fork() is cheap: share the frozen base, copy the (tiny) log + cache.
//     Hundreds of candidate simulations per AI turn pay only for what they
//     change -- important because terrain is destructible (explosions can
//     sink ground into WATER, see GridSystem.modifyHexHeight), so the map
//     is mutable state a simulation must be able to branch on.
//   - The winning candidate's `events` log is directly replayable against
//     the REAL game afterwards: the same facts the simulation committed to
//     are what get executed with visuals/audio, so simulation and reality
//     can't diverge on rules.
//
// Determinism: events carry resolved facts (e.g. the damage dealt), never
// dice rolls. Simulations should resolve randomness up front (expected
// damage = (minDamage + maxDamage) / 2) so replaying a log always
// reproduces the same state.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';

export interface SimTile {
    height: number;
    type: string;
    hasRoad: boolean;
    moveCost: number;
}

export interface SimUnit {
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
}

// A building as the simulation sees it. Deliberately does NOT carry the
// hidden unit's TYPE -- only whether one is still inside. The hidden
// content is invisible to both players by design, so the search must value
// a capture at a fixed expected value (see score.ts) instead of peeking at
// the actual prize. `yieldedTo` marks who opened the factory within THIS
// snapshot's rollout, so horizon scoring can credit the capture even
// though SimState can't spawn the prize unit itself.
export interface SimBuilding {
    q: number;
    r: number;
    ownerIndex: number | null;
    hasHiddenUnit: boolean;
    yieldedTo: number | null;
    destroyed: boolean;
}

// Facts, not intentions: each event is deterministic to apply, both here
// and (later) against the live game. Units are addressed by their index in
// the turn snapshot; indices stay stable even after deaths.
export type GameEvent =
    | { type: 'unitMoved'; unitIndex: number; toQ: number; toR: number; moveSpent: number }
    | { type: 'unitAttacked'; attackerIndex: number; defenderIndex: number; damage: number }
    | { type: 'unitDied'; unitIndex: number }
    | { type: 'terrainModified'; q: number; r: number; delta: number }
    // A canCapture unit ended a move on a building it doesn't own. Applies
    // the ownership flip and (first time only) marks the hidden unit as
    // yielded. The LIVE side spawns the actual prize unit via
    // BuildingSystem's move hook -- AIController must NOT execute this
    // event directly.
    | { type: 'buildingCaptured'; buildingIndex: number; playerIndex: number }
    // A new simulated turn begins for a player: their units regain full
    // movement and may attack again (mirrors GameState.nextTurn's reset).
    // Used by the search's multi-turn lookahead rollouts; never part of the
    // executed first-turn plan.
    | { type: 'turnStarted'; playerIndex: number };

export class SimState {
    readonly cols: number;
    readonly rows: number;

    // Shared, treated as immutable -- all mutation happens via events.
    private readonly baseTiles: readonly SimTile[];
    private readonly baseUnits: readonly SimUnit[];
    private readonly baseBuildings: readonly SimBuilding[];

    // The canonical change history for this branch.
    private log: GameEvent[];

    // Materialized cache of the log (override value null = dead unit).
    private tileOverrides: Map<number, SimTile>;
    private unitOverrides: Map<number, SimUnit | null>;
    private buildingOverrides: Map<number, SimBuilding>;

    private constructor(
        cols: number,
        rows: number,
        baseTiles: readonly SimTile[],
        baseUnits: readonly SimUnit[],
        baseBuildings: readonly SimBuilding[],
        log: GameEvent[],
        tileOverrides: Map<number, SimTile>,
        unitOverrides: Map<number, SimUnit | null>,
        buildingOverrides: Map<number, SimBuilding>
    ) {
        this.cols = cols;
        this.rows = rows;
        this.baseTiles = baseTiles;
        this.baseUnits = baseUnits;
        this.baseBuildings = baseBuildings;
        this.log = log;
        this.tileOverrides = tileOverrides;
        this.unitOverrides = unitOverrides;
        this.buildingOverrides = buildingOverrides;
    }

    // Flatten the live game into a pure base. Call once per AI turn, then
    // fork() per candidate simulation.
    static snapshot(source: {
        map: { cols: number; rows: number; getTile(q: number, r: number): any };
        units: any[];
        buildings?: any[];
    }): SimState {
        const { cols, rows } = source.map;
        const tiles: SimTile[] = new Array(cols * rows);
        for (let q = 0; q < cols; q++) {
            for (let r = 0; r < rows; r++) {
                const t = source.map.getTile(q, r);
                tiles[r * cols + q] = {
                    height: t.height,
                    type: t.type,
                    hasRoad: t.hasRoad,
                    moveCost: t.moveCost,
                };
            }
        }
        const units: SimUnit[] = source.units.map((u: any) => ({
            type: u.type,
            q: u.q,
            r: u.r,
            playerIndex: u.playerIndex,
            hp: u.hp,
            maxHp: u.maxHp,
            move: u.move,
            attack: u.attack,
            minRange: u.minRange,
            maxRange: u.maxRange,
            hasAttacked: u.hasAttacked,
        }));
        // Accepts both the live Building shape (hiddenUnitType) and an
        // already-flattened SimBuilding (hasHiddenUnit) so condense() can
        // feed its own buildings back through. The hidden unit's TYPE is
        // intentionally dropped here -- the simulation stays blind to the
        // factory's content. yieldedTo always starts null: it's a
        // per-snapshot scoring marker, not persistent state.
        const buildings: SimBuilding[] = (source.buildings ?? []).map((b: any) => ({
            q: b.q,
            r: b.r,
            ownerIndex: b.ownerIndex ?? null,
            hasHiddenUnit: b.hasHiddenUnit ?? b.hiddenUnitType != null,
            yieldedTo: null,
            destroyed: !!b.destroyed,
        }));
        return new SimState(cols, rows, tiles, units, buildings, [], new Map(), new Map(), new Map());
    }

    // Flatten this state's CURRENT tiles and live units into a fresh
    // SimState with an empty log and compacted unit indices (dead units
    // drop out). This is "start a new turn snapshot from here" -- exactly
    // what AIController does against the live game, but usable headlessly
    // to chain simulated turns without any UI.
    condense(): SimState {
        const units: SimUnit[] = [];
        for (const [, unit] of this.liveUnits()) {
            units.push({ ...unit });
        }
        return SimState.snapshot({
            map: {
                cols: this.cols,
                rows: this.rows,
                getTile: (q: number, r: number) => this.getTile(q, r),
            },
            units,
            buildings: this.baseBuildings.map((_, i) => this.getBuilding(i)),
        });
    }

    // Cheap branch point: shares the base, copies the log and its cache
    // (both usually a handful of entries). Mutating the fork never affects
    // this state or sibling forks.
    fork(): SimState {
        return new SimState(
            this.cols,
            this.rows,
            this.baseTiles,
            this.baseUnits,
            this.baseBuildings,
            [...this.log],
            new Map(this.tileOverrides),
            new Map(this.unitOverrides),
            new Map(this.buildingOverrides)
        );
    }

    // The change history of this branch relative to the turn snapshot.
    // After the search picks a winner, this is what gets replayed against
    // the real game.
    get events(): readonly GameEvent[] {
        return this.log;
    }

    // Append a fact and update the materialized cache. The ONLY way to
    // mutate a SimState.
    record(event: GameEvent): void {
        this.apply(event);
        this.log.push(event);
    }

    private apply(event: GameEvent): void {
        switch (event.type) {
            case 'unitMoved': {
                const unit = this.getUnit(event.unitIndex);
                if (!unit) return;
                this.setUnit(event.unitIndex, {
                    ...unit,
                    q: event.toQ,
                    r: event.toR,
                    move: unit.move - event.moveSpent,
                });
                return;
            }
            case 'unitAttacked': {
                const attacker = this.getUnit(event.attackerIndex);
                const defender = this.getUnit(event.defenderIndex);
                if (attacker) this.setUnit(event.attackerIndex, { ...attacker, hasAttacked: true });
                if (defender) this.setUnit(event.defenderIndex, { ...defender, hp: defender.hp - event.damage });
                // Death is a separate explicit event, recorded by the
                // command layer when it sees hp reach 0 -- apply() stays
                // mechanical and never derives new facts.
                return;
            }
            case 'unitDied': {
                if (event.unitIndex >= 0 && event.unitIndex < this.baseUnits.length) {
                    this.unitOverrides.set(event.unitIndex, null);
                }
                return;
            }
            case 'turnStarted': {
                for (let i = 0; i < this.baseUnits.length; i++) {
                    const unit = this.getUnit(i);
                    if (unit && unit.playerIndex === event.playerIndex) {
                        this.setUnit(i, {
                            ...unit,
                            move: UnitSystem.unitTypesRecord[unit.type].move,
                            hasAttacked: false,
                        });
                    }
                }
                return;
            }
            case 'terrainModified': {
                // Pure mirror of GridSystem.modifyHexHeight's game rule
                // (minus visuals/footprints/mesh smoothing): raise/lower
                // terrain, converting to WATER when the new height sinks to
                // or below the water base height. Like the original, water
                // tiles can't be modified further, and hasRoad is left
                // untouched on conversion (convertHexToWater doesn't clear
                // it either).
                const tile = this.getTile(event.q, event.r);
                if (!tile || tile.type === 'WATER') return;

                const newHeight = Math.max(0, tile.height + event.delta);
                const waterHeight = TerrainSystem.getTerrainBaseHeight('WATER');

                if (newHeight <= waterHeight) {
                    this.setTile(event.q, event.r, {
                        ...tile,
                        type: 'WATER',
                        height: waterHeight,
                        moveCost: TerrainSystem.terrainTypes.WATER.moveCost,
                    });
                    // Sinking a building's tile destroys the building --
                    // mirrors convertHexToWater removing the hex decorator
                    // on the live side.
                    for (let i = 0; i < this.baseBuildings.length; i++) {
                        const building = this.getBuilding(i)!;
                        if (building.q === event.q && building.r === event.r && !building.destroyed) {
                            this.setBuilding(i, { ...building, destroyed: true });
                        }
                    }
                } else {
                    this.setTile(event.q, event.r, { ...tile, height: newHeight });
                }
                return;
            }
            case 'buildingCaptured': {
                const building = this.getBuilding(event.buildingIndex);
                if (!building || building.destroyed) return;
                const opensFactory = building.hasHiddenUnit;
                this.setBuilding(event.buildingIndex, {
                    ...building,
                    ownerIndex: event.playerIndex,
                    hasHiddenUnit: false,
                    // First capture yields the hidden unit; re-captures only
                    // flip ownership and must not re-credit the prize.
                    yieldedTo: opensFactory ? event.playerIndex : building.yieldedTo,
                });
                return;
            }
        }
    }

    // ---- Reads (override cache first, then shared base) ----

    private tileIndex(q: number, r: number): number | null {
        if (q < 0 || q >= this.cols || r < 0 || r >= this.rows) return null;
        return r * this.cols + q;
    }

    getTile(q: number, r: number): SimTile | null {
        const idx = this.tileIndex(q, r);
        if (idx === null) return null;
        return this.tileOverrides.get(idx) ?? this.baseTiles[idx];
    }

    get unitCount(): number {
        return this.baseUnits.length;
    }

    getUnit(index: number): SimUnit | null {
        if (index < 0 || index >= this.baseUnits.length) return null;
        const override = this.unitOverrides.get(index);
        if (override !== undefined) return override;
        return this.baseUnits[index];
    }

    *liveUnits(): Generator<[number, SimUnit]> {
        for (let i = 0; i < this.baseUnits.length; i++) {
            const unit = this.getUnit(i);
            if (unit) yield [i, unit];
        }
    }

    getUnitAt(q: number, r: number): [number, SimUnit] | null {
        for (const [i, unit] of this.liveUnits()) {
            if (unit.q === q && unit.r === r) return [i, unit];
        }
        return null;
    }

    get buildingCount(): number {
        return this.baseBuildings.length;
    }

    getBuilding(index: number): SimBuilding | null {
        if (index < 0 || index >= this.baseBuildings.length) return null;
        return this.buildingOverrides.get(index) ?? this.baseBuildings[index];
    }

    // Buildings that still exist on the map (destroyed ones sank with
    // their tile and are gone for good).
    *liveBuildings(): Generator<[number, SimBuilding]> {
        for (let i = 0; i < this.baseBuildings.length; i++) {
            const building = this.getBuilding(i)!;
            if (!building.destroyed) yield [i, building];
        }
    }

    getBuildingAt(q: number, r: number): [number, SimBuilding] | null {
        for (const [i, building] of this.liveBuildings()) {
            if (building.q === q && building.r === r) return [i, building];
        }
        return null;
    }

    // ---- Private cache writers (only apply() calls these) ----

    private setTile(q: number, r: number, tile: SimTile): void {
        const idx = this.tileIndex(q, r);
        if (idx !== null) this.tileOverrides.set(idx, tile);
    }

    private setUnit(index: number, unit: SimUnit): void {
        this.unitOverrides.set(index, unit);
    }

    private setBuilding(index: number, building: SimBuilding): void {
        this.buildingOverrides.set(index, building);
    }
}
