import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { applyGene, randomGene, nearestEnemyIndex } from './SimCommands';
import { mulberry32 } from './resolveAttack';
import { HexCoord } from '../../shared/hexengine/HexCoord';

const grass = () => ({ height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 });

function makeUnit(patch: any = {}) {
    return {
        type: 'Bulwark', q: 2, r: 2, playerIndex: 1, hp: 10, maxHp: 10,
        move: 2, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false,
        ...patch,
    };
}

function makeState(units: any[]): SimState {
    return SimState.snapshot({
        map: { cols: 8, rows: 8, getTile: () => grass() },
        units,
    });
}

describe('attack gene', () => {
    it('records unitAttacked and unitDied when lethal, and marks hasAttacked', () => {
        // Bulwark expected damage 5, Droid has 2 hp -> dies.
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const state = makeState([
            makeUnit({ playerIndex: 1 }),
            makeUnit({ type: 'Droid', q: neighbor.q, r: neighbor.r, playerIndex: 0, hp: 2, maxHp: 2 }),
        ]);
        const acted = applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(acted).toBe(true);
        expect(state.events).toEqual([
            { type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 5 },
            { type: 'unitDied', unitIndex: 1 },
        ]);
        expect(state.getUnit(0)!.hasAttacked).toBe(true);
        expect(state.getUnit(1)).toBeNull();
    });

    it('rejects out-of-range, friendly, and repeat attacks', () => {
        const state = makeState([
            makeUnit({ playerIndex: 1, minRange: 1, maxRange: 1 }),
            makeUnit({ q: 6, r: 6, playerIndex: 0 }),          // far away
            makeUnit({ q: 3, r: 2, playerIndex: 1 }),          // friendly adjacent-ish
        ]);
        expect(applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(false);
        // Friendly explicit target falls back to nearest enemy (index 1, out of range) -> false.
        expect(applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 2, seed: 1 })).toBe(false);
        expect(state.events).toEqual([]);

        // hasAttacked blocks.
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const state2 = makeState([
            makeUnit({ playerIndex: 1, hasAttacked: true }),
            makeUnit({ q: neighbor.q, r: neighbor.r, playerIndex: 0 }),
        ]);
        expect(applyGene(state2, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(false);
    });

    it('artillery cannot fire at adjacent targets (min range 2)', () => {
        // Kestrel needs at least one empty tile between itself and the
        // target -- getting close to artillery neutralizes it, which is
        // the intended counterplay.
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const adjacent = makeState([
            makeUnit({ type: 'Kestrel', q: 2, r: 2, playerIndex: 1, minRange: 2, maxRange: 3 }),
            makeUnit({ type: 'Droid', q: neighbor.q, r: neighbor.r, playerIndex: 0 }),
        ]);
        expect(applyGene(adjacent, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(false);
        expect(adjacent.events).toEqual([]);

        // At distance 2 (one tile in between) the same shot is legal.
        const standoff = makeState([
            makeUnit({ type: 'Kestrel', q: 2, r: 2, playerIndex: 1, minRange: 2, maxRange: 3 }),
            makeUnit({ type: 'Droid', q: 4, r: 2, playerIndex: 0 }),
        ]);
        expect(HexCoord.getDistance(2, 2, 4, 2)).toBe(2);
        expect(applyGene(standoff, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(true);
        expect(standoff.events.some((e) => e.type === 'unitAttacked')).toBe(true);
    });

    it('rocketBarrage genes record terrainModified craters', () => {
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const state = makeState([
            makeUnit({ type: 'Kestrel', q: neighbor.q, r: neighbor.r, playerIndex: 1, minRange: 1, maxRange: 5 }),
            makeUnit({ type: 'Droid', q: 2, r: 2, playerIndex: 0, hp: 2 }),
        ]);
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 99 });
        const craters = state.events.filter((e) => e.type === 'terrainModified');
        expect(craters.length).toBe(6);
        // The terrain actually sank in this branch.
        const changed = craters.some((c: any) => state.getTile(c.q, c.r)!.height < 1);
        expect(changed).toBe(true);
    });
});

describe('movement genes', () => {
    it('moveTowards closes distance and spends movement', () => {
        const state = makeState([
            makeUnit({ q: 1, r: 1, playerIndex: 1, move: 2 }),
            makeUnit({ q: 6, r: 6, playerIndex: 0 }),
        ]);
        const before = HexCoord.getDistance(1, 1, 6, 6);
        const acted = applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(acted).toBe(true);

        const moved = state.getUnit(0)!;
        expect(HexCoord.getDistance(moved.q, moved.r, 6, 6)).toBeLessThan(before);
        expect(moved.move).toBeLessThan(2);

        const event: any = state.events[0];
        expect(event.type).toBe('unitMoved');
        expect(event.moveSpent).toBeGreaterThan(0);
    });

    it('sequential genes for the same unit compose against the shrinking budget', () => {
        const state = makeState([
            makeUnit({ q: 1, r: 1, playerIndex: 1, move: 2 }),
            makeUnit({ q: 7, r: 7, playerIndex: 0 }),
        ]);
        applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 });
        const midMove = state.getUnit(0)!.move;
        applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 2 });
        const endMove = state.getUnit(0)!.move;
        expect(endMove).toBeLessThanOrEqual(midMove);
        expect(endMove).toBeGreaterThanOrEqual(0);
    });

    it('moveAway increases distance to the threat', () => {
        const neighbor = HexCoord.getNeighbors(3, 3)[0];
        const state = makeState([
            makeUnit({ q: 3, r: 3, playerIndex: 1, move: 2 }),
            makeUnit({ q: neighbor.q, r: neighbor.r, playerIndex: 0 }),
        ]);
        applyGene(state, { kind: 'moveAway', unitIndex: 0, targetIndex: 1, seed: 1 });
        const moved = state.getUnit(0)!;
        expect(HexCoord.getDistance(moved.q, moved.r, neighbor.q, neighbor.r)).toBeGreaterThan(1);
    });

    it('moveRandom is deterministic per seed', () => {
        const build = () => makeState([makeUnit({ q: 3, r: 3, playerIndex: 1, move: 2 })]);
        const a = build(); applyGene(a, { kind: 'moveRandom', unitIndex: 0, seed: 77 });
        const b = build(); applyGene(b, { kind: 'moveRandom', unitIndex: 0, seed: 77 });
        expect(a.events).toEqual(b.events);
    });

    it('dead units and idle genes produce nothing', () => {
        const state = makeState([makeUnit({ playerIndex: 1 }), makeUnit({ q: 4, r: 4, playerIndex: 0 })]);
        state.record({ type: 'unitDied', unitIndex: 0 });
        const logLength = state.events.length;
        expect(applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(false);
        expect(applyGene(state, { kind: 'idle', unitIndex: 1, seed: 1 })).toBe(false);
        expect(state.events.length).toBe(logLength);
    });
});

describe('helpers', () => {
    it('nearestEnemyIndex finds the closest opposing unit', () => {
        const state = makeState([
            makeUnit({ q: 0, r: 0, playerIndex: 1 }),
            makeUnit({ q: 5, r: 5, playerIndex: 0 }),
            makeUnit({ q: 2, r: 1, playerIndex: 0 }),
        ]);
        expect(nearestEnemyIndex(state, 0)).toBe(2);
    });

    it('randomGene targets enemies and is deterministic given the rng', () => {
        const state = makeState([
            makeUnit({ playerIndex: 1 }),
            makeUnit({ q: 5, r: 5, playerIndex: 0 }),
        ]);
        const a = randomGene(state, 0, mulberry32(5));
        const b = randomGene(state, 0, mulberry32(5));
        expect(a).toEqual(b);
        expect(a.unitIndex).toBe(0);
        if (a.targetIndex !== undefined) expect(a.targetIndex).toBe(1);
    });
});
