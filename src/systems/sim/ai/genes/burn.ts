// BURN -- a Pike sets fire to the trees next to it.
//
// WHAT THE SEARCH SEES HERE. score.ts prices units and buildings, not
// terrain -- a fire is worth what it does to units. For a long time that
// made this gene near-useless: the beam's horizon (depth 3) is far
// shorter than the six turns a fire lives, so the AI lit only fires that
// paid within two plies and was blind to the rest -- measured 0/6 on the
// grove board twice, against both an immobile and a mobile artillery.
// What closed the gap is FROZEN-FUTURE FORESIGHT (see
// PlanTurnOptions.foresight / simJob.frozenFutureValue): any board with
// fire on it is also scored ~20 decision-free turns ahead, so the far
// payoff of a spreading fire -- and the cost of standing near your own --
// lands in the score a depth-3 search reads. The gene proposes; the
// frozen future prices.
//
// TARGETING IS TOWARD THE ENEMY rather than at the biggest grove. A fire
// behind your own line is a fire you have to walk around later; the point of
// the skill is to put burning ground between the enemy and where they want
// to be. Ties break on the neighbour list order, which is stable.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { PIKE_FIRE, isReady, type SkillDef } from '../../../../shared/hexengine/skills';
import { canIgnite } from '../../../../shared/hexengine/fire';
import { SimState } from '../../SimState';
import { GeneDefinition } from '../../SimCommands';

export const BURN = 'burn';

function fireSkillFor(state: SimState, unitIndex: number): SkillDef | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    const skill = UnitSystem.skillById(unit.type, PIKE_FIRE.id);
    if (!skill || skill.effect.kind !== 'startFire') return null;
    return isReady(unit.cooldowns, skill.id) ? skill : null;
}

// The adjacent tile worth lighting: burnable, and nearest to an enemy.
//
// canIgnite is the SHARED predicate, not a copy -- it already knows that a
// tile must be vegetated, unburnt and not already alight, and having the
// gene restate any part of that is how the AI ends up believing in fires the
// board will refuse to light.
function bestTarget(state: SimState, casterIndex: number, skill: SkillDef): { q: number; r: number } | null {
    const caster = state.getUnit(casterIndex);
    if (!caster) return null;

    let best: { q: number; r: number } | null = null;
    let bestDistance = Infinity;

    for (const spot of HexCoord.getNeighbors(caster.q, caster.r)) {
        const distance = HexCoord.getDistance(caster.q, caster.r, spot.q, spot.r);
        if (distance < skill.minRange || distance > skill.maxRange) continue;
        if (!canIgnite(state.getTile(spot.q, spot.r))) continue;

        for (const [, enemy] of state.activeUnits()) {
            if (enemy.playerIndex === caster.playerIndex) continue;
            const toEnemy = HexCoord.getDistance(spot.q, spot.r, enemy.q, enemy.r);
            if (toEnemy < bestDistance) {
                bestDistance = toEnemy;
                best = { q: spot.q, r: spot.r };
            }
        }
    }
    return best;
}

export const burnGene: GeneDefinition = {
    // randomGene rerolls a false guard into moveTowards, so a gene this
    // narrow costs the search almost nothing -- only a Pike standing beside
    // unburnt greenery ever widens it.
    applicable(state, unitIndex) {
        const skill = fireSkillFor(state, unitIndex);
        if (!skill) return false;
        const caster = state.getUnit(unitIndex);
        if (!caster || caster.hasAttacked) return false;
        return bestTarget(state, unitIndex, skill) !== null;
    },

    apply(state, gene) {
        const skill = fireSkillFor(state, gene.unitIndex);
        if (!skill) return false;
        const caster = state.getUnit(gene.unitIndex);
        if (!caster || caster.hasAttacked) return false;
        const target = bestTarget(state, gene.unitIndex, skill);
        if (!target) return false;

        state.record({
            type: 'fireStarted',
            q: target.q,
            r: target.r,
            casterIndex: gene.unitIndex,
            skillId: skill.id,
        });
        return true;
    },
};
