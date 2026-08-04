// Three genes, each built for a mechanic the simulation models but no
// existing gene can ask for. That claim is the only reason to build them --
// three earlier genes that merely rephrased something moveTowards could
// already reach all measured as no difference -- so each test here checks
// BOTH that the gene does what it says AND, where it can, that the
// mechanic it targets is really in the sim.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { SimState } from '../../SimState';
import * as HexCoord from '../../../../shared/hexengine/hexMath';
import { unitTypesRecord } from '../../../../shared/hexengine/unitStats';
import { nearestCapturableBuildingIndex } from '../../SimCommands';
import { MEND, mendGene } from './mend';
import { SINK, sinkGene } from './sink';
import { HOLD_DOOR, holdDoorGene } from './holdDoor';
import { menderEngine } from '../engines/mender';
import { dredgeEngine } from '../engines/dredge';
import { gatekeeperEngine } from '../engines/gatekeeper';
import { sapperEngine } from '../engines/sapper';
import { feintEngine } from '../engines/feint';

const mk = (type: string, q: number, r: number, playerIndex: number, hp?: number) => {
    const s = unitTypesRecord[type];
    return { type, q, r, playerIndex, hp: hp ?? s.hp, maxHp: s.maxHp, move: s.move,
             attack: s.attack, minRange: s.minRange, maxRange: s.maxRange, hasAttacked: false };
};

function board(units: any[], buildings: any[] = [], height = 1) {
    const cols = 12, rows = 12;
    const tiles: any[][] = [];
    for (let q = 0; q < cols; q++) {
        tiles[q] = [];
        for (let r = 0; r < rows; r++) tiles[q][r] = { height, type: 'GRASS', hasRoad: false, moveCost: 1 };
    }
    return {
        state: SimState.snapshot({
            map: { cols, rows, getTile: (q: number, r: number) => tiles[q][r] },
            units, buildings,
        }),
        tiles,
    };
}

describe('mend -- healing at an owned building', () => {
    it('is unreachable through the existing capture finder', () => {
        // The line that makes the gene necessary: our own building is not a
        // moveToBuilding target, so nothing else can send a unit there.
        const { state } = board(
            [mk('Bulwark', 8, 8, 0, 4)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null, isEntrance: true, ownerIndex: 0 }]
        );
        expect(nearestCapturableBuildingIndex(state, 0)).toBeNull();
    });

    it('walks a damaged unit toward the building we own', () => {
        const { state } = board(
            [mk('Bulwark', 8, 8, 0, 4)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null, isEntrance: true, ownerIndex: 0 }]
        );
        expect(mendGene.apply(state, { kind: MEND, unitIndex: 0, seed: 1 })).toBe(true);
        const unit = state.getUnit(0)!;
        expect(HexCoord.getDistance(unit.q, unit.r, 2, 2))
            .toBeLessThan(HexCoord.getDistance(8, 8, 2, 2));
    });

    it('leaves a healthy unit alone', () => {
        const { state } = board(
            [mk('Bulwark', 8, 8, 0)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null, isEntrance: true, ownerIndex: 0 }]
        );
        expect(mendGene.applicable!(state, 0)).toBe(false);
    });

    it('declines when we own no building', () => {
        const { state } = board(
            [mk('Bulwark', 8, 8, 0, 4)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null, isEntrance: true, ownerIndex: 1 }]
        );
        expect(mendGene.applicable!(state, 0)).toBe(false);
    });

    it('the heal it aims at is real', () => {
        // 2 hp back for starting a turn on an owned building, so the gene is
        // chasing something the score can actually see.
        const { state } = board(
            [mk('Bulwark', 2, 2, 0, 4)],
            [{ type: 'factory', q: 2, r: 2, hiddenUnitType: null, isEntrance: true, ownerIndex: 0 }]
        );
        state.record({ type: 'turnStarted', playerIndex: 0 });
        expect(state.getUnit(0)!.hp).toBe(4 + SimState.FACTORY_REPAIR_HP);
    });
});

describe('sink -- drowning a unit by digging out its ground', () => {
    it('only fires for a unit whose shots actually crater', () => {
        // Kestrel barrages; a Bulwark's cannon leaves no hole.
        const low = 0.2;
        const { state } = board([mk('Kestrel', 5, 5, 0), mk('Bulwark', 6, 5, 1)], [], low);
        expect(sinkGene.applicable!(state, 0)).toBe(true);

        const { state: tankState } = board([mk('Bulwark', 5, 5, 0), mk('Bulwark', 6, 5, 1)], [], low);
        expect(sinkGene.applicable!(tankState, 0)).toBe(false);
    });

    it('ignores ground too high to be worth digging', () => {
        const { state } = board([mk('Kestrel', 5, 5, 0), mk('Bulwark', 6, 5, 1)], [], 1.2);
        expect(sinkGene.applicable!(state, 0)).toBe(false);
    });

    it('ignores a target that would not drown', () => {
        // A Nightjar flies; its tile becoming water is no threat -- and
        // artillery cannot shoot air anyway.
        const { state } = board([mk('Kestrel', 5, 5, 0), mk('Nightjar', 6, 5, 1)], [], 0.2);
        expect(sinkGene.applicable!(state, 0)).toBe(false);
    });

    it('fires at the low target when in range', () => {
        const { state } = board([mk('Kestrel', 5, 5, 0), mk('Bulwark', 7, 5, 1)], [], 0.2);
        const acted = sinkGene.apply(state, { kind: SINK, unitIndex: 0, seed: 1 });
        expect(acted).toBe(true);
        expect(state.events.some((e: any) => e.type === 'terrainModified')).toBe(true);
    });

    it('drowning is a real outcome of lowering a tile', () => {
        // The mechanic the gene exists for, exercised directly.
        const { state } = board([mk('Bulwark', 5, 5, 1)], [], 0.05);
        state.record({ type: 'terrainModified', q: 5, r: 5, delta: -0.5 });
        expect(state.getTile(5, 5)!.type).toBe('WATER');
    });
});

describe('holdDoor -- denying a capture', () => {
    const doorAt = (q: number, r: number, ownerIndex: number | null = null) =>
        ({ type: 'forgeDepotS', q, r, hiddenUnitType: null, isEntrance: true, groupId: 'd', ownerIndex });

    it('puts a non-capturing unit on the entrance', () => {
        const { state } = board([mk('Bulwark', 5, 6, 0), mk('Pike', 9, 9, 1)], [doorAt(5, 5)]);
        expect(holdDoorGene.apply(state, { kind: HOLD_DOOR, unitIndex: 0, seed: 1 })).toBe(true);
        const unit = state.getUnit(0)!;
        expect([unit.q, unit.r]).toEqual([5, 5]);
    });

    it('does not fire for a unit that could just capture it', () => {
        // Infantry landing there takes the building outright, which is
        // strictly better and is what moveToBuilding is for.
        const { state } = board([mk('Pike', 5, 6, 0), mk('Pike', 9, 9, 1)], [doorAt(5, 5)]);
        expect(holdDoorGene.applicable!(state, 0)).toBe(false);
    });

    it('does not fire when the enemy has nobody who can capture', () => {
        const { state } = board([mk('Bulwark', 5, 6, 0), mk('Bulwark', 9, 9, 1)], [doorAt(5, 5)]);
        expect(holdDoorGene.applicable!(state, 0)).toBe(false);
    });

    it('does not fire when it cannot reach the door this turn', () => {
        // Only the hex itself denies anything, so inching toward it is
        // pointless -- unlike every other movement gene.
        const { state } = board([mk('Bulwark', 11, 11, 0), mk('Pike', 9, 9, 1)], [doorAt(5, 5)]);
        expect(holdDoorGene.apply(state, { kind: HOLD_DOOR, unitIndex: 0, seed: 1 })).toBe(false);
    });

    it('leaves a door somebody already holds', () => {
        const { state } = board(
            [mk('Bulwark', 5, 6, 0), mk('Halberd', 5, 5, 0), mk('Pike', 9, 9, 1)],
            [doorAt(5, 5)]
        );
        expect(holdDoorGene.applicable!(state, 0)).toBe(false);
    });
});

describe('each engine is Feint plus exactly one gene', () => {
    const cases = [
        ['mender', menderEngine, MEND],
        ['dredge', dredgeEngine, SINK],
        ['gatekeeper', gatekeeperEngine, HOLD_DOOR],
    ] as const;

    for (const [name, engine, kind] of cases) {
        it(`${name} differs from feint only in its dialect`, () => {
            const { dialect: a, ...rest } = engine.options as any;
            const { dialect: f, ...feintRest } = feintEngine.options as any;
            expect(rest).toEqual(feintRest);
            expect(engine.options.beam).toEqual(feintEngine.options.beam);
            expect(engine.options.score).toEqual(feintEngine.options.score);
        });

        it(`${name} registers its gene and keeps the roulette at 1.00`, () => {
            expect(Object.keys(engine.options.dialect!.extras)).toEqual([kind]);
            const total = engine.options.dialect!.weights.reduce((sum, [, w]) => sum + w, 0);
            expect(total).toBeCloseTo(1, 6);
        });

        it(`${name} leaves the purposeful weights where Feint had them`, () => {
            const weightOf = (e: any, k: string) =>
                (e.options.dialect.weights.find(([key]: any[]) => key === k) ?? [, 0])[1];
            for (const k of ['attack', 'moveTowards', 'standoff', 'moveAway', 'moveToBuilding']) {
                expect(weightOf(engine, k), k).toBe(weightOf(feintEngine, k));
            }
        });
    }

    it('gives each engine a different gene, so each benchmark asks one question', () => {
        const kinds = cases.map(([, engine]) => Object.keys(engine.options.dialect!.extras)[0]);
        expect(new Set(kinds).size).toBe(kinds.length);
    });
});

describe('sapper carries all three, and nothing else', () => {
    it('registers exactly the three genes', () => {
        expect(Object.keys(sapperEngine.options.dialect!.extras).sort())
            .toEqual([HOLD_DOOR, MEND, SINK].sort());
    });

    it('still differs from feint only in its dialect', () => {
        const { dialect: a, ...rest } = sapperEngine.options as any;
        const { dialect: f, ...feintRest } = feintEngine.options as any;
        expect(rest).toEqual(feintRest);
    });

    it('leaves every purposeful weight where feint had it', () => {
        // The whole budget comes out of moveRandom and idle, so a win here
        // is about the genes and not about having quietly reweighted the
        // search underneath them.
        const weightOf = (e: any, k: string) =>
            (e.options.dialect.weights.find(([key]: any[]) => key === k) ?? [, 0])[1];
        for (const k of ['attack', 'moveTowards', 'standoff', 'moveAway', 'moveToBuilding']) {
            expect(weightOf(sapperEngine, k), k).toBe(weightOf(feintEngine, k));
        }
        expect(weightOf(sapperEngine, 'moveRandom')).toBeLessThan(weightOf(feintEngine, 'moveRandom'));
        expect(weightOf(sapperEngine, 'idle')).toBeLessThan(weightOf(feintEngine, 'idle'));
    });

    it('weights the niche gene lowest and the common one highest', () => {
        // holdDoor almost never applies; mend applies to any damaged unit.
        const weightOf = (k: string) =>
            (sapperEngine.options.dialect!.weights.find(([key]) => key === k) ?? [, 0])[1];
        expect(weightOf(HOLD_DOOR)).toBeLessThan(weightOf(SINK));
        expect(weightOf(SINK)).toBeLessThan(weightOf(MEND));
    });

    it('keeps the roulette summing to one', () => {
        const total = sapperEngine.options.dialect!.weights.reduce((sum, [, w]) => sum + w, 0);
        expect(total).toBeCloseTo(1, 6);
    });

    it('is decomposable: each of its genes also ships alone', () => {
        // The reason combining three at once is acceptable here. A win can
        // be attributed afterwards instead of being a dead end.
        const solo = [menderEngine, dredgeEngine, gatekeeperEngine]
            .map((e) => Object.keys(e.options.dialect!.extras)[0]).sort();
        expect(solo).toEqual(Object.keys(sapperEngine.options.dialect!.extras).sort());
    });
});
