// Standing tuning probes, env-gated, never part of the suite.
//
// PROBE=1  runs press-family weight variants against the choke -- the
//          instrument that shaped vanguard's second draft.
// PROBE2=1 maps robustness: engines x eight seeds x two widths. This is
//          the run that recalibrated the choke itself: healthy engines
//          hold ~6 of 8 with the failures landing on different seeds, so
//          single-seed verdicts between them are dice -- and MORE width
//          made both engines hold LESS, a horizon effect worth its own
//          investigation someday. Class failures (baseline, quickdraw)
//          are total at every seed, which is what the suite's rate-gate
//          in waterChoke.test.ts is calibrated against.

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { scenario } from './scenario';
import { CHOKE_PICTURE, RETREAT_PICTURE, CHOKE_LEGEND } from '../../maps/ChokeMapProvider';
import { runHeadlessMatch } from '../headless';
import { createEngine } from '../ai/AIEngine';
import { beamPlanGen } from '../ai/planners/beam';
import { parthianEngine } from '../ai/engines/parthian';
import { vanguardEngine } from '../ai/engines/vanguard';
import { HIT_AND_RUN, hitAndRunGene } from '../ai/genes/hitAndRun';
import { SHOOT_ADVANCE, shootAdvanceGene } from '../ai/genes/shootAdvance';
import { SHOOT_BLOCK, shootBlockGene } from '../ai/genes/shootBlock';
import { STORM_CAPTURE, stormCaptureGene } from '../ai/genes/stormCapture';

declare const process: { env: Record<string, string | undefined> };

const CHOKE = scenario('water-choke-probe', CHOKE_PICTURE, CHOKE_LEGEND);

const PLAN = { beamChildCounts: [48, 24, 12], beamDepth: 3 };

const FULL_EXTRAS = {
    [HIT_AND_RUN]: hitAndRunGene,
    [SHOOT_ADVANCE]: shootAdvanceGene,
    [SHOOT_BLOCK]: shootBlockGene,
    [STORM_CAPTURE]: stormCaptureGene,
};

// Each variant is parthian with a different press-family weight table.
const VARIANTS: Record<string, { weights: ReadonlyArray<readonly [string, number]>; extras: any }> = {
    // B: hitAndRun restored to 0.10; the family funded from moveTowards
    // instead, offsetting the reroll inflation narrow genes cause on
    // buildingless boards.
    'fund-from-movetowards': {
        weights: [
            ['attack', 0.30], ['moveTowards', 0.16], ['standoff', 0.10], ['moveAway', 0.10],
            ['moveToBuilding', 0.10], [HIT_AND_RUN, 0.10], [SHOOT_ADVANCE, 0.04],
            [SHOOT_BLOCK, 0.03], [STORM_CAPTURE, 0.03], ['moveRandom', 0.02], ['idle', 0.02],
        ],
        extras: FULL_EXTRAS,
    },
    // D: drop shootAdvance entirely -- the defensive/assault genes only.
    'no-shootadvance': {
        weights: [
            ['attack', 0.30], ['moveTowards', 0.20], ['standoff', 0.10], ['moveAway', 0.10],
            ['moveToBuilding', 0.10], [HIT_AND_RUN, 0.10], [SHOOT_BLOCK, 0.03],
            [STORM_CAPTURE, 0.03], ['moveRandom', 0.02], ['idle', 0.02],
        ],
        extras: { [HIT_AND_RUN]: hitAndRunGene, [SHOOT_BLOCK]: shootBlockGene, [STORM_CAPTURE]: stormCaptureGene },
    },
    // E: vanguard's exact current weights -- the failing control.
    'vanguard-as-is': {
        weights: [
            ['attack', 0.30], ['moveTowards', 0.20], ['standoff', 0.10], ['moveAway', 0.10],
            ['moveToBuilding', 0.10], [HIT_AND_RUN, 0.06], [SHOOT_ADVANCE, 0.04],
            [SHOOT_BLOCK, 0.03], [STORM_CAPTURE, 0.03], ['moveRandom', 0.02], ['idle', 0.02],
        ],
        extras: FULL_EXTRAS,
    },
};

describe.skipIf(!process.env.PROBE2)('robustness: engines x seeds x widths', () => {
    it('maps the boundary', () => {
        for (const [planName, plan] of [['w48', PLAN], ['w96', { beamChildCounts: [96, 48, 24], beamDepth: 3 }]] as Array<[string, any]>) {
            for (const engine of [parthianEngine, vanguardEngine]) {
                let held = 0;
                const fails: number[] = [];
                for (let seed = 1; seed <= 8; seed++) {
                    const result = runHeadlessMatch(CHOKE, { seed, maxTurns: 80, engines: [engine, engine], plan });
                    if (result.winner === 0 && result.survivors[0].includes('Pyramid')) held++;
                    else fails.push(seed);
                }
                console.log(`robust ${planName} ${engine.id.padEnd(10)} ${held}/8 håller${fails.length ? ` | föll: ${fails.join(',')}` : ''}`);
            }
        }
    }, 900_000);
});

describe.skipIf(!process.env.PROBE6)('bastion against the boards', () => {
    it('measures the blockade engine where parthian failed', async () => {
        const { bastionEngine } = await import('../ai/engines/bastion');
        const { TWIN_PICTURE } = await import('../../maps/ChokeMapProvider');
        const RETREAT = scenario('bastion-retreat', RETREAT_PICTURE, CHOKE_LEGEND);
        const TWIN = scenario('bastion-twin', TWIN_PICTURE, CHOKE_LEGEND);
        for (const [name, board] of [['twin', TWIN], ['retreat', RETREAT], ['choke', CHOKE]] as const) {
            for (const engine of [bastionEngine, parthianEngine]) {
                let held = 0;
                const fails: number[] = [];
                for (let seed = 1; seed <= 6; seed++) {
                    const result = runHeadlessMatch(board as any, {
                        seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
                    });
                    if (result.winner === 0 && result.survivors[0].includes('Pyramid')) held++;
                    else fails.push(seed);
                }
                console.log(`bastion-probe ${name.padEnd(8)} ${engine.id.padEnd(9)} ${held}/6${fails.length ? ` | föll: ${fails.join(',')}` : ''}`);
            }
        }
    }, 900_000);
});

describe.skipIf(!process.env.PROBE5)('dissect the Boll turn-3 decision', () => {
    it('compares the chosen plan against the hand-built kill line', async () => {
        const { stateFromProvider } = await import('../headless');
        const { startTurn, applyGene, sweepAttacks, DEFAULT_DIALECT } = await import('../SimCommands');
        const { scoreState } = await import('../score');
        const { mulberry32, combineSeed } = await import('../resolveAttack');
        const seed = 1;
        const RETREAT = scenario('choke-retreat-dissect', RETREAT_PICTURE, CHOKE_LEGEND);

        // Replay turns 0-2 exactly as the narrated match played them.
        let state = stateFromProvider(RETREAT as any);
        for (let turn = 0; turn < 3; turn++) {
            const side = turn % 2;
            startTurn(state, side, mulberry32(combineSeed(seed, turn)));
            const snap = state.condense();
            const { events } = parthianEngine.planTurn(snap, side, combineSeed(seed, turn));
            state = snap;
            for (const event of events) state.record(event);
        }

        // Turn 3, the Boll to move. Same reset + condense the loop does.
        startTurn(state, 1, mulberry32(combineSeed(seed, 3)));
        const snap = state.condense();
        const weights = parthianEngine.options.score!;
        const units = [...snap.liveUnits()].map(([i, u]) => `${i}:${u.type}(${u.q},${u.r})hp${u.hp}`);
        console.log(`t3 snapshot: ${units.join(' ')}`);

        // What the engine actually picks.
        const planned = parthianEngine.planTurn(snap, 1, combineSeed(seed, 3));
        const played = snap.fork();
        for (const event of planned.events) played.record(event);
        console.log(`vald plan: [${planned.events.map((e) => e.type).join(', ')}] beamscore ${planned.score.toFixed(1)} | omedelbar ${scoreState(played, 1, weights).toFixed(1)}`);

        // The hand-built kill line: walk at the Pyramid, let the sweep fire.
        const kill = snap.fork();
        applyGene(kill, { kind: 'moveTowards', unitIndex: 2, targetIndex: 1, seed: 1 }, parthianEngine.options.dialect!.extras);
        sweepAttacks(kill, 1, DEFAULT_DIALECT.sweep!);
        const boll = kill.getUnit(2);
        console.log(`kill-linjen: [${kill.events.map((e) => e.type).join(', ')}] Boll->(${boll?.q},${boll?.r}) omedelbar ${scoreState(kill, 1, weights).toFixed(1)}`);

        // The brawl line, for reference.
        const brawl = snap.fork();
        applyGene(brawl, { kind: 'attack', unitIndex: 2, targetIndex: 0, seed: 1 }, parthianEngine.options.dialect!.extras);
        sweepAttacks(brawl, 1, DEFAULT_DIALECT.sweep!);
        console.log(`brawl-linjen: [${brawl.events.map((e) => e.type).join(', ')}] omedelbar ${scoreState(brawl, 1, weights).toFixed(1)}`);
    }, 300_000);
});

describe.skipIf(!process.env.PROBE4)('retreat scenario: what actually happens, turn by turn', () => {
    it('narrates one match', async () => {
        const { stateFromProvider } = await import('../headless');
        const { startTurn } = await import('../SimCommands');
        const { mulberry32, combineSeed } = await import('../resolveAttack');
        const seed = Number(process.env.SEED ?? 1);
        const RETREAT = scenario('choke-retreat-narrate', RETREAT_PICTURE, CHOKE_LEGEND);
        // LIVE Low budget, so the narration answers for the game Roger is
        // actually watching, not for a thinner probe search.
        const engine = process.env.HARD
            ? parthianEngine.withBudget({ beamChildCounts: [2600, 1900, 1200, 800, 520], beamDepth: 5 })
            : process.env.LIVEBUDGET
                ? parthianEngine.withBudget({ beamChildCounts: [160, 120, 60, 40, 32], beamDepth: 3 })
                : parthianEngine;

        let state = stateFromProvider(RETREAT as any);
        const positions = () => [...state.liveUnits()]
            .map(([, u]) => `${u.type}(${u.q},${u.r})hp${u.hp}`).join(' ');
        console.log(`start: ${positions()}`);

        for (let turn = 0; turn < 20; turn++) {
            const side = turn % 2;
            const alive: [boolean, boolean] = [false, false];
            for (const [, u] of state.liveUnits()) alive[u.playerIndex] = true;
            if (!alive[0] || !alive[1]) break;
            startTurn(state, side, mulberry32(combineSeed(seed, turn)));
            const snap = state.condense();
            const { events } = engine.planTurn(snap, side, combineSeed(seed, turn));
            state = snap;
            const notes: string[] = [];
            for (const event of events) {
                if (event.type === 'unitMoved') {
                    const u = state.getUnit(event.unitIndex)!;
                    notes.push(`${u.type}->( ${event.toQ},${event.toR})`);
                }
                if (event.type === 'unitAttacked') {
                    const a = state.getUnit(event.attackerIndex)!;
                    const d = state.getUnit(event.defenderIndex)!;
                    notes.push(`${a.type} slår ${d.type} -${event.damage}`);
                }
                if (event.type === 'unitDied') {
                    notes.push(`DÖD: index ${event.unitIndex}`);
                }
                state.record(event);
            }
            console.log(`t${turn} sida${side}: ${notes.join(' | ') || 'inget'}  => ${positions()}`);
        }
    }, 300_000);
});

describe.skipIf(!process.env.PROBE3)('retreat scenario: is the failure the horizon?', () => {
    it('maps hold rate against beam depth', () => {
        const RETREAT = scenario('choke-retreat-depth', RETREAT_PICTURE, CHOKE_LEGEND);
        for (const depth of [3, 4, 5]) {
            const plan = { beamChildCounts: [48, 24, 12, 8, 6], beamDepth: depth };
            let held = 0;
            const fails: number[] = [];
            for (let seed = 1; seed <= 6; seed++) {
                const result = runHeadlessMatch(RETREAT, {
                    seed, maxTurns: 80, engines: [parthianEngine, parthianEngine], plan,
                });
                if (result.winner === 0 && result.survivors[0].includes('Pyramid')) held++;
                else fails.push(seed);
            }
            console.log(`retreat depth ${depth}: ${held}/6 håller${fails.length ? ` | föll: ${fails.join(',')}` : ''}`);
        }
    }, 900_000);
});

describe.skipIf(!process.env.PROBE)('vanguard weight probe against the choke', () => {
    it('prints each variant against the choke', () => {
        const probes: Array<[string, any]> = Object.entries(VARIANTS).map(([name, variant]) => [
            name,
            createEngine({
                id: `probe-${name}`,
                name,
                notes: 'probe',
                planner: beamPlanGen,
                options: {
                    ...parthianEngine.options,
                    dialect: {
                        ...parthianEngine.options.dialect!,
                        weights: variant.weights as any,
                        extras: variant.extras,
                    },
                },
            }),
        ]);
        probes.push(['vanguard-v2-idle-fallback', vanguardEngine]);

        for (const [name, engine] of probes) {
            for (const seed of [1, 2, 3]) {
                const result = runHeadlessMatch(CHOKE, {
                    seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
                });
                const pyramid = result.survivors[0].includes('Pyramid') ? 'Pyramid lever' : 'Pyramid DOG';
                console.log(`probe ${name.padEnd(26)} seed ${seed} | vinnare ${result.winner} | ${pyramid} | ${result.reason} | ${result.turns}t`);
            }
        }
    }, 600_000);
});
