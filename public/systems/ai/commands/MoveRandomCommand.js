class MoveRandomCommand extends Command {
    constructor(unitIndex) {
        super();
        this.unitIndex = unitIndex;
    }

    apply(gameState) {
        const unit = gameState.units[this.unitIndex];
        if (!unit || unit.move <= 0) return;

        const unitCoord = new HexCoord(unit.q, unit.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        const validHexes = Array.from(reachable)
            .map(key => HexCoord.fromKey(key))
            .map(coord => coord.getHex())
            .filter(hex => hex && !this.isHexOccupied(hex.userData.q, hex.userData.r, unit, gameState));

        if (validHexes.length > 0) {
            const randomHex = validHexes[Math.floor(Math.random() * validHexes.length)];
            const path = PathfindingSystem.getPath(unit.q, unit.r, randomHex.userData.q, randomHex.userData.r, unit.move, unit);
            if (path.length > 0) {
                UnitSystem.move(unit, path);
            }
        }
    }

    static generate(gameState) {
        const movableUnits = gameState.units.filter(unit => unit.move > 0);
        if (movableUnits.length === 0) return null;

        const randomUnit = movableUnits[Math.floor(Math.random() * movableUnits.length)];
        return new MoveRandomCommand(gameState.units.indexOf(randomUnit));
    }

    isHexOccupied(q, r, excludeUnit, gameState) {
        return gameState.units.some(u => u.q === q && u.r === r && u !== excludeUnit);
    }
}

window.MoveRandomCommand = MoveRandomCommand; 