// The wildfire rules, exercised through the simulation the AI searches.
//
// These are pure-state tests: the rules live in shared/hexengine/fire.ts and
// are called identically by the live game, which needs a renderer to test.
// That sharing is the point -- there is one implementation, so proving it
// here proves it for both sides.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from './SimState';
import { NO_COOLDOWNS, PIKE_FIRE } from '../../shared/hexengine/skills';
import { FIRE_DURATION, canIgnite } from '../../shared/hexengine/fire';
import { applyGene, startTurn, recordSimMove } from './SimCommands';
import { burnGene } from './ai/genes/burn';
import { mulberry32 } from './resolveAttack';
import { hexNeighbors } from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';

// Everything is vegetated unless a test says otherwise, so the interesting
// variable is the fire rather than the scenery.
const tile = (over: any = {}) => ({
    height: 1, type: 'FOREST', hasRoad: false, moveCost: 1,
    vegetated: true, burning: 0, burned: false, ...over,
});

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 6, maxHp: 6, move: 6, attack: 4, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...over,
    };
}

const board = (units: SimUnit[] = [], tileAt: (q: number, r: number) => any = () => tile()) =>
    SimState.snapshot({
        map: { cols: 10, rows: 10, getTile: tileAt },
        units,
        buildings: [],
    });

// Always spreads / never spreads, so the mechanic is testable without
// guessing at a seed.
const ALWAYS = () => 0;
const NEVER = () => 0.99;

describe('lighting a fire', () => {
    it('burns for the skill\'s stated duration', () => {
        const state = board();
        state.record({ type: 'fireStarted', q: 3, r: 3, casterIndex: -1, skillId: PIKE_FIRE.id });
        expect(state.getTile(3, 3)!.burning).toBe(FIRE_DURATION);
        // The duration on the skill and the duration in the rules are one
        // number, not two that happen to agree.
        expect(PIKE_FIRE.effect).toMatchObject({ kind: 'startFire', turns: FIRE_DURATION });
    });

    it('spends the caster\'s action', () => {
        const state = board([unit({ type: 'Pike', q: 3, r: 2, playerIndex: 0 })]);
        state.record({ type: 'fireStarted', q: 3, r: 3, casterIndex: 0, skillId: PIKE_FIRE.id });
        expect(state.getUnit(0)!.hasAttacked, 'a Pike could burn the wood and still shoot').toBe(true);
        expect(state.getUnit(0)!.cooldowns[PIKE_FIRE.id]).toBe(PIKE_FIRE.cooldown);
    });

    it('refuses bare ground, and refuses to relight ashes', () => {
        expect(canIgnite(tile({ vegetated: false }))).toBe(false);
        expect(canIgnite(tile({ burned: true })), 'burnt-out trees caught again').toBe(false);
        expect(canIgnite(tile({ burning: 2 })), 'an existing fire was restarted').toBe(false);
        expect(canIgnite(tile())).toBe(true);
    });
});

describe('a fire over time', () => {
    const lit = () => {
        const state = board();
        state.record({ type: 'fireStarted', q: 3, r: 3, casterIndex: -1, skillId: PIKE_FIRE.id });
        return state;
    };

    it('counts down one turn at a time and then leaves ash', () => {
        const state = lit();
        for (let turn = 0; turn < FIRE_DURATION - 1; turn++) {
            startTurn(state, turn % 2, NEVER);
            expect(state.getTile(3, 3)!.burning).toBe(FIRE_DURATION - 1 - turn);
            expect(state.getTile(3, 3)!.burned).toBe(false);
        }
        startTurn(state, 0, NEVER);
        expect(state.getTile(3, 3)!.burning).toBe(0);
        expect(state.getTile(3, 3)!.burned, 'the tile never burnt out').toBe(true);
    });

    it('spreads to neighbours on a winning roll, and to nothing on a losing one', () => {
        const cold = lit();
        startTurn(cold, 0, NEVER);
        expect(cold.getTile(3, 2)!.burning).toBe(0);

        const hot = lit();
        startTurn(hot, 0, ALWAYS);
        // Every one of the six neighbours caught. Taken from hexNeighbors
        // rather than written out: the offsets depend on column PARITY in
        // odd-q, so a hand-written ring is right for half the map only.
        for (const n of hexNeighbors(3, 3)) {
            expect(hot.getTile(n.q, n.r)!.burning, `neighbour ${n.q},${n.r} did not catch`).toBe(FIRE_DURATION);
        }
    });

    it('does not chain across the map in a single turn', () => {
        // The freshly-caught ring must not spread again the same tick.
        const state = lit();
        startTurn(state, 0, ALWAYS);
        expect(state.getTile(3, 0)!.burning, 'the fire jumped two rings in one turn').toBe(0);
    });

    it('never reignites ash, however long it burns around it', () => {
        const state = lit();
        for (let turn = 0; turn < FIRE_DURATION * 3; turn++) startTurn(state, turn % 2, ALWAYS);
        expect(state.getTile(3, 3)!.burned).toBe(true);
        expect(state.getTile(3, 3)!.burning, 'ash caught fire again').toBe(0);
    });

    it('is deterministic for a given seed, which is what the parallel search rests on', () => {
        const runs = [0, 1].map(() => {
            const state = lit();
            startTurn(state, 0, mulberry32(1234));
            return JSON.stringify(state.events);
        });
        expect(runs[0]).toBe(runs[1]);
    });
});

describe('walking through fire', () => {
    const withFireAt = (burningQ: number, burningR: number, units: SimUnit[]) =>
        board(units, (q, r) => tile(q === burningQ && r === burningR ? { burning: FIRE_DURATION } : {}));

    it('costs a ground unit a hit point per burning tile entered', () => {
        const state = withFireAt(3, 2, [unit({ type: 'Pike', q: 3, r: 1, playerIndex: 0 })]);
        recordSimMove(state, 0, 3, 3, 2);
        expect(state.getUnit(0)!.hp, 'the Pike walked through fire for free').toBe(5);
    });

    it('costs nothing to a flier', () => {
        const state = withFireAt(3, 2, [unit({ type: 'Nightjar', q: 3, r: 1, playerIndex: 0 })]);
        recordSimMove(state, 0, 3, 3, 2);
        expect(state.getUnit(0)!.hp, 'a helicopter was burned by ground fire').toBe(6);
    });

    it('kills, and takes the cargo with it', () => {
        const state = withFireAt(3, 2, [
            unit({ type: 'Drover', q: 3, r: 1, playerIndex: 0, hp: 1 }),
            unit({ type: 'Pike', q: 3, r: 1, playerIndex: 0, carriedBy: 0 }),
        ]);
        recordSimMove(state, 0, 3, 2, 1);
        expect(state.getUnit(0), 'the transport survived a lethal fire').toBeNull();
        expect(state.getUnit(1), 'the passenger outlived its burning ride').toBeNull();
    });

    it('costs nothing to stand still in a fire', () => {
        // "Passes over" is the rule -- the unit is in the gaps between the
        // flames until it moves again.
        const state = withFireAt(3, 1, [unit({ type: 'Pike', q: 3, r: 1, playerIndex: 0 })]);
        startTurn(state, 0, NEVER);
        expect(state.getUnit(0)!.hp).toBe(6);
    });
});

describe('the AI can light one', () => {
    it('offers the gene to a Pike standing beside greenery, and to nobody else', () => {
        const state = board([
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Bulwark', q: 6, r: 6, playerIndex: 0 }),
            unit({ type: 'Halberd', q: 8, r: 8, playerIndex: 1 }),
        ]);
        expect(burnGene.applicable!(state, 0)).toBe(true);
        expect(burnGene.applicable!(state, 1), 'a tank found a box of matches').toBe(false);
    });

    it('will not light bare ground', () => {
        const state = board(
            [unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0 }), unit({ type: 'Halberd', q: 8, r: 8, playerIndex: 1 })],
            () => tile({ vegetated: false })
        );
        expect(burnGene.applicable!(state, 0)).toBe(false);
    });

    it('actually starts one, and spends the action doing it', () => {
        const state = board([
            unit({ type: 'Pike', q: 3, r: 3, playerIndex: 0 }),
            unit({ type: 'Halberd', q: 5, r: 3, playerIndex: 1 }),
        ]);
        expect(applyGene(state, { kind: 'burn', unitIndex: 0, seed: 1 } as any, { burn: burnGene })).toBe(true);
        const fires = state.events.filter((e: any) => e.type === 'fireStarted');
        expect(fires).toHaveLength(1);
        expect(state.getUnit(0)!.hasAttacked).toBe(true);
    });
});

describe('a destroyed machine leaves a burning wreck', () => {
    // The roll is seeded from the branch's own position, so a scenario either
    // ignites or it does not -- deterministically. These probe a spread of
    // positions and assert on the POPULATION rather than on one lucky hex,
    // which is what a 50% rule actually claims.
    const killAt = (type: string, q: number, r: number, vegetated = true) => {
        const state = board(
            [
                unit({ type: 'Bulwark', q: 0, r: 0, playerIndex: 1, attack: 99, minRange: 1, maxRange: 9 }),
                unit({ type, q, r, playerIndex: 0, hp: 1, maxHp: 1 }),
            ],
            () => tile({ vegetated })
        );
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        return state;
    };

    const litFraction = (type: string, vegetated = true) => {
        let lit = 0, total = 0;
        for (let q = 1; q < 9; q++) {
            for (let r = 1; r < 9; r++) {
                total++;
                if (killAt(type, q, r, vegetated).getTile(q, r)!.burning > 0) lit++;
            }
        }
        return lit / total;
    };

    it('catches about half the time', () => {
        const share = litFraction('Bulwark');
        expect(share, `a tank wreck lit ${Math.round(share * 100)}% of the time`).toBeGreaterThan(0.3);
        expect(share).toBeLessThan(0.7);
    });

    it('never from infantry -- there is no engine to burn', () => {
        expect(litFraction('Pike'), 'a dead Pike started a forest fire').toBe(0);
    });

    it('never on bare ground', () => {
        expect(litFraction('Bulwark', false)).toBe(0);
    });

    it('is the same partition the repair crew works on', () => {
        // One definition of "mechanical", not two that happen to agree.
        expect(UnitSystem.isMechanical('Bulwark')).toBe(true);
        expect(UnitSystem.isMechanical('Kestrel')).toBe(true);
        expect(UnitSystem.isMechanical('Nightjar')).toBe(true);
        expect(UnitSystem.isMechanical('Pike')).toBe(false);
        expect(UnitSystem.isMechanical('Road')).toBe(false);
        // Fails safe: an unknown type is not a machine, so a typo cannot set
        // the map alight.
        expect(UnitSystem.isMechanical('Nonesuch'), 'an unknown type burned the woods down').toBe(false);
    });

    it('records the fire with no caster, so nothing is charged for it', () => {
        let found: any = null;
        for (let q = 1; q < 9 && !found; q++) {
            for (let r = 1; r < 9 && !found; r++) {
                const e = killAt('Bulwark', q, r).events.find((x: any) => x.type === 'fireStarted');
                if (e) found = e;
            }
        }
        expect(found, 'no wreck fire was produced anywhere on the board').not.toBeNull();
        expect(found.casterIndex, 'a wreck fire named a caster, who would be charged for it').toBe(-1);
        expect(found.skillId).toBeUndefined();
    });

    it('rolls once for a loaded transport, not once per corpse', () => {
        // recordDeath cascades cargo. Riders are infantry by construction, so
        // the passenger must not add a second draw on the same hex.
        const state = board(
            [
                unit({ type: 'Bulwark', q: 0, r: 0, playerIndex: 1, attack: 99, minRange: 1, maxRange: 9 }),
                unit({ type: 'Drover', q: 4, r: 4, playerIndex: 0, hp: 1, maxHp: 1 }),
                unit({ type: 'Pike', q: 4, r: 4, playerIndex: 0, carriedBy: 1 }),
            ],
            () => tile()
        );
        applyGene(state, { kind: 'attack', unitIndex: 0, targetIndex: 1, seed: 1 });
        const fires = state.events.filter((e: any) => e.type === 'fireStarted');
        expect(fires.length, 'the passenger rolled its own wreck fire').toBeLessThanOrEqual(1);
    });
});
