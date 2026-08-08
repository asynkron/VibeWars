import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { SimState } from './SimState';
import { DEFAULT_SCORE_WEIGHTS, scoreState } from './score';

function stateWithHeadquarters(): SimState {
    const cols = 4, rows = 4;
    const tiles = Array.from({ length: cols }, () =>
        Array.from({ length: rows }, () => ({
            height: 1, type: 'GRASS', hasRoad: false, moveCost: 1,
        })));
    const buildings = Array.from({ length: 7 }, (_, index) => ({
        type: 'hq', q: index % cols, r: Math.floor(index / cols),
        ownerIndex: 0, hiddenUnitType: null, groupId: 'hq@player0',
        drawnByAnchor: index !== 0,
    }));
    return SimState.snapshot({
        map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
        units: [], buildings,
    });
}

describe('HQ scoring', () => {
    it('values a seven-tile HQ once, not once per footprint tile', () => {
        const state = stateWithHeadquarters();
        expect(scoreState(state, 0)).toBe(DEFAULT_SCORE_WEIGHTS.headquartersWorth);
        expect(scoreState(state, 1)).toBe(-DEFAULT_SCORE_WEIGHTS.headquartersWorth!);
    });
});
