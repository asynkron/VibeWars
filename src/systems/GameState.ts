// GameState.js - Manages the overall game state
import { UnitSystem } from '../shared/hexengine/UnitSystem';
import { GameMap } from '../shared/hexengine/MapSystem';
import { AIController } from './ai/AIController';
import { selectedMapProvider } from './maps/mapRegistry';
import type { Building, GameUnit, GamePlayer, PlayerController } from '../types';
import { NO_COOLDOWNS, tickCooldowns } from '../shared/hexengine/skills';
import { refreshSkillBar } from './skillBar';
import { applyFireTick, burningTilesOf, FIRE_DAMAGE, tickFires, unitsStandingInFire, type FireBoard } from '../shared/hexengine/fire';
import { FireSystem } from '../shared/hexengine/FireSystem';
import { VisualizationSystem } from '../shared/hexengine/VisualizationSystem';

class GameState {
    static readonly CPU_TURN_PAUSE_MS = 400;
    // Hp repaired per turn for a unit starting its turn on an owned
    // factory. Keep in sync with SimState.FACTORY_REPAIR_HP.
    static readonly FACTORY_REPAIR_HP = 2;
    static readonly MAX_TURNS = 200;
    static readonly STALEMATE_IDLE_TURNS = 4;
    static readonly STALEMATE_NO_COMBAT_TURNS = 40;

    map: GameMap;
    players: GamePlayer[];
    units: GameUnit[];
    // Factories etc. -- populated by BuildingSystem.initializeBuildings
    // from the map provider's authored spawns.
    buildings: Building[] = [];
    currentTurn: number;
    gameOver: boolean;
    turnCount = 0;
    // Consecutive CPU turns that executed nothing / saw no combat, for
    // stalemate detection in AI-vs-AI matches.
    idleCpuTurns = 0;
    turnsWithoutCombat = 0;

    // Each side can be driven by a human or by the search AI -- picked in
    // the start menu (human vs cpu, cpu vs cpu to watch the AI fight
    // itself, or hotseat human vs human).
    constructor(controllers: [PlayerController, PlayerController] = ['human', 'cpu']) {
        this.map = new GameMap();
        this.players = [];  // Array of player objects
        this.units = [];    // Flat array of all units
        this.currentTurn = 0;
        this.gameOver = false;

        const nameFor = (controller: PlayerController, index: number) =>
            `${controller === 'human' ? 'Human' : 'AI'} ${index + 1}`;
        this.players.push({ id: 0, name: nameFor(controllers[0], 0), color: 0x0000ff, controller: controllers[0] });
        this.players.push({ id: 1, name: nameFor(controllers[1], 1), color: 0xff0000, controller: controllers[1] });
    }

    // Kick off the first turn once the world is fully initialized -- if
    // player 0 is CPU-controlled (AI vs AI), its turn must start without
    // any human pressing End Turn.
    start(): void {
        if (!this.gameOver && this.getCurrentPlayer().controller === 'cpu') {
            this.cpuTurn();
        }
    }

    nextTurn(): void {
        if (this.gameOver) return;

        // Victory check: a side with no units left has lost. Without this,
        // an AI-vs-AI match would keep exchanging empty turns forever.
        if (this.units.length > 0) {
            const alive = this.players.map((p) => this.units.some((u) => u.playerIndex === p.id));
            const losers = alive.filter((a) => !a).length;
            if (losers > 0) {
                const winner = alive.findIndex((a) => a);
                this.endGame(winner, winner >= 0 ? 'elimination' : 'mutual destruction');
                return;
            }
        }

        // Stalemate check (CPU vs CPU only -- humans decide for themselves
        // when to stop): if the armies can no longer accomplish anything
        // (e.g. separated by water, unable to reach or hurt each other),
        // the match is unwinnable and must end. Detected as consecutive AI
        // turns that executed nothing, prolonged turns without any combat,
        // or an absolute turn cap. Decided on points: higher total hp wins.
        if (this.players.every((p) => p.controller === 'cpu')) {
            if (this.idleCpuTurns >= GameState.STALEMATE_IDLE_TURNS) {
                this.endGameOnPoints('stalemate -- no side can act');
                return;
            }
            if (this.turnsWithoutCombat >= GameState.STALEMATE_NO_COMBAT_TURNS) {
                this.endGameOnPoints('stalemate -- no combat possible');
                return;
            }
            if (this.turnCount >= GameState.MAX_TURNS) {
                this.endGameOnPoints('turn limit reached');
                return;
            }
        }

        this.turnCount++;
        this.currentTurn = (this.currentTurn + 1) % this.players.length;
        // Reset movement points and attack flags for all units of the current player
        this.units.forEach(unit => {
            if (unit.playerIndex === this.currentTurn) {
                unit.move = UnitSystem.unitTypesRecord[unit.type].move;
                // Via setHasAttacked so visualUnit.userData stays in sync
                // (a bare `unit.hasAttacked = false` left it stale).
                UnitSystem.setHasAttacked(unit, false);
                // Cooldowns tick for the side whose turn began, beside the
                // move reset -- the same placement and the same rule as
                // SimState's turnStarted, so a replayed plan and the live
                // game never disagree about what is still available.
                unit.cooldowns = tickCooldowns(unit.cooldowns);
                // Factory repair: starting the turn on an owned, standing
                // factory patches the unit up. Mirrors SimState's
                // turnStarted rule so the AI values it correctly.
                const building = this.buildings.find(
                    (b) => !b.destroyed && b.q === unit.q && b.r === unit.r && b.ownerIndex === unit.playerIndex
                );
                if (building && unit.hp < unit.maxHp) {
                    unit.hp = Math.min(unit.maxHp, unit.hp + GameState.FACTORY_REPAIR_HP);
                    UnitSystem.updateUnitVisuals(unit);
                }
            }
        });

        // The wildfire, ticked HERE for the same reason cooldowns are: this
        // is where a turn begins on the live board, and SimState.turnStarted
        // is where it begins in the simulation. Anywhere else and the two
        // disagree.
        //
        // NOT in the End Turn button handler, which is where the only other
        // turn-lived visual system (FootprintSystem) is driven from. The AI
        // never presses that button, so a fire ticked there would freeze
        // solid for the whole of the CPU's turn.
        //
        // Math.random is right here and wrong in the simulation: this is the
        // one real board, rolled once, with nothing to reproduce.
        this.tickFire();

        // The badges are drawn from unit.cooldowns, so a bar left open
        // across the turn boundary would keep showing the old number until
        // something else happened to reselect. Refreshed once, after the
        // whole side has ticked.
        refreshSkillBar();
        if (this.getCurrentPlayer().controller === 'cpu') {
            this.cpuTurn();
        }
    }

    cpuTurn(): void {
        AIController.runCpuTurn(this, this.currentTurn)
            .then((stats) => {
                this.idleCpuTurns = stats.moves + stats.attacks === 0 ? this.idleCpuTurns + 1 : 0;
                this.turnsWithoutCombat = stats.attacks === 0 ? this.turnsWithoutCombat + 1 : 0;
            })
            .catch((error) => console.error('AI turn failed:', error))
            // Always hand the turn over via a macrotask. A turn that executed
            // nothing has no awaits in it, and chaining nextTurn -> cpuTurn
            // directly through resolved promises would then starve the event
            // loop (microtask-only spin = frozen page). The delay also gives
            // AI-vs-AI matches a watchable pace.
            .finally(() => setTimeout(() => this.nextTurn(), GameState.CPU_TURN_PAUSE_MS));
    }

    // The live board, as something the shared fire rules can drive. Same
    // interface SimState satisfies -- which is what lets one implementation
    // of "what fire does" serve both.
    private get fireBoard(): FireBoard {
        const map = this.map;
        return {
            getTile: (q, r) => map.getTile(q, r),
            // The live board really is mutable; there are no forks to
            // protect here, unlike the simulation's copy-on-write.
            setTile: (q, r, tile) => {
                const existing = map.getTile(q, r);
                if (existing) Object.assign(existing, tile);
            },
        };
    }

    private tickFire(): void {
        // The smoke tail first, and OUTSIDE the early return below: it runs
        // precisely on the turns when nothing is burning any more, so a
        // guard that skipped it would leave a burnt tile smoking forever.
        FireSystem.tickSmoulder();

        const burning = burningTilesOf(this.fireBoard, this.map.cols, this.map.rows);
        if (burning.length === 0) return;
        // Standing in it costs, on the same schedule the simulation charges
        // it, so a replayed plan and the live board agree about who is hurt.
        for (const unit of unitsStandingInFire(
            this.fireBoard, this.units, this.currentTurn,
            (u) => UnitSystem.unitTypesRecord[u.type]?.unitClass === 'air'
        )) {
            unit.hp -= FIRE_DAMAGE;
            UnitSystem.updateUnitVisuals(unit);
            VisualizationSystem.showDamageNumber(unit.visualUnit.position.clone(), FIRE_DAMAGE);
            if (unit.hp <= 0) UnitSystem.removeUnit(unit);
        }

        const tick = tickFires(this.fireBoard, burning, Math.random);
        applyFireTick(this.fireBoard, tick, burning);
        FireSystem.sync(this.map);
    }

    private endGame(winner: number, reason: string): void {
        this.gameOver = true;
        window.dispatchEvent(new CustomEvent('vibewars:gameover', {
            detail: { winner, name: winner >= 0 ? this.players[winner].name : null, reason },
        }));
    }

    // Decide an unwinnable/capped match on points: highest total remaining
    // hp wins; equal is a draw.
    private endGameOnPoints(reason: string): void {
        const totals = this.players.map((p) =>
            this.units.filter((u) => u.playerIndex === p.id).reduce((sum, u) => sum + u.hp, 0)
        );
        let winner = -1;
        if (totals[0] > totals[1]) winner = 0;
        else if (totals[1] > totals[0]) winner = 1;
        this.endGame(winner, `${reason} (points: ${totals.join(' vs ')})`);
    }

    getCurrentPlayer(): GamePlayer {
        return this.players[this.currentTurn];
    }

    isPlayerTurn(playerIndex: number): boolean {
        return this.currentTurn === playerIndex;
    }

    // Who is STANDING here. Cargo is skipped, exactly as in
    // SimState.getUnitAt -- a carried unit shares its transport's
    // coordinates, so without this every loaded APC reports two occupants.
    //
    // The live side needs the same rule or the two disagree about the
    // board: the simulation would plan a shot through a hex the live game
    // thinks is blocked, or target a passenger the simulation considers
    // untouchable. Splash, occupancy and selection all come through here.
    getUnitAt(q: number, r: number): GameUnit | undefined {
        return this.units.find(unit => !unit.carriedBy && unit.q === q && unit.r === r);
    }

    getPlayerUnits(playerIndex: number): GameUnit[] {
        return this.units.filter(unit => unit.playerIndex === playerIndex);
    }

    // Create a unit -- visual and game-logic record -- at (q, r). Used
    // both for the initial rosters and for mid-game spawns (a captured
    // factory yielding its hidden unit). Returns the GameUnit, or null if
    // the visual couldn't be created (unknown type).
    spawnUnit(type: string, q: number, r: number, playerIndex: number): GameUnit | null {
        const visual = UnitSystem.createUnit(type, q, r, playerIndex);
        if (!visual) return null;
        const config = UnitSystem.unitTypesRecord[type];
        const unit: GameUnit = {
            type,
            q,
            r,
            playerIndex,
            hp: config.hp,
            maxHp: config.maxHp,
            move: config.move,
            attack: config.attack,
            minRange: config.minRange,
            maxRange: config.maxRange,
            hasAttacked: false,
            cooldowns: NO_COOLDOWNS,
            visualUnit: visual,
        };
        this.units.push(unit);
        return unit;
    }

    initializeUnits(): void {
        // Starting units come from the selected map's provider, so each
        // map owns its own (possibly mirrored) lineup.
        const { player: playerStartingUnits, cpu: aiStartingUnits } = selectedMapProvider().spawns;
        playerStartingUnits.forEach((unitData) => this.spawnUnit(unitData.type, unitData.q, unitData.r, 0));
        aiStartingUnits.forEach((unitData) => this.spawnUnit(unitData.type, unitData.q, unitData.r, 1));
    }

    clone(): GameState {
        const clone = new GameState();
        clone.map = (this.map as any).clone();  // pre-existing: GameMap has no clone() method, throws if ever called (dead code, see git history)
        clone.players = JSON.parse(JSON.stringify(this.players));
        clone.units = JSON.parse(JSON.stringify(this.units));
        clone.currentTurn = this.currentTurn;
        return clone;
    }
}

export { GameState };