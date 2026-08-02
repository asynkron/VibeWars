import { MoveRandomCommand } from '../../../systems/ai/commands/MoveRandomCommand';
import { AttackRandomCommand } from '../../../systems/ai/commands/AttackRandomCommand';
import { MoveTowardsEnemyCommand } from '../../../systems/ai/commands/MoveTowardsEnemyCommand';
import { MoveAwayFromEnemyCommand } from '../../../systems/ai/commands/MoveAwayFromEnemyCommand';
import { DoNothingCommand } from '../../../systems/ai/commands/DoNothingCommand';
import { getGameState } from '../../../systems/gameStateStore';
import type { GameUnit } from '../../../types';

// A deep-copied plain object shaped like GameState.units, but not a real
// GameState (no map/players/currentTurn) -- see deepCopyGameState() below.
// AISystem is unused dead code (nothing calls executeAITurn()); typed as
// `any` here rather than modeling a shape that's intentionally incomplete.
type GameStateCopy = any;

class AISystem {
    static commandClasses = [
        MoveRandomCommand,
        AttackRandomCommand,
        MoveTowardsEnemyCommand,
        MoveAwayFromEnemyCommand,
        DoNothingCommand
    ];

    static generateCommandSeries(unit: GameUnit, gameStateCopy: GameStateCopy, seriesLength: number = 3) {
        const series: any[] = [];
        for (let i = 0; i < seriesLength; i++) {
            const command = this.generateCommand(unit, gameStateCopy);
            if (command) {
                series.push(command);
            }
        }
        return series;
    }

    static generateCommand(unit: GameUnit, gameStateCopy: GameStateCopy) {
        const possibleCommands: any[] = [];

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

    static evaluateGameState(gameStateCopy: GameStateCopy, aiPlayerIndex: number): number {
        let score = 0;

        // Count units
        const aiUnits: GameUnit[] = gameStateCopy.units.filter((u: GameUnit) => u.playerIndex === aiPlayerIndex);
        const enemyUnits: GameUnit[] = gameStateCopy.units.filter((u: GameUnit) => u.playerIndex !== aiPlayerIndex);

        // Unit count difference
        score += (aiUnits.length - enemyUnits.length) * 100;

        // Health difference
        const aiHealth = aiUnits.reduce((sum: number, unit: GameUnit) => sum + unit.hp, 0);
        const enemyHealth = enemyUnits.reduce((sum: number, unit: GameUnit) => sum + unit.hp, 0);
        score += (aiHealth - enemyHealth) * 10;

        // Unit type values
        const unitValues: Record<string, number> = {
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

    static async findBestCommandSeries(unit: GameUnit, gameStateCopy: GameStateCopy, numSeries: number = 5, seriesLength: number = 3) {
        let bestScore = -Infinity;
        let bestSeries: any = null;

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

    static deepCopyGameState(gameState: any): GameStateCopy {
        // Create a deep copy of the game state
        const copy = {
            units: gameState.units.map((unit: GameUnit) => ({
                ...unit,
                visualUnit: null // We don't need to copy visual elements
            }))
        };
        return copy;
    }

    static async executeAITurn() {
        const gameState = getGameState();
        const aiUnits = gameState.units.filter((unit: GameUnit) => unit.playerIndex === 1); // Assuming AI is player 1

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

export { AISystem };