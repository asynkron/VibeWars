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
import { applyFireTick, ignite, type FireBoard, type FireTile } from '../../shared/hexengine/fire';

// Extends FireTile, so a SimTile can be handed straight to the shared fire
// rules in shared/hexengine/fire.ts without an adapter. That is the point of
// the structural interface: one rule, and the simulation and the live map
// tile both satisfy it.
export interface SimTile extends FireTile {
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
    | { type: 'turnStarted'; playerIndex: number }
    // A unit set light to a tile. Carries the hex rather than a target
    // index because the target IS terrain -- fire is the first skill in the
    // game that does not point at a unit.
    // `skillId` is OPTIONAL and casterIndex may be -1: a wreck sets fire to
    // the trees with nobody casting anything. -1 rather than an omitted
    // field, because that is the value getUnit's bounds check actually
    // catches -- an absent index slips past `index < 0` and survives only on
    // falsiness.
    | { type: 'fireStarted'; q: number; r: number; casterIndex: number; skillId?: string }
    // One turn of wildfire, ALREADY ROLLED. The spread is the only genuinely
    // random rule in the simulation, so the dice are thrown by the command
    // layer and only the outcome travels -- exactly as resolveAttack does
    // for damage. A beam node is replayed independently on every worker
    // thread (see simJob.ts); an event that re-rolled on replay would
    // reconstruct a different board on each one.
    //
    // The countdown is NOT carried: it is derivable from the board and
    // would add an entry per burning tile per turn to the log the
    // neutrality fixture hashes.
    // `aged` is every tile that was alight when the turn began. It is
    // carried rather than re-derived because apply() runs on the REPLAY
    // path: the beam rebuilds each node by replaying its parents' events,
    // once per child, on every worker. A full board scan there cost 20x on
    // a 30x30 map with a single fire burning.
    | { type: 'fireTicked'; ignited: Array<{ q: number; r: number }>; burnedOut: Array<{ q: number; r: number }>; aged: Array<{ q: number; r: number }> }
    // Hp a unit lost walking through fire, already counted over the path
    // the mover actually took.
    | { type: 'unitBurned'; unitIndex: number; damage: number };

// Is any tile in this base array alight? Keyed on the ARRAY, so the answer
// is computed once per turn snapshot and shared by every one of the hundreds
// of forks the search makes from it -- fork() passes baseTiles through by
// reference, which is exactly what makes this cache free.
//
// It exists so that the fire check on the movement path costs nothing on a
// map with no fire on it, which is almost every map almost all of the time.
const baseHasFire = new WeakMap<readonly SimTile[], boolean>();

// Indices of the base tiles that were alight in this snapshot, computed once
// per snapshot and shared by every fork of it -- same trick, same reason.
const baseFireIndices = new WeakMap<readonly SimTile[], number[]>();

function baseFireTiles(base: readonly SimTile[], _cols: number): readonly number[] {
    let found = baseFireIndices.get(base);
    if (found === undefined) {
        found = [];
        for (let i = 0; i < base.length; i++) if (base[i].burning > 0) found.push(i);
        baseFireIndices.set(base, found);
    }
    return found;
}

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
                    // THE FIRE MUST COME THROUGH HERE OR IT DOES NOT EXIST.
                    // condense() round-trips its own tiles back through this
                    // mapper, and it runs after every turnStarted on both hot
                    // paths (headless.ts, search.ts) -- a field this function
                    // forgets is a field that silently resets to nothing once
                    // per turn. This is also the only channel by which a fire
                    // burning on the live board reaches the AI at all.
                    //
                    // `vegetated` defaults false rather than being recomputed:
                    // it is a fact about the scenery that was DRAWN, decided
                    // once at map build from the height the tile had then, and
                    // craters change the height afterwards without ever
                    // redrawing. A tile whose source cannot answer has no
                    // greenery as far as fire is concerned.
                    vegetated: t.vegetated ?? false,
                    burning: t.burning ?? 0,
                    burned: t.burned ?? false,
                };
            }
        }
        // carriedBy is an INDEX here and a GameUnit REFERENCE on the live
        // side (UnitSystem.loadPassenger writes `passenger.carriedBy =
        // carrier`). Copying it through unchanged put an object into a
        // number field, and every consumer compares it against an index --
        // so a loaded transport that reached a snapshot became a passenger
        // carried by nobody, invisible to getUnitAt for the rest of the
        // search and never able to be shot or to die.
        //
        // Resolved by identity against the same array the indices refer to.
        const indexOfCarrier = (value: unknown): number | null => {
            if (value == null) return null;
            if (typeof value === 'number') return value;
            const index = source.units.indexOf(value as any);
            return index >= 0 ? index : null;
        };
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
            carriedBy: indexOfCarrier(u.carriedBy),
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
        // COMPACTING RENUMBERS EVERYTHING AFTER A HOLE, and carriedBy is an
        // index. Copying it through a condense that dropped a dead unit
        // rebound every passenger to whoever now sits at that number --
        // often itself. condense runs on two hot paths, deepEvaluate's
        // rollout and every turn of a headless match, so this went wrong
        // constantly and silently: the passenger stayed hidden from
        // getUnitAt, answered as cargo of an unrelated unit, and teleported
        // whenever THAT unit moved.
        const units: SimUnit[] = [];
        const newIndexOf = new Map<number, number>();
        for (const [oldIndex] of this.liveUnits()) newIndexOf.set(oldIndex, newIndexOf.size);
        for (const [, unit] of this.liveUnits()) {
            units.push({
                ...unit,
                // A carrier that died is no carrier: the passenger is put
                // back on the board rather than left pointing at a ghost.
                // It cannot happen through the command layer, which
                // cascades cargo death, but a snapshot assembled by hand
                // can produce it and silence is the wrong answer.
                carriedBy: unit.carriedBy === null ? null : newIndexOf.get(unit.carriedBy) ?? null,
            });
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
        const copy = new SimState(
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
        // The overrides came along, so the fact that one of them changed
        // the terrain must come along too.
        copy.terrainChanged = this.terrainChanged;
        return copy;
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
            case 'fireStarted': {
                ignite(this.fireBoard, event.q, event.r);
                // The caster pays, through the same skillCost() every other
                // cast goes through. Charging it here rather than in the
                // gene is what stops a simulated Pike from burning the wood
                // and shooting in the same turn while a replayed one cannot.
                const caster = this.getUnit(event.casterIndex);
                if (caster) {
                    const skill = event.skillId ? UnitSystem.skillById(caster.type, event.skillId) : undefined;
                    this.setUnit(event.casterIndex, {
                        ...caster,
                        ...(skill ? skillCost(caster, skill) : { hasAttacked: true }),
                    });
                }
                return;
            }
            case 'fireTicked': {
                applyFireTick(this.fireBoard, event, event.aged);
                return;
            }
            case 'unitBurned': {
                const unit = this.getUnit(event.unitIndex);
                // Like unitAttacked: hp goes down and stops there. Death is
                // a separate explicit event from the command layer.
                if (unit) this.setUnit(event.unitIndex, { ...unit, hp: unit.hp - event.damage });
                return;
            }
            case 'turnStarted': {
                for (let i = 0; i < this.baseUnits.length; i++) {
                    const unit = this.getUnit(i);
                    // Cargo does not get its move back. unitLoaded sets
                    // move: 0 to pin the passenger to the hull, and the
                    // next turnStarted handed it straight back -- so a
                    // loaded Pike could simply walk out of a moving
                    // transport, with no unload, from wherever the hull
                    // happened to be.
                    if (unit && unit.playerIndex === event.playerIndex && unit.carriedBy === null) {
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

    // Everyone who is IN PLAY -- on the board and not inside a transport.
    //
    // liveUnits() answers "exists"; this answers "may act and may be acted
    // upon", and combat wants the second one. Cargo stays listed by
    // liveUnits on purpose (score.ts prices it, so loading is score-neutral
    // -- see genes/transport.ts), but a passenger that is enumerated by the
    // targeting code is a passenger that shoots out of a sealed hull and
    // gets shot through it. Both happened: every target picker, sweepAttacks
    // on BOTH sides of its loop, and the search's per-unit gene assignment
    // all walked liveUnits() with no cargo test.
    *activeUnits(): Generator<[number, SimUnit]> {
        for (const entry of this.liveUnits()) {
            if (entry[1].carriedBy === null) yield entry;
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
        // INDEXED, NOT SCANNED. Profiling a real beam job put this at ~35%
        // of all simulation CPU -- 160 calls per rollout, each re-walking
        // every unit, at 14x the cost of getTile or getUnit. Movement,
        // adjacency and blocking checks all land here.
        //
        // The index is built lazily and thrown away on any unit write, which
        // pays for itself by a wide margin: a rollout does ~160 of these
        // reads against roughly 4 writes, and a rebuild is one pass over ten
        // units. Correctness does not depend on the arithmetic being right,
        // only on the invalidation being total -- see setUnit.
        let index = this.occupancy;
        if (index === null) {
            index = new Map<number, number>();
            for (const [i, unit] of this.liveUnits()) {
                if (unit.carriedBy !== null) continue;
                // Cargo is deliberately absent, exactly as the scan had it:
                // a carried unit shares its transport's hex and must not
                // report as standing on it.
                index.set(unit.r * this.cols + unit.q, i);
            }
            this.occupancy = index;
        }
        if (q < 0 || q >= this.cols || r < 0 || r >= this.rows) return null;
        const found = index.get(r * this.cols + q);
        if (found === undefined) return null;
        const unit = this.getUnit(found);
        return unit ? [found, unit] : null;
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

    // Every tile currently alight, without scanning the map.
    //
    // Fires only ever START through an event, and every event writes a tile
    // OVERRIDE -- so the burning set is (base fires) plus (overrides that
    // burn), and the override map is a handful of entries in any branch.
    // The base scan happens once per turn snapshot and is shared by every
    // fork through the same WeakMap the hasFire check uses.
    *burningTiles(): Generator<{ q: number; r: number }> {
        for (const [idx, tile] of this.tileOverrides) {
            if (tile.burning > 0) yield { q: idx % this.cols, r: Math.floor(idx / this.cols) };
        }
        for (const idx of baseFireTiles(this.baseTiles, this.cols)) {
            // An override wins: a base fire that has since burnt out is
            // already covered by the loop above.
            const override = this.tileOverrides.get(idx);
            if (override ? override.burning > 0 : true) {
                if (!override) yield { q: idx % this.cols, r: Math.floor(idx / this.cols) };
            }
        }
    }

    // Lazily-built hex -> unit index, dropped on any unit write.
    private occupancy: Map<number, number> | null = null;

    // True once a tile write changed type or hasRoad -- see
    // hasTerrainOverrides. Set by setTile, carried across fork().
    private terrainChanged = false;

    // The base tile array as an IDENTITY, for per-snapshot caches outside
    // this file (SimPathfinding's cost-field cache keys a WeakMap on it,
    // exactly as baseHasFire does below). Every fork shares the array by
    // reference, so "same identity" means "same map, same turn snapshot".
    // It is NOT a read path -- getTile is, and it knows about overrides.
    get tileIdentity(): readonly SimTile[] {
        return this.baseTiles;
    }

    // Whether this branch has changed what PATHFINDING sees on any tile --
    // the veto a movement-cost cache must check before trusting
    // tileIdentity alone. Movement reads exactly two tile facts, type and
    // hasRoad, so only a write that changes one of those counts. The
    // distinction matters: FIRE writes tile overrides on every simulated
    // turn of a board with one wreck burning (burning/burned counters),
    // and a veto on "any override at all" killed the cost-field cache in
    // precisely the midgame states that need it most -- measured at 19x on
    // the depth-4 opponent level. Craters that flip a tile to WATER still
    // veto, which is the case the veto exists for.
    get hasTerrainOverrides(): boolean {
        return this.terrainChanged;
    }

    // Whether anything anywhere is burning. The cheap guard the movement
    // path checks before it bothers to reconstruct a route.
    get hasFire(): boolean {
        let base = baseHasFire.get(this.baseTiles);
        if (base === undefined) {
            base = this.baseTiles.some((t) => t.burning > 0);
            baseHasFire.set(this.baseTiles, base);
        }
        if (base) return true;
        // Overrides are the fires lit since the snapshot. There are only
        // ever a handful of them in a branch.
        for (const tile of this.tileOverrides.values()) {
            if (tile.burning > 0) return true;
        }
        return false;
    }

    // The read side of the fire board, public so the command layer can roll
    // a spread before recording it. Writes stay behind the private setter:
    // only apply() may change a board, and only from a recorded event.
    get fireView(): FireBoard {
        return this.fireBoard;
    }

    // SimState as a board the shared fire rules can drive. Reads go through
    // getTile, writes through setTile's copy-on-write override -- which is
    // the whole reason FireBoard takes a setter instead of mutating tiles.
    private get fireBoard(): FireBoard {
        return {
            getTile: (q, r) => this.getTile(q, r),
            setTile: (q, r, tile) => this.setTile(q, r, tile as SimTile),
        };
    }

    private setTile(q: number, r: number, tile: SimTile): void {
        const idx = this.tileIndex(q, r);
        if (idx === null) return;
        // Fire writes burning counters through here every simulated turn;
        // only a change to what movement reads flips the cache veto.
        const previous = this.tileOverrides.get(idx) ?? this.baseTiles[idx];
        if (previous.type !== tile.type || previous.hasRoad !== tile.hasRoad) {
            this.terrainChanged = true;
        }
        this.tileOverrides.set(idx, tile);
    }

    private setUnit(index: number, unit: SimUnit): void {
        this.unitOverrides.set(index, unit);
        // Total invalidation rather than a surgical patch. Every write that
        // can move a unit, kill it, load it or put it down goes through
        // here, and getting a targeted update wrong would put a phantom on a
        // hex -- a bug that would look like the movement rules failing.
        // Rebuilding is one pass over the roster.
        this.occupancy = null;
    }

    private setBuilding(index: number, building: SimBuilding): void {
        this.buildingOverrides.set(index, building);
    }
}
