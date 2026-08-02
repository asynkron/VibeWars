class DoNothingCommand extends Command {
    constructor(unitIndex) {
        super();
        this.unitIndex = unitIndex;
    }

    apply(gameState) {
        // Do nothing
    }

    static generate(gameState) {
        const units = gameState.units;
        if (units.length === 0) return null;

        const randomUnit = units[Math.floor(Math.random() * units.length)];
        return new DoNothingCommand(gameState.units.indexOf(randomUnit));
    }
}

window.DoNothingCommand = DoNothingCommand; 