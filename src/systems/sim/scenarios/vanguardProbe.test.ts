// Standing tuning probes, env-gated, never part of the suite.
//
// PROBE2=1 maps robustness: engine x eight seeds x two widths. This is the
//          run that recalibrated the choke itself: a healthy engine holds
//          ~6 of 8 with the failures landing on different seeds, so
//          single-seed verdicts are dice -- and MORE width made it hold
//          LESS, a horizon effect worth its own investigation someday.
//
// The press-family weight probe (PROBE=1) and the bastion-vs-parthian
// probe (PROBE6=1) that used to live here measured their questions and
// are gone: the press family is now inlined in parthian.ts at its
// settled weights -- see its header -- so there is no longer a second
// engine to A/B against. (Bastion's blockade gene was tried in the same
// merge and removed again; waterChoke.test.ts tells that story.)

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { scenario } from './scenario';
import { CHOKE_PICTURE, RETREAT_PICTURE, CHOKE_LEGEND } from '../../maps/ChokeMapProvider';
import { runHeadlessMatch } from '../headless';
import { parthianEngine } from '../ai/engines/parthian';

declare const process: { env: Record<string, string | undefined> };

const CHOKE = scenario('water-choke-probe', CHOKE_PICTURE, CHOKE_LEGEND);

const PLAN = { beamChildCounts: [48, 24, 12], beamDepth: 3 };

describe.skipIf(!process.env.PROBE2)('robustness: engine x seeds x widths', () => {
    it('maps the boundary', () => {
        for (const [planName, plan] of [['w48', PLAN], ['w96', { beamChildCounts: [96, 48, 24], beamDepth: 3 }]] as Array<[string, any]>) {
            let held = 0;
            const fails: number[] = [];
            for (let seed = 1; seed <= 8; seed++) {
                const result = runHeadlessMatch(CHOKE, { seed, maxTurns: 80, engines: [parthianEngine, parthianEngine], plan });
                if (result.winner === 0 && result.survivors[0].includes('Pyramid')) held++;
                else fails.push(seed);
            }
            console.log(`robust ${planName} ${held}/8 håller${fails.length ? ` | föll: ${fails.join(',')}` : ''}`);
        }
    }, 900_000);
});


describe.skipIf(!process.env.PROBE7)('open-board dissection: why no two-round hunt', () => {
    it('census of level 0 plus the hand-built march line', async () => {
        const { stateFromProvider } = await import('../headless');
        const { startTurn, applyGene, sweepAttacks, DEFAULT_DIALECT } = await import('../SimCommands');
        const { scoreState } = await import('../score');
        const { mulberry32, combineSeed } = await import('../resolveAttack');
        const { runSimJob } = await import('../ai/simJob');
        const HexCoord = await import('../../../shared/hexengine/hexMath');

        // Open grass, no water, nothing blocking: Pyramid in the north,
        // Boll eight hexes south of it (two rounds at move 4), Klosses far
        // east where they block nothing -- Rogers screenshot, distilled.
        const OPEN = scenario('open-hunt', [
            '............',
            '...A........',
            '............',
            '............',
            '............',
            '.........K..',
            '............',
            '............',
            '..........K.',
            '...B........',
            '............',
        ], {
            K: { type: 'Kloss', player: 0 },
            A: { type: 'Pyramid', player: 0 },
            B: { type: 'Boll', player: 1 },
        });

        const seed = 1;
        let state = stateFromProvider(OPEN as any);
        startTurn(state, 1, mulberry32(combineSeed(seed, 0)));
        const snap = state.condense();
        const units = [...snap.liveUnits()].map(([i, u]) => `${i}:${u.type}(${u.q},${u.r})`);
        console.log(`board: ${units.join(' ')}`);
        const boll = [...snap.liveUnits()].find(([, u]) => u.type === 'Boll')![0];
        const pyr = [...snap.liveUnits()].find(([, u]) => u.type === 'Pyramid')![1];
        const weights = parthianEngine.options.score!;
        const dialect = parthianEngine.options.dialect!;

        // 1. The whole level-0 child population at live Low width, no keep.
        const jobSeed = combineSeed(combineSeed(seed, 0), 0, 0);
        const children = runSimJob(snap, {
            parentEvents: [], side: 1, scoreFor: 1, resetTurn: false,
            count: 160, seed: jobSeed, genesPerUnit: 3,
        }, { dialect, score: weights });

        const startDist = HexCoord.getDistance(
            [...snap.liveUnits()].find(([, u]) => u.type === 'Boll')![1].q,
            [...snap.liveUnits()].find(([, u]) => u.type === 'Boll')![1].r,
            pyr.q, pyr.r);
        const marchers: Array<{ index: number; value: number; closer: number }> = [];
        for (const child of children) {
            const played = snap.fork();
            for (const event of child.events) played.record(event);
            const u = played.getUnit(boll)!;
            const d = HexCoord.getDistance(u.q, u.r, pyr.q, pyr.r);
            if (startDist - d >= 3) marchers.push({ index: child.index, value: child.value, closer: startDist - d });
        }
        const sorted = [...children].sort((a, b) => b.value - a.value || a.index - b.index);
        const rankOf = (index: number) => sorted.findIndex((c) => c.index === index) + 1;
        const kept = new Set<number>();
        sorted.slice(0, 7).forEach((c) => kept.add(c.index));
        sorted.slice(7).slice(-4).forEach((c) => kept.add(c.index));
        console.log(`startdist ${startDist} | barn ${children.length} | marschbarn (>=3 narmare): ${marchers.length}`);
        console.log(`marschranker: ${marchers.map((m) => `#${rankOf(m.index)}(v${m.value.toFixed(0)},+${m.closer})`).join(' ')}`);
        console.log(`vardespann: bast ${sorted[0].value.toFixed(0)} / median ${sorted[80].value.toFixed(0)} / samst ${sorted[sorted.length - 1].value.toFixed(0)}`);
        console.log(`marschbarn bland de 11 behallna: ${marchers.filter((m) => kept.has(m.index)).length}`);

        // 2. The hand-built two-round kill line, scored inside depth 3.
        const line = snap.fork();
        applyGene(line, { kind: 'moveTowards', unitIndex: boll, targetIndex: 1, seed: 5 }, dialect.extras);
        sweepAttacks(line, 1, DEFAULT_DIALECT.sweep!);
        const afterT0 = scoreState(line, 1, weights);
        startTurn(line, 0, mulberry32(99));           // defense reply (idle board)
        startTurn(line, 1, mulberry32(combineSeed(seed, 2)));
        applyGene(line, { kind: 'moveTowards', unitIndex: boll, targetIndex: 1, seed: 6 }, dialect.extras);
        applyGene(line, { kind: 'attack', unitIndex: boll, targetIndex: 1, seed: 7 }, dialect.extras);
        sweepAttacks(line, 1, DEFAULT_DIALECT.sweep!);
        const u2 = line.getUnit(boll)!;
        const pyrAlive = [...line.liveUnits()].some(([, u]) => u.type === 'Pyramid');
        console.log(`handlinje: t0-score ${afterT0.toFixed(0)} | t2 Boll(${u2.q},${u2.r}) Pyramid ${pyrAlive ? 'LEVER' : 'DOD'} | t2-score ${scoreState(line, 1, weights).toFixed(0)}`);

        // 3. What the planner actually returns at the live Low budget.
        const live = parthianEngine.withBudget({ beamChildCounts: [160, 120, 60, 40, 32], beamDepth: 3 });
        const plan = live.planTurn(snap, 1, combineSeed(seed, 0));
        const played = snap.fork();
        for (const event of plan.events) played.record(event);
        const after = played.getUnit(boll)!;
        console.log(`planner: [${plan.events.map((e) => e.type).join(',')}] Boll->(${after.q},${after.r}) dist ${HexCoord.getDistance(after.q, after.r, pyr.q, pyr.r)} (start ${startDist})`);
    }, 600_000);
});

describe.skipIf(!process.env.PROBE6)('parthian against the choke boards', () => {
    it('measures the boards bastion used to be A/B tested against', async () => {
        const { TWIN_PICTURE } = await import('../../maps/ChokeMapProvider');
        const RETREAT = scenario('bastion-retreat', RETREAT_PICTURE, CHOKE_LEGEND);
        const TWIN = scenario('bastion-twin', TWIN_PICTURE, CHOKE_LEGEND);
        for (const [name, board] of [['twin', TWIN], ['retreat', RETREAT], ['choke', CHOKE]] as const) {
            let held = 0;
            const fails: number[] = [];
            for (let seed = 1; seed <= 6; seed++) {
                const result = runHeadlessMatch(board as any, {
                    seed, maxTurns: 80, engines: [parthianEngine, parthianEngine], plan: PLAN,
                });
                if (result.winner === 0 && result.survivors[0].includes('Pyramid')) held++;
                else fails.push(seed);
            }
            console.log(`parthian-probe ${name.padEnd(8)} ${held}/6${fails.length ? ` | föll: ${fails.join(',')}` : ''}`);
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

