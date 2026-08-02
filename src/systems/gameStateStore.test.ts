import { describe, it, expect, vi } from 'vitest';
import { setGameState, getGameState, getGameStateOrNull } from './gameStateStore';

describe('gameStateStore', () => {
    it('getGameState returns whatever was passed to setGameState', () => {
        const fakeState = { units: [], players: [] } as any;
        setGameState(fakeState);
        expect(getGameState()).toBe(fakeState);
        expect(getGameStateOrNull()).toBe(fakeState);
    });

    it('getGameState throws and getGameStateOrNull returns null before initialization', async () => {
        // The module-level store is shared across tests in this file, so we
        // get an uninitialized copy via a fresh module registry.
        vi.resetModules();
        const fresh = await import('./gameStateStore');
        expect(fresh.getGameStateOrNull()).toBeNull();
        expect(() => fresh.getGameState()).toThrow(/before initGame/);
    });
});
