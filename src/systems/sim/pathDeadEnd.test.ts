// A movement gene that ranks candidate hexes by straight-line distance can
// only accept a step that shortens the line. On a map with a ridge or a
// lake in the way, the route runs AROUND the obstacle -- and the first step
// around is farther, so it is refused, and next turn looks identical. The
// unit stops and never moves again.
//
// This was not a corner case on the shipped map. Walking a single unit at a
// stationary enemy with moveTowards alone, 74 of 84 starts for a Bulwark
// and the same 74 for a Halberd stopped dead at (5,11); a Kestrel never
// arrived from any of its 84. Only Pike (crosses mountains) and Nightjar
// (flies) got through, because neither ever has to go around anything.
//
// These tests walk the real map, because that is where the bug lived and a
// synthetic board would not have reproduced it.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { applyGene } from './SimCommands';
import { simCostFieldFrom } from './SimPathfinding';
import * as HexCoord from '../../shared/hexengine/hexMath';
import { unitTypesRecord } from '../../shared/hexengine/unitStats';
import { rotor12x18MapProvider as MAP } from '../maps/Rotor12x18MapProvider';

const tiles = MAP.generate();
const TARGET = { q: 6, r: 16 };
// Cost fields key by hex index (r * cols + q) -- see SimPathfinding.
const key = (q: number, r: number) => r * MAP.cols + q;

function stateWith(type: string, q: number, r: number): SimState {
    const s = unitTypesRecord[type];
    const stats = (t: string) => {
        const u = unitTypesRecord[t];
        return { hp: u.hp, maxHp: u.maxHp, move: u.move, attack: u.attack,
                 minRange: u.minRange, maxRange: u.maxRange, hasAttacked: false };
    };
    return SimState.snapshot({
        map: { cols: MAP.cols, rows: MAP.rows, getTile: (a: number, b: number) => tiles[a][b] },
        units: [
            { type, q, r, playerIndex: 0, ...stats(type) },
            { type: 'Bulwark', q: TARGET.q, r: TARGET.r, playerIndex: 1, ...stats('Bulwark') },
        ],
        buildings: [],
    });
}

// March one unit at the enemy with moveTowards alone, and report whether it
// arrives, stalls, or is still walking after `limit` turns.
function march(type: string, from: { q: number; r: number }, limit = 40) {
    let state = stateWith(type, from.q, from.r);
    let last = '';
    for (let turn = 0; turn < limit; turn++) {
        state.record({ type: 'turnStarted', playerIndex: 0 });
        const snapshot = state.condense();
        applyGene(snapshot, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 });
        state = snapshot;
        const unit = state.getUnit(0)!;
        if (HexCoord.getDistance(unit.q, unit.r, TARGET.q, TARGET.r) <= 1) return { arrived: true, turns: turn + 1 };
        const key = `${unit.q},${unit.r}`;
        if (key === last) return { arrived: false, stalledAt: key, turns: turn + 1 };
        last = key;
    }
    return { arrived: false, stalledAt: 'still walking', turns: limit };
}

describe('a ground unit can cross the shipped map', () => {
    it('walks out of the hex where every tank used to stop forever', () => {
        // (5,11) sits against the ridge at (5,12)/(6,11)/(6,12) with the
        // lakes below it. Every reachable hex is the same distance or
        // farther, which is exactly what the old rule refused.
        const state = stateWith('Bulwark', 5, 11);
        expect(applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(true);
        const unit = state.getUnit(0)!;
        expect([unit.q, unit.r]).not.toEqual([5, 11]);
    });

    it('the step it takes is farther in a straight line and nearer along the ground', () => {
        // The whole point in one assertion: progress that hex distance
        // cannot see.
        const state = stateWith('Bulwark', 5, 11);
        const field = simCostFieldFrom(state, 'Bulwark', TARGET.q, TARGET.r);
        const before = { hex: HexCoord.getDistance(5, 11, TARGET.q, TARGET.r), path: field.get(key(5, 11))! };

        applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 });
        const unit = state.getUnit(0)!;
        const after = {
            hex: HexCoord.getDistance(unit.q, unit.r, TARGET.q, TARGET.r),
            path: field.get(key(unit.q, unit.r))!,
        };

        expect(after.path).toBeLessThan(before.path);
        expect(after.hex).toBeGreaterThanOrEqual(before.hex);
    });

    for (const type of ['Bulwark', 'Halberd', 'Kestrel']) {
        it(`${type} arrives from every passable start in the northern half`, () => {
            const failures: string[] = [];
            let starts = 0;
            for (let q = 0; q < MAP.cols; q++) {
                for (let r = 0; r < 8; r++) {
                    if (unitTypesRecord[type].terrainCosts[tiles[q][r].type] == null) continue;
                    starts++;
                    const result = march(type, { q, r });
                    if (!result.arrived) failures.push(`(${q},${r}) -> ${(result as any).stalledAt}`);
                }
            }
            expect(starts).toBeGreaterThan(50);
            expect(failures, `${failures.length}/${starts} never arrived: ${failures.slice(0, 5).join(', ')}`)
                .toHaveLength(0);
        }, 120_000);
    }
});

describe('simCostFieldFrom', () => {
    it('measures ground the unit can cross, not the straight line', () => {
        const state = stateWith('Bulwark', 5, 11);
        const field = simCostFieldFrom(state, 'Bulwark', TARGET.q, TARGET.r);
        // The jam hex is 5 hexes from the target but much further to walk.
        expect(HexCoord.getDistance(5, 11, TARGET.q, TARGET.r)).toBe(5);
        expect(field.get(key(5, 11))!).toBeGreaterThan(5);
    });

    it('leaves impassable ground out entirely', () => {
        const state = stateWith('Bulwark', 5, 11);
        const field = simCostFieldFrom(state, 'Bulwark', TARGET.q, TARGET.r);
        for (let q = 0; q < MAP.cols; q++) {
            for (let r = 0; r < MAP.rows; r++) {
                if (unitTypesRecord.Bulwark.terrainCosts[tiles[q][r].type] != null) continue;
                expect(field.has(key(q, r)), `${q},${r} is impassable`).toBe(false);
            }
        }
    });

    it('ignores who is standing where', () => {
        // The hex being routed toward is occupied by the enemy, so a field
        // that skipped occupied hexes would have no destination at all.
        const state = stateWith('Bulwark', 5, 11);
        const field = simCostFieldFrom(state, 'Bulwark', TARGET.q, TARGET.r);
        expect(field.get(key(TARGET.q, TARGET.r))).toBe(0);
    });
});
