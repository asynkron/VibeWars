// The blockade gene: stand where your body buys the most road. The tests
// pin the three behaviours the retreat autopsy demanded -- find the
// station, walk to it, and compose with a second blocker -- plus the
// guards that keep it quiet on boards where blocking means nothing.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenarios/scenario';
import { RETREAT_PICTURE, TWIN_PICTURE, CHOKE_LEGEND } from '../../../maps/ChokeMapProvider';
import { stateFromProvider } from '../../headless';
import { SimState } from '../../SimState';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';
import { NO_COOLDOWNS } from '../../../../shared/hexengine/skills';
import { blockadeGene } from './blockade';

const mk = (type: string, q: number, r: number, playerIndex: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange,
             hasAttacked: false, cooldowns: NO_COOLDOWNS, carriedBy: null };
};

function grassBoard(units: any[], cols = 10, rows = 10) {
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height: 1, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return SimState.snapshot({ map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] }, units, buildings: [] });
}

describe('blockade on the retreat board', () => {
    const board = () => stateFromProvider(scenario('blockade-retreat', RETREAT_PICTURE, CHOKE_LEGEND) as any);

    it('walks the Kloss into the corridor on turn zero', () => {
        // From (3,2) the severing hexes are the corridor (3,4) and the door
        // (3,5); only (3,4) is within move 2. Standing there cuts the
        // Boll's only lane to the Pyramid dead.
        const state = board();
        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 1 })).toBe(true);
        const kloss = state.getUnit(0)!;
        expect([kloss.q, kloss.r]).toEqual([3, 4]);
    });

    it('prefers our side of the cut once both sever', () => {
        // Standing at (3,4): the door (3,5) severs equally, but it is on
        // OUR side of the water -- the tie-break the design names.
        const state = board();
        blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 1 });
        state.record({ type: 'turnStarted', playerIndex: 0 });
        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 2 })).toBe(true);
        const kloss = state.getUnit(0)!;
        expect([kloss.q, kloss.r]).toEqual([3, 5]);
    });

    it('holds without an event once it stands on the best hex', () => {
        const state = board();
        blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 1 });
        state.record({ type: 'turnStarted', playerIndex: 0 });
        blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 2 });
        state.record({ type: 'turnStarted', playerIndex: 0 });
        // On the door now. Holding is a refusal, not a move.
        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 3 })).toBe(false);
    });
});

describe('blockade composes: the twin pass', () => {
    // Roger's board: TWO middle tiles, TWO Klosses. One body narrows the
    // pass, the second one's evaluation runs with the first already
    // standing there -- sequential gene application -- and completes the
    // sever. The order the genes land in is the plan shuffle's business;
    // here we apply them in order and expect the pair on the pass.
    // The picture comes from the PLAYABLE map (?map=chokeTwin), one
    // source for the game and the tests alike.
    const TWIN = scenario('twin-pass', TWIN_PICTURE, CHOKE_LEGEND);

    it('two applications seal the pass', async () => {
        // The assertion is SEMANTIC -- the Boll must have no path to any
        // firing hex against the Pyramid -- not a fixed pair of hexes.
        // The gene taught the test that lesson on the first run: the
        // second blocker chose the hex BEHIND the east tile, which also
        // severs (a Boll stepping onto the gap stands in a dead end) and
        // wins the our-side tie-break.
        const { simDijkstra } = await import('../../SimPathfinding');
        const { HexCoord } = await import('../../../../shared/hexengine/HexCoord');
        const state = stateFromProvider(TWIN as any);

        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 1 })).toBe(true);
        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 1, seed: 1 })).toBe(true);

        const pyramid = state.getUnit(2)!;
        const { reachable } = simDijkstra(state, 3, Infinity);
        for (const n of HexCoord.getNeighbors(pyramid.q, pyramid.r)) {
            expect(reachable.has(n.r * state.cols + n.q),
                `Bollen kan nå skottläge (${n.q},${n.r})`).toBe(false);
        }
    });
});

describe('blockade guards', () => {
    it('is inapplicable without a protectee or a threat', () => {
        const alone = grassBoard([mk('Kloss', 5, 5, 0), mk('Boll', 5, 1, 1)]);
        expect(blockadeGene.applicable!(alone, 0)).toBe(false); // no one to protect

        const safe = grassBoard([mk('Kloss', 5, 5, 0), mk('Pyramid', 5, 7, 0)]);
        expect(blockadeGene.applicable!(safe, 0)).toBe(false); // no threat
    });

    it('does nothing on an open field where no hex buys road', () => {
        // Flat grass: every reroute costs the same, no candidate beats
        // standing still, and the gene must not wander.
        const state = grassBoard([mk('Kloss', 5, 5, 0), mk('Pyramid', 5, 8, 0), mk('Boll', 5, 1, 1)]);
        expect(blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 1 })).toBe(false);
        expect(state.events).toHaveLength(0);
    });

    it('is deterministic', () => {
        const run = () => {
            const state = stateFromProvider(scenario('blockade-det', RETREAT_PICTURE, CHOKE_LEGEND) as any);
            blockadeGene.apply(state, { kind: 'blockade', unitIndex: 0, seed: 7 });
            return state.events;
        };
        expect(run()).toEqual(run());
    });
});
