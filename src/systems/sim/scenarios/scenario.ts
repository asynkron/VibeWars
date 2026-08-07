// Tiny authored boards for tactical questions with a known right answer.
//
// A scenario is an ASCII picture plus a legend: terrain characters make
// tiles, legend characters drop units on grass. The picture IS the
// documentation -- a reviewer should be able to read the board and the
// question straight out of the test file. The result feeds
// runHeadlessMatch unchanged, so a scenario gets the whole match loop --
// turn resets, victory, stalemate-on-points, the event digest -- for free.
//
// Terrain characters:
//   .  grass        ~  water        ^  mountain        ,  sand
//   #  forest (vegetated: this is the tile fire can catch on)
//   anything in the legend: a unit standing on grass, unless its legend
//   entry names a `ground` character to stand on instead
//
// Row index is r, column index is q -- exactly how the pictures read.
// Remember the grid is odd-q offset: a single unbroken row of water DOES
// seal the map (every neighbour step changes r by at most 1), which is
// what makes a one-tile crossing a real chokepoint.

import type { StartingUnit } from '../../maps/MapProvider';

export interface ScenarioLegend {
    [character: string]: { type: string; player: 0 | 1; ground?: string };
}

export interface ScenarioMap {
    key: string;
    name: string;
    cols: number;
    rows: number;
    randomRoads: number;
    spawns: { player: StartingUnit[]; cpu: StartingUnit[] };
    buildings: never[];
    generate(): any[][];
}

const TERRAIN: Record<string, { type: string; height: number; moveCost: number }> = {
    '.': { type: 'GRASS', height: 1, moveCost: 1 },
    ',': { type: 'SAND', height: 1, moveCost: 1 },
    '~': { type: 'WATER', height: 0.3, moveCost: Infinity },
    '^': { type: 'MOUNTAIN', height: 2.4, moveCost: Infinity },
    '#': { type: 'FOREST', height: 1.1, moveCost: 2 },
};

export function scenario(name: string, picture: string[], legend: ScenarioLegend): ScenarioMap {
    const rows = picture.length;
    const cols = picture[0].length;
    for (const line of picture) {
        if (line.length !== cols) throw new Error(`scenario "${name}": ragged row "${line}"`);
    }

    const player: StartingUnit[] = [];
    const cpu: StartingUnit[] = [];
    const tiles: any[][] = Array.from({ length: cols }, () => new Array(rows));

    for (let r = 0; r < rows; r++) {
        for (let q = 0; q < cols; q++) {
            const character = picture[r][q];
            const unit = legend[character];
            const ground = TERRAIN[unit ? unit.ground ?? '.' : character];
            if (!ground) throw new Error(`scenario "${name}": unknown character "${character}" at (${q},${r})`);
            tiles[q][r] = {
                height: ground.height,
                type: ground.type,
                hasRoad: false,
                moveCost: ground.moveCost,
                // The one scenario terrain fire can catch on. Mirrors the
                // live rule (hasVegetation: FOREST is always a grove);
                // scenario grass stays bare so boards burn only where the
                // picture says forest.
                vegetated: ground.type === 'FOREST',
                burning: 0,
                burned: false,
            };
            if (unit) (unit.player === 0 ? player : cpu).push({ type: unit.type, q, r });
        }
    }

    return {
        key: `scenario-${name}`,
        name,
        cols,
        rows,
        randomRoads: 0,
        spawns: { player, cpu },
        buildings: [],
        generate: () => tiles,
    };
}
