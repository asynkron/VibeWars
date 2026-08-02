class AISystem {
    static commandClasses = [
        MoveRandomCommand,
        AttackRandomCommand,
        MoveTowardsEnemyCommand,
        MoveAwayFromEnemyCommand,
        DoNothingCommand
    ];

    static generateCommandSeries(unit, gameStateCopy, seriesLength = 3) {
        const series = [];
        for (let i = 0; i < seriesLength; i++) {
            const command = this.generateCommand(unit, gameStateCopy);
            if (command) {
                series.push(command);
            }
        }
        return series;
    }

    static generateCommand(unit, gameStateCopy) {
        const possibleCommands = [];

        // Generate all possible commands for this unit
        this.commandClasses.forEach(CommandClass => {
            const command = CommandClass.generate(gameStateCopy);
            if (command) {
                possibleCommands.push(command);
            }
        });

        if (possibleCommands.length === 0) return null;
        return possibleCommands[Math.floor(Math.random() * possibleCommands.length)];
    }

    static evaluateGameState(gameStateCopy, aiPlayerIndex) {
        let score = 0;

        // Count units
        const aiUnits = gameStateCopy.units.filter(u => u.playerIndex === aiPlayerIndex);
        const enemyUnits = gameStateCopy.units.filter(u => u.playerIndex !== aiPlayerIndex);

        // Unit count difference
        score += (aiUnits.length - enemyUnits.length) * 100;

        // Health difference
        const aiHealth = aiUnits.reduce((sum, unit) => sum + unit.hp, 0);
        const enemyHealth = enemyUnits.reduce((sum, unit) => sum + unit.hp, 0);
        score += (aiHealth - enemyHealth) * 10;

        // Unit type values
        const unitValues = {
            'Tank1': 100,
            'Tank2': 100,
            'Tank3': 100,
            'Artillery': 150,
            'Droid': 80,
            'Boat1': 120,
            'Catapult': 90
        };

        // Value of remaining units
        aiUnits.forEach(unit => {
            score += unitValues[unit.type] || 50;
        });

        return score;
    }

    static async findBestCommandSeries(unit, gameStateCopy, numSeries = 5, seriesLength = 3) {
        let bestScore = -Infinity;
        let bestSeries = null;

        for (let i = 0; i < numSeries; i++) {
            const series = this.generateCommandSeries(unit, gameStateCopy, seriesLength);
            const seriesGameState = this.deepCopyGameState(gameStateCopy);

            // Apply the series of commands
            for (const command of series) {
                command.apply(seriesGameState);
            }

            // Evaluate the result
            const score = this.evaluateGameState(seriesGameState, unit.playerIndex);

            if (score > bestScore) {
                bestScore = score;
                bestSeries = series;
            }
        }

        return bestSeries;
    }

    static deepCopyGameState(gameState) {
        // Create a deep copy of the game state
        const copy = {
            units: gameState.units.map(unit => ({
                ...unit,
                visualUnit: null // We don't need to copy visual elements
            }))
        };
        return copy;
    }

    static async executeAITurn() {
        const aiUnits = gameState.units.filter(unit => unit.playerIndex === 1); // Assuming AI is player 1

        for (const unit of aiUnits) {
            const gameStateCopy = this.deepCopyGameState(gameState);
            const bestSeries = await this.findBestCommandSeries(unit, gameStateCopy);

            // Apply the best series to the actual game state
            for (const command of bestSeries) {
                command.apply(gameState);
            }
        }
    }
}

window.AISystem = AISystem; 