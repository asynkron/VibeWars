// LOAD and UNLOAD -- the two halves of the transport, as genes.
//
// The mechanic they drive is the one thing in this port that had nothing to
// copy: HeroesOfBlazor has no transports, and its Apply(IUnit, IUnit, int)
// could not express one if it did -- no board, no return value, no hex
// target. So the shape here is argued from this engine rather than ported.
//
// WHY THE SEARCH WOULD NEVER USE A TRANSPORT BY ACCIDENT, and what makes it
// use one on purpose: score.ts prices a unit directly and again through a
// quadratic army-size term. A passenger that vanished from liveUnits() while
// loaded would read as dead twice over, so loading would be a large
// self-inflicted loss and unloading free money -- the beam would refuse to
// ever load and would unload instantly, into anything. Cargo therefore stays
// LISTED with its coordinates synced to the carrier (see SimUnit.carriedBy),
// which makes loading score-neutral and makes driving infantry toward a
// depot pull on the capture term exactly as walking it would.
//
// What makes the ride a real decision rather than free is the risk: cargo
// cannot be shot while loaded, and dies with its transport. The beam can
// weigh that, because it plays the line out.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { DROVER_LOAD, DROVER_UNLOAD, isReady, type SkillDef } from '../../../../shared/hexengine/skills';
import { SimState, type SimUnit } from '../../SimState';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra } from '../../SimPathfinding';

export const LOAD = 'load';
export const UNLOAD = 'unload';

function skillFor(state: SimState, unitIndex: number, id: string): SkillDef | null {
    const unit = state.getUnit(unitIndex);
    if (!unit) return null;
    const skill = UnitSystem.skillById(unit.type, id);
    if (!skill) return null;
    return isReady(unit.cooldowns, skill.id) ? skill : null;
}

export function carriedBy(state: SimState, carrierIndex: number): Array<[number, SimUnit]> {
    const riders: Array<[number, SimUnit]> = [];
    for (const [index, unit] of state.liveUnits()) {
        if (unit.carriedBy === carrierIndex) riders.push([index, unit]);
    }
    return riders;
}

function hasRoom(state: SimState, carrierIndex: number): boolean {
    const carrier = state.getUnit(carrierIndex);
    if (!carrier) return false;
    const capacity = UnitSystem.unitTypesRecord[carrier.type]?.capacity ?? 0;
    return capacity > 0 && carriedBy(state, carrierIndex).length < capacity;
}

// A passenger this carrier will take: right side, right class, on the board,
// and standing within reach.
function boardableNear(state: SimState, carrierIndex: number, skill: SkillDef): number | null {
    const carrier = state.getUnit(carrierIndex);
    if (!carrier) return null;
    const carries = UnitSystem.unitTypesRecord[carrier.type]?.carries;
    for (const [index, unit] of state.liveUnits()) {
        if (index === carrierIndex) continue;
        if (unit.carriedBy !== null) continue;
        if (unit.playerIndex !== carrier.playerIndex) continue;
        const unitClass = UnitSystem.unitTypesRecord[unit.type]?.unitClass;
        if (carries && (!unitClass || !carries.includes(unitClass))) continue;
        const distance = HexCoord.getDistance(carrier.q, carrier.r, unit.q, unit.r);
        if (distance < skill.minRange || distance > skill.maxRange) continue;
        return index;
    }
    return null;
}

export const loadGene: GeneDefinition = {
    applicable(state, unitIndex) {
        const skill = skillFor(state, unitIndex, DROVER_LOAD.id);
        if (!skill) return false;
        const carrier = state.getUnit(unitIndex);
        if (!carrier || carrier.hasAttacked) return false;
        if (!hasRoom(state, unitIndex)) return false;
        return boardableNear(state, unitIndex, skill) !== null;
    },

    apply(state, gene) {
        const skill = skillFor(state, gene.unitIndex, DROVER_LOAD.id);
        if (!skill) return false;
        const carrier = state.getUnit(gene.unitIndex);
        if (!carrier || carrier.hasAttacked || !hasRoom(state, gene.unitIndex)) return false;
        const passengerIndex = boardableNear(state, gene.unitIndex, skill);
        if (passengerIndex === null) return false;
        state.record({
            type: 'unitLoaded',
            carrierIndex: gene.unitIndex,
            passengerIndex,
            skillId: skill.id,
        });
        return true;
    },
};

// Where a passenger may be put down: adjacent, in bounds, empty, no
// building, and passable FOR THE CARGO -- a Pike cannot be dropped into a
// lake just because the Drover is parked beside one.
//
// Deliberately not simDijkstra's `reachable`: that excludes occupied hexes
// during expansion for movement reasons and would also apply the carrier's
// own terrain costs, which are the wrong unit's.
function dropHexes(state: SimState, carrierIndex: number, passenger: SimUnit, skill: SkillDef): Array<[number, number]> {
    const carrier = state.getUnit(carrierIndex);
    if (!carrier) return [];
    const costs = UnitSystem.unitTypesRecord[passenger.type]?.terrainCosts ?? {};
    const spots: Array<[number, number]> = [];
    for (const spot of HexCoord.getNeighbors(carrier.q, carrier.r)) {
        const distance = HexCoord.getDistance(carrier.q, carrier.r, spot.q, spot.r);
        if (distance < skill.minRange || distance > skill.maxRange) continue;
        const tile = state.getTile(spot.q, spot.r);
        if (!tile || costs[tile.type] == null) continue;
        if (state.getUnitAt(spot.q, spot.r)) continue;
        // Never onto a building. An unload is not a move, so it records no
        // unitMoved and derives no capture -- meaning a passenger dropped
        // on a depot door would capture in NEITHER the simulation nor the
        // live game, and the search would see a door it can never take. The
        // rule is that you walk in the door.
        if (state.getBuildingAt(spot.q, spot.r)) continue;
        spots.push([spot.q, spot.r]);
    }
    return spots;
}

export const unloadGene: GeneDefinition = {
    applicable(state, unitIndex) {
        const skill = skillFor(state, unitIndex, DROVER_UNLOAD.id);
        if (!skill) return false;
        const riders = carriedBy(state, unitIndex);
        if (riders.length === 0) return false;
        return dropHexes(state, unitIndex, riders[0][1], skill).length > 0;
    },

    apply(state, gene) {
        const skill = skillFor(state, gene.unitIndex, DROVER_UNLOAD.id);
        if (!skill) return false;
        const riders = carriedBy(state, gene.unitIndex);
        if (riders.length === 0) return false;
        const [passengerIndex, passenger] = riders[0];

        const spots = dropHexes(state, gene.unitIndex, passenger, skill);
        if (spots.length === 0) {
            // Nowhere to put it down. Drive toward the enemy instead of
            // failing outright -- an APC whose only legal action is
            // unloading would otherwise sit still whenever it is boxed in.
            return false;
        }

        // Toward the nearest enemy, so the delivery goes where the fight
        // is rather than wherever the neighbour list happened to start.
        const carrier = state.getUnit(gene.unitIndex)!;
        let target: [number, number] = spots[0];
        let bestDistance = Infinity;
        for (const [q, r] of spots) {
            for (const [, enemy] of state.liveUnits()) {
                if (enemy.playerIndex === carrier.playerIndex || enemy.carriedBy !== null) continue;
                const distance = HexCoord.getDistance(q, r, enemy.q, enemy.r);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    target = [q, r];
                }
            }
        }

        state.record({
            type: 'unitUnloaded',
            carrierIndex: gene.unitIndex,
            passengerIndex,
            toQ: target[0],
            toR: target[1],
            skillId: skill.id,
        });
        return true;
    },
};
