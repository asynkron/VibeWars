// GameState.js - Manages the overall game state
import { UnitSystem } from '../shared/hexengine/UnitSystem';
import { GameMap } from '../shared/hexengine/MapSystem';
import { AIController } from './ai/AIController';
import { selectedMapProvider } from './maps/mapRegistry';
import type { GameUnit, GamePlayer, PlayerController } from '../types';

class GameState {
    static readonly CPU_TURN_PAUSE_MS = 400;
    static readonly MAX_TURNS = 200;
    static readonly STALEMATE_IDLE_TURNS = 4;
    static readonly STALEMATE_NO_COMBAT_TURNS = 40;

    map: GameMap;
    players: GamePlayer[];
    units: GameUnit[];
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
            }
        });
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

    getUnitAt(q: number, r: number): GameUnit | undefined {
        return this.units.find(unit => unit.q === q && unit.r === r);
    }

    getPlayerUnits(playerIndex: number): GameUnit[] {
        return this.units.filter(unit => unit.playerIndex === playerIndex);
    }

    initializeUnits(): void {
        // Starting units come from the selected map's provider, so each
        // map owns its own (possibly mirrored) lineup.
        const { player: playerStartingUnits, cpu: aiStartingUnits } = selectedMapProvider().spawns;

        // Create player units
        playerStartingUnits.forEach(unitData => {
            const unit = UnitSystem.createUnit(
                unitData.type,
                unitData.q,
                unitData.r,
                0  // playerIndex
            );
            if (unit) {
                // Add to flat units array
                this.units.push({
                    type: unitData.type,
                    q: unitData.q,
                    r: unitData.r,
                    playerIndex: 0,
                    hp: UnitSystem.unitTypesRecord[unitData.type].hp,
                    maxHp: UnitSystem.unitTypesRecord[unitData.type].maxHp,
                    move: UnitSystem.unitTypesRecord[unitData.type].move,
                    attack: UnitSystem.unitTypesRecord[unitData.type].attack,
                    minRange: UnitSystem.unitTypesRecord[unitData.type].minRange,
                    maxRange: UnitSystem.unitTypesRecord[unitData.type].maxRange,
                    hasAttacked: false,
                    visualUnit: unit  // Reference to the 3D unit for visualization
                });
            }
        });

        // Create AI units
        aiStartingUnits.forEach(unitData => {
            const unit = UnitSystem.createUnit(
                unitData.type,
                unitData.q,
                unitData.r,
                1  // playerIndex
            );
            if (unit) {
                // Add to flat units array
                this.units.push({
                    type: unitData.type,
                    q: unitData.q,
                    r: unitData.r,
                    playerIndex: 1,
                    hp: UnitSystem.unitTypesRecord[unitData.type].hp,
                    maxHp: UnitSystem.unitTypesRecord[unitData.type].maxHp,
                    move: UnitSystem.unitTypesRecord[unitData.type].move,
                    attack: UnitSystem.unitTypesRecord[unitData.type].attack,
                    minRange: UnitSystem.unitTypesRecord[unitData.type].minRange,
                    maxRange: UnitSystem.unitTypesRecord[unitData.type].maxRange,
                    hasAttacked: false,
                    visualUnit: unit  // Reference to the 3D unit for visualization
                });
            }
        });
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