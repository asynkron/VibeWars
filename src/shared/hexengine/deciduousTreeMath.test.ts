import { describe, expect, it } from 'vitest';
import { childBranchLength } from './deciduousTreeMath';

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
