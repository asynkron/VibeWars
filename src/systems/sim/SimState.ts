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
import { PRODUCTION_INTERVAL, EXPECTED_PRODUCT } from '../../shared/hexengine/production';

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
    // HQs are owned destruction objectives, never capture targets. Optional
    // keeps old serialized/test fixtures equivalent to ordinary buildings.
    isHeadquarters?: boolean;
    // Pieces of one composite structure share this; null means the
    // building stands alone. Capturing the group's entrance captures every
    // piece, so the search values a depot as the single object it looks
    // like rather than as four independently flippable tiles.
    groupId: string | null;
    // The only tile a capture can happen on. A composite's back and side
    // walls are false, so the search cannot plan a capture by parking
    // infantry against the wrong face of a depot.
    isEntrance: boolean;
    // The factory's product line -- what it delivers every
    // PRODUCTION_INTERVAL owner turns (see shared/hexengine/production).
    // Null while the factory is unopened (the sim stays blind to hidden
    // content) or when it never had one. A capture inside a rollout sets
    // EXPECTED_PRODUCT; the live game records the real type at yield and
    // the next snapshot corrects the guess.
    productType: string | null;
    // Owner turns left until the next delivery. Ticks in turnStarted,
    // floors at 1 (due); unitProduced resets it. Capture resets to a full
    // interval -- the conqueror waits a cycle.
    productionCountdown: number;
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
    | {
        type: 'unitAttacked';
        attackerIndex: number;
        defenderIndex: number;
        damage: number;
        skillId?: string;
        // A counterattack is a reaction, not the unit's turn action. It
        // deals damage normally but does not spend hasAttacked/cooldowns.
        isCounter?: true;
    }
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
    | { type: 'unitBurned'; unitIndex: number; damage: number }
    // A factory delivered a unit of its product line -- see
    // shared/hexengine/production.ts for the rule. `unitIndex` is the
    // index the newborn takes (always the state's current unitCount when
    // recorded), carried explicitly so a replay on another thread builds
    // the identical roster. The newborn cannot act on its birth turn:
    // move 0, hasAttacked true, reset by its owner's NEXT turnStarted.
    | { type: 'unitProduced'; buildingIndex: number; unitIndex: number; unitType: string; q: number; r: number; playerIndex: number };

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

// Hex -> building index, keyed on the frozen base array -- same trick again.
// Valid for the array's whole lifetime because building POSITIONS never
// change: events only touch ownership and destroyed, via overrides, so
// every fork sharing the base shares this map too. Lowest index wins on a
// (hypothetical) shared hex, matching the old first-live-building scan; no
// map provider currently places two buildings on one hex.
const baseBuildingIndex = new WeakMap<readonly SimBuilding[], Map<number, number>>();

function buildingIndexByHex(base: readonly SimBuilding[], cols: number): Map<number, number> {
    let found = baseBuildingIndex.get(base);
    if (found === undefined) {
        found = new Map();
        for (let i = 0; i < base.length; i++) {
            const key = base[i].r * cols + base[i].q;
            if (!found.has(key)) found.set(key, i);
        }
        baseBuildingIndex.set(base, found);
    }
    return found;
}

function baseFireTiles(base: readonly SimTile[], _cols: number): readonly number[] {
    let found = baseFireIndices.get(base);
    if (found === undefined) {
        found = [];
        for (let i = 0; i < base.length; i++) if (base[i].burning > 0) found.push(i);
        baseFireIndices.set(base, found);
    }
    return found;
}

// ---- The incremental state hash (see SimState.stateHash). ----
//
// Fingerprint scratch: two FNV-1a lanes built up field by field, then
// XORed into the state's delta lanes by the caller. Module-level mutable
// scratch instead of a returned tuple so a fingerprint allocates nothing
// -- these run inside every setter call of every rollout. Single-threaded
// per module instance (each worker loads its own), so no reentrancy.
const FNV_PRIME = 0x01000193;
const HASH_VIEW = new DataView(new ArrayBuffer(8));
let fpA = 0;
let fpB = 0;

function fpBegin(seed: number): void {
    fpA = (0x811c9dc5 ^ seed) | 0;
    fpB = (0xcbf29ce4 ^ seed) | 0;
}

// Mixed through the full float64 bits: tile heights are fractional, and
// truncating them would merge boards a half-height crater separates.
function fpNumber(value: number): void {
    HASH_VIEW.setFloat64(0, value);
    const lo = HASH_VIEW.getUint32(0);
    const hi = HASH_VIEW.getUint32(4);
    fpA = Math.imul(fpA ^ lo, FNV_PRIME);
    fpA = Math.imul(fpA ^ hi, FNV_PRIME);
    fpB = Math.imul(fpB ^ lo, FNV_PRIME);
    fpB = Math.imul(fpB ^ hi, FNV_PRIME);
}

function fpText(text: string): void {
    fpA = Math.imul(fpA ^ text.length, FNV_PRIME);
    fpB = Math.imul(fpB ^ text.length, FNV_PRIME);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        fpA = Math.imul(fpA ^ code, FNV_PRIME);
        fpB = Math.imul(fpB ^ code, FNV_PRIME);
    }
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
            ...(b.isHeadquarters === true || b.type === 'hq'
                ? { isHeadquarters: true }
                : {}),
            groupId: b.groupId ?? null,
            // A building with no group is its own way in. A grouped one
            // must say which piece carries the door -- defaulting those to
            // true would make every wall of a depot capturable, which is
            // exactly the rule this flag exists to prevent.
            isEntrance: b.isEntrance ?? (b.groupId == null),
            // The product line rides through openly ONLY once the factory
            // is opened (the live side sets productType at yield; condense
            // feeds SimBuildings back through). An unopened factory's
            // hiddenUnitType is deliberately NOT read here -- the sim
            // stays blind to hidden content, as above.
            productType: b.productType ?? null,
            productionCountdown: b.productionCountdown ?? PRODUCTION_INTERVAL,
        }));
        const state = new SimState(cols, rows, tiles, units, buildings, [], new Map(), new Map(), new Map());
        // Counted once here so the unitMoved cargo sweep can be skipped
        // entirely on boards where nothing is ever carried -- which is
        // most of them. Kept current by apply() from this point on.
        for (const u of units) if (u.carriedBy !== null) state.carriedCount++;
        return state;
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
        // the terrain must come along too -- and the hash lanes, which are
        // a pure function of those overrides, and the newborn count, whose
        // units live in those overrides.
        copy.terrainChanged = this.terrainChanged;
        copy.hashLo = this.hashLo;
        copy.hashHi = this.hashHi;
        copy.spawnedCount = this.spawnedCount;
        copy.carriedCount = this.carriedCount;
        // A fork of a non-hashing state carries lanes that stopped
        // tracking the board, so it must not resume mixing into them.
        copy.hashing = this.hashing;
        return copy;
    }

    // The board's identity as a short key -- see the hashLo/hashHi comment
    // for what it covers and the one rule about when two hashes are
    // comparable (forks of a common snapshot only). O(1) to read; the cost
    // was paid a few mixes at a time inside the writes that got here.
    get stateHash(): string {
        return (this.hashLo >>> 0).toString(36) + ':' + (this.hashHi >>> 0).toString(36);
    }

    // One-way opt-out of the incremental hash, for the caller that KNOWS
    // stateHash will never be read on this branch or its forks (see the
    // `hashing` flag). After this, stateHash is stale -- do not read it.
    disableHashing(): void {
        this.hashing = false;
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
                //
                // Guarded by carriedCount: this runs on EVERY move on the
                // replay path, and most boards never load a transport, so
                // the full-roster scan is usually pure waste. The bound is
                // unitCount, not baseUnits.length -- factory newborns live
                // past the base array and can be loaded like anyone else.
                if (this.carriedCount > 0) {
                    for (let i = 0; i < this.unitCount; i++) {
                        const rider = this.getUnit(i);
                        if (rider?.carriedBy === event.unitIndex) {
                            this.setUnit(i, { ...rider, q: event.toQ, r: event.toR });
                        }
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
                if (attacker && !event.isCounter) {
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
                    this.carriedCount++;
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
                    this.carriedCount--;
                }
                return;
            }
            case 'unitDied': {
                // unitCount, not baseUnits.length -- factory newborns can
                // die (and die carried) just like the base roster.
                if (event.unitIndex >= 0 && event.unitIndex < this.unitCount) {
                    // Cargo dying inside its transport still leaves the
                    // hold -- read BEFORE the null override lands, or the
                    // fact that it was carried is gone.
                    if (this.getUnit(event.unitIndex)?.carriedBy != null) this.carriedCount--;
                    // Writes the override directly (setUnit's signature is
                    // for the living), so it must feed the hash lanes
                    // itself -- same before/after pattern as setUnit.
                    this.xorUnit(event.unitIndex);
                    this.unitOverrides.set(event.unitIndex, null);
                    this.xorUnit(event.unitIndex);
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
                for (let i = 0; i < this.unitCount; i++) {
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
                        const repaired = building && !building[1].isHeadquarters
                            && building[1].ownerIndex === unit.playerIndex
                            ? Math.min(unit.maxHp, unit.hp + SimState.FACTORY_REPAIR_HP)
                            : unit.hp;
                        // tickCooldowns returns the SAME object when nothing
                        // was on cooldown (see skills.ts), so reference
                        // equality detects the tick that changed nothing.
                        const ticked = tickCooldowns(unit.cooldowns);
                        // A unit that never acted resets to itself: skip the
                        // write. Identical values are hash-neutral (the
                        // before/after XOR cancels) and turnStarted is one
                        // event either way, so the log and the lanes are
                        // exactly what the unconditional write produced --
                        // minus the override churn and occupancy rebuild.
                        if (repaired === unit.hp
                            && unit.move === UnitSystem.unitTypesRecord[unit.type].move
                            && unit.hasAttacked === false
                            && ticked === unit.cooldowns) {
                            continue;
                        }
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
                            cooldowns: ticked,
                        });
                    }
                }
                // Production countdown ticks with the owner's turn, beside
                // the move reset and for the cooldown rule's reason: the
                // beam replays turnStarted at every depth, so a delivery
                // due in two owner-turns is genuinely two levels away in
                // the search with no AI code at all. Floors at 0 ("due"):
                // the SPAWN is not derived here -- apply stays mechanical
                // -- the command layer reads "due", picks the spot, and
                // records unitProduced, which resets the countdown. A
                // blocked factory simply stays at 0 and is retried.
                for (let i = 0; i < this.baseBuildings.length; i++) {
                    const building = this.getBuilding(i);
                    if (!building || building.destroyed || !building.isEntrance) continue;
                    if (building.ownerIndex !== event.playerIndex) continue;
                    if (building.productType === null) continue;
                    if (building.productionCountdown > 0) {
                        this.setBuilding(i, { ...building, productionCountdown: building.productionCountdown - 1 });
                    }
                }
                return;
            }
            case 'unitProduced': {
                // The newborn takes the next index (carried in the event,
                // so replays on other threads build the identical roster).
                // It cannot act on its birth turn: move 0, hasAttacked
                // true -- its owner's next turnStarted wakes it like any
                // other unit.
                const stats = UnitSystem.unitTypesRecord[event.unitType];
                if (!stats) return;
                this.spawnedCount = Math.max(this.spawnedCount, event.unitIndex - this.baseUnits.length + 1);
                this.setUnit(event.unitIndex, {
                    type: event.unitType,
                    q: event.q,
                    r: event.r,
                    playerIndex: event.playerIndex,
                    hp: stats.hp,
                    maxHp: stats.maxHp,
                    move: 0,
                    attack: stats.attack,
                    minRange: stats.minRange,
                    maxRange: stats.maxRange,
                    hasAttacked: true,
                    cooldowns: NO_COOLDOWNS,
                    carriedBy: null,
                });
                const factory = this.getBuilding(event.buildingIndex);
                if (factory) {
                    this.setBuilding(event.buildingIndex, { ...factory, productionCountdown: PRODUCTION_INTERVAL });
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
                if (!captured || captured.destroyed || captured.isHeadquarters) return;
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
                        // Opening a factory starts its product line. The sim
                        // cannot see the real hidden type, so a rollout's
                        // capture assumes the expected product -- the same
                        // guess captureYield prices. The live game records
                        // the real type at yield, and the next snapshot
                        // replaces this guess with the truth.
                        productType: opensFactory && piece.productType === null
                            ? EXPECTED_PRODUCT
                            : piece.productType,
                        // The conqueror waits a full cycle for delivery.
                        productionCountdown: PRODUCTION_INTERVAL,
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

    // Base roster plus units BORN during this branch (factory production).
    // Newborns live purely in unitOverrides at indices past the base
    // array; spawnedCount is how many such indices exist. Events address
    // newborns by index exactly like everyone else, so nothing downstream
    // knows the difference.
    get unitCount(): number {
        return this.baseUnits.length + this.spawnedCount;
    }

    getUnit(index: number): SimUnit | null {
        if (index < 0 || index >= this.unitCount) return null;
        const override = this.unitOverrides.get(index);
        if (override !== undefined) return override;
        return index < this.baseUnits.length ? this.baseUnits[index] : null;
    }

    *liveUnits(): Generator<[number, SimUnit]> {
        for (let i = 0; i < this.unitCount; i++) {
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
        if (q < 0 || q >= this.cols || r < 0 || r >= this.rows) return null;
        // Positions live in the shared hex index; only the destroyed flag
        // needs the override-aware view.
        const found = buildingIndexByHex(this.baseBuildings, this.cols).get(r * this.cols + q);
        if (found === undefined) return null;
        const building = this.getBuilding(found)!;
        return building.destroyed ? null : [found, building];
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

    // How many units have been BORN in this branch beyond the base roster
    // -- see unitCount. Carried across fork(); reset by a fresh snapshot
    // (condense compacts newborns into the next base roster).
    private spawnedCount = 0;

    // How many living units are currently aboard a transport (carriedBy
    // !== null). Exists so the unitMoved cargo sweep can bail without
    // scanning the roster -- the common case. Initialized by snapshot(),
    // carried across fork(), maintained by unitLoaded/unitUnloaded/
    // unitDied in apply().
    private carriedCount = 0;

    // ---- Incremental state hash: two 32-bit delta lanes. ----
    //
    // Zero at the snapshot; every write XORs in the fingerprint of the
    // touched entity BEFORE and AFTER the change (see xorUnit/xorTile/
    // xorBuilding). XOR is commutative and self-inverse, so the lanes are
    // a pure function of the CURRENT board, not of the route taken to it:
    // two forks that reach the same board by different event orders carry
    // equal lanes, and an intermediate value visited and left again
    // cancels out. That makes stateHash an O(changed-entities) board key
    // where walking the board would be O(board) -- per child, in the
    // search's innermost loop.
    //
    // Valid ONLY between forks of a common snapshot: unchanged entities
    // never enter the lanes, so states from different snapshots are not
    // comparable. That is exactly the dedup use (see SimJob.dedupe), and
    // it is also what makes construction free -- no initial walk.
    private hashLo = 0;
    private hashHi = 0;

    // Whether writes feed the hash lanes at all. Default ON is load-bearing:
    // every test and every direct stateHash reader gets valid lanes without
    // asking. The only consumer of the lanes is dedup (SimJob.dedupe), which
    // is off in the shipped engine, yet every setter paid two fingerprints
    // per write regardless -- measured at ~2% of a search. runSimJob is the
    // one caller that knows up front whether the lanes will be read, so it
    // alone may opt out via disableHashing(); children fork after the flag
    // is set and inherit it (see fork()).
    private hashing = true;

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

    // Whether any standing factory is on a product line for someone --
    // the frozen-future guard's other half: production, like fire, is
    // passive dynamics whose payoff the foresight rollout can watch
    // arrive. Buildings are few, so this is a short loop.
    get hasProduction(): boolean {
        for (let i = 0; i < this.baseBuildings.length; i++) {
            const building = this.getBuilding(i);
            if (building && !building.destroyed && building.isEntrance
                && building.ownerIndex !== null && building.productType !== null) {
                return true;
            }
        }
        return false;
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
        this.xorTile(idx);
        this.tileOverrides.set(idx, tile);
        this.xorTile(idx);
    }

    private setUnit(index: number, unit: SimUnit): void {
        this.xorUnit(index);
        this.unitOverrides.set(index, unit);
        this.xorUnit(index);
        // Total invalidation rather than a surgical patch. Every write that
        // can move a unit, kill it, load it or put it down goes through
        // here, and getting a targeted update wrong would put a phantom on a
        // hex -- a bug that would look like the movement rules failing.
        // Rebuilding is one pass over the roster.
        this.occupancy = null;
    }

    private setBuilding(index: number, building: SimBuilding): void {
        this.xorBuilding(index);
        this.buildingOverrides.set(index, building);
        this.xorBuilding(index);
    }

    // ---- The hash side of every write: fingerprint the CANONICAL view of
    // the touched entity (what getUnit/getTile/getBuilding answer, so a
    // dead unit is one canonical fact however its corpse is stored) and
    // XOR it into the delta lanes. Called before AND after each change --
    // see the lane comment above for why that makes the lanes a function
    // of the board alone. Immutable-per-index facts (a unit's type, a
    // tile's road) are not mixed: within one snapshot's forks they are
    // fixed by the index, which is already the fingerprint seed.

    private xorUnit(index: number): void {
        if (!this.hashing) return;
        fpBegin(index * 4 + 1);
        const unit = this.getUnit(index);
        if (!unit) {
            fpNumber(-1);
        } else {
            fpNumber(unit.q); fpNumber(unit.r); fpNumber(unit.hp); fpNumber(unit.move);
            fpNumber(unit.hasAttacked ? 1 : 0);
            fpNumber(unit.carriedBy ?? -1);
            // Almost always the shared frozen empty object; sorted so key
            // insertion order cannot split identical cooldown states.
            const keys = Object.keys(unit.cooldowns);
            if (keys.length > 0) {
                keys.sort();
                for (const key of keys) { fpText(key); fpNumber((unit.cooldowns as any)[key]); }
            }
        }
        this.hashLo = (this.hashLo ^ fpA) | 0;
        this.hashHi = (this.hashHi ^ fpB) | 0;
    }

    private xorTile(idx: number): void {
        if (!this.hashing) return;
        fpBegin(idx * 4 + 2);
        const tile = this.tileOverrides.get(idx) ?? this.baseTiles[idx];
        fpNumber(tile.height);
        fpNumber(tile.moveCost);
        fpText(tile.type);
        fpNumber((tile.vegetated ? 1 : 0) | (tile.burned ? 2 : 0));
        fpNumber(tile.burning);
        this.hashLo = (this.hashLo ^ fpA) | 0;
        this.hashHi = (this.hashHi ^ fpB) | 0;
    }

    private xorBuilding(index: number): void {
        if (!this.hashing) return;
        fpBegin(index * 4 + 3);
        const building = this.getBuilding(index);
        if (!building) {
            fpNumber(-1);
        } else {
            fpNumber(building.ownerIndex ?? -1);
            fpNumber(building.yieldedTo ?? -1);
            fpNumber(building.destroyed ? 1 : 0);
            fpNumber(building.hasHiddenUnit ? 1 : 0);
        }
        this.hashLo = (this.hashLo ^ fpA) | 0;
        this.hashHi = (this.hashHi ^ fpB) | 0;
    }
}
