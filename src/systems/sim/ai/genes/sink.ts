// SINK -- shell the ground under a unit until it drowns.
//
// The mechanic is real and simulated. A rocketBarrage scatters six rockets
// across the target hex and its neighbours, each lowering the ground by
// CRATER_DELTA; SimCommands' terrainModified handler then checks whether a
// tile has crossed into WATER, and if it has, kills the land unit standing
// on it outright -- whatever its hit points were.
//
// Nothing can ask for that. Every attack gene resolves a TARGET UNIT and is
// scored on the damage it deals, and sweepAttacks -- which fires every
// net-positive shot after a plan -- picks the target with the best damage
// value. Both are blind to what the ground under a target is doing. A kill
// by drowning is worth a whole unit regardless of its health, so the right
// target can be the one a normal shot would rank last.
//
// THE ARITHMETIC IS WHY THE GUARD IS STRICT. Six rockets land across the
// target hex plus its up-to-six neighbours, so the target hex takes about
// 6/7 of one CRATER_DELTA per barrage -- roughly 0.086 of height. Sinking a
// typical grass tile from 0.9 would take ten barrages, which is not a plan,
// it is a campaign. The gene therefore only fires against a target already
// standing near the waterline: sand tiles smoothed down toward a lake, or
// ground an earlier barrage has already dug out. There it is two or three
// turns of work for a guaranteed kill, and the beam can play that out.
//
// It also handles its own positioning. Artillery has move 2 and range 2-3,
// so a gene that only fired when already in range would rarely fire, and
// composing it out of standoff-then-attack is exactly the coincidence of
// two random genes landing together that the search cannot rely on.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { SimState } from '../../SimState';
import { GeneDefinition, recordSimMove, applyGene } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';
import { CRATER_DELTA, ROCKET_COUNT } from '../../resolveAttack';

export const SINK = 'sink';

// Height a single barrage takes off the target's own hex: six rockets
// spread over that hex and its neighbours. Deliberately derived rather than
// written down, so a change to either constant carries through.
const HEIGHT_PER_BARRAGE = Math.abs(CRATER_DELTA) * (ROCKET_COUNT / 7);

// How many barrages are still worth committing to. Beyond this the ground
// outlives the match.
const BARRAGES_WORTH_IT = 4;
const WORKABLE_HEIGHT = HEIGHT_PER_BARRAGE * BARRAGES_WORTH_IT;

function cratersTerrain(unitType: string): boolean {
    return UnitSystem.unitTypesRecord[unitType]?.attackEffect === 'rocketBarrage';
}

// The enemy standing on the ground closest to going under, among those this
// unit may legally shoot and that would actually drown -- a unit that can
// enter WATER is not threatened by its tile becoming water.
function drownableTarget(state: SimState, unitIndex: number): [number, number] | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    let best: [number, number] | null = null;
    let lowest = Infinity;
    for (const [i, enemy] of state.liveUnits()) {
        if (enemy.playerIndex === unit.playerIndex) continue;
        if (!UnitSystem.canTarget(unit.type, enemy.type)) continue;
        if (UnitSystem.unitTypesRecord[enemy.type]?.terrainCosts.WATER != null) continue;
        const tile = state.getTile(enemy.q, enemy.r);
        if (!tile || tile.type === 'WATER') continue;
        if (tile.height > WORKABLE_HEIGHT) continue;
        if (tile.height < lowest) {
            lowest = tile.height;
            best = [i, tile.height];
        }
    }
    return best;
}

export const sinkGene: GeneDefinition = {
    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit || !cratersTerrain(unit.type)) return false;
        return drownableTarget(state, unitIndex) !== null;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit || !cratersTerrain(unit.type)) return false;
        const found = drownableTarget(state, gene.unitIndex);
        if (!found) return false;
        const [targetIndex] = found;
        const target = state.getUnit(targetIndex)!;

        const distance = HexCoord.getDistance(unit.q, unit.r, target.q, target.r);
        if (distance >= unit.minRange && distance <= unit.maxRange) {
            if (unit.hasAttacked) return false;
            // Through SimCommands' own attack gene, so splash, friendly
            // fire, craters and drowning resolve exactly as they would for
            // any other shot. This gene's contribution is WHICH hex gets
            // shelled, not a second set of combat rules.
            return applyGene(state, { kind: 'attack', unitIndex: gene.unitIndex, targetIndex, seed: gene.seed });
        }

        // Out of range: walk into the firing bracket, preferring the far
        // edge of it, the way artillery actually fights.
        if (unit.move <= 0) return false;
        const { distances, reachable } = simDijkstra(state, gene.unitIndex, unit.move);
        let bestKey: string | null = null;
        let bestDist = -Infinity;
        let bestCost = Infinity;
        for (const key of reachable) {
            const [q, r] = key.split(',').map(Number);
            if (q === unit.q && r === unit.r) continue;
            const d = HexCoord.getDistance(q, r, target.q, target.r);
            if (d < unit.minRange || d > unit.maxRange) continue;
            const cost = distances.get(key)!;
            if (d > bestDist || (d === bestDist && cost < bestCost)) {
                bestDist = d;
                bestCost = cost;
                bestKey = key;
            }
        }
        if (bestKey === null) return false;
        const [toQ, toR] = bestKey.split(',').map(Number);
        recordSimMove(state, gene.unitIndex, toQ, toR, bestCost);
        return true;
    },
};
