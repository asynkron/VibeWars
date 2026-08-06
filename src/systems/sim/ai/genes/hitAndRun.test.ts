// The hit-and-run gene: in, shoot, out, one roll. The tests pin the
// choreography -- the shot lands between the two moves, and the run ends
// beyond the target's reach whenever the movement left can get there --
// because the whole reason the gene exists is that this ORDER is what
// three independent random genes almost never produce.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import { HexCoord } from '../../../../shared/hexengine/HexCoord';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';
import { NO_COOLDOWNS } from '../../../../shared/hexengine/skills';
import { hitAndRunGene } from './hitAndRun';

const mk = (type: string, q: number, r: number, playerIndex: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange,
             hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null };
};

function board(units: any[], cols = 14, rows = 14) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({ map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] }, units, buildings: [] });
}

// A Bulwark covers move 2 + range 1 = 3 hexes; that number is the whole
// geometry below. The Lynx moves 4 and shoots at range 1.
const BULWARK_REACH = 3;
const TANK = { q: 6, r: 6 };

describe('hitAndRun', () => {
    it('from adjacency: shoots first, then runs beyond the reply', () => {
        const spot = HexCoord.getNeighbors(TANK.q, TANK.r)[0];
        const state = board([mk('Lynx', spot.q, spot.r, 0), mk('Bulwark', TANK.q, TANK.r, 1)]);

        expect(hitAndRunGene.apply(state, { kind: 'hitAndRun', unitIndex: 0, targetIndex: 1, seed: 5 })).toBe(true);

        const kinds = state.events.map((e) => e.type);
        const shotAt = kinds.indexOf('unitAttacked');
        expect(shotAt).toBeGreaterThanOrEqual(0);
        // Already in the bracket, so the only move is the run, after the shot.
        expect(kinds.indexOf('unitMoved')).toBeGreaterThan(shotAt);

        const lynx = state.getUnit(0)!;
        expect(HexCoord.getDistance(lynx.q, lynx.r, TANK.q, TANK.r)).toBeGreaterThan(BULWARK_REACH);
        // The target took the Lynx's expected damage.
        expect(state.getUnit(1)!.hp).toBe(unitTypesRecord.Bulwark.hp - 3);
    });

    it('from distance: walks in, shoots, and retreats with what is left', () => {
        // (6,3) is exactly 3 from the tank: two hexes of walking buy
        // adjacency, the shot spends nothing, and the remaining two hexes
        // go into the retreat.
        const state = board([mk('Lynx', 6, 3, 0), mk('Bulwark', TANK.q, TANK.r, 1)]);

        expect(hitAndRunGene.apply(state, { kind: 'hitAndRun', unitIndex: 0, targetIndex: 1, seed: 5 })).toBe(true);

        const kinds = state.events.map((e) => e.type);
        const shotAt = kinds.indexOf('unitAttacked');
        expect(kinds.indexOf('unitMoved')).toBeLessThan(shotAt);            // in...
        expect(kinds.lastIndexOf('unitMoved')).toBeGreaterThan(shotAt);     // ...and out
        expect(state.getUnit(1)!.hp).toBe(unitTypesRecord.Bulwark.hp - 3);

        // Two movement points cannot clear reach 3 from adjacency; the
        // fallback is the farthest reachable hex, and partial distance is
        // still the right play after the damage is banked.
        const lynx = state.getUnit(0)!;
        expect(HexCoord.getDistance(lynx.q, lynx.r, TANK.q, TANK.r)).toBe(3);
    });

    it('does nothing at all when the bracket is out of reach', () => {
        // Advancing without a shot is moveTowards' job, not this gene's.
        const state = board([mk('Lynx', 6, 0, 0), mk('Bulwark', 6, 12, 1)]);
        expect(hitAndRunGene.apply(state, { kind: 'hitAndRun', unitIndex: 0, targetIndex: 1, seed: 5 })).toBe(false);
        expect(state.events).toHaveLength(0);
    });

    it('is inapplicable without a shootable enemy', () => {
        const alone = board([mk('Lynx', 6, 6, 0)]);
        expect(hitAndRunGene.applicable!(alone, 0)).toBe(false);

        const spent = board([mk('Lynx', 6, 3, 0), mk('Bulwark', TANK.q, TANK.r, 1)]);
        spent.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 0 });
        expect(hitAndRunGene.applicable!(spent, 0)).toBe(false);
    });

    it('is deterministic in its seed', () => {
        const run = () => {
            const state = board([mk('Lynx', 6, 3, 0), mk('Bulwark', TANK.q, TANK.r, 1)]);
            hitAndRunGene.apply(state, { kind: 'hitAndRun', unitIndex: 0, targetIndex: 1, seed: 9 });
            return state.events;
        };
        expect(run()).toEqual(run());
    });
});
