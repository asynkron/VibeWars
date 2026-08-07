import { AI_DIFFICULTY } from '../../constants';
// Bridges the pure search (SimState + planTurn) to the live game: snapshot
// the world, search for the best whole-turn plan, then replay the winning
// event log against the real systems with animations.
//
// Index safety: SimState addresses units by their index in the turn
// snapshot, and those indices are stable across simulated deaths. The live
// units array is NOT stable -- UnitSystem.removeUnit splices it. So the
// snapshot's unit order is captured as an array of live GameUnit
// REFERENCES up front, and every event index resolves through that.
// A membership check against gameState.units tells us whether the unit is
// still alive when its event comes up for execution.
//
// Attack replay: the events from one attack gene (all unitAttacked hits,
// the unitDied facts, the terrainModified craters) are grouped back into
// one ResolvedAttackOutcome and handed to UnitSystem.attack(attacker,
// defender, resolved) -- the exact facts the search committed to are what
// get executed with visuals. unitDied events aren't executed directly:
// applyResolvedOutcome derives the same deaths from the same damage.

import { SimState } from '../sim/SimState';
import { AIEngine } from '../sim/ai/AIEngine';
import { DEFAULT_ENGINE, getEngine, ENGINES } from '../sim/ai/engineRegistry';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { PathfindingSystem } from '../../shared/hexengine/PathfindingSystem';
import { skillById } from '../../shared/hexengine/unitStats';
import type { GameUnit, ResolvedAttackOutcome } from '../../types';

const ACTION_PAUSE_MS = 300;

// Live search budget: broad hillclimb + 6 finalists deep-checked 4 plies
// into the future with real (small) opponent searches. Roughly 10-15s of
// thinking per turn -- the progress panel makes the wait legible. The
// headless simulate batches pass their own smaller budgets.
//
// This is a BUDGET, not a personality: it says how hard to think, never
// what to think. Which engine plays is chosen separately below, so
// swapping engines can't accidentally change the think time and a budget
// change can't accidentally change how the AI values the board.
// How hard the CPU thinks, as three budgets.
//
// The dials are the beam's WIDTH (how many candidate turns survive at each
// level) and its DEPTH (how many turns ahead it looks). Width buys better
// play within the same horizon; depth buys foresight, and costs far more --
// each extra ply multiplies the tree.
//
// LOW IS EXACTLY WHAT THE GAME PLAYED BEFORE THIS SETTING EXISTED, so a
// player who never touches it gets the same opponent as yesterday.
//
// DEPTH NEVER GOES BELOW 3 at any level. skills.ts refuses to author a
// cooldown longer than the default engine is deep, and the default's 3 is
// what makes Repair and Start Fire visible to the search -- a shallower
// setting would spend them as though they were free.
const DIFFICULTY_BUDGETS = {
    low: {
        population: 32,
        rounds: 5,
        finalists: 6,
        deepPlies: 4,
        replyPopulation: 10,
        replyRounds: 2,
        // A beam planner reads none of the above, so it needs its own live
        // dial or it would play the batch-sized search in a game where
        // there is time to think.
        beamChildCounts: [160, 120, 60, 40, 32],
        beamDepth: 3,
    },
    medium: {
        population: 48,
        rounds: 6,
        finalists: 8,
        deepPlies: 4,
        replyPopulation: 14,
        replyRounds: 2,
        // 1400 wide. Only the first FOUR entries are ever read -- the list
        // is indexed childCounts[min(depth, length - 1)] and this plays four
        // plies -- but the tail is kept so the taper is readable beside
        // Hard's, and so raising beamDepth later does not silently hand the
        // new deepest ply a number chosen for a shallower one.
        beamChildCounts: [1400, 1000, 620, 400, 260],
        beamDepth: 4,
    },
    hard: {
        population: 96,
        rounds: 9,
        finalists: 14,
        deepPlies: 5,
        replyPopulation: 24,
        replyRounds: 3,
        // WIDTH is the dial that was raised here -- 300 to 2600, roughly 16x
        // Low. Depth stays at 5, where it started.
        //
        // It was briefly 6, and that was a mistake: work per level is about
        // (surviving nodes x childCount) and the survivors are capped by the
        // engine's keepBest/keepWorst, so width costs LINEARLY while every
        // extra ply MULTIPLIES. A serial plan at depth 6 did not finish
        // inside ten minutes on a 30x30 board with ten units. Depth is the
        // expensive dial and it is not the one that needed turning.
        beamChildCounts: [2600, 1900, 1200, 800, 520],
        beamDepth: 5,
    },
};

export type Difficulty = keyof typeof DIFFICULTY_BUDGETS;

export const DIFFICULTIES: readonly Difficulty[] = ['low', 'medium', 'hard'];

function budgetFor(difficulty: string | null) {
    return DIFFICULTY_BUDGETS[(difficulty as Difficulty)] ?? DIFFICULTY_BUDGETS.low;
}

const LIVE_BUDGET = budgetFor(AI_DIFFICULTY);

// ?ai=baseline picks a variant for BOTH CPU sides; ?ai=baseline:parthian
// gives each side its own, so an AI-vs-AI game in the browser is a visible
// version of what the headless tournament measures.
function enginesFromQuery(): [AIEngine, AIEngine] {
    const fallback: [AIEngine, AIEngine] = [DEFAULT_ENGINE, DEFAULT_ENGINE];
    if (typeof window === 'undefined' || !window.location?.search) return fallback;
    const requested = new URLSearchParams(window.location.search).get('ai');
    if (!requested) return fallback;

    const parts = requested.split(':');
    const picked = (parts.length === 2 ? parts : [requested, requested]).map((id) => {
        const engine = getEngine(id.trim());
        if (!engine) {
            console.warn(`Unknown AI engine "${id}" -- known: ${ENGINES.map((e) => e.id).join(', ')}. Using ${DEFAULT_ENGINE.id}.`);
        }
        return engine ?? DEFAULT_ENGINE;
    });
    return [picked[0], picked[1]];
}

// Resolved once, but on FIRST USE rather than at module load: reading the
// registry at load time makes this file order-sensitive, and any import
// path that reaches AIController before the engine modules have finished
// initialising crashes the whole game at startup with an undefined engine.
// Caching after the first call still guarantees the query string is read
// once, so engines cannot silently change between turns.
let liveEngines: [AIEngine, AIEngine] | null = null;
function getLiveEngines(): [AIEngine, AIEngine] {
    if (!liveEngines) {
        const [a, b] = enginesFromQuery();
        liveEngines = [a.withBudget(LIVE_BUDGET), b.withBudget(LIVE_BUDGET)];
    }
    return liveEngines;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// What a CPU turn actually did against the live world -- GameState uses
// this to detect stalemates (e.g. armies separated by water that can
// neither reach nor hurt each other).
export interface CpuTurnStats {
    moves: number;
    attacks: number;
}

export class AIController {
    static async runCpuTurn(gameState: { map: any; units: GameUnit[]; buildings?: any[] }, playerIndex: number = 1): Promise<CpuTurnStats> {
        const stats: CpuTurnStats = { moves: 0, attacks: 0 };
        const snapshot = SimState.snapshot(gameState);
        // Parallel to the snapshot's unit indices, by construction: snapshot
        // maps source.units in order.
        const liveRefs: GameUnit[] = [...gameState.units];

        const seed = Math.floor(Math.random() * 0x7fffffff);
        const reportProgress = (done: number, total: number) =>
            window.dispatchEvent(new CustomEvent('vibewars:aiprogress', {
                detail: { done, total, playerIndex },
            }));
        const engines = getLiveEngines();
        const engine = engines[playerIndex] ?? engines[1];
        const { events } = await engine.planTurnAsync(
            snapshot,
            playerIndex,
            seed,
            (p) => reportProgress(p.done, p.total)
        );
        reportProgress(1, 1); // thinking done -- hide the panel

        const isAlive = (unit: GameUnit | undefined): unit is GameUnit =>
            unit !== undefined && gameState.units.includes(unit);

        let i = 0;
        while (i < events.length) {
            const event = events[i];

            if (event.type === 'unitMoved') {
                i++;
                const unit = liveRefs[event.unitIndex];
                if (!isAlive(unit)) continue;
                const path = PathfindingSystem.getPath(unit.q, unit.r, event.toQ, event.toR, unit.move, unit);
                if (path.length === 0) {
                    // The live world diverged from the simulation. Skip
                    // gracefully, but LOUDLY -- a silent drop here cascades
                    // (the unit never reaches its firing position, so its
                    // planned attacks get range-rejected later).
                    console.warn(
                        `AI replay: no live path for ${unit.type} (${unit.q},${unit.r}) -> ` +
                        `(${event.toQ},${event.toR}) with move ${unit.move} -- move dropped`
                    );
                    continue;
                }
                unit.move -= event.moveSpent;
                stats.moves++;
                await UnitSystem.move(unit, path);
                await sleep(ACTION_PAUSE_MS);
                continue;
            }

            if (event.type === 'unitAttacked') {
                // Regroup this attack's consecutive facts into one outcome.
                const attackerIndex = event.attackerIndex;
                const primaryDefender = liveRefs[event.defenderIndex];
                const outcome: ResolvedAttackOutcome = { damages: [], impacts: [] };

                // Grouped on the attacker AND the skill, not the attacker
                // alone. No unit uses two skills in one turn today, so the
                // two are equivalent -- but the moment a skill exists that
                // does not spend the action, a unit's second use would be
                // swallowed into the first outcome and replayed as one
                // attack. Cheap now, invisible later.
                const skillId = (event as any).skillId;
                while (i < events.length) {
                    const e = events[i];
                    if (e.type === 'unitAttacked' && e.attackerIndex === attackerIndex
                        && (e as any).skillId === skillId) {
                        const victim = liveRefs[e.defenderIndex];
                        if (victim) outcome.damages.push({ unit: victim, damage: e.damage });
                        i++;
                    } else if (e.type === 'unitDied') {
                        i++; // derived by applyResolvedOutcome from the damage
                    } else if (e.type === 'terrainModified') {
                        outcome.impacts.push({ q: e.q, r: e.r, craterDelta: e.delta });
                        i++;
                    } else if (e.type === 'fireStarted' && e.casterIndex < 0) {
                        // A wreck fire: no caster, no skill. Consumed INTO
                        // this attack's outcome rather than left to the arm
                        // below, for two reasons. It is recorded in the
                        // middle of an attack's event run, so letting it
                        // through would split the run and the remainder
                        // would be dropped by attack()'s hasAttacked guard.
                        // And applyResolvedOutcome is the only moment in the
                        // whole replay when a death actually happens, so it
                        // is the only place the ignition can be sequenced
                        // with the corpse it came from.
                        (outcome.ignitions ??= []).push({ q: e.q, r: e.r });
                        i++;
                    } else {
                        break;
                    }
                }

                const attacker = liveRefs[attackerIndex];
                if (isAlive(attacker) && isAlive(primaryDefender)) {
                    // Same range/hasAttacked preconditions attack() checks
                    // silently -- verify them here so a diverged replay is
                    // visible instead of a no-op.
                    const dist = UnitSystem.getHexDistance(attacker.q, attacker.r, primaryDefender.q, primaryDefender.r);
                    if (dist < attacker.minRange || dist > attacker.maxRange || UnitSystem.hasUnitAttacked(attacker)) {
                        console.warn(
                            `AI replay: attack dropped for ${attacker.type} at (${attacker.q},${attacker.r}) -> ` +
                            `${primaryDefender.type} at (${primaryDefender.q},${primaryDefender.r}): ` +
                            `dist ${dist}, range ${attacker.minRange}-${attacker.maxRange}, ` +
                            `hasAttacked ${UnitSystem.hasUnitAttacked(attacker)}`
                        );
                    } else {
                        stats.attacks++;
                        // The skill the simulation chose travels with the
                        // plan, so the live cast is the same cast. This is
                        // the property the reference has only by accident:
                        // its player and its AI both call
                        // Unit.AnimateSpellCast, which is the single most
                        // copyable idea in the whole thing.
                        await UnitSystem.attack(attacker, primaryDefender, outcome, skillId);
                        await sleep(ACTION_PAUSE_MS);
                    }
                }
                continue;
            }

            if (event.type === 'unitRepaired') {
                const healer = liveRefs[event.repairerIndex];
                const target = liveRefs[event.targetIndex];
                if (isAlive(healer) && isAlive(target)) {
                    // Neither the cooldown NOR the spent action is applied
                    // here: the executor owns both, exactly as the
                    // reference leaves Cast() to AnimateSpellCast and omits
                    // it from AiSpellCastAction. One place to charge, so a
                    // replayed cast and a player's cannot drift -- and they
                    // did drift, the first time this was written with the
                    // action set here and the cooldown set there.
                    UnitSystem.repair(target, event.hp, healer);
                    await sleep(ACTION_PAUSE_MS);
                }
                i++;
                continue;
            }

            if (event.type === 'unitLoaded' || event.type === 'unitUnloaded') {
                const carrier = liveRefs[event.carrierIndex];
                const passenger = liveRefs[event.passengerIndex];
                if (isAlive(carrier) && isAlive(passenger)) {
                    if (event.type === 'unitLoaded') {
                        UnitSystem.loadPassenger(carrier, passenger);
                    } else {
                        UnitSystem.unloadPassenger(carrier, passenger, event.toQ, event.toR);
                    }
                    await sleep(ACTION_PAUSE_MS);
                }
                i++;
                continue;
            }

            if (event.type === 'fireStarted') {
                if (event.casterIndex < 0) {
                    // A wreck fire that reached here rather than being
                    // consumed into an attack's outcome above -- which means
                    // a death happened somewhere the grouping loop does not
                    // cover. Lit anyway, because dropping it silently is the
                    // divergence this replay exists to prevent.
                    UnitSystem.igniteTile(event.q, event.r);
                    i++;
                    continue;
                }
                const caster = liveRefs[event.casterIndex];
                const skill = event.skillId ? skillById(caster?.type ?? '', event.skillId) : undefined;
                if (isAlive(caster) && skill) {
                    // The same executor the player's click calls, which is
                    // what charges the cost exactly once and in one way.
                    UnitSystem.startFire(caster, event.q, event.r, skill);
                    await sleep(ACTION_PAUSE_MS);
                }
                i++;
                continue;
            }

            if (event.type === 'unitBurned') {
                // Deliberately NOT executed. The damage was charged as the
                // replayed unitMoved above walked its path -- UnitSystem.move
                // applies it step by step, exactly as the simulation charged
                // it over the route it planned. Applying the event as well
                // would burn the unit twice.
                i++;
                continue;
            }

            if (event.type === 'fireTicked') {
                // Never reaches here: the beam only ever returns depth-0
                // events and a turn start is not one of them. Armed anyway
                // so it cannot fall through to the warning below and read as
                // a divergence that is not one.
                i++;
                continue;
            }

            if (event.type === 'buildingCaptured') {
                // Deliberately NOT executed: the live capture hook in
                // UnitSystem.move()'s finalizeStep (BuildingSystem.tryCapture)
                // already fired when the replayed unitMoved above landed on
                // the building -- executing this too would double-capture.
                i++;
                continue;
            }

            // Anything this loop has no arm for. The gene layer produces
            // none of these today, but a silently skipped event is a plan
            // the AI searched and the live game did not play -- the exact
            // divergence the resolve-first design exists to prevent, and
            // the one failure here that leaves no trace at all. Say so.
            //
            // Warned rather than thrown: a half-executed turn is worse
            // than a turn missing one action, and this is the fallback
            // arm, so anything reaching it is already unexpected.
            console.warn(
                `AI replay: no handler for event "${(event as any).type}" -- skipped. ` +
                'The simulation planned something the live game cannot execute.'
            );
            i++;
        }

        return stats;
    }
}
