// USE SKILL -- the one gene that makes every skill samplable.
//
// THE FAILURE THIS EXISTS TO PREVENT is not hypothetical; it happened.
// Each skill used to reach the search only through its own dedicated gene,
// and each dedicated gene only through the dialect of whichever engine
// remembered to list it. When the engine roster was flattened to two, the
// burn gene fell out of every dialect and the AI silently lost the word
// "arson" -- the grove board (see fireGrove.test.ts) caught it standing
// beside the treeline it was built to light, doing nothing, winning on
// points. A vocabulary that must be re-wired per engine is a vocabulary
// that gets lost in refactors.
//
// So: ONE gene kind in the dialect, which delegates to the skill-backed
// genes below. Their targeting heuristics, approach walks, cooldown
// guards and event recording are untouched -- burn still picks the
// burnable tile nearest an enemy, repair still walks to the most damaged
// machine -- this gene only owns the SAMPLING: if any of them can act,
// the roll can express it. A new skill means one line in SKILL_GENES, and
// every engine that rolls useSkill can play it from that moment. No
// dialect edit, nothing to forget.
//
// The choice among several applicable skills is SEEDED, like every other
// piece of gene randomness -- a plan is a pure function of its genes, and
// a beam child replayed on a worker must rebuild the same board.
//
// fallback: 'idle', the press family's rule: on the (usual) board where a
// unit has no ready skill, this gene adds NOTHING rather than rerolling
// into advance pressure. Its dialect weight is therefore purely additive.
//
// What the search does with the samples is the evaluation's problem, on
// purpose: a repair prices itself through the hp terms, but a fire whose
// payoff lands past the beam horizon scores near zero (see genes/burn.ts
// on that blindness). If sampled arson still never gets PICKED, that is
// the score function failing, not the vocabulary -- and now the exams can
// show it.

import { mulberry32, combineSeed } from '../../resolveAttack';
import { GeneDefinition } from '../../SimCommands';
import { BURN, burnGene } from './burn';
import { REPAIR, repairGene } from './repair';
import { LOAD, UNLOAD, loadGene, unloadGene } from './transport';

export const USE_SKILL = 'useSkill';

// Slot order is the tie-break order, so it is part of determinism: never
// reorder without expecting plans to change.
const SKILL_GENES: ReadonlyArray<readonly [string, GeneDefinition]> = [
    [REPAIR, repairGene],
    [BURN, burnGene],
    [LOAD, loadGene],
    [UNLOAD, unloadGene],
];

function applicableSkillGenes(state: any, unitIndex: number): GeneDefinition[] {
    const open: GeneDefinition[] = [];
    for (const [, gene] of SKILL_GENES) {
        if (gene.applicable?.(state, unitIndex) ?? true) open.push(gene);
    }
    return open;
}

export const useSkillGene: GeneDefinition = {
    applicable(state, unitIndex) {
        return applicableSkillGenes(state, unitIndex).length > 0;
    },

    apply(state, gene) {
        const open = applicableSkillGenes(state, gene.unitIndex);
        if (open.length === 0) return false;
        // Seeded pick, derived from the gene's own seed plus the unit, so
        // two useSkill genes in one plan can diverge.
        const roll = mulberry32(combineSeed(gene.seed, gene.unitIndex))();
        const pick = open[Math.floor(roll * open.length)];
        return pick.apply(state, gene);
    },

    fallback: 'idle',
};
