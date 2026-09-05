// Deterministic 12x18 competitive map with 180-DEGREE ROTATIONAL symmetry.
//
// The northern half (rows 0..8) is authored below; the southern half is
// that half rotated half a turn about the map's centre, so tile (q, r)
// equals tile (COLS-1-q, ROWS-1-r). That is NOT a mirror: a mirrored map
// puts the same feature directly across from itself, which is instantly
// readable as a reflection. Under rotation each feature reappears
// diagonally opposite instead, so the map reads as asymmetric while both
// sides still face byte-identical terrain, identical distances and
// identical cover.
//
// The authored half is deliberately NOT left/right symmetric either --
// were it, the rotation would coincide with a reflection and the whole
// point would be lost. Lakes, ridge and forest sit off-centre.
//
// Heights come from a coherent relief field (see terrainRelief.ts) rather
// than a per-tile hash, plus a shore ramp that slopes the ground into the
// lakes instead of leaving it standing a full unit above them. Both are
// pure functions of the cell, so every load still produces the same map --
// no Math.random and no noise library anywhere.
//
// Roads: the two edge columns carry full north-south roads baked as
// tile.hasRoad (randomRoads: 0). Column 0 rotates onto column 11, so the
// pair is symmetric under the same transform as everything else.

import * as TerrainSystem from '../../shared/hexengine/terrainStats';
import { symmetricRelief } from '../../shared/hexengine/terrainRelief';
import { createRotationalMap } from './rotationalMap';
import type { BuildingSpawn } from '../../types';

const ROWS = 18;
const COLS = 12;

// Northern half, rows 0 (top / CPU spawn row) through 8.
// G = grass, F = forest, S = sand, W = water, M = mountain.
//              q: 012345678901
const NORTH_LAYOUT = [
    'GGGGGGGGGGGG', // r0: CPU spawn row -- open grass, no cover to camp in
    'GGFFGGGGFGGG', // r1: light forest, weighted left
    'GSWWGGGSFGGG', // r2: west lake begins; a forest shoulder east
    'GSWWSGGWWSGG', // r3: west lake body, east lake begins
    'GGSSGGMWWSGG', // r4: ridge toe meets the east lake
    'GGGGGMMGSSGG', // r5: central ridge, offset west of centre
    'GFGGGMGGGGFG', // r6: ridge tail; factory sits at q3 on open ground
    'GFFGGGGFFGGG', // r7: forest belt with a gap at q5/q6
    'GGGGGSSGGGGG', // r8: sand saddle at the waist of the map
];

// Roads, authored for the northern half only; the southern half gets the
// half-turn image of it, so the network maps onto itself exactly like the
// terrain and neither side gets the better route.
//
// Two arteries rather than two straight edge columns: a western one that
// runs down past the lake and bends east to pass the factory, and an
// eastern one that bends west through the forest belt. They meet on a
// lateral road along the waist, which the rotated copy joins one row
// further down -- so the middle of the map is a crossroads worth holding
// rather than two lanes that never touch.
const NORTH_ROADS: Array<[number, number]> = [
    // Western artery, down the flank of the lake...
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
    // ...bending east onto the cross street, which runs the width of the
    // map past the factory at (3, 6).
    [2, 6], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7],
    // Eastern artery, straight down and then west onto the same street.
    [10, 0], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [9, 7],
    // The single tile that crosses the waist. Its half-turn image is
    // (6, 9), which is a NEIGHBOUR of it -- so one authored tile per side
    // is enough to join the two halves into one network, without the two
    // copies landing side by side and rendering as a slab.
    [5, 8],
];

// Same roster as the 8x8 map: the full rock/paper/scissors triangle --
// tank (Bulwark) beats AA (Halberd) beats air (Nightjar) beats tank --
// plus artillery (Kestrel) and the only capturing class (Pike).
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Bulwark', q: 3 },
    { type: 'Kestrel', q: 4 },
    { type: 'Halberd', q: 6 },
    { type: 'Nightjar', q: 7 },
    { type: 'Pike', q: 8 },
];

// One neutral forge depot per half. The depot is FOUR pieces on four
// adjacent hexes, and the pieces are named for where they sit: viewed from
// above with north up, the N piece is capped by edge trim along its NW, N
// and NE edges and left open toward SW, S and SE, while E is capped to the
// east and open toward NW and SW. So they form a DIAMOND -- N on top, W
// and E either side, S below -- which is the only arrangement where every
// open edge meets another piece and no trim ends up buried inside.
//
// The anchor is the N piece and its column must be EVEN, because that is
// the parity for which SW/S/SE are (q-1, r), (q, r+1) and (q+1, r).
const DEPOT_ANCHOR = { q: 8, r: 5 };

// The southern depot is the northern one turned half a turn, pieces and
// all: same cells under the map's rotation, each model spun 180 degrees so
// its joining edges still face inward. Only the N piece holds the prize,
// so a depot still yields exactly one Sabre however it is taken.
//
// All four pieces share a groupId, which makes them ONE building for
// ownership: taking the depot takes all four and retints all four. Without
// it each piece is captured separately and a depot can stand in two
// players' colours at once.
//
// The S piece is the DOOR, and the only way in. The other three are back
// and side walls -- walking onto them does nothing, so a depot has an
// approach that can be defended rather than four equivalent ones. The
// prize lives behind that door for the same reason.
const depotAt = (anchorQ: number, anchorR: number, rotationDeg: number): BuildingSpawn[] => {
    const cells: Array<[BuildingSpawn['type'], number, number]> = [
        ['forgeDepotN', anchorQ, anchorR],
        ['forgeDepotW', anchorQ - 1, anchorR],
        ['forgeDepotE', anchorQ + 1, anchorR],
        ['forgeDepotS', anchorQ, anchorR + 1],
    ];
    const groupId = `forgeDepot@${anchorQ},${anchorR}/${rotationDeg}`;
    return cells.map(([type, q, r]) => ({
        type,
        q: rotationDeg ? COLS - 1 - q : q,
        r: rotationDeg ? ROWS - 1 - r : r,
        hiddenUnitType: type === 'forgeDepotS' ? 'Sabre' : null,
        groupId,
        isEntrance: type === 'forgeDepotS',
        rotationDeg,
    }));
};

const FACTORIES: BuildingSpawn[] = [
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 0),
    ...depotAt(DEPOT_ANCHOR.q, DEPOT_ANCHOR.r, 180),
];

// A depot's four pieces have to sit on ONE level platform, or they meet in
// steps -- a building tile keeps its authored height exactly, because
// smoothHexTile returns early for it, so whatever is authored here is what
// the pieces stand on.
//
// They did NOT sit on one platform. Each cell took its own terrain's base
// height, and the northern depot straddles a boundary: its W and S pieces
// stand on grass at 0.9 while N and E stand on sand at 0.7. That is a 0.2
// step straight through the middle of the building, which is the thing the
// comment above was written to prevent.
//
// So the pad is computed ONCE per depot and shared by all four pieces:
// the highest base height in the group -- max, so no piece is left buried
// -- lifted onto the relief at the group's anchor. Only the anchor is
// sampled, and the two depots' anchors are each other's image under the
// map's rotation, so the two pads are identical by construction.
// groupId -> the one height every piece of that depot stands on. Computed
// ONCE PER DEPOT and not per tile: sampling the relief separately for each
// piece is exactly how four pieces end up at four heights.
//
// Called from generate(), never at module load. TerrainSystem reaches
// BuildingSystem, which reaches mapRegistry, which reaches back here -- so
// touching it while this module is still evaluating finds it undefined.
function depotPadHeights(terrainAt: (q: number, r: number) => string): Map<string, number> {
    const pads = new Map<string, number>();
    // The highest base height in the group, so no piece is left buried.
    for (const piece of FACTORIES) {
        const group = piece.groupId!;
        const base = TerrainSystem.getTerrainBaseHeight(terrainAt(piece.q, piece.r));
        pads.set(group, Math.max(pads.get(group) ?? 0, base));
    }
    // Then lifted onto the relief at the group's anchor -- the N piece. The
    // two depots' anchors are each other's image under the map's rotation
    // and symmetricRelief is exact there, so the two pads come out bit for
    // bit the same.
    for (const piece of FACTORIES) {
        if (piece.type !== 'forgeDepotN') continue;
        const relief = symmetricRelief(piece.q, piece.r, COLS, ROWS);
        pads.set(piece.groupId!, pads.get(piece.groupId!)! + relief * 0.55);
    }
    return new Map(FACTORIES.map((piece) => [
        `${piece.q},${piece.r}`, pads.get(piece.groupId!)!,
    ]));
}

export const rotor12x18MapProvider = createRotationalMap({
    key: 'rotor12x18',
    name: 'Half Turn (12x18)',
    rows: ROWS,
    cols: COLS,
    northLayout: NORTH_LAYOUT,
    northRoads: NORTH_ROADS,
    roster: ROSTER,
    buildings: FACTORIES,
    pads: depotPadHeights,
});
