// The screen gene claims a specific move: stand next to the frailest ally,
// on the side the threat is coming from. These tests check that claim on
// positions where the right answer is unambiguous, plus the guards -- a
// gene that fires when it should not is worse than one that never fires,
// because it burns movement the rest of the plan needed.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import * as HexCoord from '../../../../shared/hexengine/hexMath';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';
import { SCREEN, screenGene } from './screen';
import { applyGene } from '../../SimCommands';

const mk = (type: string, q: number, r: number, playerIndex: number, hp?: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: hp ?? s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange, hasAttacked: false };
};

function board(units: any[], cols = 12, rows = 12) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units, buildings: [],
    });
}

describe('screen gene', () => {
    it('steps between the frail ally and the threat', () => {
        // Kestrel (3 hp) at (5,5), a Lynx (5 hp, move 4) loitering behind
        // it, and an enemy tank closing from the west. A Bulwark would be
        // the obvious guard and cannot be used here: move 2 does not reach
        // round to the threatened side, so the test would be measuring its
        // legs rather than the gene.
        const state = board([
            mk('Lynx', 7, 5, 0),
            mk('Kestrel', 5, 5, 0),
            mk('Bulwark', 1, 5, 1),
        ]);
        expect(screenGene.apply(state, { kind: SCREEN, unitIndex: 0, seed: 1 })).toBe(true);

        const guard = state.getUnit(0)!;
        // Touching the ward...
        expect(HexCoord.getDistance(guard.q, guard.r, 5, 5)).toBe(1);
        // ...and closer to the threat than the ward is, i.e. in front of it.
        expect(HexCoord.getDistance(guard.q, guard.r, 1, 5))
            .toBeLessThan(HexCoord.getDistance(5, 5, 1, 5));
    });

    it('protects the frailest ally, not the nearest one', () => {
        // A Halberd (8 hp) sits closer than the Kestrel (3 hp). Guarding
        // the sturdier one would be the easy mistake.
        const state = board([
            mk('Lynx', 8, 8, 0),
            mk('Halberd', 6, 5, 0),
            mk('Kestrel', 9, 9, 0),
            mk('Bulwark', 11, 11, 1),
        ]);
        screenGene.apply(state, { kind: SCREEN, unitIndex: 0, seed: 1 });
        const guard = state.getUnit(0)!;
        // Adjacent to the Kestrel, not to the Halberd.
        expect(HexCoord.getDistance(guard.q, guard.r, 9, 9)).toBe(1);
    });

    it('declines when there is nobody frailer to stand in front of', () => {
        // Two Bulwarks: neither outlasts the other, so neither screens.
        const state = board([mk('Bulwark', 5, 5, 0), mk('Bulwark', 6, 5, 0), mk('Bulwark', 1, 5, 1)]);
        expect(screenGene.applicable!(state, 0)).toBe(false);
        expect(screenGene.apply(state, { kind: SCREEN, unitIndex: 0, seed: 1 })).toBe(false);
    });

    it('declines when nothing can reach the ward', () => {
        const state = board([mk('Bulwark', 7, 5, 0), mk('Kestrel', 5, 5, 0)]);
        expect(screenGene.applicable!(state, 0)).toBe(false);
    });

    it('ignores an enemy that cannot legally shoot the ward', () => {
        // Artillery cannot touch air, so a lone Kestrel is no threat to a
        // Nightjar and there is nothing to screen against.
        const state = board([
            mk('Bulwark', 7, 5, 0),
            mk('Nightjar', 5, 5, 0),
            mk('Kestrel', 1, 5, 1),
        ]);
        expect(screenGene.applicable!(state, 0)).toBe(false);
    });

    it('declines when already in the best place', () => {
        const state = board([mk('Bulwark', 4, 5, 0), mk('Kestrel', 5, 5, 0), mk('Bulwark', 1, 5, 1)]);
        const before = { ...state.getUnit(0)! };
        screenGene.apply(state, { kind: SCREEN, unitIndex: 0, seed: 1 });
        const after = state.getUnit(0)!;
        expect([after.q, after.r]).toEqual([before.q, before.r]);
    });

    it('spends no more movement than the unit has', () => {
        const state = board([mk('Bulwark', 9, 5, 0), mk('Kestrel', 5, 5, 0), mk('Bulwark', 1, 5, 1)]);
        screenGene.apply(state, { kind: SCREEN, unitIndex: 0, seed: 1 });
        const spent = state.events
            .filter((e: any) => e.type === 'unitMoved' && e.unitIndex === 0)
            .reduce((total: number, e: any) => total + e.moveSpent, 0);
        expect(spent).toBeLessThanOrEqual(unitTypesRecord.Bulwark.move);
    });
});

describe('screen registered but unused', () => {
    it('is a no-op for an engine that did not register it', () => {
        // A plan crossing between engines must degrade, not throw. No
        // shipped engine currently carries SCREEN in its dialect -- it was
        // aegis's gene, and aegis was retired once its measurement was in
        // (see engineRegistry.ts) -- so every live engine takes this path.
        const state = board([mk('Bulwark', 7, 5, 0), mk('Kestrel', 5, 5, 0), mk('Bulwark', 1, 5, 1)]);
        expect(applyGene(state, { kind: SCREEN, unitIndex: 0, seed: 1 })).toBe(false);
    });
});
