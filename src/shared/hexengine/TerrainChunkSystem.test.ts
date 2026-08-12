import { describe, expect, it } from 'vitest';
import { terrainChunkMath } from './TerrainChunkSystem';

describe('terrain chunk coordinates', () => {
    it('keeps five tile coordinates together', () => {
        expect(terrainChunkMath.chunkId(0, 0)).toBe('0:0');
        expect(terrainChunkMath.chunkId(4, 4)).toBe('0:0');
        expect(terrainChunkMath.chunkId(5, 4)).toBe('1:0');
        expect(terrainChunkMath.chunkId(4, 5)).toBe('0:1');
    });

    it('uses floor semantics at negative coordinates', () => {
        expect(terrainChunkMath.chunkCoordinate(-1)).toBe(-1);
        expect(terrainChunkMath.chunkCoordinate(-5)).toBe(-1);
        expect(terrainChunkMath.chunkCoordinate(-6)).toBe(-2);
    });
});
