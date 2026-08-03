import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from './SimState';
import type { GameEvent } from './SimState';

// Minimal fake of the live game shape SimState.snapshot() reads.
function makeSource() {
    const cols = 4, rows = 4;
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) {
            tiles[q][r] = { height: 1.0, type: 'GRASS', hasRoad: false, moveCost: 1 };
        }
    }
    // One water tile for the "can't modify water" rule.
    tiles[0][3] = { height: 0, type: 'WATER', hasRoad: false, moveCost: Infinity };

    const units = [
        { type: 'Bulwark', q: 1, r: 1, playerIndex: 0, hp: 10, maxHp: 10, move: 2, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false },
        { type: 'Pike', q: 2, r: 2, playerIndex: 1, hp: 2, maxHp: 2, move: 3, attack: 4, minRange: 1, maxRange: 2, hasAttacked: false },
    ];
    return {
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units,
    };
}

describe('SimState.snapshot', () => {
    it('flattens map tiles and units into pure data', () => {
        const sim = SimState.snapshot(makeSource());
        expect(sim.cols).toBe(4);
        expect(sim.rows).toBe(4);
        expect(sim.getTile(0, 0)).toEqual({ height: 1.0, type: 'GRASS', hasRoad: false, moveCost: 1 });
        expect(sim.getTile(0, 3)!.type).toBe('WATER');
        expect(sim.unitCount).toBe(2);
        expect(sim.getUnit(0)!.type).toBe('Bulwark');
        expect(sim.getUnit(1)!.playerIndex).toBe(1);
    });

    it('is decoupled from the source: later source mutations are invisible', () => {
        const source = makeSource();
        const sim = SimState.snapshot(source);
        source.units[0].hp = 1;
        expect(sim.getUnit(0)!.hp).toBe(10);
    });
});

describe('events', () => {
    it('unitMoved updates position and spends movement', () => {
        const sim = SimState.snapshot(makeSource());
        sim.record({ type: 'unitMoved', unitIndex: 0, toQ: 2, toR: 1, moveSpent: 1 });
        const unit = sim.getUnit(0)!;
        expect([unit.q, unit.r, unit.move]).toEqual([2, 1, 1]);
        expect(sim.getUnitAt(2, 1)![0]).toBe(0);
        expect(sim.getUnitAt(1, 1)).toBeNull();
    });

    it('unitAttacked reduces defender hp, marks attacker, and does NOT auto-kill', () => {
        const sim = SimState.snapshot(makeSource());
        sim.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 5 });
        expect(sim.getUnit(0)!.hasAttacked).toBe(true);
        // hp can go negative until the command layer records unitDied --
        // apply() never derives new facts on its own.
        expect(sim.getUnit(1)!.hp).toBe(-3);
        sim.record({ type: 'unitDied', unitIndex: 1 });
        expect(sim.getUnit(1)).toBeNull();
        expect([...sim.liveUnits()].length).toBe(1);
    });

    it('terrainModified lowers height, and sinks to WATER at or below water level', () => {
        const sim = SimState.snapshot(makeSource());
        sim.record({ type: 'terrainModified', q: 1, r: 1, delta: -0.5 });
        expect(sim.getTile(1, 1)).toMatchObject({ height: 0.5, type: 'GRASS' });

        sim.record({ type: 'terrainModified', q: 1, r: 1, delta: -0.5 });
        const sunk = sim.getTile(1, 1)!;
        expect(sunk.type).toBe('WATER');
        // The effective water level is 0.3, not 0: WATER.baseHeight is 0,
        // but TerrainSystem.getTerrainBaseHeight uses `|| GRASS.baseHeight`
        // so the falsy 0 falls through to grass's 0.3. One of the
        // deliberately-preserved || quirks from the JS->TS migration --
        // GridSystem.modifyHexHeight behaves the same way, and SimState
        // mirrors the real rule rather than the intended-looking one.
        expect(sunk.height).toBe(0.3);
        expect(sunk.moveCost).toBe(Infinity);
    });

    it('terrainModified on WATER is a no-op (matches GridSystem.modifyHexHeight)', () => {
        const sim = SimState.snapshot(makeSource());
        sim.record({ type: 'terrainModified', q: 0, r: 3, delta: 5 });
        expect(sim.getTile(0, 3)!.type).toBe('WATER');
        expect(sim.getTile(0, 3)!.height).toBe(0);
    });

    it('turnStarted resets movement and attack flag for that side only', () => {
        const sim = SimState.snapshot(makeSource());
        // Spend the Bulwark's (p0) resources.
        sim.record({ type: 'unitMoved', unitIndex: 0, toQ: 2, toR: 1, moveSpent: 2 });
        sim.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 1 });
        expect(sim.getUnit(0)!.move).toBe(0);
        expect(sim.getUnit(0)!.hasAttacked).toBe(true);
        const enemyHpBefore = sim.getUnit(1)!.hp;

        sim.record({ type: 'turnStarted', playerIndex: 0 });
        const refreshed = sim.getUnit(0)!;
        expect(refreshed.move).toBe(2); // Bulwark's configured move
        expect(refreshed.hasAttacked).toBe(false);
        // The other side is untouched (and damage persists).
        expect(sim.getUnit(1)!.hp).toBe(enemyHpBefore);
    });

    it('accumulates the log in order', () => {
        const sim = SimState.snapshot(makeSource());
        const events: GameEvent[] = [
            { type: 'unitMoved', unitIndex: 0, toQ: 2, toR: 1, moveSpent: 1 },
            { type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 2 },
            { type: 'unitDied', unitIndex: 1 },
        ];
        events.forEach((e) => sim.record(e));
        expect(sim.events).toEqual(events);
    });
});

describe('fork isolation', () => {
    it('mutating a fork affects neither the parent nor sibling forks', () => {
        const base = SimState.snapshot(makeSource());
        const a = base.fork();
        const b = base.fork();

        a.record({ type: 'terrainModified', q: 1, r: 1, delta: -2 });
        a.record({ type: 'unitDied', unitIndex: 1 });

        expect(base.getTile(1, 1)!.type).toBe('GRASS');
        expect(b.getTile(1, 1)!.type).toBe('GRASS');
        expect(base.getUnit(1)).not.toBeNull();
        expect(b.getUnit(1)).not.toBeNull();

        expect(a.getTile(1, 1)!.type).toBe('WATER');
        expect(a.getUnit(1)).toBeNull();
        expect(a.events.length).toBe(2);
        expect(base.events.length).toBe(0);
        expect(b.events.length).toBe(0);
    });

    it('a fork inherits its parent branch history and continues from it', () => {
        const base = SimState.snapshot(makeSource());
        const parent = base.fork();
        parent.record({ type: 'unitMoved', unitIndex: 0, toQ: 3, toR: 1, moveSpent: 2 });

        const child = parent.fork();
        child.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 1 });

        expect(child.getUnit(0)!.q).toBe(3);
        expect(child.events.length).toBe(2);
        expect(parent.events.length).toBe(1);
        expect(parent.getUnit(1)!.hp).toBe(2);
    });
});

describe('replay determinism', () => {
    it('replaying one branch\'s log onto a fresh fork reproduces identical state', () => {
        const base = SimState.snapshot(makeSource());

        const branch = base.fork();
        branch.record({ type: 'unitMoved', unitIndex: 0, toQ: 2, toR: 1, moveSpent: 1 });
        branch.record({ type: 'terrainModified', q: 2, r: 2, delta: -3 });
        branch.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 2 });
        branch.record({ type: 'unitDied', unitIndex: 1 });

        const replayed = base.fork();
        branch.events.forEach((e) => replayed.record(e));

        expect(replayed.getUnit(0)).toEqual(branch.getUnit(0));
        expect(replayed.getUnit(1)).toEqual(branch.getUnit(1));
        expect(replayed.getTile(2, 2)).toEqual(branch.getTile(2, 2));
        expect(replayed.events).toEqual(branch.events);
    });
});
