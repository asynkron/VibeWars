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
import { planTurnAsync } from '../sim/search';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import { PathfindingSystem } from '../../shared/hexengine/PathfindingSystem';
import type { GameUnit, ResolvedAttackOutcome } from '../../types';

const ACTION_PAUSE_MS = 300;

// Live search budget: broad hillclimb + 6 finalists deep-checked 4 plies
// into the future with real (small) opponent searches. Roughly 10-15s of
// thinking per turn -- the progress panel makes the wait legible. The
// headless simulate batches pass their own smaller budgets.
const LIVE_PLAN_OPTIONS = {
    population: 32,
    rounds: 5,
    finalists: 6,
    deepPlies: 4,
    replyPopulation: 10,
    replyRounds: 2,
};

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
        const { events } = await planTurnAsync(
            snapshot,
            playerIndex,
            { ...LIVE_PLAN_OPTIONS, seed },
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
                if (path.length === 0) continue; // live world diverged; skip gracefully
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

                while (i < events.length) {
                    const e = events[i];
                    if (e.type === 'unitAttacked' && e.attackerIndex === attackerIndex) {
                        const victim = liveRefs[e.defenderIndex];
                        if (victim) outcome.damages.push({ unit: victim, damage: e.damage });
                        i++;
                    } else if (e.type === 'unitDied') {
                        i++; // derived by applyResolvedOutcome from the damage
                    } else if (e.type === 'terrainModified') {
                        outcome.impacts.push({ q: e.q, r: e.r, craterDelta: e.delta });
                        i++;
                    } else {
                        break;
                    }
                }

                const attacker = liveRefs[attackerIndex];
                if (isAlive(attacker) && isAlive(primaryDefender)) {
                    stats.attacks++;
                    await UnitSystem.attack(attacker, primaryDefender, outcome);
                    await sleep(ACTION_PAUSE_MS);
                }
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

            // Stray unitDied/terrainModified outside an attack group -- the
            // gene layer never produces these, but skip defensively.
            i++;
        }

        return stats;
    }
}
