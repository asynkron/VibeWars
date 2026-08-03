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

import { SimState, SimUnit } from './SimState';
import { planTurn, PlanTurnOptions } from './search';
import { combineSeed } from './resolveAttack';
import { HexCoord } from '../../shared/hexengine/HexCoord';
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
    // Factory captures per side (ownership flips, including re-captures).
    captures: [number, number];
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
        buildings: provider.buildings ?? [],
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
    const captures: [number, number] = [0, 0];

    // The factories' hidden prizes, tracked HERE rather than in SimState
    // (which deliberately can't see unit types -- the search must not
    // cheat). When a capture opens a factory, the prize unit materializes
    // on a free neighboring tile at the start of the next turn, mirroring
    // BuildingSystem.yieldHiddenUnit in the live game.
    const prizes: Array<string | null> = (provider.buildings ?? []).map((b) => b.hiddenUnitType);
    const pendingSpawns: SimUnit[] = [];

    const freeYieldTile = (buildingIndex: number, type: string): { q: number; r: number } | null => {
        const building = state.getBuilding(buildingIndex)!;
        const config = UnitSystem.unitTypesRecord[type];
        for (const c of HexCoord.getNeighbors(building.q, building.r)) {
            const tile = state.getTile(c.q, c.r);
            if (!tile || config.terrainCosts[tile.type] == null) continue;
            if (state.getUnitAt(c.q, c.r) || state.getBuildingAt(c.q, c.r)) continue;
            if (pendingSpawns.some((u) => u.q === c.q && u.r === c.r)) continue;
            return c;
        }
        return null;
    };

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
        captures: [...captures],
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

        // Play one turn: reset the side, snapshot, search, apply. Any
        // prize unit yielded last turn joins the fresh snapshot here
        // (condense can't add units, so the spawn rides in via a manual
        // re-snapshot of the condensed state).
        state.record({ type: 'turnStarted', playerIndex: side });
        let snapshot = state.condense();
        if (pendingSpawns.length > 0) {
            snapshot = SimState.snapshot({
                map: {
                    cols: snapshot.cols,
                    rows: snapshot.rows,
                    getTile: (q: number, r: number) => snapshot.getTile(q, r),
                },
                units: [...[...snapshot.liveUnits()].map(([, u]) => ({ ...u })), ...pendingSpawns],
                buildings: Array.from({ length: snapshot.buildingCount }, (_, i) => snapshot.getBuilding(i)),
            });
            pendingSpawns.length = 0;
        }
        const { events } = planTurn(snapshot, side, { ...plan, seed: combineSeed(seed, turn) });
        state = snapshot; // canonical from here; events' indices refer to it
        for (const event of events) {
            state.record(event);
            if (event.type === 'buildingCaptured') {
                captures[event.playerIndex]++;
                const prize = prizes[event.buildingIndex];
                if (prize) {
                    prizes[event.buildingIndex] = null;
                    const spot = freeYieldTile(event.buildingIndex, prize);
                    if (spot) {
                        pendingSpawns.push({ ...spawnToSimUnit({ type: prize, ...spot }, event.playerIndex) });
                    }
                }
            }
        }

        idleTurns = events.length === 0 ? idleTurns + 1 : 0;
        noCombatTurns = events.some((e) => e.type === 'unitAttacked') ? 0 : noCombatTurns + 1;
    }

    return finishOnPoints('turn limit reached', maxTurns);
}
