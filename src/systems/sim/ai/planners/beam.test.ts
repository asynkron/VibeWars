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
import { parthianEngine } from '../engines/parthian';
import { baselineEngine } from '../engines/baseline';

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
    const plan = drivePlanner(beamPlanGen(state, 0, { seed, beam, score: parthianEngine.options.score }));
    const after = state.fork();
    for (const event of plan.events) after.record(event);
    const unit = after.getUnit(0)!;
    return { dist: HexCoord.getDistance(unit.q, unit.r, 5, 2 + gap), plan };
}

// A Halberd covers move 3 + range 2 = 5 hexes (move went 2 -> 3 when AA
// was buffed to actually contest helicopters). That number is the whole
// geometry of both tests below: the attacker starts one hex OUTSIDE it.
const AA_REACH = 5;
const START_GAP = AA_REACH + 1;

describe('beam planner finds matchups the evaluation never mentions', () => {
    it('sends a tank at the AA it one-shots', () => {
        // Bulwark deals 10 into 8 hp; the Halberd deals 2 back into 10. A
        // free kill, but starting outside the AA's reach the closing costs
        // chip damage now for a payoff turns away -- which is exactly what
        // the shallow hillclimb cannot see, so it parks at the edge of the
        // reach instead. The beam must close the distance.
        for (const seed of [1, 2, 3]) {
            expect(distanceAfterPlanning('Bulwark', START_GAP, seed).dist).toBeLessThan(START_GAP);
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
            expect(distanceAfterPlanning('Nightjar', START_GAP, seed).dist).toBeGreaterThan(AA_REACH);
        }
    }, 60_000);

    it('does better than standing still when there is something to gain', () => {
        const state = board([mk('Bulwark', 5, 2, 0), mk('Halberd', 5, 4, 1)]);
        const idle = state.fork();
        sweepAttacks(idle, 0, DEFAULT_DIALECT.sweep!);
        const idleScore = scoreState(idle, 0, parthianEngine.options.score);

        const plan = drivePlanner(beamPlanGen(state, 0, { seed: 4, beam: FAST, score: parthianEngine.options.score }));
        const played = state.fork();
        for (const event of plan.events) played.record(event);
        expect(scoreState(played, 0, parthianEngine.options.score)).toBeGreaterThan(idleScore);
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

// The ablation chain that produced parthian's beam settings --
// gambit (the beam itself) -> feint (shallower) -> mirage/talus (selection
// tweaks) -- answered its questions and was retired; see engineRegistry.ts
// and ai/README.md for the measured table. Its winning values are inlined
// in parthian.ts directly, so there is no longer a second engine to diff
// against for depth, dedupeChildren or spreadWorst.

// quickdraw (Parthian with the attack sweep removed) measured its
// hypothesis and lost cleanly at both widths -- the sweepless attempt
// walked into range and dealt nothing often enough to cost ~11 points of
// share -- so the sweep stays in Parthian and quickdraw is retired. See
// ai/README.md for the numbers.

describe('parthian engine', () => {
    it('uses the beam rather than the hillclimb', () => {
        expect(parthianEngine.options.beam).toBeDefined();
        expect(parthianEngine.options.beam.keepWorst).toBeGreaterThan(0);
    });

    it('keeps its beam when a budget is applied', () => {
        // withBudget must not be able to turn one engine into another. The
        // tournament budget carries no beam, so parthian's own must survive.
        const cheap = parthianEngine.withBudget({ population: 4, rounds: 1 });
        expect(cheap.options.beam).toEqual(parthianEngine.options.beam);
    });

    it('values unit types differently, which baseline does not', () => {
        expect(baselineEngine.options.score!.typeValue).toBeUndefined();
        const table = parthianEngine.options.score!.typeValue!;
        expect(table.Nightjar).toBeGreaterThan(table.Bulwark);
        // Every type on the shipped roster has an entry -- a missing one is
        // silently valued at 1.0, which is a bug that never announces itself.
        for (const type of Object.keys(UnitSystem.unitTypesRecord)) {
            if (type === 'Road') continue; // not a combat unit on any map
            expect(table[type], `typeValue missing for ${type}`).toBeGreaterThan(0);
        }
    });
});
