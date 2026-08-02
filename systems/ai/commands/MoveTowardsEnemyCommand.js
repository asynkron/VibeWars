class MoveTowardsEnemyCommand extends Command {
    constructor(unitIndex, targetIndex) {
        super();
        this.unitIndex = unitIndex;
        this.targetIndex = targetIndex;
    }

    apply(gameState) {
        const unit = gameState.units[this.unitIndex];
        const target = gameState.units[this.targetIndex];

        if (!unit || !target || unit.move <= 0) return;

        const path = PathfindingSystem.getPath(unit.q, unit.r, target.q, target.r, unit.move, unit);
        if (path.length > 0) {
            UnitSystem.move(unit, path);
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

        return new MoveTowardsEnemyCommand(unitIndex, targetIndex);
    }
}

window.MoveTowardsEnemyCommand = MoveTowardsEnemyCommand; 