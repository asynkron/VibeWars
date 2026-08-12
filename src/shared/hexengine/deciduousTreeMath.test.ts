import { describe, expect, it } from 'vitest';
import {
    childBranchLength,
    canopyWidthAtTrunkLevel,
    firstSideBranchLength,
    leaderBranchAzimuth,
    sideBranchLengthAtTrunkLevel,
} from './deciduousTreeMath';

describe('childBranchLength', () => {
    it('treats the trunk as generation 1 and applies the ratio to each actual parent', () => {
        const generations = [10];
        for (let generation = 2; generation <= 4; generation++) {
            generations.push(childBranchLength(generations[generations.length - 1], 0.65));
        }

        const expected = [10, 6.5, 4.225, 2.74625];
        generations.forEach((length, index) => expect(length).toBeCloseTo(expected[index], 8));
    });
});

describe('canopyWidthAtTrunkLevel', () => {
    it('keeps full width at the first trunk level and compounds upward', () => {
        expect(canopyWidthAtTrunkLevel(2.35, 0.8, 0)).toBeCloseTo(2.35, 8);
        expect(canopyWidthAtTrunkLevel(2.35, 0.8, 1)).toBeCloseTo(1.88, 8);
        expect(canopyWidthAtTrunkLevel(2.35, 0.8, 2)).toBeCloseTo(1.504, 8);
    });
});

describe('independent trunk and branch length chains', () => {
    it('keeps the first side branch independent of both trunk length controls', () => {
        const firstBranch = firstSideBranchLength(10, 0.38);
        const shortTrunk = childBranchLength(10 * 0.25, 0.4);
        const longTrunk = childBranchLength(10 * 0.75, 1.0);

        expect(firstBranch).toBe(3.8);
        expect(shortTrunk).toBe(1);
        expect(longTrunk).toBe(7.5);
        expect(firstSideBranchLength(10, 0.38)).toBe(firstBranch);
    });

    it('applies branch ratio only after the independent first branch', () => {
        const firstBranch = firstSideBranchLength(10, 0.38);
        expect(childBranchLength(firstBranch, 0)).toBe(0);
        expect(childBranchLength(firstBranch, 0.75)).toBeCloseTo(2.85, 8);
    });

    it('shortens first-generation side branches by trunk level count, not trunk length', () => {
        expect(sideBranchLengthAtTrunkLevel(4, 0.75, 0)).toBe(4);
        expect(sideBranchLengthAtTrunkLevel(4, 0.75, 1)).toBe(3);
        expect(sideBranchLengthAtTrunkLevel(4, 0.75, 2)).toBe(2.25);
    });
});

describe('leaderBranchAzimuth', () => {
    it('lets each node phase control its complete rotation', () => {
        expect(leaderBranchAzimuth(0, 1, 0.35, 0)).toBeCloseTo(0.35, 8);
        expect(leaderBranchAzimuth(0, 1, 4.9, 0)).toBeCloseTo(4.9, 8);
    });

    it('still distributes siblings around the complete ring', () => {
        const angles = [0, 1, 2].map((side) => leaderBranchAzimuth(side, 3, 0.7, 0));
        expect(angles[1] - angles[0]).toBeCloseTo(Math.PI * 2 / 3, 8);
        expect(angles[2] - angles[1]).toBeCloseTo(Math.PI * 2 / 3, 8);
    });
});
