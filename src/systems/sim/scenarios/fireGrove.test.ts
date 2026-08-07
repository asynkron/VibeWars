// THE GROVE. One Pike on open ground, one Kestrel deep in an unbroken
// forest. The Kestrel out-ranges the Pike (range 2-3, minRange 2: blind
// adjacent) and MOVES -- one tile per turn inside the grove -- so it can
// advance, kite, or flee a fire. It has 3 hp, and a burning tile costs
// 1 hp per own turn standing in it, three own turns per fire lifetime:
// caught and unable to leave, it burns to death untouched. The seat was
// first held by an immobile Mortar, which proved the pure quiet-move
// blindness (a payoff fifteen turns out is invisible at depth 3); the
// mobile Kestrel asks the DYNAMIC version -- when the enemy can close on
// you through burnable ground, does the fire start paying inside the
// horizon? See maps/GroveMapProvider.ts, whose picture this file imports.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';

declare const process: { env: Record<string, string | undefined> };
import { scenario } from './scenario';
import { GROVE_PICTURE, GROVE_LEGEND } from '../../maps/GroveMapProvider';
import { runHeadlessMatch, stateFromProvider } from '../headless';
import { requireEngine } from '../ai/engineRegistry';
import { startTurn, applyGene } from '../SimCommands';
import { BURN, burnGene } from '../ai/genes/burn';
import { mulberry32, combineSeed } from '../resolveAttack';

const GROVE = scenario('grove', GROVE_PICTURE, GROVE_LEGEND);
const PLAN = { beamChildCounts: [48, 24, 12], beamDepth: 3 };

describe('the grove: burn the wood, keep the range', () => {
    it('the arson line kills the artillery without firing a shot', () => {
        // The board's own proof, scripted rather than searched: the Pike
        // stands still at the treeline and lights whatever burnable
        // neighbour it has whenever the skill is ready (cooldown 3, so at
        // most a handful of ignitions); everything else is the fire rules
        // doing their work. The spread is seeded dice, so this is a rate
        // over seeds like every other scenario gate -- but the kill
        // arithmetic itself is exact once the Kestrel's tile catches.
        // (Undriven, it stands still like the Mortar it replaced -- the
        // scripted line proves the BOARD, not the opponent.)
        let killed = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const state = stateFromProvider(GROVE as any);
            const pike = 0;
            const kestrel = 1;
            let deadAt = -1;
            for (let turn = 0; turn < 60; turn++) {
                const side = turn % 2;
                startTurn(state, side, mulberry32(combineSeed(seed, turn)));
                if (!state.getUnit(kestrel)) { deadAt = turn; break; }
                if (side === 0) {
                    // No-op unless the skill is ready and a burnable
                    // neighbour exists -- burnGene.apply guards itself.
                    applyGene(state, { kind: BURN, unitIndex: pike, targetIndex: kestrel, seed: turn }, { [BURN]: burnGene });
                }
            }
            const pikeAfter = state.getUnit(pike);
            const ok = deadAt >= 0 && !!pikeAfter && pikeAfter.hp === pikeAfter.maxHp;
            if (ok) killed++;
            outcomes.push(`seed ${seed}: ${ok ? `brann ihjäl turn ${deadAt}` : 'ÖVERLEVDE'}`);
        }
        console.log(`grove arson ${killed}/6: ${outcomes.join(' | ')}`);
        expect(killed, outcomes.join(' | ')).toBeGreaterThanOrEqual(6);
    }, 120_000);

    it('parthian burns the artillery to death: the fire kill is a GATE now', () => {
        // The exam's whole history, because it earned its gate in three
        // measured steps and each one taught something:
        //
        // 1. VOCABULARY. No shipped dialect rolled the burn gene, so the
        //    winning line could not even be generated. Fixed by
        //    genes/useSkill.ts (the whole skill set through one dialect
        //    word); useSkill.test.ts proves the Pike samples arson. Still
        //    0/6 -- generation was necessary, not sufficient.
        //
        // 2. EVALUATION, static case. Against the immobile Mortar the
        //    kill lands ~turn 15, the beam sees 3: lighting scored the
        //    same as idle and died to the lowest-index tie-break. Against
        //    the mobile Kestrel a clean catch-22 appeared: far enemy =
        //    lightable trees but invisible payoff; near enemy = visible
        //    payoff but the Pike has fled onto bare grass. 0/6 either
        //    way -- the quiet-move blindness, measured twice.
        //
        // 3. FORESIGHT (the change that flipped this red and earned the
        //    gate): frozen-future scoring -- every board with fire on it
        //    is also scored 20 decision-free turns ahead at half weight
        //    (see PlanTurnOptions.foresight / frozenFutureValue). The
        //    fire's far payoff became visible at depth 3, and the first
        //    measured run went 2/6 fire eliminations with a third seed
        //    ending at Kestrel 1 hp -- and the stand-in-your-own-fire
        //    blunder vanished in the same stroke (narrate seed 3: ELD on
        //    turn 0, step away on turn 2, Kestrel burns dead turn 15).
        //
        // Gate at 1 of 6: the eliminations are seed-dice like every other
        // scenario rate, but zero would mean the foresight regressed and
        // the fire went quiet again.
        const engine = requireEngine('parthian');
        let kills = 0;
        const outcomes: string[] = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const result = runHeadlessMatch(GROVE, {
                seed, maxTurns: 80, engines: [engine, engine], plan: PLAN,
            });
            const ok = result.winner === 0 && result.survivors[1].length === 0;
            if (ok) kills++;
            outcomes.push(`seed ${seed}: ${ok ? 'ELIMINERAD' : `${result.winner === 0 ? 'vann utan kill' : 'förlorade'} (${result.reason}, ${result.turns}t)`}`);
        }
        console.log(`grove parthian kills ${kills}/6: ${outcomes.join(' | ')}`);
        expect(kills, outcomes.join(' | ')).toBeGreaterThanOrEqual(1);
    }, 480_000);
});

describe.skipIf(!process.env.GROVE_NARRATE)('grove: what actually happens, turn by turn', () => {
    it('narrates one match', () => {
        const seed = Number(process.env.SEED ?? 1);
        // GROVE_LIVE=1 runs the LIVE Low budget, so the narration answers
        // for the game being watched rather than for a thinner probe.
        const plan = process.env.GROVE_LIVE
            ? { beamChildCounts: [160, 120, 60, 40, 32], beamDepth: 3 }
            : PLAN;
        const engine = requireEngine('parthian');
        let state = stateFromProvider(GROVE as any);
        const positions = () => [...state.liveUnits()]
            .map(([, u]) => `${u.type}(${u.q},${u.r})hp${u.hp}`).join(' ');
        console.log(`start: ${positions()}`);
        for (let turn = 0; turn < 24; turn++) {
            const side = turn % 2;
            const alive: [boolean, boolean] = [false, false];
            for (const [, u] of state.liveUnits()) alive[u.playerIndex] = true;
            if (!alive[0] || !alive[1]) break;
            startTurn(state, side, mulberry32(combineSeed(seed, turn)));
            const snap = state.condense();
            const { events } = engine.withBudget(plan as any).planTurn(snap, side, combineSeed(seed, turn));
            state = snap;
            const notes: string[] = [];
            for (const event of events) {
                if (event.type === 'unitMoved') notes.push(`flytt->(${event.toQ},${event.toR})`);
                if (event.type === 'unitAttacked') notes.push(`skott -${event.damage}`);
                if (event.type === 'fireStarted') notes.push(`ELD(${event.q},${event.r})`);
                if (event.type === 'unitDied') notes.push(`DÖD idx${event.unitIndex}`);
                state.record(event);
            }
            console.log(`t${turn} sida${side}: ${notes.join(' | ') || 'inget'}  => ${positions()}`);
        }
    }, 300_000);
});
