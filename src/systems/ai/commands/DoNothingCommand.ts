import { Command } from './Command';
import type { GameState } from '../../GameState';

class DoNothingCommand extends Command {
    unitIndex: number;

    constructor(unitIndex: number) {
        super();
        this.unitIndex = unitIndex;
    }

    apply(gameState: GameState): void {
        // Do nothing
    }

    static generate(gameState: GameState): DoNothingCommand | null {
        const units = gameState.units;
        if (units.length === 0) return null;

        const randomUnit = units[Math.floor(Math.random() * units.length)];
        return new DoNothingCommand(gameState.units.indexOf(randomUnit));
    }
}

export { DoNothingCommand };