import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import { applyGene, randomGene, nearestEnemyIndex, nearestCapturableBuildingIndex, sweepAttacks } from './SimCommands';
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

function makeState(units: any[], buildings: any[] = []): SimState {
    return SimState.snapshot({
        map: { cols: 8, rows: 8, getTile: () => grass() },
        units,
        buildings,
    });
}

describe('attack gene', () => {
    it('records unitAttacked and unitDied when lethal, and marks hasAttacked', () => {
        // Bulwark expected damage 5, Droid has 2 hp -> dies.
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const state = makeState([
            makeUnit({ playerIndex: 1 }),
            makeUnit({ type: 'Pike', q: neighbor.q, r: neighbor.r, playerIndex: 0, hp: 2, maxHp: 2 }),
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
            makeUnit({ type: 'Pike', q: neighbor.q, r: neighbor.r, playerIndex: 0 }),
        ]);
        expect(applyGene(adjacent, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(false);
        expect(adjacent.events).toEqual([]);

        // At distance 2 (one tile in between) the same shot is legal.
        const standoff = makeState([
            makeUnit({ type: 'Kestrel', q: 2, r: 2, playerIndex: 1, minRange: 2, maxRange: 3 }),
            makeUnit({ type: 'Pike', q: 4, r: 2, playerIndex: 0 }),
        ]);
        expect(HexCoord.getDistance(2, 2, 4, 2)).toBe(2);
        expect(applyGene(standoff, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 })).toBe(true);
        expect(standoff.events.some((e) => e.type === 'unitAttacked')).toBe(true);
    });

    it('rocketBarrage genes record terrainModified craters', () => {
        const neighbor = HexCoord.getNeighbors(2, 2)[0];
        const state = makeState([
            makeUnit({ type: 'Kestrel', q: neighbor.q, r: neighbor.r, playerIndex: 1, minRange: 1, maxRange: 5 }),
            makeUnit({ type: 'Pike', q: 2, r: 2, playerIndex: 0, hp: 2 }),
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

describe('drowning', () => {
    it('a land unit on a tile that sinks into water dies (plums)', () => {
        // Custom map: the target tile is one crater away from the water
        // line, and a land unit stands on it.
        const lowTile = { height: 0.5, type: 'GRASS', hasRoad: false, moveCost: 1 };
        const state = SimState.snapshot({
            map: { cols: 8, rows: 8, getTile: (q: number, r: number) => (q === 2 && r === 2 ? lowTile : grass()) },
            units: [
                makeUnit({ type: 'Kestrel', q: 5, r: 2, playerIndex: 1, minRange: 2, maxRange: 3 }),
                // hp far above any splash damage: only drowning can kill it.
                makeUnit({ type: 'Pike', q: 2, r: 2, playerIndex: 0, hp: 100, maxHp: 100 }),
            ],
        });
        // Fire barrages until a crater lands on the target tile and sinks
        // it (placement is seeded per gene, so scan a few seeds).
        for (let seed = 1; seed < 40 && state.getTile(2, 2)!.type !== 'WATER'; seed++) {
            state.record({ type: 'turnStarted', playerIndex: 1 });
            applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed });
        }
        expect(state.getTile(2, 2)!.type).toBe('WATER');
        // The Pike went down with the tile despite its massive hp.
        expect(state.getUnit(1)).toBeNull();
        expect(state.events.some((e) => e.type === 'unitDied' && e.unitIndex === 1)).toBe(true);
    });
});

describe('building capture in the sim', () => {
    const factoryAt = (q: number, r: number, patch: any = {}) =>
        ({ type: 'factory', q, r, ownerIndex: null, hiddenUnitType: 'Sabre', ...patch });

    it('moveToBuilding walks infantry onto the factory and derives buildingCaptured', () => {
        // Pike (canCapture, move 2) two tiles from a neutral factory.
        const state = makeState(
            [makeUnit({ type: 'Pike', q: 2, r: 2, playerIndex: 1, move: 2 })],
            [factoryAt(4, 2)],
        );
        const acted = applyGene(state, { kind: 'moveToBuilding', unitIndex: 0, seed: 1 });
        expect(acted).toBe(true);
        expect(state.getUnit(0)).toMatchObject({ q: 4, r: 2 });
        expect(state.events).toEqual([
            { type: 'unitMoved', unitIndex: 0, toQ: 4, toR: 2, moveSpent: 2 },
            { type: 'buildingCaptured', buildingIndex: 0, playerIndex: 1 },
        ]);
        expect(state.getBuilding(0)).toMatchObject({ ownerIndex: 1, hasHiddenUnit: false, yieldedTo: 1 });
    });

    it('any movement gene derives the capture when infantry lands on a building', () => {
        // moveTowards an enemy that happens to sit past the factory tile.
        const state = makeState(
            [
                makeUnit({ type: 'Pike', q: 2, r: 2, playerIndex: 1, move: 2 }),
                makeUnit({ q: 6, r: 2, playerIndex: 0 }),
            ],
            [factoryAt(4, 2)],
        );
        applyGene(state, { kind: 'moveTowards', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(state.getUnit(0)).toMatchObject({ q: 4, r: 2 });
        expect(state.events.some((e) => e.type === 'buildingCaptured')).toBe(true);
    });

    it('non-capture units never trigger captures and reject moveToBuilding', () => {
        // Bulwark (tank, no canCapture) driving over the factory tile.
        const state = makeState(
            [makeUnit({ type: 'Bulwark', q: 2, r: 2, playerIndex: 1, move: 2 })],
            [factoryAt(4, 2)],
        );
        expect(applyGene(state, { kind: 'moveToBuilding', unitIndex: 0, seed: 1 })).toBe(false);

        applyGene(state, { kind: 'moveRandom', unitIndex: 0, seed: 4 });
        expect(state.events.some((e) => e.type === 'buildingCaptured')).toBe(false);
        expect(state.getBuilding(0)!.ownerIndex).toBeNull();
    });

    it('moving onto an already-owned building does not re-capture it', () => {
        const state = makeState(
            [makeUnit({ type: 'Pike', q: 3, r: 2, playerIndex: 1, move: 2 })],
            [factoryAt(4, 2, { ownerIndex: 1, hiddenUnitType: null })],
        );
        // Own building -> not a moveToBuilding target...
        expect(applyGene(state, { kind: 'moveToBuilding', unitIndex: 0, seed: 1 })).toBe(false);
        // ...and walking onto it records no capture.
        applyGene(state, { kind: 'moveRandom', unitIndex: 0, seed: 8 });
        expect(state.events.every((e) => e.type !== 'buildingCaptured')).toBe(true);
    });

    it('nearestCapturableBuildingIndex skips own and destroyed buildings', () => {
        const state = makeState(
            [makeUnit({ type: 'Pike', q: 0, r: 0, playerIndex: 1 })],
            [
                factoryAt(1, 0, { ownerIndex: 1 }),   // own -- skip
                factoryAt(2, 0),                       // nearest capturable
                factoryAt(5, 0, { ownerIndex: 0 }),   // enemy-owned -- capturable too, but farther
            ],
        );
        expect(nearestCapturableBuildingIndex(state, 0)).toBe(1);

        state.record({ type: 'terrainModified', q: 2, r: 0, delta: -1 });
        expect(state.getBuilding(1)!.destroyed).toBe(true);
        expect(nearestCapturableBuildingIndex(state, 0)).toBe(2);
    });

    it('randomGene never emits moveToBuilding for units that cannot capture', () => {
        const state = makeState(
            [makeUnit({ type: 'Bulwark', playerIndex: 1 }), makeUnit({ q: 6, r: 6, playerIndex: 0 })],
            [factoryAt(4, 2)],
        );
        const rng = mulberry32(1);
        for (let i = 0; i < 200; i++) {
            expect(randomGene(state, 0, rng).kind).not.toBe('moveToBuilding');
        }
    });

    it('randomGene does emit moveToBuilding for infantry when a factory is up for grabs', () => {
        const state = makeState(
            [makeUnit({ type: 'Pike', playerIndex: 1 }), makeUnit({ q: 6, r: 6, playerIndex: 0 })],
            [factoryAt(4, 2)],
        );
        const rng = mulberry32(1);
        const kinds = new Set<string>();
        for (let i = 0; i < 200; i++) kinds.add(randomGene(state, 0, rng).kind);
        expect(kinds.has('moveToBuilding')).toBe(true);
    });
});

describe('sweepAttacks', () => {
    it('fires every unit with a legal shot, preferring kills', () => {
        const neighbors = HexCoord.getNeighbors(2, 2);
        const state = makeState([
            makeUnit({ playerIndex: 1, q: 2, r: 2 }),                                        // Bulwark, expected 5 dmg
            makeUnit({ type: 'Pike', q: neighbors[0].q, r: neighbors[0].r, playerIndex: 0, hp: 2, maxHp: 2 }), // killable
            makeUnit({ q: neighbors[1].q, r: neighbors[1].r, playerIndex: 0, hp: 10 }),      // survivable
        ]);
        expect(sweepAttacks(state, 1)).toBe(true);
        // The kill was chosen over chip damage on the full-hp tank.
        expect(state.events.some((e) => e.type === 'unitDied' && e.unitIndex === 1)).toBe(true);
        expect(state.getUnit(0)!.hasAttacked).toBe(true);
        // Idempotent: everyone has fired, a second sweep does nothing.
        expect(sweepAttacks(state, 1)).toBe(false);
    });

    it('does nothing when no shot is legal and never fires net-negative barrages', () => {
        // No enemy in range.
        const idle = makeState([
            makeUnit({ playerIndex: 1, q: 0, r: 0 }),
            makeUnit({ q: 7, r: 7, playerIndex: 0 }),
        ]);
        expect(sweepAttacks(idle, 1)).toBe(false);
        expect(idle.events).toEqual([]);

        // A Kestrel barrage whose splash would maul its own Bulwark next to
        // the 1hp target: enemy value 5+100(kill) vs own splash 2*1.5 --
        // still positive, so it fires; but if the OWN unit is the 2hp one
        // and the enemy is worth little, the net goes negative and the
        // sweep must hold fire.
        const neighbor = HexCoord.getNeighbors(4, 2)[0];
        const holdFire = makeState([
            makeUnit({ type: 'Kestrel', q: 2, r: 2, playerIndex: 1, minRange: 2, maxRange: 3 }),
            makeUnit({ type: 'Pike', q: 4, r: 2, playerIndex: 0, hp: 1, maxHp: 4 }),
            // Own nearly-dead Bulwark parked in the splash zone.
            makeUnit({ q: neighbor.q, r: neighbor.r, playerIndex: 1, hp: 2, maxHp: 10 }),
        ]);
        sweepAttacks(holdFire, 1);
        // Whatever it decided, it must never have killed its own tank.
        expect(holdFire.getUnit(2)).not.toBeNull();
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
