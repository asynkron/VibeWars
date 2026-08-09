import { describe, expect, it } from 'vitest';
import { hasBurnableVegetation, hasVegetation } from './tileVegetation';

describe('hasBurnableVegetation', () => {
    it('preserves visible forest vegetation on an unobstructed tile', () => {
        expect(hasVegetation('FOREST', 2, 3, 1)).toBe(true);
        expect(hasBurnableVegetation('FOREST', 2, 3, 1, false, false)).toBe(true);
    });

    it('suppresses the hidden vegetation underneath a road', () => {
        expect(hasBurnableVegetation('FOREST', 2, 3, 1, true, false)).toBe(false);
    });

    it('suppresses the hidden vegetation underneath every building piece', () => {
        expect(hasBurnableVegetation('FOREST', 2, 3, 1, false, true)).toBe(false);
    });
});
