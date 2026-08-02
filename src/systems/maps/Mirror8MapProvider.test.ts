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

    it('is exactly north/south mirrored: type, height, and roads', () => {
        const tiles = mirror8MapProvider.generate();
        for (let q = 0; q < cols; q++) {
            for (let r = 0; r < rows / 2; r++) {
                const north = tiles[q][r];
                const south = tiles[q][rows - 1 - r];
                expect(south.type).toBe(north.type);
                expect(south.height).toBe(north.height);
                expect(south.hasRoad).toBe(north.hasRoad);
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

    it('spawns identical mirrored rosters on grass back rows', () => {
        const tiles = mirror8MapProvider.generate();
        const { player, cpu } = mirror8MapProvider.spawns;

        expect(player.length).toBe(cpu.length);
        for (let i = 0; i < player.length; i++) {
            // Same type, same column, mirrored row.
            expect(cpu[i].type).toBe(player[i].type);
            expect(cpu[i].q).toBe(player[i].q);
            expect(cpu[i].r).toBe(rows - 1 - player[i].r);
            // Both stand on grass, inside the map.
            expect(tiles[player[i].q][player[i].r].type).toBe('GRASS');
            expect(tiles[cpu[i].q][cpu[i].r].type).toBe('GRASS');
        }

        // No two units share a hex.
        const keys = [...player, ...cpu].map((s) => `${s.q},${s.r}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
