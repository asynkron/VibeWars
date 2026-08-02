// GameState.js - Manages the overall game state
import { UnitSystem } from '../shared/hexengine/UnitSystem';
import { GameMap } from '../shared/hexengine/MapSystem';
import type { GameUnit, GamePlayer } from '../types';

class GameState {
    map: GameMap;
    players: GamePlayer[];
    units: GameUnit[];
    currentTurn: number;

    constructor() {
        this.map = new GameMap();
        this.players = [];  // Array of player objects
        this.units = [];    // Flat array of all units
        this.currentTurn = 0;

        // Create players to match existing setup
        this.players.push({ id: 0, name: "human", color: 0x0000ff });  // Blue for player
        this.players.push({ id: 1, name: "cpu1", color: 0xff0000 });   // Red for AI
    }

    nextTurn(): void {
        this.currentTurn = (this.currentTurn + 1) % this.players.length;
        // Reset movement points and attack flags for all units of the current player
        this.units.forEach(unit => {
            if (unit.playerIndex === this.currentTurn) {
                unit.move = UnitSystem.unitTypesRecord[unit.type].move;
                unit.hasAttacked = false;
            }
        });
        if (this.currentTurn !== 0) {
            this.cpuTurn();
        }
    }

    cpuTurn(): void {
        setTimeout(() => this.nextTurn(), 1000);
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
        // Player units (matching existing setup)
        const playerStartingUnits = [
            { type: 'Droid', q: 2, r: 2 },
            { type: 'Artillery', q: 3, r: 3 },
            { type: 'Tank1', q: 4, r: 4 },
            { type: 'Tank2', q: 5, r: 4 },
            { type: 'Tank3', q: 6, r: 4 },
            { type: 'Boat1', q: 6, r: 6 },
            { type: 'DroverAPC', q: 7, r: 4 },
            { type: 'HalberdAA', q: 7, r: 5 },
            { type: 'LynxIFV', q: 4, r: 5 },
            { type: 'NightjarHelo', q: 3, r: 5 },
            { type: 'ShrikeJet', q: 8, r: 3 }
        ];

        // AI units (matching existing setup)
        const aiStartingUnits = [
            { type: 'Tank1', q: 1, r: 5 },
            { type: 'Artillery', q: 2, r: 6 }

        ];

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