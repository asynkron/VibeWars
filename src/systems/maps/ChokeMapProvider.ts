// THE WATER CHOKE, as a real playable map. A river seals the board except
// for one crossing; south of it a Kloss and a Pyramid, north of it a Boll.
// The right play is a formation: the block STANDS ON the crossing, the
// glass cannon stands exactly two behind it and shells the only hex the
// ball can threaten from. Held, the weaker army wins the long game;
// broken once, the ball walks through and deletes the Pyramid.
//
// This is a SCENARIO map -- deliberately asymmetric, so it is registered
// in SCENARIO_PROVIDERS and never in AUTHORED_PROVIDERS, whose fairness
// battery would (correctly) reject it. It exists to make the AI's
// tactical homework visible in the real game: same board, same units,
// same engine as systems/sim/scenarios/waterChoke.test.ts, which imports
// the picture below so the two can never drift apart.
//
// In human-vs-cpu the human holds the south side: two units, one right
// answer, an AI that punishes the wrong one.

import { TerrainSystem } from '../../shared/hexengine/TerrainSystem';
import { MapProvider, StartingUnit, Tile } from './MapProvider';
import type { TileLike } from '../../types';

// The board as a picture. '~' water, '.' grass; letters are units standing
// on grass. Row index is r, column index is q.
// The distances ARE the design: Boll (move 4) spawns five from the
// crossing, so its best first turn ends on the hex in FRONT of the door
// and it cannot be across before turn three -- while Kloss (two away,
// move 2) can stand on the door on turn zero and Pyramid is posted two
// behind by turn two. The defence always CAN be there first; the
// scenario asks whether it IS.
export const CHOKE_PICTURE: string[] = [
    '...B...',
    '.......',
    '.......',
    '.......',
    '.......',
    '~~~.~~~',
    '.......',
    '...K...',
    '.......',
    '...A...',
];

export const CHOKE_LEGEND: Record<string, { type: string; player: 0 | 1 }> = {
    K: { type: 'Kloss', player: 0 },
    A: { type: 'Pyramid', player: 0 },
    B: { type: 'Boll', player: 1 },
};

const ROWS = CHOKE_PICTURE.length;
const COLS = CHOKE_PICTURE[0].length;

function providerFrom(key: string, name: string, picture: string[], legend: Record<string, { type: string; player: 0 | 1 }>): MapProvider {
    const rows = picture.length;
    const cols = picture[0].length;
    const spawnsFor = (player: 0 | 1): StartingUnit[] => {
        const spawns: StartingUnit[] = [];
        for (let r = 0; r < rows; r++) {
            for (let q = 0; q < cols; q++) {
                const unit = legend[picture[r][q]];
                if (unit && unit.player === player) spawns.push({ type: unit.type, q, r });
            }
        }
        return spawns;
    };
    return {
        key,
        name,
        rows,
        cols,
        randomRoads: 0,
        buildings: [],
        spawns: { player: spawnsFor(0), cpu: spawnsFor(1) },
        generate(): TileLike[][] {
            const tiles: TileLike[][] = [];
            for (let q = 0; q < cols; q++) {
                tiles[q] = [];
                for (let r = 0; r < rows; r++) {
                    const terrainType = picture[r][q] === '~' ? 'WATER' : 'GRASS';
                    const height = TerrainSystem.getTerrainBaseHeight(terrainType)
                        + (terrainType === 'WATER' ? 0 : 0.1);
                    tiles[q][r] = new Tile(height, terrainType, TerrainSystem.getTerrainColor(terrainType));
                }
            }
            return tiles;
        },
    };
}

export const chokeMapProvider: MapProvider = providerFrom(
    'choke', 'Vattenchoken (7x10)', CHOKE_PICTURE, CHOKE_LEGEND);

// THE RETREAT. Same board, same three units -- but the Kloss starts on the
// WRONG side of the river, up near the Boll. Standing and fighting is a
// slow loss (the Boll kills it in five turns; it needs fourteen back), so
// the only right line is the ugly-looking one: walk AWAY from the enemy,
// back through the door, and stop ON it. Two extra cruelties make it a
// real exam: the crossing's only northern neighbour is the corridor, so
// the Kloss claims it by simply retreating through -- and every step of
// the retreat is taken under fire. A test of purposeful withdrawal, which
// is exactly the move an aggression gradient hates.
export const RETREAT_PICTURE: string[] = [
    '...B...',
    '.......',
    '...K...',
    '.......',
    '.......',
    '~~~.~~~',
    '.......',
    '.......',
    '.......',
    '...A...',
];

export const chokeRetreatMapProvider: MapProvider = providerFrom(
    'chokeRetreat', 'Reträtten (7x10)', RETREAT_PICTURE, CHOKE_LEGEND);
