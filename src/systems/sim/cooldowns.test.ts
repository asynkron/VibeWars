// Cooldowns as SIMULATION state, which is the part that has to be right
// before any skill uses it.
//
// The AI forks a state hundreds of times per turn and plays each fork out
// over several turns. If a cooldown leaks between forks, sibling lines see
// each other's spending; if it fails to fork, the search cannot tell the
// line that held a skill from the line that burned it. Either way the
// symptom is an AI that is subtly worse, with nothing in a log to say so.

import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState, type SimUnit } from './SimState';
import { NO_COOLDOWNS, chargeSkill, isReady, type SkillDef } from '../../shared/hexengine/skills';
import { primarySkill } from '../../shared/hexengine/unitStats';

const RATIONED: SkillDef = { ...primarySkill('Pike')!, id: 'test:rationed', cooldown: 3 };

const grass = () => ({ type: 'GRASS', height: 1, moveCost: 1, hasRoad: false });

function unit(over: Partial<SimUnit> & Pick<SimUnit, 'type' | 'q' | 'r' | 'playerIndex'>): SimUnit {
    return {
        hp: 4, maxHp: 4, move: 2, attack: 3, minRange: 1, maxRange: 1,
        hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null, ...over,
    };
}

function board(units: SimUnit[]): SimState {
    return SimState.snapshot({
        map: { cols: 8, rows: 8, getTile: () => grass() },
        units,
        buildings: [],
    });
}

describe('cooldowns are simulation state', () => {
    it('survives a snapshot', () => {
        const charged = chargeSkill(NO_COOLDOWNS, RATIONED);
        const state = board([unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, cooldowns: charged })]);
        expect(isReady(state.getUnit(0)!.cooldowns, RATIONED.id)).toBe(false);
    });

    it('does not leak between forks', () => {
        // The assertion the whole search depends on. Two candidate lines
        // branch from one position; one spends a skill. The other must not
        // see it spent, or the beam is comparing lines that interfered
        // with each other.
        // Charged the way the game charges it -- by recording an attack --
        // rather than by reaching into the state, so this exercises the
        // real path.
        const state = board([
            unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, extraSkillId: RATIONED.id } as any),
            unit({ type: 'Bulwark', q: 1, r: 2, playerIndex: 1, hp: 10, maxHp: 10 }),
        ]);
        const spender = state.fork();
        const holder = state.fork();

        spender.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 2 });

        // Pike's own attack is cooldown 0, so nothing is charged -- what
        // this proves is that the two forks carry INDEPENDENT records.
        expect(spender.getUnit(0)!.hasAttacked).toBe(true);
        expect(holder.getUnit(0)!.hasAttacked).toBe(false);
        expect(state.getUnit(0)!.hasAttacked).toBe(false);
    });

    it('keeps a charged record independent across forks', () => {
        // The same isolation, on the cooldown record itself: one line
        // starts already charged, and ticking it in one fork must not
        // advance the other.
        const charged = chargeSkill(NO_COOLDOWNS, RATIONED);
        const state = board([unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, cooldowns: charged })]);
        const ticked = state.fork();
        const untouched = state.fork();

        ticked.record({ type: 'turnStarted', playerIndex: 0 });

        expect(ticked.getUnit(0)!.cooldowns[RATIONED.id]).toBe(RATIONED.cooldown - 1);
        expect(untouched.getUnit(0)!.cooldowns[RATIONED.id]).toBe(RATIONED.cooldown);
        expect(state.getUnit(0)!.cooldowns[RATIONED.id]).toBe(RATIONED.cooldown);
    });

    it('survives condense, which is what a played-out turn goes through', () => {
        const charged = chargeSkill(NO_COOLDOWNS, RATIONED);
        const state = board([unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, cooldowns: charged })]);
        expect(isReady(state.condense().getUnit(0)!.cooldowns, RATIONED.id)).toBe(false);
    });

    it('ticks only for the side whose turn started', () => {
        // A skill spent on my turn must still be spent while the opponent
        // replies. Getting this wrong would halve every cooldown in the
        // game and would look like nothing but slightly odd AI play.
        const charged = chargeSkill(NO_COOLDOWNS, RATIONED);
        const state = board([
            unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, cooldowns: charged }),
            unit({ type: 'Pike', q: 5, r: 5, playerIndex: 1, cooldowns: charged }),
        ]);

        state.record({ type: 'turnStarted', playerIndex: 0 });
        expect(state.getUnit(0)!.cooldowns[RATIONED.id]).toBe(RATIONED.cooldown - 1);
        expect(state.getUnit(1)!.cooldowns[RATIONED.id]).toBe(RATIONED.cooldown);
    });

    it('comes back after exactly its own number of own-side turns', () => {
        const state = board([
            unit({ type: 'Pike', q: 1, r: 1, playerIndex: 0, cooldowns: chargeSkill(NO_COOLDOWNS, RATIONED) }),
            unit({ type: 'Pike', q: 5, r: 5, playerIndex: 1 }),
        ]);
        for (let round = 0; round < RATIONED.cooldown; round++) {
            expect(isReady(state.getUnit(0)!.cooldowns, RATIONED.id), `ready too early, round ${round}`).toBe(false);
            state.record({ type: 'turnStarted', playerIndex: 0 });
            state.record({ type: 'turnStarted', playerIndex: 1 });
        }
        expect(isReady(state.getUnit(0)!.cooldowns, RATIONED.id)).toBe(true);
    });

    it('leaves an ordinary attack with no cooldown at all', () => {
        // Every attack in the game is cooldown 0, so the common path must
        // stay exactly as cheap and as empty as it was.
        const state = board([
            unit({ type: 'Bulwark', q: 1, r: 1, playerIndex: 0, hp: 10, maxHp: 10 }),
            unit({ type: 'Pike', q: 1, r: 2, playerIndex: 1 }),
        ]);
        state.record({ type: 'unitAttacked', attackerIndex: 0, defenderIndex: 1, damage: 2 });
        const attacker = state.getUnit(0)!;
        expect(attacker.hasAttacked).toBe(true);
        expect(attacker.cooldowns).toBe(NO_COOLDOWNS);
    });
});
