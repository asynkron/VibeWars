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
import { CHOKE_PICTURE, CHOKE_LEGEND } from '../../maps/ChokeMapProvider';
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
