import { describe, expect, it } from 'vitest';
import { roadChunkMath } from './RoadChunkSystem';

describe('RoadChunkSystem chunk math', () => {
    it('keeps five tile coordinates in each chunk', () => {
        expect(roadChunkMath.chunkId(0, 0)).toBe('0:0');
        expect(roadChunkMath.chunkId(4, 4)).toBe('0:0');
        expect(roadChunkMath.chunkId(5, 0)).toBe('1:0');
    });

    it('uses stable floor-based chunks for negative map coordinates', () => {
        expect(roadChunkMath.chunkId(-1, -1)).toBe('-1:-1');
        expect(roadChunkMath.chunkId(-5, -5)).toBe('-1:-1');
        expect(roadChunkMath.chunkId(-6, 0)).toBe('-2:0');
    });
});
