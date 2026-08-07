// Wildfire: the whole rule, in one place, for both sides of the game.
//
// WHY THIS FILE EXISTS AT ALL. The simulation and the live game are two
// implementations of the same rules, and every time a rule has been written
// twice in this codebase the two copies have drifted: cargo followed a
// transport in the simulation and not on the board, a drowning transport
// took its passengers down on one side only, and skill costs were charged
// in four places until skillCost() collected them. Fire is a bigger rule
// than any of those -- state per tile, a random spread, a countdown, and
// damage charged during movement -- so it is written ONCE, here, and both
// sides call it.
//
// Everything below is pure: no THREE, no renderer, no Math.random. It has
// to be, because the AI searches over it inside a Web Worker, and
// workerSafety.test.ts fails the build if this file's import graph ever
// reaches a canvas. That is also why randomness arrives as an argument --
// see tickFires.
//
// The split of responsibilities is the one the architecture already uses
// for attacks: THIS module decides and returns resolved facts, the caller
// records them. Nothing here mutates a board, so SimState.apply() can stay
// mechanical and the live game can apply the identical outcome.

import { hexNeighbors } from './hexMath';

// How many turns a tile burns before it is spent. "Turn" is one player's
// turn, so on a two-player map a fire lives three rounds.
export const FIRE_DURATION = 6;

// Chance each burning tile spreads to each adjacent unburnt vegetated tile,
// rolled once per tile per turn.
export const FIRE_SPREAD_CHANCE = 0.5;

// Chance a destroyed MECHANICAL unit sets light to the tile it died on.
// Here rather than at either death site, so the simulation and the live game
// cannot end up rolling against different odds.
export const WRECK_FIRE_CHANCE = 0.5;

// Hp lost per burning tile a ground unit walks into.
export const FIRE_DAMAGE = 1;

// The fire-relevant face of a tile. Both SimTile and the live map tile
// satisfy this structurally, which is what lets one rule serve both.
//
// `vegetated` is snapshotted when the map is built and never recomputed.
// That is deliberate: it is a function of the tile's height AT DECORATION
// TIME, and craters lower tiles afterwards without ever regenerating the
// scenery. Recomputing it later would answer for scenery that is not there.
export interface FireTile {
    vegetated: boolean;
    // Turns of burning left. 0 means not on fire.
    burning: number;
    // Burnt out. Permanent, and the reason a tile cannot burn twice: the
    // trunks are still standing, but there is nothing left to catch.
    burned: boolean;
}

// A board this module can read and write.
//
// TWO METHODS, AND setTile IS NOT OPTIONAL SUGAR. The simulation must never
// mutate a tile in place: fork() shares the frozen base arrays by reference
// across every branch of the search, so writing through a tile object would
// change the board under hundreds of sibling candidates at once. SimState
// therefore stores an override, while the live game really does just assign
// the field. Taking the write as an argument is what lets the RULE below be
// written once while each side keeps its own storage discipline.
export interface FireBoard {
    getTile(q: number, r: number): FireTile | null;
    setTile(q: number, r: number, tile: FireTile): void;
}

// What one turn of fire does, as facts rather than mutations.
export interface FireTick {
    // Tiles that caught this turn.
    ignited: Array<{ q: number; r: number }>;
    // Tiles whose last turn of burning just ended.
    burnedOut: Array<{ q: number; r: number }>;
}

export const NO_FIRE_TICK: FireTick = { ignited: [], burnedOut: [] };

// Can a fire be started here?
//
// Greenery that has not already burned. Nothing about the terrain TYPE --
// a wooded mountain foot burns and a stony beach does not, and which is
// which is tileVegetation's answer, taken once at map build.
// Type guards rather than plain booleans, so a caller that has asked the
// question does not have to assert the answer with a `!` afterwards.
export function canIgnite(tile: FireTile | null | undefined): tile is FireTile {
    return !!tile && tile.vegetated && !tile.burned && tile.burning === 0;
}

export function isBurning(tile: FireTile | null | undefined): tile is FireTile {
    return !!tile && tile.burning > 0;
}

// Roll one turn of fire for the whole board.
//
// PURE, AND THE RANDOMNESS IS AN ARGUMENT. The caller supplies a seeded
// generator, because this runs in three places that must not disagree: the
// AI's rollouts on a worker thread, a headless match, and the live game.
// Math.random() here would make a beam node's board depend on which thread
// evaluated it, and the parallel planner's whole contract is that it does
// not (see simJob.ts -- a node is identified by the events that got it
// there, replayed independently on each worker).
//
// Returns facts. It does not touch the board: the simulation records the
// result as an event and lets apply() write it, and the live game applies
// the same lists. One rule, two mechanical appliers.
//
// SPREAD IS ROLLED FROM THE TILES THAT WERE ALREADY BURNING when the turn
// began -- freshly caught tiles do not spread again in the same turn. A
// fire that could chain through a forest within one tick would cross the
// whole map the moment it was lit, which is a fireworks display rather than
// a mechanic.
export function tickFires(board: FireBoard, burningTiles: Array<{ q: number; r: number }>, rng: () => number): FireTick {
    const ignited: Array<{ q: number; r: number }> = [];
    const burnedOut: Array<{ q: number; r: number }> = [];
    const claimed = new Set<string>();

    for (const { q, r } of burningTiles) {
        const tile = board.getTile(q, r);
        if (!isBurning(tile)) continue;

        // Spread first, then age. A tile spreads on the turn it burns out
        // too -- the last gasp still throws embers.
        for (const n of hexNeighbors(q, r)) {
            const key = `${n.q},${n.r}`;
            if (claimed.has(key)) continue;
            if (!canIgnite(board.getTile(n.q, n.r))) continue;
            // The roll happens for every eligible neighbour whether or not
            // it catches, so the stream does not depend on earlier
            // outcomes. Skipping the draw on a miss would make the sequence
            // depend on the board's history and two identical boards
            // reached by different routes would then diverge.
            if (rng() < FIRE_SPREAD_CHANCE) {
                claimed.add(key);
                ignited.push({ q: n.q, r: n.r });
            }
        }

        if (tile.burning <= 1) burnedOut.push({ q, r });
    }

    return { ignited, burnedOut };
}

// Every tile that is currently alight. The caller hands this to tickFires;
// both sides find it the same way so neither can miss a fire the other saw.
export function burningTilesOf(board: FireBoard, cols: number, rows: number): Array<{ q: number; r: number }> {
    const out: Array<{ q: number; r: number }> = [];
    for (let q = 0; q < cols; q++) {
        for (let r = 0; r < rows; r++) {
            if (isBurning(board.getTile(q, r))) out.push({ q, r });
        }
    }
    return out;
}

// Light a tile. One definition of "on fire", so the skill, the spread and
// the live executor cannot disagree about how long a fire lasts.
export function ignite(board: FireBoard, q: number, r: number): void {
    const tile = board.getTile(q, r);
    if (canIgnite(tile)) board.setTile(q, r, { ...tile, burning: FIRE_DURATION });
}

// Apply a tick's facts to a board, and age what is still alight.
//
// The countdown is derived here rather than carried in the event: "every
// burning tile is one turn shorter" is not a fact worth recording, and an
// event per burning tile per turn would bloat the log the neutrality digest
// hashes. What the event carries is the part that cannot be re-derived --
// which tiles the dice caught.
export function applyFireTick(board: FireBoard, tick: FireTick, burningTiles: Array<{ q: number; r: number }>): void {
    // Age first, then burn out, then light. Order matters: a tile lit this
    // turn must not immediately lose a turn to the countdown, and a tile
    // that just burnt out must not be relit by its own neighbour's roll.
    for (const { q, r } of burningTiles) {
        const tile = board.getTile(q, r);
        if (tile && tile.burning > 0) board.setTile(q, r, { ...tile, burning: tile.burning - 1 });
    }
    for (const { q, r } of tick.burnedOut) {
        const tile = board.getTile(q, r);
        if (tile) board.setTile(q, r, { ...tile, burning: 0, burned: true });
    }
    for (const { q, r } of tick.ignited) {
        const tile = board.getTile(q, r);
        if (canIgnite(tile)) board.setTile(q, r, { ...tile, burning: FIRE_DURATION });
    }
}

// Units of the side whose turn is beginning that are standing in fire.
//
// ADDED AFTER PLAYTESTING. The original rule charged only for tiles ENTERED,
// which is defensible -- the unit is in the gaps between the flames -- but it
// made fire feel like nothing: one hit point, once, and then free to camp in
// the middle of a burning forest. Standing in a fire now costs the same as
// walking into one, every turn, which is what makes burning ground something
// to get off rather than scenery.
//
// Returns the units to burn rather than burning them, like everything else
// here: the caller records it in the simulation and applies it live.
export function unitsStandingInFire<T extends { q: number; r: number; playerIndex: number }>(
    board: FireBoard, units: readonly T[], playerIndex: number, flies: (unit: T) => boolean
): T[] {
    const burnt: T[] = [];
    for (const unit of units) {
        if (unit.playerIndex !== playerIndex) continue;
        if (flies(unit)) continue;
        if (isBurning(board.getTile(unit.q, unit.r))) burnt.push(unit);
    }
    return burnt;
}

// Damage a unit takes for walking this path.
//
// Charged per burning tile ENTERED, so crossing a wall of fire costs more
// than skirting it, and standing still in a fire costs nothing -- the unit
// is in the gaps between the flames. The starting hex is not counted: the
// unit is already there and already paid when it entered.
//
// Fliers are untouched, which is the one place the rule looks at the unit
// at all.
export function firePathDamage(board: FireBoard, path: Array<{ q: number; r: number }>, flies: boolean): number {
    if (flies) return 0;
    let damage = 0;
    for (const step of path) {
        if (isBurning(board.getTile(step.q, step.r))) damage += FIRE_DAMAGE;
    }
    return damage;
}
