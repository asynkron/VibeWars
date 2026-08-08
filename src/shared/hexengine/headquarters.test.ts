import { describe, expect, it } from 'vitest';
import { headquartersLosers } from './headquarters';

describe('headquartersLosers', () => {
    it('does nothing on a map without headquarters', () => {
        expect(headquartersLosers([
            { type: 'factory', ownerIndex: 0, destroyed: true },
        ], 2)).toEqual([]);
    });

    it('only defeats the owner of a destroyed headquarters', () => {
        expect(headquartersLosers([
            { type: 'hq', ownerIndex: 0, destroyed: true },
            { type: 'hq', ownerIndex: 1, destroyed: false },
        ], 2)).toEqual([0]);
    });

    it('allows only one side to have an HQ', () => {
        expect(headquartersLosers([
            { isHeadquarters: true, ownerIndex: 1, destroyed: true },
        ], 2)).toEqual([1]);
    });

    it('ignores a destroyed neutral HQ', () => {
        expect(headquartersLosers([
            { type: 'hq', ownerIndex: null, destroyed: true },
        ], 2)).toEqual([]);
    });

    it('reports mutual HQ destruction as both sides losing', () => {
        expect(headquartersLosers([
            { type: 'hq', ownerIndex: 0, destroyed: true },
            { type: 'hq', ownerIndex: 1, destroyed: true },
        ], 2)).toEqual([0, 1]);
    });
});
