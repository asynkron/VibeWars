// The random map: perlin-noise terrain with random height variation and
// random roads added by game.ts.
//
// Three sizes, and THE GENERATOR IS THE SAME ONE IN ALL THREE. generate()
// below uses the same noise, scale, valley offset, height scale and lerped
// colours. A soft negative edge field is applied before the ordinary terrain
// classification so every random board is one island with open water around
// its complete perimeter. The three variants differ only in grid size and
// how many units each side starts with. There is deliberately no second
// terrain generator in here.
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
// whatever board comes out, not for one memorized layout. One additional
// 30x30 provider deliberately supplies a fixed seed to the same generator,
// giving us a permanent, linkable random-map layout for repeated playtests.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { perlinNoise } from '../../shared/hexengine/perlinNoise';
import { TERRAIN_CONFIG } from '../../constants';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { BuildingSpawn, TileLike } from '../../types';
import { DEPOT_TURNS, depotCells, depotRotationDeg } from './depotLayout';
import { cubeRotate60, cubeToHex, hexToCube } from '../../shared/hexengine/hexMath';
import { seededRandom } from '../../shared/seededRandom';

export const FIXED_RANDOM_30_SEED = 0x30c0ffee;

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

const ATTACK_BOAT = 'AttackBoat';

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

// Boats need the same protection from decorative puddles that ground units
// get from mainland(): both fleets are placed in the largest connected body
// of water, so every attack boat has an actual opponent it can sail to.
function mainWaterway(tiles: TileLike[][], cols: number, rows: number): Set<string> {
    const unvisited = new Set<string>();
    for (let q = 0; q < cols; q++) {
        for (let r = 0; r < rows; r++) {
            if (tiles[q]?.[r]?.type === 'WATER') unvisited.add(`${q},${r}`);
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
export function hqCells(q: number, r: number): Array<[number, number]> {
    return [[q, r], ...neighbourOffsets(q).map(([dq, dr]) => [q + dq, r + dr] as [number, number])];
}

// The authored gate is on the south wing. Its usable approach is the next
// hex beyond that wing -- two cube steps south from the centre at rest, then
// turned with the model. This is deliberately outside the seven occupied
// building cells: units drive UP TO the door, not through a wall tile.
export function hqDoorApproach(q: number, r: number, turns: number): [number, number] {
    const anchor = hexToCube(q, r);
    let offset = { x: 0, y: -2, z: 2 };
    const steps = ((turns % 6) + 6) % 6;
    for (let index = 0; index < steps; index++) {
        offset = cubeRotate60(offset.x, offset.y, offset.z);
    }
    const door = cubeToHex(anchor.x + offset.x, anchor.z + offset.z);
    return [door.q, door.r];
}

// The south wing itself carries the gate. Unlike the approach above this is
// one of the seven occupied footprint cells, and is the only one an owning
// ground unit may enter.
export function hqDoorCell(q: number, r: number, turns: number): [number, number] {
    const anchor = hexToCube(q, r);
    let offset = { x: 0, y: -1, z: 1 };
    const steps = ((turns % 6) + 6) % 6;
    for (let index = 0; index < steps; index++) {
        offset = cubeRotate60(offset.x, offset.y, offset.z);
    }
    const door = cubeToHex(anchor.x + offset.x, anchor.z + offset.z);
    return [door.q, door.r];
}

// Buildings turn in exact sixths so their authored hex edges still align
// with the grid. Exported for the six-direction contract test.
export function randomBuildingRotationDeg(random: () => number = Math.random): number {
    const turns = Math.min(DEPOT_TURNS.length - 1, Math.floor(random() * DEPOT_TURNS.length));
    return depotRotationDeg(turns);
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
    tiles: TileLike[][], cols: number, rows: number, roster: readonly string[], baseCount: number,
    attackBoatsPerSide: number, random: () => number = Math.random
): { spawns: { player: StartingUnit[]; cpu: StartingUnit[] }; buildings: BuildingSpawn[] } {
    const open = tiles.length ? mainland(tiles, cols, rows) : new Set<string>();
    const waterway = tiles.length ? mainWaterway(tiles, cols, rows) : new Set<string>();
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
    const hqFitsTurned = (q: number, r: number, turns: number) => {
        const [doorQ, doorR] = hqDoorApproach(q, r, turns);
        return hqCells(q, r).every(([cq, cr]) =>
            cq >= 0 && cq < cols && cr >= 0 && cr < rows && free(cq, cr))
            && doorQ >= 0 && doorQ < cols && doorR >= 0 && doorR < rows
            && free(doorQ, doorR);
    };
    const hqFits = (q: number, r: number) => DEPOT_TURNS.some((turns) => hqFitsTurned(q, r, turns));
    for (const target of hqTargets) {
        const position = open.size
            ? nearestWhere(cols, rows, target.q, target.r, hqFits)
            : [target.q, target.r] as [number, number];
        if (!position) {
            throw new Error(`Random map ${cols}x${rows} has no free mainland hex for player ${target.ownerIndex}'s HQ`);
        }
        const [anchorQ, anchorR] = position;
        const groupId = `hq@player${target.ownerIndex}`;
        const firstTurn = open.size ? randomBuildingRotationDeg(random) / 60 : 0;
        let turns = firstTurn;
        for (let index = 0; index < DEPOT_TURNS.length; index++) {
            const candidate = (firstTurn + index) % DEPOT_TURNS.length;
            if (!open.size || hqFitsTurned(anchorQ, anchorR, candidate)) {
                turns = candidate;
                break;
            }
        }
        const rotationDeg = depotRotationDeg(turns);
        const [entranceQ, entranceR] = hqDoorCell(anchorQ, anchorR, turns);
        for (const [index, [q, r]] of hqCells(anchorQ, anchorR).entries()) {
            taken.add(`${q},${r}`);
            buildings.push({
                type: 'hq', q, r,
                ownerIndex: target.ownerIndex,
                hiddenUnitType: null,
                groupId,
                isEntrance: q === entranceQ && r === entranceR,
                drawnByAnchor: index !== 0,
                rotationDeg,
            });
        }
        // Keep the drive-up clear for subsequent unit and depot placement.
        // Terrain passability was part of hqFitsTurned, so this reserved hex
        // is both connected to the mainland and free of water or mountain.
        const [doorQ, doorR] = hqDoorApproach(anchorQ, anchorR, turns);
        taken.add(`${doorQ},${doorR}`);
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

    // Put both fleets into the same connected body of water, approaching it
    // from their own map edge. This keeps exact 1/2/3-per-side rosters while
    // preventing a boat from spawning alone in a tiny inland pond.
    const fleet = (edgeRow: number): StartingUnit[] => Array.from(
        { length: attackBoatsPerSide },
        (_, index) => {
            const column = Math.floor((cols - attackBoatsPerSide) / 2) + index;
            if (!waterway.size) return { type: ATTACK_BOAT, q: column, r: edgeRow };
            const position = nearestWhere(
                cols, rows, column, edgeRow,
                (q, r) => waterway.has(`${q},${r}`) && !taken.has(`${q},${r}`)
            );
            if (!position) {
                throw new Error(
                    `Random map ${cols}x${rows} has fewer than ${attackBoatsPerSide * 2} connected water hexes`
                );
            }
            const [q, r] = position;
            taken.add(`${q},${r}`);
            return { type: ATTACK_BOAT, q, r };
        }
    );
    spawns.player.push(...fleet(rows - 1));
    spawns.cpu.push(...fleet(0));

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
            // it could not have used. An ordinary random map uses Math.random
            // here; the fixed map passes its seeded generator through the
            // same path. Both are generation-time choices, not simulation.
            const first = Math.floor(random() * DEPOT_TURNS.length);
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

// Pull the Perlin field down toward deep-water noise at the map edge, then
// smoothly release it back to the untouched field toward the interior. The
// exact outer ring is therefore ALWAYS water, while values crossing 0.4 and
// 0.45 on the way inward naturally become the existing water/sand shoreline
// instead of a separately-authored beach band.
export function islandNoiseValue(
    noiseValue: number,
    q: number,
    r: number,
    cols: number,
    rows: number,
): number {
    const edgeDistance = Math.min(q, r, cols - 1 - q, rows - 1 - r);
    const fadeWidth = Math.max(2, Math.round(Math.min(cols, rows) * 0.10));
    const t = Math.max(0, Math.min(1, edgeDistance / fadeWidth));
    const smooth = t * t * (3 - 2 * t);
    const deepWaterNoise = 0.18;
    return deepWaterNoise + (noiseValue - deepWaterNoise) * smooth;
}

function createRandomMap(
    key: string, name: string, size: number, roster: readonly string[], baseCount: number,
    attackBoatsPerSide: number, seed?: number,
    colorGrade?: MapProvider['colorGrade'],
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
    let placed = placeEverything(
        [], size, size, roster, baseCount, attackBoatsPerSide,
        seed === undefined ? Math.random : seededRandom(seed),
    );

    return {
        key,
        name,
        rows: size,
        cols: size,
        randomRoads: 10,
        ...(seed === undefined ? {} : { seed }),
        ...(colorGrade === undefined ? {} : { colorGrade }),

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
            // A seeded provider starts the sequence over on every generate;
            // an ordinary provider deliberately keeps rolling fresh boards.
            const random = seed === undefined ? Math.random : seededRandom(seed);
            const offsetQ = random() * 4096;
            const offsetR = random() * 4096;
            const tiles: TileLike[][] = [];
            for (let q = 0; q < this.cols; q++) {
                tiles[q] = [];
                for (let r = 0; r < this.rows; r++) {
                    const rawNoise = perlinNoise((q + offsetQ) / TERRAIN_CONFIG.PERLIN_SCALE, (r + offsetR) / TERRAIN_CONFIG.PERLIN_SCALE);
                    const perlinValue = (rawNoise + 1) / 2;
                    const noiseValue = islandNoiseValue(
                        perlinValue,
                        q,
                        r,
                        this.cols,
                        this.rows,
                    );

                    const terrainType = TerrainSystem.getTerrainTypeFromNoise(noiseValue);
                    const baseHeight = TerrainSystem.getTerrainBaseHeight(terrainType);
                    const heightVariation = random() * TerrainSystem.getTerrainHeightVariation(terrainType);

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

                    const color = TerrainSystem.getLerpedTerrainColor(noiseValue, random);
                    tiles[q][r] = new Tile(height, terrainType, color);
                }
            }
            placed = placeEverything(tiles, size, size, roster, baseCount, attackBoatsPerSide, random);
            levelBuildingPads(tiles, placed.buildings);
            return tiles;
        },
    };
}

//                                    key         name               size  ground roster  bases  boats/side
export const randomSmallMapProvider = createRandomMap('random20', 'Random — Small', 20, SMALL_ROSTER, 2, 1);
export const randomMediumMapProvider = createRandomMap('random30', 'Random — Medium', 30, MEDIUM_ROSTER, 3, 2);
export const fixedRandomMediumMapProvider = createRandomMap(
    'random30fixed',
    'Random — Medium · Fixed seed',
    30,
    [],
    3,
    0,
    FIXED_RANDOM_30_SEED,
    {
        // Intentionally neutral. Material-specific View 1 calibration is
        // measured from aligned water/grass/forest/beach crops; a global
        // scene grade must not hide one material getting worse behind gains
        // elsewhere.
        exposure: 1,
        contrast: 1,
        saturation: 1,
        gamma: 1,
        balance: [1, 1, 1],
    },
);
export const randomLargeMapProvider = createRandomMap('random50', 'Random — Large', 50, LARGE_ROSTER, 7, 3);

// The old name, so nothing that imported it has to change. It is the 50x50
// map that key has always meant.
export const perlinMapProvider = randomLargeMapProvider;
