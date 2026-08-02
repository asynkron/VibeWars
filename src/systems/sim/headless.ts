// Headless match runner: full AI-vs-AI games played entirely in the pure
// simulation layer -- no renderer, no DOM in the game logic, no
// animations. The point is balance testing at scale: run dozens of
// matches in seconds and collect win rates, instead of watching one
// animated match at a time.
//
// The turn loop mirrors GameState/AIController faithfully:
//   - turnStarted resets the side to move (like GameState.nextTurn)
//   - the state is condensed into a fresh snapshot each turn (like
//     AIController snapshotting the live game), planTurn searches it, and
//     the winning events are applied
//   - victory by elimination; stalemate by consecutive idle turns,
//     prolonged no-combat play, or a turn cap -- decided on points
//     (total remaining hp), same rules as GameState.
//
// Deterministic given `seed`: per-turn plan seeds derive from it.

import { SimState } from './SimState';
import { planTurn, PlanTurnOptions } from './search';
import { combineSeed } from './resolveAttack';
import { UnitSystem } from '../../shared/hexengine/UnitSystem';
import type { MapProvider, StartingUnit } from '../maps/MapProvider';

export interface HeadlessMatchOptions {
    seed?: number;
    // Cap in half-turns (one side's turn = 1). Default 200, matching GameState.
    maxTurns?: number;
    stalemateIdleTurns?: number;
    stalemateNoCombatTurns?: number;
    // Search budget per turn; defaults to planTurn's own defaults.
    plan?: Omit<PlanTurnOptions, 'seed'>;
}

export interface HeadlessMatchResult {
    winner: number; // 0 | 1, or -1 for a draw
    reason: string;
    turns: number;
    hpTotals: [number, number];
    survivors: [string[], string[]];
}

function spawnToSimUnit(spawn: StartingUnit, playerIndex: number) {
    const stats = UnitSystem.unitTypesRecord[spawn.type];
    return {
        type: spawn.type,
        q: spawn.q,
        r: spawn.r,
        playerIndex,
        hp: stats.hp,
        maxHp: stats.maxHp,
        move: stats.move,
        attack: stats.attack,
        minRange: stats.minRange,
        maxRange: stats.maxRange,
        hasAttacked: false,
    };
}

// Build the initial pure state for a map provider, exactly as the real
// game would set it up (tiles + both sides' spawns).
export function stateFromProvider(provider: MapProvider): SimState {
    const tiles = provider.generate();
    const units = [
        ...provider.spawns.player.map((s) => spawnToSimUnit(s, 0)),
        ...provider.spawns.cpu.map((s) => spawnToSimUnit(s, 1)),
    ];
    return SimState.snapshot({
        map: {
            cols: provider.cols,
            rows: provider.rows,
            getTile: (q: number, r: number) => tiles[q][r],
        },
        units,
    });
}

export function runHeadlessMatch(provider: MapProvider, options: HeadlessMatchOptions = {}): HeadlessMatchResult {
    const {
        seed = 1,
        maxTurns = 200,
        stalemateIdleTurns = 4,
        stalemateNoCombatTurns = 40,
        plan = {},
    } = options;

    let state = stateFromProvider(provider);
    let idleTurns = 0;
    let noCombatTurns = 0;

    const sideTotals = (): [number, number] => {
        const totals: [number, number] = [0, 0];
        for (const [, unit] of state.liveUnits()) {
            totals[unit.playerIndex] += unit.hp;
        }
        return totals;
    };

    const survivors = (): [string[], string[]] => {
        const result: [string[], string[]] = [[], []];
        for (const [, unit] of state.liveUnits()) {
            result[unit.playerIndex].push(unit.type);
        }
        return result;
    };

    const finish = (winner: number, reason: string, turns: number): HeadlessMatchResult => ({
        winner,
        reason,
        turns,
        hpTotals: sideTotals(),
        survivors: survivors(),
    });

    const finishOnPoints = (reason: string, turns: number): HeadlessMatchResult => {
        const totals = sideTotals();
        const winner = totals[0] > totals[1] ? 0 : totals[1] > totals[0] ? 1 : -1;
        return finish(winner, `${reason} (points: ${totals.join(' vs ')})`, turns);
    };

    for (let turn = 0; turn < maxTurns; turn++) {
        const side = turn % 2;

        // Victory by elimination?
        const alive: [boolean, boolean] = [false, false];
        for (const [, unit] of state.liveUnits()) alive[unit.playerIndex] = true;
        if (!alive[0] || !alive[1]) {
            const winner = alive[0] ? 0 : alive[1] ? 1 : -1;
            return finish(winner, winner >= 0 ? 'elimination' : 'mutual destruction', turn);
        }

        // Stalemate?
        if (idleTurns >= stalemateIdleTurns) return finishOnPoints('stalemate -- no side can act', turn);
        if (noCombatTurns >= stalemateNoCombatTurns) return finishOnPoints('stalemate -- no combat', turn);

        // Play one turn: reset the side, snapshot, search, apply.
        state.record({ type: 'turnStarted', playerIndex: side });
        const snapshot = state.condense();
        const { events } = planTurn(snapshot, side, { ...plan, seed: combineSeed(seed, turn) });
        for (const event of events) snapshot.record(event);
        // The condensed snapshot (with this turn's events applied) becomes
        // the canonical state -- indices in the events refer to it.
        state = snapshot;

        idleTurns = events.length === 0 ? idleTurns + 1 : 0;
        noCombatTurns = events.some((e) => e.type === 'unitAttacked') ? 0 : noCombatTurns + 1;
    }

    return finishOnPoints('turn limit reached', maxTurns);
}
