import '../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { hash, getVertexOffset, getVertexOffsets, clamp } from './utils';

describe('clamp', () => {
    it('passes values within range through unchanged', () => {
        expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps below the minimum', () => {
        expect(clamp(-3, 0, 10)).toBe(0);
    });

    it('clamps above the maximum', () => {
        expect(clamp(15, 0, 10)).toBe(10);
    });
});

describe('hash', () => {
    it('is deterministic for the same seed', () => {
        expect(hash(42)).toBe(hash(42));
    });

    it('produces different output for different seeds (no obvious collisions nearby)', () => {
        const outputs = new Set([0, 1, 2, 3, 4].map(hash));
        expect(outputs.size).toBe(5);
    });
});

describe('getVertexOffset', () => {
    it('always returns 0 (lateral offsets are intentionally disabled -- see comment in source)', () => {
        // Battle Isle's original smoothing kept top vertices aligned by
        // multiplying the offset by 0; getVertexOffset preserves that.
        // (toBeCloseTo rather than toBe: the `* 0.0` can yield -0, which
        // fails Object.is-based equality against +0 despite `-0 === 0`.)
        [0, 1, 100, -50].forEach((seed) => {
            expect(getVertexOffset(seed)).toBeCloseTo(0);
        });
    });
});

describe('getVertexOffsets', () => {
    it('returns an {x, z} pair, both 0 given getVertexOffset always returns 0', () => {
        const { x, z } = getVertexOffsets(7);
        expect(x).toBeCloseTo(0);
        expect(z).toBeCloseTo(0);
    });
});
