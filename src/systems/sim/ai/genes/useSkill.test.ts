// The generic skill gene: one word in the dialect, every skill samplable.
// See useSkill.ts for why it exists (the burn gene got lost in an engine
// flatten and the AI silently lost arson).

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { scenario } from '../../scenarios/scenario';
import { GROVE_PICTURE, GROVE_LEGEND } from '../../../maps/GroveMapProvider';
import { stateFromProvider } from '../../headless';
import { applyGene, randomGene, startTurn } from '../../SimCommands';
import { mulberry32 } from '../../resolveAttack';
import { USE_SKILL, useSkillGene } from './useSkill';
import { parthianEngine } from '../engines/parthian';

const GROVE = scenario('useskill-grove', GROVE_PICTURE, GROVE_LEGEND);

describe('useSkill delegates to the skill-backed genes', () => {
    it('a Pike beside the treeline can express arson through it', () => {
        const state = stateFromProvider(GROVE as any);
        startTurn(state, 0, mulberry32(1));
        expect(useSkillGene.applicable!(state, 0)).toBe(true);
        const applied = applyGene(
            state,
            { kind: USE_SKILL, unitIndex: 0, targetIndex: 1, seed: 1 },
            { [USE_SKILL]: useSkillGene },
        );
        expect(applied).toBe(true);
        // The delegate was burn (the Pike is undamaged and alone, so
        // repair has no target and transport does not apply): a fire
        // exists on the board now.
        expect(state.events.some((e) => e.type === 'fireStarted')).toBe(true);
    });

    it('is inapplicable for a unit with no ready skill, and falls back to idle', () => {
        // The Kestrel has only its primary attack -- no extra skills -- so
        // the gene must not apply, and a dialect roll of useSkill for it
        // must become idle rather than advance pressure (fallback: the
        // press family's rule).
        const state = stateFromProvider(GROVE as any);
        startTurn(state, 1, mulberry32(1));
        expect(useSkillGene.applicable!(state, 1)).toBe(false);
        expect(useSkillGene.fallback).toBe('idle');
    });

    it('parthian actually samples it: some rolled genes come out useSkill', () => {
        // The regression that motivated the whole gene: a vocabulary word
        // no shipped dialect samples is a word the AI does not have. Roll
        // parthian's dialect for the grove Pike and demand the word shows
        // up -- via randomGene's own guard path, so applicability and
        // fallback are exercised too.
        const state = stateFromProvider(GROVE as any);
        startTurn(state, 0, mulberry32(1));
        const rng = mulberry32(7);
        const kinds = new Set<string>();
        for (let i = 0; i < 400; i++) kinds.add(randomGene(state, 0, rng, parthianEngine.options.dialect).kind);
        expect([...kinds]).toContain(USE_SKILL);
    });
});
