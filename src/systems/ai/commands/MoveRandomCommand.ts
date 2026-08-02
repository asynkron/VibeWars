import { Command } from './Command';
import { PathfindingSystem } from '../../../shared/hexengine/PathfindingSystem';
import { UnitSystem } from '../../../shared/hexengine/UnitSystem';
import { HexCoord } from '../../../shared/hexengine/HexCoord';
import type { GameState } from '../../GameState';
import type { GameUnit } from '../../../types';

class MoveRandomCommand extends Command {
    unitIndex: number;

    constructor(unitIndex: number) {
        super();
        this.unitIndex = unitIndex;
    }

    apply(gameState: GameState): void {
        const unit = gameState.units[this.unitIndex];
        if (!unit || unit.move <= 0) return;

        const unitCoord = new HexCoord(unit.q, unit.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        const validHexes = Array.from(reachable)
            .map(key => HexCoord.fromKey(key))
            .map(coord => coord.getHex())
            .filter((hex: any) => hex && !this.isHexOccupied(hex.userData.q, hex.userData.r, unit, gameState));

        if (validHexes.length > 0) {
            const randomHex: any = validHexes[Math.floor(Math.random() * validHexes.length)];
            const path = PathfindingSystem.getPath(unit.q, unit.r, randomHex.userData.q, randomHex.userData.r, unit.move, unit);
            if (path.length > 0) {
                UnitSystem.move(unit, path);
            }
        }
    }

    static generate(gameState: GameState): MoveRandomCommand | null {
        const movableUnits = gameState.units.filter(unit => unit.move > 0);
        if (movableUnits.length === 0) return null;

        const randomUnit = movableUnits[Math.floor(Math.random() * movableUnits.length)];
        return new MoveRandomCommand(gameState.units.indexOf(randomUnit));
    }

    isHexOccupied(q: number, r: number, excludeUnit: GameUnit, gameState: GameState): boolean {
        return gameState.units.some(u => u.q === q && u.r === r && u !== excludeUnit);
    }
}

window.MoveRandomCommand = MoveRandomCommand;

export { MoveRandomCommand };