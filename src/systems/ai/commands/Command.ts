import type { GameState } from '../../GameState';

class Command {
    constructor() {
        if (this.constructor === Command) {
            throw new Error("Command is an abstract class");
        }
    }

    // Apply the command to a game state
    apply(gameState: GameState): void {
        throw new Error("apply() must be implemented by subclasses");
    }

    // Generate a new command with random parameters
    static generate(gameState: GameState): Command | null {
        throw new Error("generate() must be implemented by subclasses");
    }

    // Convert command to a serializable format
    serialize() {
        return {
            type: this.constructor.name,
            ...this
        };
    }

    // Create a command from a serialized format
    static deserialize(data: any) {
        const CommandClass: any = (window as any)[data.type];
        if (!CommandClass) {
            throw new Error(`Unknown command type: ${data.type}`);
        }
        return new CommandClass(data);
    }
}

window.Command = Command;

export { Command };