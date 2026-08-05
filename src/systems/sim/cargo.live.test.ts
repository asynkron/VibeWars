// The two cargo rules the LIVE side was missing.
//
// Both existed in the simulation and not in the live game, which is the
// worst shape a bug can take here: the AI searches a plan and replays it
// against the live board, so the two disagreeing means it plays a different
// game than it chose, and AIController validates only range and hasAttacked.
//
// These are pure-state tests against the same rules the live executors
// implement, because UnitSystem itself needs a renderer.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from './SimState';
import { NO_COOLDOWNS } from '../../shared/hexengine/skills';
import { applyGene, nearestTargetableEnemyIndex, weakestTargetableEnemyIndex, sweepAttacks } from './SimCommands';

const grass = () => ({ type: 'GRASS', height: 1, moveCost: 1, hasRoad: false });

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 6, maxHp: 6, move: 3, attack: 4, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...over,
    };
}

const board = (units: SimUnit[]) => SimState.snapshot({
    map: { cols: 12, rows: 12, getTile: () => grass() },
    units,
    buildings: [],
});

describe('cargo follows its transport', () => {
    it('moves with it, so nothing reads a stale position', () => {
        // Without this the passenger's coordinates stay where it boarded,
        // and every distance term lies -- including the capture pull that is
        // the whole reason to drive infantry forward.
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 0, hp: 4, maxHp: 4 }),
            unit({ type: 'Bulwark', q: 9, r: 9, playerIndex: 1, hp: 10, maxHp: 10 }),
        ]);
        state.record({ type: 'unitMoved', unitIndex: 0, toQ: 5, toR: 4, moveSpent: 2 });
        const rider = state.getUnit(1)!;
        expect([rider.q, rider.r]).toEqual([5, 4]);
    });

    it('does not report itself as standing on the transport\'s hex', () => {
        const state = board([
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 0, hp: 4, maxHp: 4 }),
        ]);
        expect(state.getUnitAt(3, 3)![0]).toBe(0);
    });
});

describe('cargo dies with its transport', () => {
    it('goes down when the ride is destroyed', () => {
        // Otherwise a loaded APC is an invulnerable warehouse: getUnitAt
        // hides the passenger from every shot, so nothing else can reach it.
        // Making the ride a real risk is what lets the search weigh it.
        const state = board([
            unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1, hp: 10, maxHp: 10, minRange: 1, maxRange: 1 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 1 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1, hp: 4, maxHp: 4 }),
        ]);
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(state.getUnit(1), 'the transport survived the test setup').toBeNull();
        expect(state.getUnit(2), 'the passenger outlived its ride').toBeNull();
    });

    it('leaves an EMPTY transport\'s death alone', () => {
        const state = board([
            unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1, hp: 10, maxHp: 10 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 1 }),
            unit({ type: 'Pike', q: 8, r: 8, playerIndex: 0, hp: 4, maxHp: 4 }),
        ]);
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        expect(state.getUnit(1)).toBeNull();
        expect(state.getUnit(2), 'an unrelated unit was caught in the cascade').not.toBeNull();
    });
});

// carriedBy is an INDEX in the simulation and a GameUnit REFERENCE on the
// live side. Every rule below is one that read the field and got it wrong.
describe('carriedBy survives the trip into and through a snapshot', () => {
    it('translates a live GameUnit reference into an index', () => {
        // What GameState actually holds: UnitSystem.loadPassenger writes
        // `passenger.carriedBy = carrier`, the object itself.
        const carrier: any = { type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 6, maxHp: 6,
            move: 3, attack: 4, minRange: 1, maxRange: 1, hasAttacked: false, carriedBy: null };
        const passenger: any = { ...carrier, type: 'Pike', carriedBy: carrier };
        const state = SimState.snapshot({
            map: { cols: 12, rows: 12, getTile: () => grass() },
            units: [carrier, passenger],
            buildings: [],
        });
        expect(state.getUnit(1)!.carriedBy, 'an object landed in a number field').toBe(0);
    });

    it('remaps indices when condense compacts a hole', () => {
        // Unit 0 dies, so 1 and 2 slide down to 0 and 1. A passenger whose
        // carriedBy is copied through unchanged now points at whoever took
        // that number -- here, at itself.
        const state = board([
            unit({ type: 'Pike', q: 1, r: 1, playerIndex: 1, hp: 1 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1 }),
        ]);
        state.record({ type: 'unitDied', unitIndex: 0 });

        const next = state.condense();
        expect(next.getUnit(1)!.carriedBy, 'the passenger was rebound by compaction').toBe(0);
        expect(next.getUnit(0)!.type).toBe('Drover');
    });
});

describe('cargo is out of play until it is put down', () => {
    // The PASSENGER is index 0 and the wounded one, so every tie-break in
    // the target pickers points at it: they scan in index order and keep
    // the first strictly-better candidate, and cargo shares its carrier's
    // hex so distance can never separate the two. Ordered the other way
    // round these tests pass without the cargo rule at all.
    const loaded = () => board([
        unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1, move: 0, hp: 1 }),
        unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
        unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1 }),
    ]);

    it('does not get its movement back at the start of the turn', () => {
        // unitLoaded pins the passenger with move: 0. Handing it back is
        // how a Pike walks out of a moving transport with no unload.
        const state = loaded();
        state.record({ type: 'turnStarted', playerIndex: 0 });
        expect(state.getUnit(0)!.move, 'the passenger can walk out of the hull').toBe(0);
        expect(state.getUnit(1)!.move, 'the transport lost its own turn').toBeGreaterThan(0);
    });

    it('is not enumerated as a unit that acts', () => {
        const state = loaded();
        const active = [...state.activeUnits()].map(([i]) => i);
        expect(active).toEqual([1, 2]);
    });

    it('cannot be shot through the hull', () => {
        const state = loaded();
        // The Bulwark is adjacent, and the 1hp Pike is exactly what focus
        // fire is built to reach for.
        expect(nearestTargetableEnemyIndex(state, 2), 'picked the passenger').toBe(1);
        expect(weakestTargetableEnemyIndex(state, 2), 'focused the passenger').toBe(1);
    });

    it('does not fire out of it either', () => {
        const state = board([
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1, move: 0 }),
            unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 4, r: 3, playerIndex: 1, hp: 40, maxHp: 40 }),
        ]);
        sweepAttacks(state, 0);
        const shooters = state.events
            .filter((e: any) => e.type === 'unitAttacked')
            .map((e: any) => e.attackerIndex);
        expect(shooters, 'the passenger shot from inside the transport').not.toContain(0);
    });
});

describe('cargo drowns with its transport', () => {
    it('goes down when the ground under the ride turns to water', () => {
        // The damage path cascaded and the drowning path did not, which left
        // passengers alive on a corpse at coordinates that no longer moved.
        //
        // Every tile sits at 0.05, just above WATER's base height of 0, so
        // the barrage's -0.1 crater sinks whatever it lands on. Seed 1 puts
        // one of the six rockets on (3,3) -- the transport's own hex. The
        // Drover has the hp to shrug off the 4 damage, so the ONLY thing
        // that can kill it here is the water.
        const state = SimState.snapshot({
            map: {
                cols: 12, rows: 12,
                getTile: () => ({ type: 'GRASS', height: 0.05, moveCost: 1, hasRoad: false }),
            },
            units: [
                unit({ type: 'Kestrel', q: 5, r: 3, playerIndex: 1, minRange: 2, maxRange: 3 }),
                unit({ type: 'Drover', q: 3, r: 3, playerIndex: 0, hp: 60, maxHp: 60 }),
                unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0, carriedBy: 1 }),
            ],
            buildings: [],
        });

        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });

        expect(state.getTile(3, 3)!.type, 'the hex never sank, so the test proves nothing').toBe('WATER');
        expect(state.getUnit(1), 'the transport did not drown, so the test proves nothing').toBeNull();
        expect(state.getUnit(2), 'the passenger survived its sunken ride').toBeNull();
    });
});
