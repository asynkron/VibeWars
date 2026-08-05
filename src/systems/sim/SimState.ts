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

import * as TerrainSystem from '../../shared/hexengine/terrainStats';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import { NO_COOLDOWNS, skillCost, tickCooldowns, type Cooldowns } from '../../shared/hexengine/skills';

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
    // Skill id -> turns remaining, absent meaning ready. Almost always the
    // shared frozen empty object: every attack in the game has cooldown 0,
    // so a record is only ever allocated for a unit that has actually used
    // a rationed skill.
    cooldowns: Cooldowns;
    // The index of the transport carrying this unit, or null when it is on
    // the board itself.
    //
    // A CARRIED UNIT STAYS IN liveUnits() AND DISAPPEARS FROM getUnitAt().
    // That split is the whole trick, and getting it backwards makes the
    // transport unusable:
    //
    //   Staying listed is what keeps loading score-NEUTRAL. score.ts prices
    //   a unit both directly and through a quadratic army-size term, so a
    //   passenger that left the list would read as dead twice -- loading
    //   would be a self-inflicted loss the search never takes, and
    //   unloading free money it always takes, including into enemy guns.
    //   Listed, with q,r synced to the carrier, also means the
    //   capture-proximity term reads the passenger as being wherever the
    //   transport has driven it, which is the entire point of an APC.
    //
    //   Vanishing from getUnitAt is what makes it CARGO. The pathfinder
    //   blocks on getUnitAt, so a carried unit stops blocking hexes; splash
    //   looks up victims through it, so cargo cannot be shot while loaded.
    //   That last one is the transport's value, and it is why a full APC
    //   has to die with its passengers -- see the attack gene.
    carriedBy: number | null;
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
    // Pieces of one composite structure share this; null means the
    // building stands alone. Capturing the group's entrance captures every
    // piece, so the search values a depot as the single object it looks
    // like rather than as four independently flippable tiles.
    groupId: string | null;
    // The only tile a capture can happen on. A composite's back and side
    // walls are false, so the search cannot plan a capture by parking
    // infantry against the wrong face of a depot.
    isEntrance: boolean;
}

// Facts, not intentions: each event is deterministic to apply, both here
// and (later) against the live game. Units are addressed by their index in
// the turn snapshot; indices stay stable even after deaths.
export type GameEvent =
    | { type: 'unitMoved'; unitIndex: number; toQ: number; toR: number; moveSpent: number }
    // `skillId` names which of the attacker's skills fired. OPTIONAL, and
    // that is load-bearing rather than lazy: seven test files build this
    // event as an object literal, and the neutrality fixture hashes the
    // event log verbatim, so an always-present field would rewrite every
    // one of them and destroy the very comparison that proves this
    // migration changed nothing. Omitted means the unit's primary attack,
    // which is what every event in the game meant before skills existed.
    | { type: 'unitAttacked'; attackerIndex: number; defenderIndex: number; damage: number; skillId?: string }
    | { type: 'unitDied'; unitIndex: number }
    // A unit patched an ally up. Carries the hp actually restored, already
    // clamped by the command layer -- apply() stays mechanical and derives
    // nothing, exactly as it does for damage.
    | { type: 'unitRepaired'; repairerIndex: number; targetIndex: number; hp: number; skillId: string }
    // A unit boarded a transport, and a transport put one down. Separate
    // events rather than a move, because an unload is NOT a move: routing
    // it through unitMoved would derive a capture in the simulation that
    // the live side never performs, and AIController's replay check only
    // validates range and hasAttacked, so it would never notice.
    | { type: 'unitLoaded'; carrierIndex: number; passengerIndex: number; skillId: string }
    | { type: 'unitUnloaded'; carrierIndex: number; passengerIndex: number; toQ: number; toR: number; skillId: string }
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
    // Hp repaired per turn for a unit starting its turn on an owned
    // factory (the HeroesOfBlazor healing-beacon idea). Keep in sync with
    // GameState.FACTORY_REPAIR_HP on the live side.
    static readonly FACTORY_REPAIR_HP = 2;

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
            // THE ONE LINE THAT COVERS THREE PATHS. Every unit that ever
            // enters a SimState comes through here: the live game's
            // GameUnits, condense() feeding its own SimUnits back in, and
            // the headless harness's spawns. The `??` is what lets all
            // three keep working without an edit, and it is why a fork
            // cannot silently lose a cooldown.
            cooldowns: u.cooldowns ?? NO_COOLDOWNS,
            carriedBy: u.carriedBy ?? null,
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
            groupId: b.groupId ?? null,
            // A building with no group is its own way in. A grouped one
            // must say which piece carries the door -- defaulting those to
            // true would make every wall of a depot capturable, which is
            // exactly the rule this flag exists to prevent.
            isEntrance: b.isEntrance ?? (b.groupId == null),
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
                // Cargo rides along. Without this the passenger's
                // coordinates stay where it boarded, and every distance
                // term in score.ts -- including the capture-proximity pull
                // that is the whole point of driving infantry forward --
                // reads a lie.
                for (let i = 0; i < this.baseUnits.length; i++) {
                    const rider = this.getUnit(i);
                    if (rider?.carriedBy === event.unitIndex) {
                        this.setUnit(i, { ...rider, q: event.toQ, r: event.toR });
                    }
                }
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
                if (attacker) {
                    // The cooldown starts HERE, in apply(), rather than at
                    // the command layer -- so it starts identically for a
                    // simulated cast, a replayed one and a player's, all
                    // three of which end up recording this same event.
                    // The reference has two implementations of casting
                    // (Unit.AnimateSpellCast and AIUnit.CastSpell) and
                    // they have already drifted apart on exactly this.
                    //
                    // chargeSkill returns the SAME object for a
                    // zero-cooldown skill, which is every attack in the
                    // game, so this allocates nothing on the hot path.
                    const skill = event.skillId
                        ? UnitSystem.skillById(attacker.type, event.skillId)
                        : UnitSystem.primarySkill(attacker.type);
                    this.setUnit(event.attackerIndex, {
                        ...attacker,
                        ...(skill ? skillCost(attacker, skill) : { hasAttacked: true }),
                    });
                }
                if (defender) this.setUnit(event.defenderIndex, { ...defender, hp: defender.hp - event.damage });
                // Death is a separate explicit event, recorded by the
                // command layer when it sees hp reach 0 -- apply() stays
                // mechanical and never derives new facts.
                return;
            }
            case 'unitRepaired': {
                const repairer = this.getUnit(event.repairerIndex);
                const target = this.getUnit(event.targetIndex);
                if (repairer) {
                    const skill = UnitSystem.skillById(repairer.type, event.skillId);
                    this.setUnit(event.repairerIndex, {
                        ...repairer,
                        ...(skill ? skillCost(repairer, skill) : { hasAttacked: true }),
                    });
                }
                // Clamped again here rather than trusted. The event is
                // replayed against the live game too, and a hp total above
                // maxHp would show as a health bar past full with no way to
                // get back.
                if (target) {
                    this.setUnit(event.targetIndex, {
                        ...target,
                        hp: Math.min(target.maxHp, target.hp + event.hp),
                    });
                }
                return;
            }
            case 'unitLoaded': {
                const carrier = this.getUnit(event.carrierIndex);
                const passenger = this.getUnit(event.passengerIndex);
                if (carrier) {
                    const skill = UnitSystem.skillById(carrier.type, event.skillId);
                    this.setUnit(event.carrierIndex, {
                        ...carrier,
                        ...(skill ? skillCost(carrier, skill) : {}),
                    });
                }
                if (passenger && carrier) {
                    // Coordinates follow the carrier immediately, so the
                    // passenger is never briefly somewhere it is not.
                    this.setUnit(event.passengerIndex, {
                        ...passenger,
                        carriedBy: event.carrierIndex,
                        q: carrier.q,
                        r: carrier.r,
                        move: 0,
                    });
                }
                return;
            }
            case 'unitUnloaded': {
                const carrier = this.getUnit(event.carrierIndex);
                const passenger = this.getUnit(event.passengerIndex);
                if (carrier) {
                    const skill = UnitSystem.skillById(carrier.type, event.skillId);
                    this.setUnit(event.carrierIndex, {
                        ...carrier,
                        ...(skill ? skillCost(carrier, skill) : {}),
                    });
                }
                if (passenger) {
                    this.setUnit(event.passengerIndex, {
                        ...passenger,
                        carriedBy: null,
                        q: event.toQ,
                        r: event.toR,
                        // Lands with no movement left: a transport that
                        // delivers a unit AND lets it drive off is a free
                        // teleport, not a ride. It may still act, which is
                        // the payoff for having been carried.
                        move: 0,
                    });
                }
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
                        // Factory repair: a unit starting its turn on an
                        // owned, standing factory patches up (mirrors
                        // GameState.nextTurn's live rule). Deterministic,
                        // so it may live in apply() like the move reset.
                        const building = this.getBuildingAt(unit.q, unit.r);
                        const repaired = building && building[1].ownerIndex === unit.playerIndex
                            ? Math.min(unit.maxHp, unit.hp + SimState.FACTORY_REPAIR_HP)
                            : unit.hp;
                        this.setUnit(i, {
                            ...unit,
                            hp: repaired,
                            move: UnitSystem.unitTypesRecord[unit.type].move,
                            hasAttacked: false,
                            // Cooldowns tick HERE, beside the move reset,
                            // and only for the side whose turn started --
                            // so a skill spent on my turn is still spent
                            // when the opponent replies, and comes back on
                            // my next turn, not theirs.
                            //
                            // This is also what makes the beam understand
                            // cooldowns with no AI code at all: it plays
                            // out my turn, the reply and my next turn, so
                            // a skill spent at depth 0 is genuinely
                            // unavailable at depth 2, and the sibling line
                            // that held it is scored against the line that
                            // spent it -- by the same number, with no
                            // special case anywhere.
                            cooldowns: tickCooldowns(unit.cooldowns),
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
                const captured = this.getBuilding(event.buildingIndex);
                if (!captured || captured.destroyed) return;
                // A composite building changes hands whole. The prize is
                // credited only on the piece that actually held one -- the
                // depot's prize lives in a single piece, and crediting all
                // four would value one Sabre at four Sabres.
                for (const [index, piece] of this.groupOf(event.buildingIndex)) {
                    const opensFactory = piece.hasHiddenUnit;
                    this.setBuilding(index, {
                        ...piece,
                        ownerIndex: event.playerIndex,
                        hasHiddenUnit: false,
                        // First capture yields the hidden unit; re-captures only
                        // flip ownership and must not re-credit the prize.
                        yieldedTo: opensFactory ? event.playerIndex : piece.yieldedTo,
                    });
                }
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

    // Who is STANDING on this hex. Cargo is skipped: a carried unit shares
    // its transport's coordinates, so without this every loaded APC would
    // report two occupants and the passenger would block its own ride.
    //
    // One line, and it fixes three things at once, because everything that
    // asks "is this hex taken" asks here. simDijkstra blocks on it, so the
    // pathfinder stops seeing cargo. resolveAttack looks up splash victims
    // through it, so cargo cannot be shot while loaded -- which is the
    // transport's entire value, and the reason a destroyed transport has to
    // take its passengers with it.
    getUnitAt(q: number, r: number): [number, SimUnit] | null {
        for (const [i, unit] of this.liveUnits()) {
            if (unit.carriedBy !== null) continue;
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

    // The standing pieces that make up one structure: everything sharing
    // this building's groupId, or just the building itself when it has
    // none. Destroyed pieces are left out -- a piece that sank with its
    // tile is gone, not un-owned.
    *groupOf(buildingIndex: number): Generator<[number, SimBuilding]> {
        const building = this.getBuilding(buildingIndex);
        if (!building || building.destroyed) return;
        if (building.groupId === null) {
            yield [buildingIndex, building];
            return;
        }
        for (const [i, piece] of this.liveBuildings()) {
            if (piece.groupId === building.groupId) yield [i, piece];
        }
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
