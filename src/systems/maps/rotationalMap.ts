import * as TerrainSystem from '../../shared/hexengine/terrainStats';
import { hash } from '../../shared/hexengine/utils';
import { distanceField, shoreFactor, symmetricRelief } from '../../shared/hexengine/terrainRelief';
import { Tile, type MapProvider } from './MapProvider';

const TERRAIN: Record<string, string> = {
    G: 'GRASS', F: 'FOREST', S: 'SAND', W: 'WATER', M: 'MOUNTAIN',
};

interface RotationalMap {
    key: string;
    name: string;
    cols: number;
    rows: number;
    northLayout: readonly string[];
    northRoads: readonly (readonly [number, number])[];
    roster: readonly { type: string; q: number }[];
    buildings: NonNullable<MapProvider['buildings']>;
    mountainBulk?: number;
    flatTiles?: ReadonlySet<string>;
    // Called at generation time: terrain/render dependencies must not be
    // read while mapRegistry is still evaluating. Keys are tile coordinates.
    pads?: (terrainAt: (q: number, r: number) => string) => ReadonlyMap<string, number>;
}

// Odd-q grids require an even column count for a half turn to preserve
// adjacency. A north/south reflection would silently change movement costs.
export function createRotationalMap(options: RotationalMap): MapProvider {
    const { key, name, cols, rows, northLayout, northRoads, roster, buildings } = options;
    if (cols % 2 || northLayout.length !== rows / 2) throw new Error(`${key}: invalid half-turn dimensions`);
    for (const row of northLayout) {
        if (row.length !== cols || [...row].some((ch) => !TERRAIN[ch])) {
            throw new Error(`${key}: invalid terrain row "${row}"`);
        }
    }
    const source = (q: number, r: number) => r < rows / 2 ? [q, r] : [cols - 1 - q, rows - 1 - r];
    const terrainAt = (q: number, r: number) => {
        const [sq, sr] = source(q, r);
        return TERRAIN[northLayout[sr][sq]];
    };
    const roads = new Set<string>();
    for (const [q, r] of northRoads) {
        roads.add(`${q},${r}`);
        roads.add(`${cols - 1 - q},${rows - 1 - r}`);
    }
    return {
        key, name, cols, rows, buildings, randomRoads: 0,
        spawns: {
            cpu: roster.map(({ type, q }) => ({ type, q, r: 0 })),
            player: roster.map(({ type, q }) => ({ type, q: cols - 1 - q, r: rows - 1 })),
        },
        generate() {
            const water = TerrainSystem.getTerrainBaseHeight('WATER');
            const fromWater = distanceField(cols, rows, (q, r) => terrainAt(q, r) === 'WATER');
            const pads = options.pads?.(terrainAt);
            return Array.from({ length: cols }, (_, q) => Array.from({ length: rows }, (_, r) => {
                const [sq, sr] = source(q, r);
                const type = TERRAIN[northLayout[sr][sq]];
                const cell = `${q},${r}`;
                const base = TerrainSystem.getTerrainBaseHeight(type);
                const relief = symmetricRelief(q, r, cols, rows);
                const variation = TerrainSystem.getTerrainHeightVariation(type);
                const texture = options.flatTiles?.has(cell) ? 0 : (hash(sq * 131 + sr * 31) & 0xff) / 255;
                let height = pads?.get(cell);
                if (type === 'WATER') height = base;
                else if (height === undefined) {
                    if (type === 'MOUNTAIN') {
                        // Peaks follow the relief, without flattening cliffs at the shore.
                        const bulk = ((relief + 1) / 2) * 0.7 + texture * 0.3;
                        height = base + relief * 0.55 + bulk * variation * (options.mountainBulk ?? 1);
                    } else {
                        height = base + relief * 0.55 + texture * variation * 0.35;
                        height = water + (height - water) * shoreFactor(fromWater[q][r], 3);
                        height = Math.max(water + 0.1, height);
                    }
                }
                const tile = new Tile(height, type, TerrainSystem.getTerrainColor(type));
                tile.hasRoad = roads.has(cell) && type !== 'WATER' && type !== 'MOUNTAIN';
                return tile;
            }));
        },
    };
}
