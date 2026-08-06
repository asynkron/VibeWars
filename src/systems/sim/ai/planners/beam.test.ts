// The beam planner exists to answer one question -- can the SEARCH find
// good and bad matchups without the evaluation being told about them --
// so the tests are about behaviour on positions with a known right answer,
// not about internals.
//
// Two of them are regressions for bugs that were in the first draft and
// that both produced the same symptom, a helicopter flying into the guns
// that one-shot it. Both are the kind that make a search quietly stop
// being a search while still returning plausible plans, so they are worth
// pinning explicitly.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import { HexCoord } from '../../../../shared/hexengine/HexCoord';
import { UnitSystem } from '../../../../shared/hexengine/UnitSystem';
import { scoreState } from '../../score';
import { sweepAttacks, DEFAULT_DIALECT } from '../../SimCommands';
import { drivePlanner } from '../../search';
import { beamPlanGen, DEFAULT_BEAM } from './beam';
import { gambitEngine } from '../engines/gambit';
import { baselineEngine } from '../engines/baseline';
import { feintEngine } from '../engines/feint';
import { mirageEngine } from '../engines/mirage';
import { talusEngine } from '../engines/talus';
import { quickdrawEngine } from '../engines/quickdraw';

const mk = (type: string, q: number, r: number, playerIndex: number) => {
    const s = UnitSystem.unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange, hasAttacked: false };
};

function board(units: any[], cols = 16, rows = 16) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({ map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] }, units, buildings: [] });
}

// Cheap beam: enough depth for the point, small enough for a test run.
const FAST = { depth: 5, childCounts: [24, 10, 8, 5, 4], keepBest: 3, keepWorst: 2, keepOpponent: 1, genesPerUnit: 3 };

// Play the plan and report where the unit ended up relative to the enemy.
function distanceAfterPlanning(attacker: string, gap: number, seed: number, beam = FAST) {
    const state = board([mk(attacker, 5, 2, 0), mk('Halberd', 5, 2 + gap, 1)]);
    const plan = drivePlanner(beamPlanGen(state, 0, { seed, beam, score: gambitEngine.options.score }));
    const after = state.fork();
    for (const event of plan.events) after.record(event);
    const unit = after.getUnit(0)!;
    return { dist: HexCoord.getDistance(unit.q, unit.r, 5, 2 + gap), plan };
}

// A Halberd covers move 2 + range 2 = 4 hexes. That number is the whole
// geometry of both tests below.
const AA_REACH = 4;

describe('beam planner finds matchups the evaluation never mentions', () => {
    it('sends a tank at the AA it one-shots', () => {
        // Bulwark deals 10 into 8 hp; the Halberd deals 2 back into 10. A
        // free kill, but two turns away at move 2 -- which is exactly the
        // payoff the shallow hillclimb cannot see, so it parks at the edge
        // of the AA's reach instead.
        for (const seed of [1, 2, 3]) {
            expect(distanceAfterPlanning('Bulwark', 5, seed).dist).toBeLessThan(5);
        }
    }, 60_000);

    it('keeps a helicopter out of that same AA', () => {
        // Reversed: the Halberd one-shots the Nightjar and takes 2 back.
        // The plan must not end with the helicopter inside reach.
        //
        // REGRESSION, twice over. The first draft picked the best node at
        // ANY depth, so a depth-0 dive that shot for 2 outscored every
        // deeper line and the death one ply later never counted. The second
        // pooled all of a level's children into one ranking and cut
        // globally; with keepOpponent 1 that left a single survivor for the
        // whole level, and since the opponent's cut takes OUR worst, the
        // survivor was always our worst opening -- which the search then
        // returned as its answer.
        for (const seed of [1, 2, 3]) {
            expect(distanceAfterPlanning('Nightjar', 5, seed).dist).toBeGreaterThan(AA_REACH);
        }
    }, 60_000);

    it('does better than standing still when there is something to gain', () => {
        const state = board([mk('Bulwark', 5, 2, 0), mk('Halberd', 5, 4, 1)]);
        const idle = state.fork();
        sweepAttacks(idle, 0, DEFAULT_DIALECT.sweep!);
        const idleScore = scoreState(idle, 0, gambitEngine.options.score);

        const plan = drivePlanner(beamPlanGen(state, 0, { seed: 4, beam: FAST, score: gambitEngine.options.score }));
        const played = state.fork();
        for (const event of plan.events) played.record(event);
        expect(scoreState(played, 0, gambitEngine.options.score)).toBeGreaterThan(idleScore);
    }, 60_000);
});

describe('an even depth ends on the reply, and the reply counts', () => {
    // beamDepth 2 is "my turn, then their answer". Before the final-level
    // readout the answer was computed and discarded, so depth 2 played
    // exactly like depth 1 -- pure greedy -- at three times the cost.
    //
    // The position: a Lynx at 2 hp stands next to a full Bulwark. Greedy
    // takes the shot (+3 expected damage now) and stands there; the
    // Bulwark's reply kills the Lynx (expected 5 into 2 hp). The only line
    // that survives the reply is fleeing beyond the Bulwark's reach of
    // move 2 + range 1 -- which costs points NOW, lives in the sacrifice
    // slots at depth 0, and only an after-reply readout can prefer.
    const READOUT = { depth: 2, childCounts: [40, 20], keepBest: 4, keepWorst: 2, keepOpponent: 1, genesPerUnit: 3 };
    const BULWARK_REACH = 3; // move 2 + range 1

    const position = () => board([{ ...mk('Lynx', 4, 4, 0), hp: 2 }, mk('Bulwark', 5, 4, 1)]);

    const lynxDistanceAfter = (beam: any, seed: number) => {
        const state = position();
        const plan = drivePlanner(beamPlanGen(state, 0, { seed, beam }));
        const after = state.fork();
        for (const event of plan.events) after.record(event);
        const lynx = after.getUnit(0)!;
        return HexCoord.getDistance(lynx.q, lynx.r, 5, 4);
    };

    it('depth 1 stays greedy: shoot and stand in the kill zone', () => {
        for (const seed of [1, 2, 3]) {
            expect(lynxDistanceAfter({ ...READOUT, depth: 1 }, seed), `seed ${seed}`)
                .toBeLessThanOrEqual(BULWARK_REACH);
        }
    }, 60_000);

    it('depth 2 reads the reply and walks the Lynx out of it', () => {
        for (const seed of [1, 2, 3]) {
            expect(lynxDistanceAfter(READOUT, seed), `seed ${seed}`)
                .toBeGreaterThan(BULWARK_REACH);
        }
    }, 60_000);
});

describe('beam planner mechanics', () => {
    it('is deterministic in its seed', () => {
        const build = () => board([mk('Bulwark', 5, 2, 0), mk('Nightjar', 3, 3, 0), mk('Halberd', 5, 7, 1)]);
        const run = () => drivePlanner(beamPlanGen(build(), 0, { seed: 12, beam: FAST })).events;
        expect(run()).toEqual(run());
    }, 60_000);

    it('returns an empty plan for a side with no units', () => {
        const state = board([mk('Halberd', 5, 7, 1)]);
        const plan = drivePlanner(beamPlanGen(state, 0, { seed: 1, beam: FAST }));
        expect(plan.events).toEqual([]);
    });

    it('only ever returns ONE turn of events, however deep it looked', () => {
        // Everything past depth 0 is evaluation. Returning a deeper turn's
        // events would hand the live game moves for units that have not had
        // their turn yet.
        const state = board([mk('Bulwark', 5, 2, 0), mk('Halberd', 5, 5, 1)]);
        const plan = drivePlanner(beamPlanGen(state, 0, { seed: 3, beam: FAST }));
        const movedUnits = plan.events.filter((e: any) => e.type === 'unitMoved').map((e: any) => e.unitIndex);
        // Only our own unit, and no unit moves more than its budget allows.
        for (const index of movedUnits) expect(state.getUnit(index)!.playerIndex).toBe(0);
        const spent = plan.events
            .filter((e: any) => e.type === 'unitMoved' && e.unitIndex === 0)
            .reduce((total: number, e: any) => total + e.moveSpent, 0);
        expect(spent).toBeLessThanOrEqual(UnitSystem.unitTypesRecord.Bulwark.move);
    }, 60_000);

    it('runs greedily when the sacrifice slots are switched off', () => {
        // keepWorst 0 must be a legal configuration -- it is the control
        // for "was sacrifice retention the part that mattered".
        const state = board([mk('Bulwark', 5, 2, 0), mk('Halberd', 5, 5, 1)]);
        const greedy = { ...FAST, keepWorst: 0 };
        expect(() => drivePlanner(beamPlanGen(state, 0, { seed: 1, beam: greedy }))).not.toThrow();
    }, 60_000);

    it('ships a default beam config so the planner works unconfigured', () => {
        expect(DEFAULT_BEAM.depth).toBeGreaterThan(1);
        expect(DEFAULT_BEAM.keepWorst).toBeGreaterThan(0);
        expect(DEFAULT_BEAM.keepOpponent).toBeGreaterThan(0);
    });
});

describe('feint is an ablation of gambit, not a second variant', () => {
    it('differs from gambit in exactly one value: beam.depth', () => {
        // The experiment only means something if everything else is
        // identical. A drifted weight would turn "depth 3 vs depth 5" into
        // "two different engines", and the result would answer nothing.
        const { beam: feintBeam, ...feintRest } = feintEngine.options as any;
        const { beam: gambitBeam, ...gambitRest } = gambitEngine.options as any;
        expect(feintRest).toEqual(gambitRest);

        const { depth: feintDepth, ...feintBeamRest } = feintBeam;
        const { depth: gambitDepth, ...gambitBeamRest } = gambitBeam;
        expect(feintBeamRest).toEqual(gambitBeamRest);
        expect(feintDepth).toBeLessThan(gambitDepth);
    });

    it('keeps its shallower depth when a live budget is applied', () => {
        // REGRESSION: LIVE_BUDGET used to carry a whole beam object, which
        // replaced the engine's own -- depth included. Selecting Feint for
        // a live game would silently have played Gambit. Budgets set width
        // now, never depth.
        const live = feintEngine.withBudget({ beamChildCounts: [160, 120, 60, 40, 32] } as any);
        expect(live.options.beam.depth).toBe(feintEngine.options.beam.depth);
    });

    it('actually searches shallower, measured in work done', () => {
        // Not just a different number in a config: fewer levels means the
        // planner really does less. Compared by wall-clock on one position,
        // which is coarse but cannot be satisfied by a mislabelled field.
        //
        // MEASURED AS THE BEST OF THREE, INTERLEAVED, because a single pair
        // of samples measures the machine as much as the planner. It failed
        // once at 3563 against 1488 -- feint three times slower than
        // gambit, which is not a thing that can happen -- while an AI match
        // was running in a browser on the same box eating every core. A
        // minimum is the right statistic here: load can only ever make a
        // run slower, so the fastest of several is the closest look at the
        // work itself. Interleaved so a drift partway through hits both.
        //
        // Still not a true work counter. The honest one would count node
        // evaluations, and nothing reports them today -- TurnPlanResult
        // carries events, score and genes, and the progress ticks yield
        // once per depth level, which is the very thing already asserted
        // above.
        const state = board([mk('Bulwark', 5, 2, 0), mk('Nightjar', 3, 3, 0), mk('Halberd', 5, 7, 1)]);
        const once = (engine: any) => {
            const started = Date.now();
            engine.planTurn(state, 0, 5);
            return Date.now() - started;
        };

        let feint = Infinity;
        let gambit = Infinity;
        for (let run = 0; run < 3; run++) {
            feint = Math.min(feint, once(feintEngine));
            gambit = Math.min(gambit, once(gambitEngine));
        }
        expect(feint, `feint ${feint}ms vs gambit ${gambit}ms`).toBeLessThan(gambit);
    }, 120_000);
});

describe('mirage and talus are ablations of feint', () => {
    // Same contract the feint-vs-gambit test pins: one changed value, or
    // the tournament result cannot say what caused it.
    const beamAblation = (variant: any, flag: string) => {
        const { beam: variantBeam, ...variantRest } = variant.options as any;
        const { beam: feintBeam, ...feintRest } = feintEngine.options as any;
        expect(variantRest).toEqual(feintRest);
        const { [flag]: changed, ...variantBeamRest } = variantBeam;
        expect(variantBeamRest).toEqual(feintBeam);
        expect(changed).toBe(true);
    };

    it('mirage changes exactly beam.dedupeChildren', () => {
        beamAblation(mirageEngine, 'dedupeChildren');
    });

    it('talus changes exactly beam.spreadWorst', () => {
        beamAblation(talusEngine, 'spreadWorst');
    });

    it('talus plans deterministically through the serial planner', () => {
        const build = () => board([mk('Bulwark', 5, 2, 0), mk('Nightjar', 3, 3, 0), mk('Halberd', 5, 7, 1)]);
        const run = () => talusEngine.planTurn(build(), 0, 9).events;
        expect(run()).toEqual(run());
    }, 60_000);
});

describe('quickdraw has no sweep and shoots anyway', () => {
    it('names its change: sweep null, hit-and-run frequent', () => {
        expect(quickdrawEngine.options.dialect!.sweep).toBeNull();
        const weights = new Map(quickdrawEngine.options.dialect!.weights);
        expect(weights.get('hitAndRun')).toBeGreaterThanOrEqual(0.2);
        // The search itself is untouched Talus: same beam, same everything
        // outside the dialect.
        expect(quickdrawEngine.options.beam).toEqual(talusEngine.options.beam);
    });

    it('still deals damage through explicit genes alone', () => {
        // A free kill standing adjacent: a one-hit enemy, no return worth
        // fearing. If the genome could not shoot, this engine would be a
        // pacifist and leave it alive -- which is the wiring mistake this
        // test exists to catch. (A FAIR trade it may legitimately refuse;
        // the first draft offered one and quickdraw correctly walked away.)
        const spot = HexCoord.getNeighbors(5, 5)[0];
        const state = board([mk('Lynx', 5, 5, 0), { ...mk('Bulwark', spot.q, spot.r, 1), hp: 1 }]);
        const plan = quickdrawEngine.planTurn(state, 0, 3);
        expect(plan.events.some((e: any) => e.type === 'unitAttacked')).toBe(true);
        expect(plan.events.some((e: any) => e.type === 'unitDied')).toBe(true);
    }, 60_000);
});

describe('gambit engine', () => {
    it('uses the beam rather than the hillclimb', () => {
        expect(gambitEngine.options.beam).toBeDefined();
        expect(gambitEngine.options.beam.keepWorst).toBeGreaterThan(0);
    });

    it('keeps its beam when a budget is applied', () => {
        // withBudget must not be able to turn one engine into another. The
        // tournament budget carries no beam, so Gambit's own must survive.
        const cheap = gambitEngine.withBudget({ population: 4, rounds: 1 });
        expect(cheap.options.beam).toEqual(gambitEngine.options.beam);
    });

    it('values unit types differently, which baseline does not', () => {
        expect(baselineEngine.options.score!.typeValue).toBeUndefined();
        const table = gambitEngine.options.score!.typeValue!;
        expect(table.Nightjar).toBeGreaterThan(table.Bulwark);
        // Every type on the shipped roster has an entry -- a missing one is
        // silently valued at 1.0, which is a bug that never announces itself.
        for (const type of Object.keys(UnitSystem.unitTypesRecord)) {
            if (type === 'Road') continue; // not a combat unit on any map
            expect(table[type], `typeValue missing for ${type}`).toBeGreaterThan(0);
        }
    });
});
