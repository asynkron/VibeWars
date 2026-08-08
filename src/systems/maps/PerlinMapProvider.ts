// The random map: perlin-noise terrain with random height variation and
// random roads added by game.ts.
//
// Three sizes, and THE GENERATOR IS THE SAME ONE IN ALL THREE. generate()
// below is the original body, line for line -- same noise, same scale, same
// valley offset, same height scale, same lerped colours. The three variants
// differ only in how big the grid is and how many units each side starts
// with. There is deliberately no second terrain generator in here.
//
// What IS new is what stands on it. The old 50x50 map put eleven units on
// one side and two on the other, all bunched in one corner on whatever the
// noise happened to put there -- including, sometimes, open water, from
// which a ground unit never gets out -- and had no buildings at all. Now
// both sides get the SAME roster and one owned HQ on opposite edges, the
// way the authored maps do it, and there are forge depots to fight over:
// two, three or seven by size. Everything is placed on the MAINLAND, so
// nothing starts on an island and no depot is uncapturable.
//
// A NOTE ON "RANDOM". perlinNoise has a fixed permutation table, so for a
// long time the terrain TYPE layout was the same on every load -- three
// fixed crops of one landscape, with only height jitter and roads varying.
// generate() now samples at a RANDOM OFFSET into the noise field per load
// (see the seed note in generate()), so every match gets a genuinely new
// board. The structural tests in randomMaps.test.ts therefore hold for
// whatever board comes out, not for one memorized layout.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { perlinNoise } from '../../shared/hexengine/perlinNoise';
import { TERRAIN_CONFIG } from '../../constants';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';
import { DEPOT_TURNS, depotCells, depotRotationDeg } from './depotLayout';

// One explicit roster per size -- the prefix scheme is gone, because the
// counts are authored per size now: every size fields Pike (the only
// class that can capture, or the depots are scenery) and Drover (the
// APC, or the Pikes walk), scaled 1/2/3 by map size. AA appears only
// where AIR does: the small map has neither -- an AA with nothing to
// shoot at was a dead slot -- while medium and large field Nightjar (and
// large Shrike), answered by a Halberd.
const SMALL_ROSTER = [
    'Bulwark',
    'Pike',
    'Drover',
];
const MEDIUM_ROSTER = [
    'Bulwark',
    'Halberd',
    'Nightjar',
    'Kestrel',
    'Pike', 'Pike',
    'Drover', 'Drover',
];
const LARGE_ROSTER = [
    'Bulwark',
    'Halberd',
    'Nightjar',
    'Kestrel',
    'Sabre',
    'Lynx',
    'Shrike',
    'Pike', 'Pike', 'Pike',
    'Drover', 'Drover', 'Drover',
];

const neighbourOffsets = (q: number) => (q % 2 === 0
    ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
    : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]);

// The biggest patch of ground a walking unit can move around inside.
//
// Random terrain makes islands, and anything placed on one is out of the
// match: a unit that can never reach the enemy, or a factory nobody can
// capture. Everything below is placed on the MAINLAND only, which is the
// same class of fault as the movement bug that stranded units against a
// ridge -- worth designing out rather than discovering in a game.
function mainland(tiles: TileLike[][], cols: number, rows: number): Set<string> {
    const unvisited = new Set<string>();
    for (let q = 0; q < cols; q++) {
        for (let r = 0; r < rows; r++) {
            if (!TerrainSystem.isImpassable(tiles[q]?.[r]?.type ?? 'WATER')) unvisited.add(`${q},${r}`);
        }
    }
    let best = new Set<string>();
    while (unvisited.size) {
        const start = unvisited.values().next().value as string;
        const component = new Set<string>([start]);
        unvisited.delete(start);
        const queue = [start];
        for (let head = 0; head < queue.length; head++) {
            const [cq, cr] = queue[head].split(',').map(Number);
            for (const [dq, dr] of neighbourOffsets(cq)) {
                const key = `${cq + dq},${cr + dr}`;
                if (!unvisited.has(key)) continue;
                unvisited.delete(key);
                component.add(key);
                queue.push(key);
            }
        }
        if (component.size > best.size) best = component;
    }
    return best;
}

// The nearest hex to (q, r) that satisfies a predicate -- a breadth-first
// walk outward. The walk itself ignores passability, because it is looking
// for somewhere to LAND, not a route.
function nearestWhere(
    cols: number, rows: number, q: number, r: number,
    accept: (q: number, r: number) => boolean
): [number, number] | null {
    const seen = new Set<string>([`${q},${r}`]);
    const queue: Array<[number, number]> = [[q, r]];
    for (let head = 0; head < queue.length; head++) {
        const [cq, cr] = queue[head];
        if (accept(cq, cr)) return [cq, cr];
        for (const [dq, dr] of neighbourOffsets(cq)) {
            const nq = cq + dq;
            const nr = cr + dr;
            if (nq < 0 || nr < 0 || nq >= cols || nr >= rows) continue;
            if (seen.has(`${nq},${nr}`)) continue;
            seen.add(`${nq},${nr}`);
            queue.push([nq, nr]);
        }
    }
    return null;
}

// Grand Hall's footprint: the centre anchor plus all six neighbours.
function hqCells(q: number, r: number): Array<[number, number]> {
    return [[q, r], ...neighbourOffsets(q).map(([dq, dr]) => [q + dq, r + dr] as [number, number])];
}

// Where the bases want to be, before the terrain gets a say: the middle of
// the map, in HALF-TURN-SYMMETRIC PAIRS, plus the centre itself when the
// count is odd.
//
// The terrain is random, so the two sides can never face identical ground
// and there is no point pretending otherwise. What can be made fair is the
// LAYOUT OF THE OBJECTIVES: each pair puts one base on each side of the
// middle at mirrored offsets, and the odd one out sits dead centre, where it
// belongs to whoever fights for it.
function baseTargets(cols: number, rows: number, count: number): Array<[number, number]> {
    const centreQ = (cols - 1) / 2;
    const centreR = (rows - 1) / 2;
    const targets: Array<[number, number]> = [];
    if (count % 2 === 1) targets.push([centreQ, centreR]);
    // Offsets from the centre as a fraction of the map, so they scale with
    // it. Spread apart in both axes: three bases in a row down the middle
    // would make one lane the whole game.
    const PAIRS: Array<[number, number]> = [[0.24, 0.12], [0.10, 0.30], [0.32, 0.30]];
    for (let index = 0; index < Math.floor(count / 2); index++) {
        const [fractionQ, fractionR] = PAIRS[index % PAIRS.length];
        const offsetQ = fractionQ * (cols - 1);
        const offsetR = fractionR * (rows - 1);
        targets.push([centreQ - offsetQ, centreR - offsetR]);
        targets.push([centreQ + offsetQ, centreR + offsetR]);
    }
    return targets.map(([q, r]) => [Math.round(q), Math.round(r)] as [number, number]);
}

// Both sides' starting units and the neutral bases between them, placed
// together because they must not collide and both need the same mainland.
function placeEverything(
    tiles: TileLike[][], cols: number, rows: number, roster: readonly string[], baseCount: number
): { spawns: { player: StartingUnit[]; cpu: StartingUnit[] }; buildings: BuildingSpawn[] } {
    const open = tiles.length ? mainland(tiles, cols, rows) : new Set<string>();
    const taken = new Set<string>();

    const free = (q: number, r: number) => open.has(`${q},${r}`) && !taken.has(`${q},${r}`);

    // Every random battle has one HQ per side. Place them first, one row in
    // from each side's edge and centred, so unit placement and the neutral
    // depot search both reserve their cells. Before generate() there is no
    // terrain yet; the provider still exposes harmless placeholder positions
    // for menus that inspect its buildings early.
    const buildings: BuildingSpawn[] = [];
    const hqTargets: Array<{ ownerIndex: number; q: number; r: number }> = [
        { ownerIndex: 0, q: Math.floor(cols / 2), r: Math.max(0, rows - 2) },
        { ownerIndex: 1, q: Math.floor(cols / 2), r: Math.min(rows - 1, 1) },
    ];
    const hqFits = (q: number, r: number) => hqCells(q, r).every(([cq, cr]) =>
        cq >= 0 && cq < cols && cr >= 0 && cr < rows && free(cq, cr));
    for (const target of hqTargets) {
        const position = open.size
            ? nearestWhere(cols, rows, target.q, target.r, hqFits)
            : [target.q, target.r] as [number, number];
        if (!position) {
            throw new Error(`Random map ${cols}x${rows} has no free mainland hex for player ${target.ownerIndex}'s HQ`);
        }
        const [anchorQ, anchorR] = position;
        const groupId = `hq@player${target.ownerIndex}`;
        for (const [index, [q, r]] of hqCells(anchorQ, anchorR).entries()) {
            taken.add(`${q},${r}`);
            buildings.push({
                type: 'hq', q, r,
                ownerIndex: target.ownerIndex,
                hiddenUnitType: null,
                groupId,
                drawnByAnchor: index !== 0,
            });
        }
    }

    // The player takes the southern edge and the CPU the northern, the
    // convention every other map follows.
    const line = (edgeRow: number): StartingUnit[] => roster.map((type, index) => {
        // Centred on the edge rather than started from a corner, so a big
        // roster on a small map does not run off the end.
        const column = Math.floor((cols - roster.length) / 2) + index;
        if (!open.size) return { type, q: column, r: edgeRow };
        const [q, r] = nearestWhere(cols, rows, column, edgeRow, free) ?? [column, edgeRow];
        taken.add(`${q},${r}`);
        return { type, q, r };
    });
    const spawns = { player: line(rows - 1), cpu: line(0) };

    // A depot fits at some HEADING if all four of that heading's hexes are
    // on the mainland, free, and on the board. There is no parity rule any
    // more: depotLayout turns the fan in cube coordinates, which is the same
    // permutation on every column, so an odd anchor is as good as an even
    // one. That alone doubles the sites the search below has to choose from.
    const fitsTurned = (q: number, r: number, turns: number) =>
        depotCells(q, r, turns).every(([, cq, cr]) =>
            cq >= 0 && cq < cols && cr >= 0 && cr < rows && free(cq, cr));
    const depotFits = (q: number, r: number) => DEPOT_TURNS.some((t) => fitsTurned(q, r, t));

    if (open.size) {
        for (const [targetQ, targetR] of baseTargets(cols, rows, baseCount)) {
            const anchor = nearestWhere(cols, rows, targetQ, targetR, depotFits);
            if (!anchor) continue; // No room left; fewer depots beats a broken one.
            const [q, r] = anchor;
            // Which way it faces is drawn, not fixed -- but only among the
            // headings that actually fit here. Starting the search at a
            // random offset and taking the first fit means a depot with room
            // on every side is genuinely random, while one wedged against a
            // lake still gets built instead of being skipped for a heading
            // it could not have used. Math.random is right here for the same
            // reason it is right for the noise offset above: this is map
            // generation, not simulation.
            const first = Math.floor(Math.random() * DEPOT_TURNS.length);
            let turns = first;
            for (let i = 0; i < DEPOT_TURNS.length; i++) {
                const candidate = (first + i) % DEPOT_TURNS.length;
                if (fitsTurned(q, r, candidate)) { turns = candidate; break; }
            }
            const groupId = `forgeDepot@${q},${r}`;
            for (const [type, cq, cr] of depotCells(q, r, turns)) {
                taken.add(`${cq},${cr}`);
                // Block the ring around each piece too. Two depots that
                // touch are one objective wearing two hats: an infantryman
                // standing between both doors takes them on consecutive
                // turns without ever moving.
                for (const [dq, dr] of neighbourOffsets(cq)) taken.add(`${cq + dq},${cr + dr}`);
                buildings.push({
                    type,
                    q: cq,
                    r: cr,
                    // The S piece is the DOOR and holds the prize, exactly as
                    // on the authored map: the other three are back and side
                    // walls, so a depot has one approach worth defending
                    // rather than four equivalent ones.
                    hiddenUnitType: type === 'forgeDepotS' ? 'Sabre' : null,
                    groupId,
                    isEntrance: type === 'forgeDepotS',
                    // Turns the models the same sixth the cells were turned.
                    // The door stays the S PIECE whatever the heading -- it
                    // is which model has the opening, not which way it
                    // happens to point, so capture is unaffected.
                    rotationDeg: depotRotationDeg(turns),
                });
            }
        }
    }
    return { spawns, buildings };
}

// A depot's four pieces have to stand on ONE level platform. A building tile
// keeps its authored height exactly -- GridSystem.smoothHexTile returns early
// for it -- so on random terrain, where neighbouring tiles routinely differ,
// four pieces on four heights meet in steps through the middle of the
// building. Levelled to the HIGHEST of the four, so no piece is left buried.
function levelBuildingPads(tiles: TileLike[][], buildings: BuildingSpawn[]): void {
    const byGroup = new Map<string, BuildingSpawn[]>();
    for (const piece of buildings) {
        if (!piece.groupId) continue;
        byGroup.set(piece.groupId, [...(byGroup.get(piece.groupId) ?? []), piece]);
    }
    for (const pieces of byGroup.values()) {
        const pad = Math.max(...pieces.map((piece) => tiles[piece.q][piece.r].height));
        for (const piece of pieces) tiles[piece.q][piece.r].height = pad;
    }
}

function createRandomMap(
    key: string, name: string, size: number, roster: readonly string[], baseCount: number
): MapProvider {
    // Where everything ended up on the map generate() last produced. Both
    // callers -- GameState and the headless harness -- generate the map and
    // THEN read spawns and buildings, in that order, so this is always fresh
    // by the time anyone asks. Computed once, because spawns and bases have
    // to agree about which hexes are already claimed.
    //
    // Before any generate() there is no terrain to consult. The start menu
    // does read spawns then, to show how many units a side gets, and the
    // roster length is right even when the coordinates are placeholders.
    let placed = placeEverything([], size, size, roster, baseCount);

    return {
        key,
        name,
        rows: size,
        cols: size,
        randomRoads: 10,

        get spawns() {
            return placed.spawns;
        },

        get buildings() {
            return placed.buildings;
        },

        generate(): TileLike[][] {
            // THE SEED. perlinNoise has a fixed permutation table, so
            // sampling at fixed coordinates produced the same board on
            // every load -- "random" meant one map with random jitter. A
            // random offset into the infinite noise field per generate()
            // is the seed: every load is a different crop of the
            // landscape. Math.random is right here and wrong in the
            // simulation, same as the height jitter below: this is the
            // one real board, rolled once.
            const offsetQ = Math.random() * 4096;
            const offsetR = Math.random() * 4096;
            const tiles: TileLike[][] = [];
            for (let q = 0; q < this.cols; q++) {
                tiles[q] = [];
                for (let r = 0; r < this.rows; r++) {
                    const rawNoise = perlinNoise((q + offsetQ) / TERRAIN_CONFIG.PERLIN_SCALE, (r + offsetR) / TERRAIN_CONFIG.PERLIN_SCALE);
                    const noiseValue = (rawNoise + 1) / 2;

                    const terrainType = TerrainSystem.getTerrainTypeFromNoise(noiseValue);
                    const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                    const heightVariation = Math.random() * TerrainSystem.getTerrainHeightVariation(terrainType);

                    let height: number;
                    if (terrainType === 'WATER') {
                        height = baseHeight;
                    } else {
                        height =
                            baseHeight +
                            noiseValue * TERRAIN_CONFIG.HEIGHT_SCALE +
                            heightVariation -
                            TERRAIN_CONFIG.VALLEY_OFFSET;
                    }

                    const color = TerrainSystem.getLerpedTerrainColor(noiseValue);
                    tiles[q][r] = new Tile(height, terrainType, color);
                }
            }
            placed = placeEverything(tiles, size, size, roster, baseCount);
            levelBuildingPads(tiles, placed.buildings);
            return tiles;
        },
    };
}

//                                    key         name               size  units  bases
export const randomSmallMapProvider = createRandomMap('random20', 'Random — Small', 20, SMALL_ROSTER, 2);
export const randomMediumMapProvider = createRandomMap('random30', 'Random — Medium', 30, MEDIUM_ROSTER, 3);
export const randomLargeMapProvider = createRandomMap('random50', 'Random — Large', 50, LARGE_ROSTER, 7);

// The old name, so nothing that imported it has to change. It is the 50x50
// map that key has always meant.
export const perlinMapProvider = randomLargeMapProvider;
