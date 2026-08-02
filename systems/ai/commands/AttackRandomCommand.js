class AttackRandomCommand extends Command {
    constructor(unitIndex, targetIndex) {
        super();
        this.unitIndex = unitIndex;
        this.targetIndex = targetIndex;
    }

    apply(gameState) {
        const unit = gameState.units[this.unitIndex];
        const target = gameState.units[this.targetIndex];

        if (!unit || !target || unit.hasAttacked) return;

        const distance = UnitSystem.getHexDistance(unit.q, unit.r, target.q, target.r);
        if (distance >= unit.minRange && distance <= unit.maxRange) {
            UnitSystem.attack(unit, target);
        }
    }

    static generate(gameState) {
        const attackableUnits = gameState.units.filter(unit => !unit.hasAttacked);
        if (attackableUnits.length === 0) return null;

        const randomUnit = attackableUnits[Math.floor(Math.random() * attackableUnits.length)];
        const unitIndex = gameState.units.indexOf(randomUnit);

        // Find valid targets
        const validTargets = gameState.units.filter(target =>
            target.playerIndex !== randomUnit.playerIndex &&
            !target.hasAttacked
        ).filter(target => {
            const distance = UnitSystem.getHexDistance(randomUnit.q, randomUnit.r, target.q, target.r);
            return distance >= randomUnit.minRange && distance <= randomUnit.maxRange;
        });

        if (validTargets.length === 0) return null;

        const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
        const targetIndex = gameState.units.indexOf(randomTarget);

        return new AttackRandomCommand(unitIndex, targetIndex);
    }
}

window.AttackRandomCommand = AttackRandomCommand; 