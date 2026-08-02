import type { GameState } from './GameState';

let currentGameState: GameState | null = null;

export function setGameState(state: GameState): void {
    currentGameState = state;
}

export function getGameState(): GameState {
    if (!currentGameState) {
        throw new Error('GameState accessed before initGame() has run');
    }
    return currentGameState;
}

// Used by public API methods (e.g. GridSystem.modifyHexHeight/getUnitAtHex)
// that may be invoked from external scripting/devtools before initGame() has
// set up the game state.
export function getGameStateOrNull(): GameState | null {
    return currentGameState;
}
