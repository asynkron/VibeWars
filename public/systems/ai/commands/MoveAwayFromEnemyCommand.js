class MoveAwayFromEnemyCommand extends Command {
    constructor(unitIndex, targetIndex) {
        super();
        this.unitIndex = unitIndex;
        this.targetIndex = targetIndex;
    }

    apply(gameState) {
        const unit = gameState.units[this.unitIndex];
        const target = gameState.units[this.targetIndex];

        if (!unit || !target || unit.move <= 0) return;

        const unitCoord = new HexCoord(unit.q, unit.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        let bestHex = null;
        let maxDistance = 0;

        reachable.forEach(key => {
            const coord = HexCoord.fromKey(key);
            const hex = coord.getHex();
            if (hex && !this.isHexOccupied(hex.userData.q, hex.userData.r, unit, gameState)) {
                const distance = UnitSystem.getHexDistance(hex.userData.q, hex.userData.r, target.q, target.r);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    bestHex = hex;
                }
            }
        });

        if (bestHex) {
            const path = PathfindingSystem.getPath(unit.q, unit.r, bestHex.userData.q, bestHex.userData.r, unit.move, unit);
            if (path.length > 0) {
                UnitSystem.move(unit, path);
            }
        }
    }

    static generate(gameState) {
        const movableUnits = gameState.units.filter(unit => unit.move > 0);
        if (movableUnits.length === 0) return null;

        const randomUnit = movableUnits[Math.floor(Math.random() * movableUnits.length)];
        const unitIndex = gameState.units.indexOf(randomUnit);

        // Find closest enemy
        const enemyUnits = gameState.units.filter(u => u.playerIndex !== randomUnit.playerIndex);
        if (enemyUnits.length === 0) return null;

        let closestEnemy = null;
        let minDistance = Infinity;

        enemyUnits.forEach(enemy => {
            const distance = UnitSystem.getHexDistance(randomUnit.q, randomUnit.r, enemy.q, enemy.r);
            if (distance < minDistance) {
                minDistance = distance;
                closestEnemy = enemy;
            }
        });

        if (!closestEnemy) return null;
        const targetIndex = gameState.units.indexOf(closestEnemy);

        return new MoveAwayFromEnemyCommand(unitIndex, targetIndex);
    }

    isHexOccupied(q, r, excludeUnit, gameState) {
        return gameState.units.some(u => u.q === q && u.r === r && u !== excludeUnit);
    }
}

window.MoveAwayFromEnemyCommand = MoveAwayFromEnemyCommand; 