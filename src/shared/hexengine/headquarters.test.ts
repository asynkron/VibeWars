import { describe, expect, it } from 'vitest';
import { headquartersAllowsGroundEntry, headquartersLosers } from './headquarters';

describe('HQ ground access', () => {
    const wall = { type: 'hq', ownerIndex: 0, destroyed: false, isEntrance: false };
    const door = { ...wall, isEntrance: true };

    it('blocks every standing wall tile for both sides', () => {
        expect(headquartersAllowsGroundEntry(wall, 0)).toBe(false);
        expect(headquartersAllowsGroundEntry(wall, 1)).toBe(false);
    });

    it('opens the door only for the owning side', () => {
        expect(headquartersAllowsGroundEntry(door, 0)).toBe(true);
        expect(headquartersAllowsGroundEntry(door, 1)).toBe(false);
    });

    it('stops blocking after destruction and does not change non-HQ doors', () => {
        expect(headquartersAllowsGroundEntry({ ...wall, destroyed: true }, 1)).toBe(true);
        expect(headquartersAllowsGroundEntry({ type: 'factory', ownerIndex: 0, destroyed: false }, 1)).toBe(true);
    });
});

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
