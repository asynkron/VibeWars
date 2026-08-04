import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { mirror8MapProvider } from './Mirror8MapProvider';

describe('mirror8MapProvider', () => {
    const { rows, cols } = mirror8MapProvider;

    it('is 8x8', () => {
        expect(rows).toBe(8);
        expect(cols).toBe(8);
        const tiles = mirror8MapProvider.generate();
        expect(tiles.length).toBe(cols);
        tiles.forEach((col) => expect(col.length).toBe(rows));
    });

    it('is exactly half-turn symmetric: type, height, and roads', () => {
        // It used to assert a north/south MIRROR, and that was the bug: a
        // vertical mirror is not a symmetry of an odd-q offset hex grid,
        // because which six hexes touch a tile depends on its column's
        // parity. The grid looked mirrored while the adjacency graph was
        // not, and the two sides paid different move costs to the same pair
        // of factories -- 6 against 5 for the contested one. The half turn
        // is a real rotation of the plane, so it is a real isometry.
        const tiles = mirror8MapProvider.generate();
        for (let q = 0; q < cols; q++) {
            for (let r = 0; r < rows; r++) {
                const here = tiles[q][r];
                const across = tiles[cols - 1 - q][rows - 1 - r];
                expect(across.type).toBe(here.type);
                expect(across.height).toBe(here.height);
                expect(across.hasRoad).toBe(here.hasRoad);
            }
        }
    });

    it('is deterministic: two generations are identical', () => {
        const a = mirror8MapProvider.generate();
        const b = mirror8MapProvider.generate();
        for (let q = 0; q < cols; q++) {
            for (let r = 0; r < rows; r++) {
                expect(b[q][r]).toEqual(a[q][r]);
            }
        }
    });

    it('has full-length roads on both edge columns (skipping water)', () => {
        const tiles = mirror8MapProvider.generate();
        for (let r = 0; r < rows; r++) {
            for (const q of [0, cols - 1]) {
                const tile = tiles[q][r];
                expect(tile.hasRoad).toBe(tile.type !== 'WATER');
            }
        }
        // Interior columns carry no authored roads.
        expect(tiles[3].some((t) => t.hasRoad)).toBe(false);
    });

    it('spawns identical rotated rosters on grass back rows', () => {
        const tiles = mirror8MapProvider.generate();
        const { player, cpu } = mirror8MapProvider.spawns;

        expect(player.length).toBe(cpu.length);
        for (let i = 0; i < player.length; i++) {
            // Same type, and each unit is its opposite number's half-turn
            // image: BOTH coordinates flip, so the CPU's columns run the
            // other way.
            expect(cpu[i].type).toBe(player[i].type);
            expect(cpu[i].q).toBe(cols - 1 - player[i].q);
            expect(cpu[i].r).toBe(rows - 1 - player[i].r);
            // Both stand on grass, inside the map.
            expect(tiles[player[i].q][player[i].r].type).toBe('GRASS');
            expect(tiles[cpu[i].q][cpu[i].r].type).toBe('GRASS');
        }

        // No two units share a hex.
        const keys = [...player, ...cpu].map((s) => `${s.q},${s.r}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('roster includes exactly one infantry so factories are capturable', () => {
        const { player, cpu } = mirror8MapProvider.spawns;
        expect(player.filter((s) => s.type === 'Pike').length).toBe(1);
        expect(cpu.filter((s) => s.type === 'Pike').length).toBe(1);
        expect(player.length).toBe(5);
    });

    it('has two rotated neutral factories with the same hidden unit, on sand fords', () => {
        const tiles = mirror8MapProvider.generate();
        const buildings = mirror8MapProvider.buildings!;
        expect(buildings.length).toBe(2);

        const [north, south] = [...buildings].sort((a, b) => a.r - b.r);
        // Each the other's half-turn image, so the column flips too.
        expect(south.q).toBe(cols - 1 - north.q);
        expect(south.r).toBe(rows - 1 - north.r);
        // Same prize on both sides.
        expect(south.hiddenUnitType).toBe(north.hiddenUnitType);
        expect(north.hiddenUnitType).toBe('Sabre');

        for (const b of buildings) {
            expect(b.type).toBe('factory');
            // On the sand ford between the lakes -- passable, contested.
            expect(tiles[b.q][b.r].type).toBe('SAND');
            // Not on top of a spawn.
            const spawnKeys = new Set(
                [...mirror8MapProvider.spawns.player, ...mirror8MapProvider.spawns.cpu].map((s) => `${s.q},${s.r}`),
            );
            expect(spawnKeys.has(`${b.q},${b.r}`)).toBe(false);
        }
    });
});
