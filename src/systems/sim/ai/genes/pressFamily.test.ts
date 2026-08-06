// The press family: shoot, then spend what is left of the move doing
// something -- advance, block, or storm. Each test pins the ORDER (the
// shot lands before the follow-through) and the follow-through itself,
// because the ordering is the entire reason these exist as single genes.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import { HexCoord } from '../../../../shared/hexengine/HexCoord';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';
import { shootAdvanceGene } from './shootAdvance';
import { shootBlockGene } from './shootBlock';
import { stormCaptureGene } from './stormCapture';

const mk = (type: string, q: number, r: number, playerIndex: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange, hasAttacked: false };
};

function board(units: any[], buildings: any[] = [], cols = 12, rows = 12) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({ map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] }, units, buildings });
}

describe('shootAdvance', () => {
    it('kills the adjacent target, then presses on with the leftover move', () => {
        const spot = HexCoord.getNeighbors(5, 5)[0];
        const state = board([
            mk('Lynx', 5, 5, 0),
            { ...mk('Bulwark', spot.q, spot.r, 1), hp: 1 },
            mk('Halberd', 10, 10, 1),
        ]);

        expect(shootAdvanceGene.apply(state, { kind: 'shootAdvance', unitIndex: 0, targetIndex: 1, seed: 4 })).toBe(true);

        const kinds = state.events.map((e) => e.type);
        const shotAt = kinds.indexOf('unitAttacked');
        expect(shotAt).toBeGreaterThanOrEqual(0);
        expect(kinds).toContain('unitDied');
        // The press comes AFTER the shot, toward the remaining enemy.
        expect(kinds.indexOf('unitMoved')).toBeGreaterThan(shotAt);
        const lynx = state.getUnit(0)!;
        expect(HexCoord.getDistance(lynx.q, lynx.r, 10, 10))
            .toBeLessThan(HexCoord.getDistance(5, 5, 10, 10));
    });

    it('refuses when nothing is in the bracket -- advancing alone is moveTowards', () => {
        const state = board([mk('Lynx', 2, 2, 0), mk('Bulwark', 9, 9, 1)]);
        expect(shootAdvanceGene.apply(state, { kind: 'shootAdvance', unitIndex: 0, seed: 4 })).toBe(false);
        expect(state.events).toHaveLength(0);
    });
});

describe('shootBlock', () => {
    // A door worth denying needs an enemy that can capture; Pike is the
    // capturer on the shipped roster.
    it('shoots the adjacent enemy, then stands in the doorway', () => {
        // The shot target and the capture threat are different units on
        // purpose: killing the LAST enemy capturer makes blocking
        // pointless and the gene correctly refuses -- the first draft of
        // this test tripped exactly that.
        const spot = HexCoord.getNeighbors(5, 5)[0];
        const state = board(
            [mk('Bulwark', 5, 5, 0), mk('Bulwark', spot.q, spot.r, 1), mk('Pike', 10, 10, 1)],
            [{ q: 5, r: 6 }]
        );

        expect(shootBlockGene.applicable!(state, 0)).toBe(true);
        expect(shootBlockGene.apply(state, { kind: 'shootBlock', unitIndex: 0, seed: 6 })).toBe(true);

        const kinds = state.events.map((e) => e.type);
        const shotAt = kinds.indexOf('unitAttacked');
        expect(shotAt).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf('unitMoved')).toBeGreaterThan(shotAt);
        const blocker = state.getUnit(0)!;
        expect([blocker.q, blocker.r]).toEqual([5, 6]);
    });

    it('is inapplicable when no enemy can capture anything', () => {
        const state = board(
            [mk('Bulwark', 5, 5, 0), mk('Bulwark', 8, 8, 1)],
            [{ q: 5, r: 6 }]
        );
        expect(shootBlockGene.applicable!(state, 0)).toBe(false);
    });
});

describe('stormCapture', () => {
    it('shoots the defender, then walks onto the door and takes it', () => {
        // Pike beside the enemy, door one step away: clear it, then kick it
        // in -- the order the sweep can never produce.
        const door = { q: 5, r: 6 };
        const spot = HexCoord.getNeighbors(5, 5)[0];
        const state = board(
            [mk('Pike', 5, 5, 0), { ...mk('Bulwark', spot.q, spot.r, 1), hp: 1 }],
            [door]
        );

        expect(stormCaptureGene.applicable!(state, 0)).toBe(true);
        expect(stormCaptureGene.apply(state, { kind: 'stormCapture', unitIndex: 0, seed: 8 })).toBe(true);

        const kinds = state.events.map((e) => e.type);
        const shotAt = kinds.indexOf('unitAttacked');
        expect(shotAt).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf('buildingCaptured')).toBeGreaterThan(shotAt);
        expect(state.getBuilding(0)!.ownerIndex).toBe(0);
    });

    it('is inapplicable for units that cannot capture', () => {
        const state = board([mk('Bulwark', 5, 5, 0), mk('Pike', 8, 8, 1)], [{ q: 5, r: 6 }]);
        expect(stormCaptureGene.applicable!(state, 0)).toBe(false);
    });
});
