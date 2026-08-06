// REPAIR -- send the infantry to patch up a damaged machine.
//
// The owner's ask, and the reference's Heal is its model. What is new here
// is the cost: Pike is the ONLY unit that can capture, so spending its turn
// on a repair is spending the turn of the only unit that can take a depot.
// That trade is the whole balance of the skill, and it is exactly the kind
// of thing the beam is good at judging -- it plays the line out and scores
// what happened, rather than following a rule about when medics are worth
// it.
//
// HOW IT RELATES TO `mend`, because at a glance they look like the same
// feature and they are complements. `mend` is a MOVEMENT gene: it records
// only unitMoved, heals nothing, and walks a damaged unit onto a building
// its own side holds so that next turn's turnStarted fires
// FACTORY_REPAIR_HP. It is "go to the hospital". This is an ACTION: the
// medic comes to you, anywhere on the map, for the price of its turn.
//
// Neither needs a new score term, which is the point they share. score.ts
// already prices hit points directly, prices a unit staying alive, and
// prices army size quadratically -- so a repair is worth exactly as much as
// it moves those, with no thumb on the scale. That is also the pattern the
// reference stumbled into without noticing: its Heal raises myScore in
// GetFitness and there is no healing bonus anywhere.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { PIKE_REPAIR, isReady, type SkillDef } from '../../../../shared/hexengine/skills';
import { SimState } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const REPAIR = 'repair';

// Whether a unit may be the target of this skill at all: right side, right
// class, and actually damaged.
//
// The damage check is the important one. Repairing a full-health ally caps
// at maxHp, so the rollout scores identically to having done nothing -- and
// a tie can survive a beam while burning the unit's action and a three-turn
// cooldown. Checked at ENUMERATION so the move cannot be generated, not
// merely deprioritised.
function isRepairable(state: SimState, healerIndex: number, targetIndex: number, skill: SkillDef): boolean {
    if (targetIndex === healerIndex) return false;
    const healer = state.getUnit(healerIndex);
    const target = state.getUnit(targetIndex);
    if (!healer || !target) return false;
    if (target.playerIndex !== healer.playerIndex) return false;
    if (target.hp >= target.maxHp) return false;
    if (skill.target.kind !== 'allyUnit') return false;
    const classes = skill.target.classes;
    if (!classes) return true;
    const unitClass = UnitSystem.unitTypesRecord[target.type]?.unitClass;
    return !!unitClass && classes.includes(unitClass);
}

// The ally that would absorb the most of the heal, tie-broken by lowest hp.
// "Save the weakest" -- the same logic the attack gene's target picker uses
// on the other side of the board.
function bestRepairTarget(state: SimState, healerIndex: number, skill: SkillDef): number | null {
    let best: number | null = null;
    let bestAbsorbed = 0;
    let bestHp = Infinity;
    const healHp = skill.effect.kind === 'repair' ? skill.effect.hp : 0;
    for (const [index, unit] of state.liveUnits()) {
        if (!isRepairable(state, healerIndex, index, skill)) continue;
        const absorbed = Math.min(healHp, unit.maxHp - unit.hp);
        if (absorbed > bestAbsorbed || (absorbed === bestAbsorbed && unit.hp < bestHp)) {
            bestAbsorbed = absorbed;
            bestHp = unit.hp;
            best = index;
        }
    }
    return best;
}

function repairSkillFor(state: SimState, unitIndex: number): SkillDef | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    const skill = UnitSystem.skillById(unit.type, PIKE_REPAIR.id);
    if (!skill || skill.effect.kind !== 'repair') return null;
    return isReady(unit.cooldowns, skill.id) ? skill : null;
}

export const repairGene: GeneDefinition = {
    // randomGene rerolls a false guard to moveTowards, so a narrow gene
    // costs almost nothing -- a Bulwark that rolls this simply advances
    // instead. Only Pike ever widens the search at all.
    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || unit.hasAttacked) return false;
        const skill = repairSkillFor(state, unitIndex);
        if (!skill) return false;
        return bestRepairTarget(state, unitIndex, skill) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || unit.hasAttacked) return false;
        const skill = repairSkillFor(state, gene.unitIndex);
        if (!skill || skill.effect.kind !== 'repair') return false;
        const targetIndex = bestRepairTarget(state, gene.unitIndex, skill);
        if (targetIndex === null) return false;
        const target = state.getUnit(targetIndex)!;

        const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
        if (distance >= skill.minRange && distance <= skill.maxRange) {
            state.record({
                type: 'unitRepaired',
                repairerIndex: gene.unitIndex,
                targetIndex,
                // Clamped HERE, at the command layer, so apply() never has
                // to derive a fact -- the same division of labour the
                // attack path uses for damage.
                hp: Math.min(skill.effect.hp, target.maxHp - target.hp),
                skillId: skill.id,
            });
            return true;
        }

        // Out of reach: walk toward it. Same shape as sink.ts, and the
        // reason both exist -- a skill that only fired when it happened to
        // already be in range would depend on two random genes landing
        // together, which is exactly the coincidence a search cannot rely
        // on.
        if (unit.move <= 0) return false;
        const cols = state.cols;
        const startKey = unit.r * cols + unit.q;
        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
        let bestKey: number | null = null;
        let bestDistance = distance;
        let bestCost = Infinity;
        for (const key of reachable) {
            if (key === startKey) continue;
            const q = key % cols;
            const d = HexCoord.getDistance(q, (key - q) / cols, target.q, target.r);
            const cost = distances.get(key)!;
            if (d < bestDistance || (d === bestDistance && cost < bestCost && bestKey !== null)) {
                bestDistance = d;
                bestCost = cost;
                bestKey = key;
            }
        }
        if (bestKey === null) return false;
        const toQ = bestKey % cols;
        recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, bestCost);
        return true;
    },
};
