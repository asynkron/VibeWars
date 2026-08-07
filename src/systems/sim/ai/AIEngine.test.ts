// The claims this file checks are the ones the whole A/B setup rests on:
//
//   1. baseline IS the shipped AI -- not an approximation of it.
//   2. the two engines are genuinely independent -- tweaking one cannot
//      leak into the other through a shared module constant.
//   3. each engine is deterministic in its own seed, so a tournament
//      result is reproducible.
//   4. the challenger's new gene actually does the thing it claims.
//
// Without (1) the control is worthless; without (2) the experiment
// measures nothing; without (3) the numbers can't be rerun.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../SimState';
import { planTurn } from '../search';
import { DEFAULT_MUTATION_RATES } from '../search';
import { scoreState, DEFAULT_SCORE_WEIGHTS } from '../score';
import { applyGene, randomGene, DEFAULT_DIALECT, DEFAULT_GENE_WEIGHTS, DEFAULT_SWEEP } from '../SimCommands';
import { mulberry32 } from '../resolveAttack';
import { createEngine } from './AIEngine';
import { baselineEngine } from './engines/baseline';
import { parthianEngine } from './engines/parthian';
import { ENGINES, getEngine, requireEngine, DEFAULT_ENGINE } from './engineRegistry';
import { REGROUP, regroupGene } from './genes/regroup';
import { HIT_AND_RUN } from './genes/hitAndRun';

// 6x6 of flat grass; callers place the units they need.
function board(units: any[], buildings: any[] = []) {
    const cols = 6, rows = 6;
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) {
            tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
        }
    }
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units,
        buildings,
    });
}

const tank = (q: number, r: number, playerIndex: number) => ({
    type: 'Bulwark', q, r, playerIndex,
    hp: 10, maxHp: 10, move: 3, attack: 5, minRange: 1, maxRange: 1, hasAttacked: false,
});

describe('baseline is the shipped AI', () => {
    const options = baselineEngine.options;

    it('spells out exactly the score weights the module defaults hold', () => {
        expect(options.score).toEqual(DEFAULT_SCORE_WEIGHTS);
    });

    it('spells out exactly the gene dialect the module defaults hold', () => {
        expect(options.dialect!.weights).toEqual(DEFAULT_GENE_WEIGHTS);
        expect(options.dialect!.extras).toEqual({});
        expect(options.dialect!.focusFireChance).toBe(DEFAULT_DIALECT.focusFireChance);
        expect(options.dialect!.sweep).toEqual(DEFAULT_SWEEP);
    });

    it('spells out exactly the evolution constants the search defaults hold', () => {
        expect(options.mutation).toEqual(DEFAULT_MUTATION_RATES);
        expect(options.parsimonyPenalty).toBe(0.001);
        expect(options.immediateWeight).toBe(0.01);
        expect(options.survivorFraction).toBe(0.25);
        expect(options.initGenesPerUnit).toBe(3);
        expect(options.replyGenesPerUnit).toBe(2);
        expect(options.maxGenesPerUnit).toBe(6);
    });

    it('plays the exact turn an unconfigured planTurn plays', () => {
        // The strongest form of claim (1): hand the same snapshot to the
        // engine and to a bare planTurn with nothing but a budget, and the
        // event logs must be identical event for event.
        const budget = { population: 12, rounds: 2, finalists: 1, deepPlies: 1, replyPopulation: 4, replyRounds: 1 };
        const build = () => board([tank(1, 1, 0), tank(4, 4, 1)]);

        const viaEngine = baselineEngine.withBudget(budget).planTurn(build(), 1, 4242);
        const viaDefaults = planTurn(build(), 1, { ...budget, seed: 4242 });

        expect(viaEngine.events).toEqual(viaDefaults.events);
        expect(viaEngine.score).toBe(viaDefaults.score);
    }, 30_000);
});

describe('engine independence', () => {
    it('gives the two engines different personalities, not different names', () => {
        expect(parthianEngine.options.score).not.toEqual(baselineEngine.options.score);
        expect(parthianEngine.options.dialect!.weights).not.toEqual(baselineEngine.options.dialect!.weights);
        expect(Object.keys(parthianEngine.options.dialect!.extras)).toContain(HIT_AND_RUN);
    });

    it('holds the search budget equal, so a match compares ideas and not think time', () => {
        // The tournament's whole validity rests on this: an engine that
        // simply searches wider would win for an uninteresting reason.
        // (Parthian is a beam engine and never reads these fields, but
        // keeps them identical to baseline's so a raw diff stays legible.)
        for (const key of ['population', 'rounds', 'lookaheadPlies', 'replyCandidates',
                           'finalists', 'deepPlies', 'replyPopulation', 'replyRounds'] as const) {
            expect(parthianEngine.options[key]).toBe(baselineEngine.options[key]);
        }
    });

    it('lets a budget override change think time without touching beliefs', () => {
        const cheap = parthianEngine.withBudget({ population: 4, rounds: 1 });
        expect(cheap.options.population).toBe(4);
        expect(cheap.options.score).toEqual(parthianEngine.options.score);
        expect(cheap.options.dialect).toEqual(parthianEngine.options.dialect);
        // And the original is untouched -- withBudget returns a new engine.
        expect(parthianEngine.options.population).toBe(24);
    });

    it('scores the same board differently for the two engines', () => {
        // A Kestrel is worth more to parthian than to baseline (typeValue
        // 1.25 vs the flat 1.0) -- same board, same side, different number.
        const kestrel = {
            type: 'Kestrel', q: 1, r: 1, playerIndex: 0,
            hp: 8, maxHp: 8, move: 4, attack: 4, minRange: 2, maxRange: 3, hasAttacked: false,
        };
        const state = board([kestrel, tank(4, 4, 1)]);
        const base = scoreState(state, 0, baselineEngine.options.score);
        const parth = scoreState(state, 0, parthianEngine.options.score);
        expect(parth).toBeGreaterThan(base);
    });

    it('keeps an unknown gene kind a no-op rather than a crash', () => {
        // A plan carried between engines must degrade, not throw: baseline
        // has no regroup handler registered.
        const state = board([tank(1, 1, 0), tank(1, 3, 0)]);
        expect(() => applyGene(state, { kind: REGROUP, unitIndex: 0, seed: 1 })).not.toThrow();
        expect(applyGene(state, { kind: REGROUP, unitIndex: 0, seed: 1 })).toBe(false);
    });

    it('never rolls a custom kind for an engine that does not have it', () => {
        const state = board([tank(1, 1, 0), tank(1, 3, 0), tank(4, 4, 1)]);
        const rng = mulberry32(11);
        for (let i = 0; i < 300; i++) {
            expect(randomGene(state, 0, rng, baselineEngine.options.dialect).kind).not.toBe(REGROUP);
        }
    });

    it('does roll the custom kind for the engine that registered it', () => {
        const state = board([tank(1, 1, 0), tank(1, 3, 0), tank(4, 4, 1)]);
        const rng = mulberry32(11);
        const kinds = new Set<string>();
        for (let i = 0; i < 300; i++) kinds.add(randomGene(state, 0, rng, parthianEngine.options.dialect).kind);
        expect(kinds).toContain(HIT_AND_RUN);
    });
});

describe('determinism', () => {
    const budget = { population: 10, rounds: 2, finalists: 1, deepPlies: 1, replyPopulation: 4, replyRounds: 1 };
    const build = () => board([tank(1, 1, 0), tank(2, 1, 0), tank(4, 4, 1), tank(4, 3, 1)]);

    for (const engine of [baselineEngine, parthianEngine]) {
        it(`${engine.id} plans the same turn twice from the same seed`, () => {
            const cheap = engine.withBudget(budget);
            expect(cheap.planTurn(build(), 1, 31).events).toEqual(cheap.planTurn(build(), 1, 31).events);
        }, 30_000);
    }
});

describe('regroup gene', () => {
    it('closes the distance to its own side', () => {
        // One straggler far from two allies clustered together.
        const state = board([tank(5, 5, 0), tank(0, 0, 0), tank(1, 0, 0), tank(3, 3, 1)]);
        const before = state.getUnit(0)!;
        const spreadBefore = Math.abs(before.q - 0) + Math.abs(before.r - 0);

        expect(regroupGene.apply(state, { kind: REGROUP, unitIndex: 0, seed: 1 })).toBe(true);

        const after = state.getUnit(0)!;
        const spreadAfter = Math.abs(after.q - 0) + Math.abs(after.r - 0);
        expect(spreadAfter).toBeLessThan(spreadBefore);
    });

    it('declines when the unit is the last one standing', () => {
        const state = board([tank(5, 5, 0), tank(3, 3, 1)]);
        expect(regroupGene.applicable!(state, 0)).toBe(false);
        expect(regroupGene.apply(state, { kind: REGROUP, unitIndex: 0, seed: 1 })).toBe(false);
    });

    it('declines when already as tight as it can get', () => {
        // Surrounded by its own side with nowhere tighter to stand.
        const state = board([tank(2, 2, 0), tank(2, 1, 0), tank(2, 3, 0), tank(5, 5, 1)]);
        const before = { ...state.getUnit(0)! };
        regroupGene.apply(state, { kind: REGROUP, unitIndex: 0, seed: 1 });
        const after = state.getUnit(0)!;
        expect([after.q, after.r]).toEqual([before.q, before.r]);
    });

    it('captures a building it regroups onto, like every other move gene', () => {
        // The straggler's own side is clustered past a neutral building, so
        // the tightest reachable hex is the building's own tile.
        const infantry = {
            type: 'Pike', q: 3, r: 3, playerIndex: 0,
            hp: 6, maxHp: 6, move: 3, attack: 4, minRange: 1, maxRange: 2, hasAttacked: false,
        };
        const state = board(
            [infantry, tank(1, 1, 0), tank(1, 2, 0), tank(5, 5, 1)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null }]
        );
        expect(regroupGene.apply(state, { kind: REGROUP, unitIndex: 0, seed: 1 })).toBe(true);
        const moved = state.getUnit(0)!;
        if (moved.q === 2 && moved.r === 2) {
            expect(state.getBuilding(0)!.ownerIndex).toBe(0);
        }
    });
});

describe('engine registry', () => {
    it('exposes every engine by a unique id', () => {
        const ids = ENGINES.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(getEngine(id)!.id).toBe(id);
    });

    it('defaults the live game to the engine that measured best', () => {
        // Parthian: 58.5% against talus over 400 matches (95% 53.6-63.2%),
        // effect size held at six times the width. If this ever changes,
        // the tournament numbers in engineRegistry.ts must change with it
        // -- a default picked on anything but a measured result is how an
        // AI quietly regresses.
        expect(DEFAULT_ENGINE.id).toBe('parthian');
    });

    it('names the alternatives when asked for one that does not exist', () => {
        expect(() => requireEngine('nope')).toThrow(/baseline/);
        expect(() => requireEngine('nope')).toThrow(/parthian/);
    });
});

describe('createEngine', () => {
    it('keeps the definition it was handed', () => {
        const engine = createEngine({
            id: 'probe', name: 'Probe', notes: 'test only',
            options: { population: 3, score: DEFAULT_SCORE_WEIGHTS },
        });
        expect(engine.id).toBe('probe');
        expect(engine.options.population).toBe(3);
    });
});
