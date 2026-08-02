// GameState.js - Manages the overall game state

class GameState {
    constructor() {
        this.map = new GameMap();
        this.players = [];  // Array of player objects
        this.units = [];    // Flat array of all units
        this.currentTurn = 0;

        // Create players to match existing setup
        this.players.push({ id: 0, name: "human", color: 0x0000ff });  // Blue for player
        this.players.push({ id: 1, name: "cpu1", color: 0xff0000 });   // Red for AI
    }

    nextTurn() {
        this.currentTurn = (this.currentTurn + 1) % this.players.length;
        // Reset movement points and attack flags for all units of the current player
        this.units.forEach(unit => {
            if (unit.playerIndex === this.currentTurn) {
                unit.move = UnitSystem.unitTypes[unit.type].move;
                unit.hasAttacked = false;
            }
        });
        if (this.currentTurn !== 0) {
            this.cpuTurn();
        }
    }

    cpuTurn() {
        setTimeout(() => this.nextTurn(), 1000);
    }

    getCurrentPlayer() {
        return this.players[this.currentTurn];
    }

    isPlayerTurn(playerIndex) {
        return this.currentTurn === playerIndex;
    }

    getUnitAt(q, r) {
        return this.units.find(unit => unit.q === q && unit.r === r);
    }

    getPlayerUnits(playerIndex) {
        return this.units.filter(unit => unit.playerIndex === playerIndex);
    }

    initializeUnits() {
        // Player units (matching existing setup)
        const playerStartingUnits = [
            { type: 'Droid', q: 2, r: 2 },
            { type: 'Artillery', q: 3, r: 3 },
            { type: 'Tank1', q: 4, r: 4 },
            { type: 'Tank2', q: 5, r: 4 },
            { type: 'Tank3', q: 6, r: 4 },
            { type: 'Boat1', q: 6, r: 6 }
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
                    hp: UnitSystem.unitTypes[unitData.type].hp,
                    maxHp: UnitSystem.unitTypes[unitData.type].maxHp,
                    move: UnitSystem.unitTypes[unitData.type].move,
                    attack: UnitSystem.unitTypes[unitData.type].attack,
                    minRange: UnitSystem.unitTypes[unitData.type].minRange,
                    maxRange: UnitSystem.unitTypes[unitData.type].maxRange,
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
                    hp: UnitSystem.unitTypes[unitData.type].hp,
                    maxHp: UnitSystem.unitTypes[unitData.type].maxHp,
                    move: UnitSystem.unitTypes[unitData.type].move,
                    attack: UnitSystem.unitTypes[unitData.type].attack,
                    minRange: UnitSystem.unitTypes[unitData.type].minRange,
                    maxRange: UnitSystem.unitTypes[unitData.type].maxRange,
                    hasAttacked: false,
                    visualUnit: unit  // Reference to the 3D unit for visualization
                });
            }
        });
    }

    clone() {
        const clone = new GameState();
        clone.map = this.map.clone();  // Assuming GameMap has a clone method
        clone.players = JSON.parse(JSON.stringify(this.players));
        clone.units = JSON.parse(JSON.stringify(this.units));
        clone.currentTurn = this.currentTurn;
        return clone;
    }
}

console.log('GameState.js loaded'); 