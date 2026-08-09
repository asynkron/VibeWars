import { describe, expect, it } from 'vitest';
import { rockRotationForTile } from './ProceduralDecorations';

describe('rockRotationForTile', () => {
    it('is deterministic and stays within one full turn', () => {
        const rotation = rockRotationForTile(7, -3, 1);
        expect(rockRotationForTile(7, -3, 1)).toBe(rotation);
        expect(rotation).toBeGreaterThanOrEqual(0);
        expect(rotation).toBeLessThanOrEqual(Math.PI * 2);
    });

    it('varies both between rocks and between tiles', () => {
        const first = rockRotationForTile(7, -3, 0);
        expect(rockRotationForTile(7, -3, 1)).not.toBe(first);
        expect(rockRotationForTile(8, -3, 0)).not.toBe(first);
    });
});
