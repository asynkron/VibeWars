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
// Deterministic given `seed` and the pair of engines: per-turn plan seeds
// derive from the seed. The one exception is `planMs`, which is wall-clock
// and therefore varies run to run -- it is reported for compute-parity
// checks between engines, not as part of the match outcome.

import { SimState, SimUnit } from './SimState';
import { PlanTurnOptions } from './search';
import { AIEngine } from './ai/AIEngine';
import { DEFAULT_ENGINE } from './ai/engineRegistry';
import { combineSeed, mulberry32 } from './resolveAttack';
import { startTurn } from './SimCommands';
import * as HexCoord from '../../shared/hexengine/hexMath';
import * as UnitSystem from '../../shared/hexengine/unitStats';
import type { MapProvider, StartingUnit } from '../maps/MapProvider';
import { NO_COOLDOWNS } from '../../shared/hexengine/skills';

export interface HeadlessMatchOptions {
    seed?: number;
    // Cap in half-turns (one side's turn = 1). Default 200, matching GameState.
    maxTurns?: number;
    stalemateIdleTurns?: number;
    stalemateNoCombatTurns?: number;
    // Who plays each seat, indexed by playerIndex. Defaults to the shipped
    // engine on both sides -- the self-play case this runner was built for.
    engines?: readonly [AIEngine, AIEngine];
    // Search BUDGET override, applied on top of both engines. Kept separate
    // from the engines themselves so a cheap batch run can't accidentally
    // change what an engine believes -- only how long it gets to think.
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
    // Which engine held each seat, so a result row is self-describing even
    // after the matches have been shuffled into a report.
    engineIds: [string, string];
    // Wall-clock milliseconds each side spent planning. Two engines are
    // only comparable if they thought for comparable time, so the runner
    // measures it rather than assuming equal budgets buy equal cost.
    planMs: [number, number];
    // A hash of every event the match produced, in order. The fields above
    // summarise the OUTCOME; this fingerprints the whole PLAY -- every
    // move, every shot, every crater, in the sequence they happened.
    //
    // It exists to make a refactor provable. A change that is supposed to
    // leave behaviour alone leaves this digest alone; anything else is a
    // behaviour change, whether or not it was meant to be one. Two matches
    // can end 6-3 on turn 22 by completely different routes, so the
    // summary fields cannot do this job.
    eventDigest: string;
}

// Both node and the browser have performance.now(); Date.now() is the
// fallback so the runner never throws on a bare runtime.
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// A rolling FNV-1a over every event the match produces, folded in turn by
// turn.
//
// ROLLING BECAUSE THE LOG DOES NOT SURVIVE THE TURN. runHeadlessMatch
// condenses after every turn -- that is the whole point of condense(), and
// the reason a long match does not carry a growing log -- so the final
// state's `events` holds only the LAST turn. Hashing it at the end gave 8
// events for a nineteen-turn match and 0 for a stalemate, which would have
// been a fixture that passed no matter what changed underneath it.
//
// Not cryptographic and does not need to be: it is compared against a value
// committed from this same code, so its only job is that different play
// produces a different string. Hashed rather than stored whole because a
// match runs to thousands of events, and the point is a fixture a human can
// read in a diff and a machine can compare exactly.
class EventDigest {
    private hash = 0x811c9dc5;
    private count = 0;

    add(events: readonly unknown[]): void {
        const text = JSON.stringify(events);
        for (let i = 0; i < text.length; i++) {
            this.hash ^= text.charCodeAt(i);
            this.hash = Math.imul(this.hash, 0x01000193);
        }
        this.count += events.length;
    }

    toString(): string {
        return `${(this.hash >>> 0).toString(16).padStart(8, '0')}:${this.count}`;
    }
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
        cooldowns: NO_COOLDOWNS,
        carriedBy: null,
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
        engines = [DEFAULT_ENGINE, DEFAULT_ENGINE],
        plan = {},
    } = options;

    // The budget override is folded in once, here, so every turn of the
    // match is planned by exactly the same two engine instances.
    const seats: [AIEngine, AIEngine] = [engines[0].withBudget(plan), engines[1].withBudget(plan)];

    let state = stateFromProvider(provider);
    let idleTurns = 0;
    let noCombatTurns = 0;
    const captures: [number, number] = [0, 0];
    const planMs: [number, number] = [0, 0];
    const digest = new EventDigest();

    // The factories' hidden prizes, tracked HERE rather than in SimState
    // (which deliberately can't see unit types -- the search must not
    // cheat). When a capture opens a factory, the prize unit materializes
    // on a free neighboring tile at the start of the next turn, mirroring
    // BuildingSystem.yieldHiddenUnit in the live game.
    const spawns = provider.buildings ?? [];
    const prizes: Array<string | null> = spawns.map((b) => b.hiddenUnitType);
    const pendingSpawns: SimUnit[] = [];

    // Which pieces make up one structure. A composite building is captured
    // whole, and only one of its pieces holds the prize, so the capture
    // event can name a piece that holds nothing -- the prize has to be
    // looked up across the group or a depot taken from the wrong side
    // silently yields nothing.
    const groupMembers = (index: number): number[] => {
        const groupId = spawns[index]?.groupId;
        if (!groupId) return [index];
        const members: number[] = [];
        spawns.forEach((spawn, i) => { if (spawn.groupId === groupId) members.push(i); });
        return members;
    };

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
        engineIds: [seats[0].id, seats[1].id],
        planMs: [...planMs],
        eventDigest: digest.toString(),
    });

    const finishOnPoints = (reason: string, turns: number): HeadlessMatchResult => {
        const totals = sideTotals();
        const winner = totals[0] > totals[1] ? 0 : totals[1] > totals[0] ? 1 : -1;
        return finish(winner, `${reason} (points: ${totals.join(' vs ')})`, turns);
    };

    // The hard rule's ledger: which sides fielded VITAL units at the
    // start. A side that had them and has none left has lost outright --
    // sides that never had any play by the ordinary rules.
    const vitalSpawned: [boolean, boolean] = [false, false];
    for (const [, unit] of state.liveUnits()) {
        if (UnitSystem.isVital(unit.type)) vitalSpawned[unit.playerIndex] = true;
    }

    for (let turn = 0; turn < maxTurns; turn++) {
        const side = turn % 2;

        // The hard rule first: a lost vital unit ends the match whatever
        // else is still standing. The Pyramid dies, the Boll has won.
        if (vitalSpawned[0] || vitalSpawned[1]) {
            const vitalAlive: [boolean, boolean] = [false, false];
            for (const [, unit] of state.liveUnits()) {
                if (UnitSystem.isVital(unit.type)) vitalAlive[unit.playerIndex] = true;
            }
            const lost = [0, 1].filter((p) => vitalSpawned[p] && !vitalAlive[p]);
            if (lost.length > 0) {
                const winner = lost.length === 2 ? -1 : 1 - lost[0];
                return finish(winner, 'vital unit lost', turn);
            }
        }

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
        startTurn(state, side, mulberry32(combineSeed(seed, turn)));
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
        const startedAt = now();
        const { events } = seats[side].planTurn(snapshot, side, combineSeed(seed, turn));
        planMs[side] += now() - startedAt;
        state = snapshot; // canonical from here; events' indices refer to it
        // Folded in before they are applied, and before the next turn
        // condenses them away.
        digest.add(events);
        for (const event of events) {
            state.record(event);
            if (event.type === 'buildingCaptured') {
                captures[event.playerIndex]++;
                for (const memberIndex of groupMembers(event.buildingIndex)) {
                    const prize = prizes[memberIndex];
                    if (!prize) continue;
                    prizes[memberIndex] = null;
                    const spot = freeYieldTile(memberIndex, prize);
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
