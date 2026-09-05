// Deterministic 14x14 competitive map with 180-DEGREE ROTATIONAL symmetry.
//
// The northern half (rows 0..6) is authored below; the southern half is that
// half turned half a turn about the map's centre, so tile (q, r) equals tile
// (COLS-1-q, ROWS-1-r). A north/south MIRROR is not an option and never was:
// odd columns are pushed half a row down, so flipping r without flipping
// column parity maps every tile onto a neighbourhood shaped the other way.
// The picture mirrors; the adjacency graph does not. The half turn is a real
// isometry of an odd-q grid whenever COLS is EVEN -- q -> COLS-1-q flips
// column parity, which is exactly what converts an even-q neighbour offset
// into the matching odd-q one. 14 is even. Do not change it.
//
// The authored half is deliberately NOT left/right symmetric: were every row
// a palindrome the rotation would coincide with a reflection, the map would
// satisfy both transforms at once, and the whole point of rotating would be
// lost. The lakes, the forest and the crown itself all sit off-centre.
//
// ---------------------------------------------------------------------
// THE CROWN
// ---------------------------------------------------------------------
// The middle of the map is a mountain massif, 18 tiles, 1-3-5-5-3-1 deep
// across columns 4..9 and the same across rows 4..9 -- a dome, staggered
// south-east because the half turn stacks r6's mountains at q4..q8 on top of
// r7's at q5..q9. MOUNTAIN is impassable to Bulwark, Kestrel and Halberd. It
// is NOT impassable to Pike (cost 2) or to Nightjar (cost 1). So the massif
// is not a wall, it is a filter: the ground army has to go round it, the
// infantry can walk over it, and the aircraft ignores it entirely. That
// asymmetry between what your own units can do is the map.
//
// The crown leaves exactly two ground lanes, and they are staggered rather
// than opposite. At the waist row 6 the west lane is q0..q3 and the east is
// q9..q13; one row further down at r7 the west lane has widened to q0..q4
// and the east has narrowed to q10..q13. Four to five hexes each, with a
// forest tile in both -- wide enough to fight in and lose a unit without the
// fight being decided by who entered the corridor first.
//
// ---------------------------------------------------------------------
// THE PRIZE, AND WHY GOING ROUND IS A DECISION
// ---------------------------------------------------------------------
// One factory per half, tucked into a nook of the massif: (4,5) sits with
// two mountain neighbours at its back, and its half-turn image (9,8) sits in
// the mirror-image nook on the far side. Each factory holds a hidden Sabre.
//
// A factory in a nook has a MOUNTAIN DOOR. The crown is only one tile deep
// at its western toe, so a Pike standing on (4,7) in the southern lane steps
// onto (4,6) -- mountain, cost 2 -- and off it straight onto the northern
// factory, bypassing the whole western flank. The east has the same door:
// (9,6) -> (9,7) -> (9,8). Nobody else in the roster can use either. So your
// own prize is permanently exposed to one infantryman coming over the ridge,
// and the ground you must hold to stop that is ground your tanks cannot
// stand on. Cover it with the Halberd or shell the ridge with the Kestrel.
//
// ---------------------------------------------------------------------
// LAKES
// ---------------------------------------------------------------------
// Two lakes in the authored half, different shapes and both off-centre, so
// the four they become do not read as a reflection. The western one (q2/q3
// at r2/r3) splits the west flank into a two-hex coast road and the open
// plain behind it. The eastern one (q8/q9 at r3, q9/q10 at r4) does
// something sharper: it pinches the ground between itself and the crown down
// to a two-hex GATE at (7,4)/(8,4), which then runs on down the massif's
// shoulder through (8,5), (9,5), (9,6) into the east lane. That gate is the
// short way past the crown and it is one Kestrel bracket wide.
//
// ---------------------------------------------------------------------
// ROADS
// ---------------------------------------------------------------------
// Authored for the northern half only; the half-turn image is added at
// module load, so the network maps onto itself exactly like the terrain and
// neither side gets the better route. Roads cost 0.5 for EVERY unit -- the
// game checks hasRoad before the unit's own terrainCosts -- which is why the
// guard below excludes MOUNTAIN as well as WATER. A road laid on a mountain
// would quietly open the crown to tanks, and the shared fairness battery
// only checks water.
//
// Four pieces:
//   * Both edge columns, q1 and q12, carry a road the full height of the
//     map. Only half of each is authored: q1 rows 0..6 rotate onto q12 rows
//     7..13, and q12 rows 0..6 onto q1 rows 7..13. The two halves meet
//     because (12,6) and (12,7) are neighbours, and so are (1,6) and (1,7).
//   * A street along r1 from q2 to q7, which is the CPU's lateral behind its
//     own spawn row; its image is the player's along r12.
//   * The GATE LANE: (7,2) (7,3) (7,4) (8,5) (9,5) (9,6), paving the pinch
//     between the eastern lake and the crown. Its image paves the mirror
//     pinch in the south-west. So each side gets one private paved lane down
//     the massif's shoulder -- and each lane arrives beside the ENEMY's
//     factory, not its own. The flank you must defend is the flank your
//     prize is on.
//   * (2,6) (3,6) join the west artery to the waist, and (3,5) is the last
//     step to the northern factory's door. Its image (10,8) is the last step
//     to the southern one's.
//
// Measured with the capturing class, roads included: 4.5 to your own
// factory, 7.0 to the far one, identical for both sides. Without the roads
// the same walk is 8 and 13.
//
// EVERYTHING HERE IS DETERMINISTIC. Heights come from the coherent relief
// field, symmetrised so the two halves agree bit for bit, plus a shore ramp
// and a source-seeded texture hash. No Math.random, no Date, no module-level
// mutable state -- the map is the same on every load, in the browser and in
// the headless simulation, which is what makes it a competitive map.

import { createRotationalMap } from './rotationalMap';
import type { BuildingSpawn } from '../../types';

const ROWS = 14;
const COLS = 14;

// Northern half, rows 0 (top / CPU spawn row) through 6.
// G = grass, F = forest, S = sand, W = water, M = mountain.
//                q: 01234567890123
const NORTH_LAYOUT = [
    'GGGGGGGGGGGGGG', // r0: CPU spawn row -- open grass, no cover to camp in
    'GGFFGGGGGFGGFG', // r1: forest pockets, weighted west; the lateral street
    'GSWWSGGGGFFGGG', // r2: west lake begins; forest shoulder over the gate
    'GSWWSGGGWWSGGG', // r3: west lake body, east lake begins, plain between
    'GGSGGFMGSWWSGG', // r4: crown's toe at q6; the gate is q7/q8
    'GGGFSMMMGGFGGG', // r5: crown widens; the factory nook is q4
    'GGFSMMMMMSGFGG', // r6: the waist -- lanes are q0..q3 and q9..q13
];

const ROTATE_Q = (q: number) => COLS - 1 - q;

const NORTH_ROADS: Array<[number, number]> = [
    // West artery, the full flank; its image is the eastern half of q12.
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
    // East artery, likewise.
    [12, 0], [12, 1], [12, 2], [12, 3], [12, 4], [12, 5], [12, 6],
    // The lateral behind the CPU's line, joining the two arteries to the
    // head of the gate lane at (7,1).
    [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
    // The gate lane: down the pinch between the eastern lake and the crown,
    // out onto the eastern flank at the waist. Fast, and one Kestrel
    // bracket wide the whole way.
    [7, 2], [7, 3], [7, 4], [8, 5], [9, 5], [9, 6],
    // West waist link -- (2,6) and (3,6) tie the west artery to (4,7), which
    // is where the rotated gate lane comes out -- and (3,5), the last step
    // to the factory door at (4,5). No road ON the factory: a building tile
    // is exempt from smoothing, so a road under one silently vanishes.
    [2, 6], [3, 6], [3, 5],
];

// The full rock/paper/scissors triangle -- tank (Bulwark) beats AA (Halberd)
// beats air (Nightjar) beats tank -- plus artillery (Kestrel) and the only
// capturing class (Pike).
//
// The order along the back row is not arbitrary. The Bulwark starts on the
// road artery, because the open flank is its ground. The Pike starts at q4,
// the column its own factory's nook stands in, so the shortest thing it can
// do on turn one is walk toward the prize only it can take. The Nightjar
// starts over the eastern approach, where the massif it can ignore is
// widest.
const ROSTER: Array<{ type: string; q: number }> = [
    { type: 'Bulwark', q: 1 },
    { type: 'Pike', q: 4 },
    { type: 'Kestrel', q: 6 },
    { type: 'Nightjar', q: 9 },
    { type: 'Halberd', q: 11 },
];

// One neutral factory per half, each the other's half-turn image, both
// holding the same hidden unit so neither side gets a content advantage.
// (4,5) is the sand nook on the crown's western shoulder: two of its six
// neighbours are mountain, and one of those two -- (4,6) -- is the whole
// depth of the massif at that column, so it is a door for a Pike and for
// nothing else. Four free neighbours remain for the Sabre to appear on.
const FACTORY_ANCHOR = { q: 4, r: 5 };
const FACTORIES: BuildingSpawn[] = [
    {
        type: 'factory',
        q: FACTORY_ANCHOR.q,
        r: FACTORY_ANCHOR.r,
        hiddenUnitType: 'Sabre',
    },
    {
        type: 'factory',
        q: ROTATE_Q(FACTORY_ANCHOR.q),
        r: ROWS - 1 - FACTORY_ANCHOR.r,
        hiddenUnitType: 'Sabre',
    },
];

export const crown14MapProvider = createRotationalMap({
    key: 'crown14',
    name: 'Crown (14x14)',
    rows: ROWS,
    cols: COLS,
    northLayout: NORTH_LAYOUT,
    northRoads: NORTH_ROADS,
    roster: ROSTER,
    buildings: FACTORIES,
});
