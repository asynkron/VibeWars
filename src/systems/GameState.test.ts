import '../test/threeStub';
import { describe, expect, it } from 'vitest';
import { GameState } from './GameState';
import type { Building } from '../types';

const hq = (ownerIndex: number, destroyed: boolean): Building => ({
    type: 'hq', q: ownerIndex, r: 0, ownerIndex,
    hiddenUnitType: null, destroyed,
});

describe('GameState HQ defeat', () => {
    it('leaves HQ-less maps under their existing victory rules', () => {
        const state = new GameState(['human', 'human']);
        expect(state.checkHeadquartersDefeat()).toBe(false);
        expect(state.gameOver).toBe(false);
    });

    it('does not end the match while an authored HQ still stands', () => {
        const state = new GameState(['human', 'human']);
        state.buildings = [hq(0, false)];
        expect(state.checkHeadquartersDefeat()).toBe(false);
        expect(state.gameOver).toBe(false);
    });

    it('ends the match for the owner when its HQ is destroyed', () => {
        const state = new GameState(['human', 'human']);
        state.buildings = [hq(0, true)];
        let detail: any = null;
        window.addEventListener('vibewars:gameover', ((event: CustomEvent) => {
            detail = event.detail;
        }) as EventListener, { once: true });

        expect(state.checkHeadquartersDefeat()).toBe(true);
        expect(state.gameOver).toBe(true);
        expect(detail).toMatchObject({ winner: 1, reason: 'headquarters lost' });
    });

    it('draws when both HQs are destroyed before the check', () => {
        const state = new GameState(['human', 'human']);
        state.buildings = [hq(0, true), hq(1, true)];
        let detail: any = null;
        window.addEventListener('vibewars:gameover', ((event: CustomEvent) => {
            detail = event.detail;
        }) as EventListener, { once: true });

        expect(state.checkHeadquartersDefeat()).toBe(true);
        expect(detail).toMatchObject({ winner: -1, name: null, reason: 'headquarters lost' });
    });
});
