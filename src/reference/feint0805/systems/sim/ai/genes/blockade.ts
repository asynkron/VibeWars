// BLOCKADE -- stand where your body buys the most road. The gene picks
// the reachable hex that MAXIMIZES the binding enemy's path cost to a
// firing position against our most fragile unit, with the board exactly
// as it stands -- allies included. Severing the path entirely counts as
// infinite, which is what a body in a doorway is worth.
//
// Born from the retreat board, where the whole loss was one missing word:
// a Kloss that proved it could stand unmoved for nine turns under fire --
// in the wrong place. Every gene could advance, flee, or shoot; none
// could say "my body is worth more as architecture than as damage".
//
// THE GENE PROPOSES, THE BEAM JUDGES. The internal ranking here only
// decides which candidate line gets born; a block that fails shows the
// protectee dying in the rollouts and the line is culled. So the ranking
// must be directionally right and CHEAP, not perfect.
//
// Cost control, in order:
//   - candidates are filtered to hexes on some TERRAIN-shortest path from
//     the threat to the protectee (two already-cached cost fields; a hex
//     off every shortest path cannot raise the first blocked cost),
//   - the exact value is then a real unit-aware search from the threat,
//     but BOUNDED: once the rerouted cost exceeds baseline + slack the
//     block counts as severed and the search stops,
//   - threats are capped to the nearest few, candidates to a handful.
//
// TWO BLOCKERS COMPOSE FOR FREE. Genes apply sequentially against the
// branch, so when the first Kloss has taken the left tile of a two-wide
// pass, the second one's evaluation runs on a board where that tile is
// already a wall -- and its own delta becomes the full sever. The plan
// shuffle covers both orders; the twin-pass board is the acceptance test.

import * as HexCoord from '../../../../shared/hexengine/hexMath';
import * as UnitSystem from '../../../../shared/hexengine/unitStats';
import { GeneDefinition, recordSimMove } from '../../SimCommands';
import { simDijkstra, simCostFieldFrom } from '../../SimPathfinding';
import { SimState, SimUnit } from '../../SimState';

export const BLOCKADE = 'blockade';

// How far past the unblocked cost a reroute may run before it counts as
// severed. Generous enough that a real detour still measures, small
// enough that the bounded search stays cheap.
const SEVER_SLACK = 8;
const SEVERED = Infinity;
const MAX_CANDIDATES = 6;
const MAX_THREATS = 3;

// The most fragile OTHER own unit -- the one whose loss the formation
// exists to prevent. Lowest hp, index breaking ties.
function protecteeOf(state: SimState, unitIndex: number): [number, SimUnit] | null {
    const self = state.getUnit(unitIndex);
    if (!self) return null;
    let best: [number, SimUnit] | null = null;
    for (const [i, unit] of state.activeUnits()) {
        if (i === unitIndex || unit.playerIndex !== self.playerIndex) continue;
        if (!best || unit.hp < best[1].hp) best = [i, unit];
    }
    return best;
}

// Enemies that can actually shoot the protectee, nearest first, capped.
function threatsAgainst(state: SimState, protectee: SimUnit): Array<[number, SimUnit]> {
    const threats: Array<[number, SimUnit, number]> = [];
    for (const [i, enemy] of state.activeUnits()) {
        if (enemy.playerIndex === protectee.playerIndex) continue;
        if (!UnitSystem.canTarget(enemy.type, protectee.type)) continue;
        threats.push([i, enemy, HexCoord.getDistance(enemy.q, enemy.r, protectee.q, protectee.r)]);
    }
    threats.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
    return threats.slice(0, MAX_THREATS).map(([i, u]) => [i, u]);
}

// Unit-aware bounded dijkstra from one threat to its nearest FIRING hex
// against the protectee: any hex within the threat's own attack bracket of
// the protectee's position. `blockedKey` is the candidate placement being
// tried; `ignoreIndex` is the blockader itself, whose current hex must
// read as free because it has hypothetically left.
function threatCostToRing(
    state: SimState,
    threat: SimUnit,
    protectee: SimUnit,
    blockedKey: number | null,
    ignoreIndex: number,
    cap: number
): number {
    const cols = state.cols;
    const rows = state.rows;
    const costs = UnitSystem.unitTypesRecord[threat.type].terrainCosts;
    const inRing = (q: number, r: number) => {
        const d = HexCoord.getDistance(q, r, protectee.q, protectee.r);
        return d >= threat.minRange && d <= threat.maxRange;
    };
    const startKey = threat.r * cols + threat.q;
    if (inRing(threat.q, threat.r)) return 0;

    const dist = new Map<number, number>([[startKey, 0]]);
    // A tiny frontier list beats importing a heap for searches this
    // bounded; the cap keeps the whole thing a few dozen hexes.
    const open: number[] = [startKey];
    while (open.length > 0) {
        let bestAt = 0;
        for (let i = 1; i < open.length; i++) {
            if (dist.get(open[i])! < dist.get(open[bestAt])!) bestAt = i;
        }
        const currentKey = open.splice(bestAt, 1)[0];
        const currentCost = dist.get(currentKey)!;
        if (currentCost > cap) return SEVERED;
        const cq = currentKey % cols;
        const cr = (currentKey - cq) / cols;
        for (const n of HexCoord.getNeighbors(cq, cr)) {
            if (n.q < 0 || n.q >= cols || n.r < 0 || n.r >= rows) continue;
            const key = n.r * cols + n.q;
            if (key === blockedKey) continue;
            const standing = state.getUnitAt(n.q, n.r);
            if (standing && standing[0] !== ignoreIndex) continue;
            const tile = state.getTile(n.q, n.r);
            if (!tile) continue;
            const step = tile.hasRoad ? 0.5 : (costs[tile.type] || null);
            if (!step) continue;
            const next = currentCost + step;
            if (next >= (dist.get(key) ?? Infinity)) continue;
            if (inRing(n.q, n.r)) return next;
            dist.set(key, next);
            open.push(key);
        }
    }
    return SEVERED;
}

// min over the capped threat list -- the BINDING path is the only one a
// block can be judged by; sealing one lane while another is open is worth
// what the open lane says, nothing more.
function bindingCost(
    state: SimState,
    threats: Array<[number, SimUnit]>,
    protectee: SimUnit,
    blockedKey: number | null,
    ignoreIndex: number,
    cap: number
): number {
    let worst = SEVERED;
    for (const [, threat] of threats) {
        const cost = threatCostToRing(state, threat, protectee, blockedKey, ignoreIndex, cap);
        if (cost < worst) worst = cost;
        if (worst === 0) break;
    }
    return worst;
}

export const blockadeGene: GeneDefinition = {
    // Additive, never a hidden advance -- the press family's lesson.
    fallback: 'idle',

    applicable(state, unitIndex) {
        const unit = state.getUnit(unitIndex);
        if (!unit) return false;
        const found = protecteeOf(state, unitIndex);
        if (!found) return false;
        return threatsAgainst(state, found[1]).length > 0;
    },

    apply(state, gene) {
        const unit = state.getUnit(gene.unitIndex);
        if (!unit) return false;
        const found = protecteeOf(state, gene.unitIndex);
        if (!found) return false;
        const protectee = found[1];
        const threats = threatsAgainst(state, protectee);
        if (threats.length === 0) return false;

        const cols = state.cols;
        const currentKey = unit.r * cols + unit.q;
        const baseline = bindingCost(state, threats, protectee, null, -1, 999);
        if (baseline === 0) return false; // already in the ring; blocking is over
        const cap = Math.min(999, baseline + SEVER_SLACK);

        // Candidates: reachable hexes on some terrain-shortest path from
        // the binding threat to the protectee (cached fields), plus where
        // we already stand. Off-path hexes cannot raise the FIRST blocked
        // cost, so they are not worth an exact search.
        const [, binding] = threats[0];
        const fromThreat = simCostFieldFrom(state, binding.type, binding.q, binding.r);
        const fromProtectee = simCostFieldFrom(state, binding.type, protectee.q, protectee.r);
        const straight = fromThreat.get(protectee.r * cols + protectee.q);

        // NEAR-shortest, not exactly-shortest: the fields are terrain-only
        // and cannot see that an ally already walls the best lane, so the
        // second blocker of a two-wide pass lives on a +1 path. The
        // tolerance admits it; the exact evaluation below tells the truth.
        const candidates: Array<[number, number]> = [];
        if (unit.move > 0 && straight !== undefined) {
            const { reachable } = simDijkstra(state, gene.unitIndex, unit.move);
            for (const key of reachable) {
                if (key === currentKey) continue;
                const a = fromThreat.get(key);
                const b = fromProtectee.get(key);
                if (a === undefined || b === undefined) continue;
                if (a + b <= straight + 2) candidates.push([key, a + b]);
            }
            // Truest corridor hexes first, deterministic, capped.
            candidates.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
            candidates.length = Math.min(candidates.length, MAX_CANDIDATES);
        }

        // Where does my body buy the most road? Ties are where the design
        // lives:
        //   SEVERED ties -- all full cuts are equal to the enemy but not
        //   to us, so prefer OUR side of the water (nearer the protectee
        //   along the ground): the door over the corridor in front of it.
        //   FINITE ties -- prefer a hex with FEWER passable neighbours
        //   than where we stand. This is the first-mover rule for a
        //   two-wide pass: the hex metric prices the detour around one of
        //   two ADJACENT tiles at zero, so the first body's delta is
        //   nothing -- but standing IN the pass is what lets the second
        //   body's evaluation see a wall and complete the sever. On open
        //   fields every hex has six neighbours, so the rule never
        //   wanders.
        const passableDegree = (key: number): number => {
            const q = key % cols;
            const r = (key - q) / cols;
            let open = 0;
            for (const n of HexCoord.getNeighbors(q, r)) {
                if (n.q < 0 || n.q >= cols || n.r < 0 || n.r >= rows) continue;
                const tile = state.getTile(n.q, n.r);
                if (!tile) continue;
                const costsHere = UnitSystem.unitTypesRecord[unit.type].terrainCosts;
                if (tile.hasRoad || costsHere[tile.type]) open++;
            }
            return open;
        };
        const rows = state.rows;

        let bestKey = currentKey;
        let bestValue = bindingCost(state, threats, protectee, currentKey, gene.unitIndex, cap);
        for (const [key] of candidates) {
            const value = bindingCost(state, threats, protectee, key, gene.unitIndex, cap);
            const better = value > bestValue
                || (value === bestValue && value === SEVERED
                    && (fromProtectee.get(key) ?? Infinity) < (fromProtectee.get(bestKey) ?? Infinity))
                || (value === bestValue && value !== SEVERED
                    && passableDegree(key) < passableDegree(bestKey));
            if (better) {
                bestValue = value;
                bestKey = key;
            }
        }

        if (bestKey === currentKey) return false; // holding needs no event
        const { distances } = simDijkstra(state, gene.unitIndex, unit.move);
        const cost = distances.get(bestKey);
        if (cost === undefined) return false;
        const toQ = bestKey % cols;
        recordSimMove(state, gene.unitIndex, toQ, (bestKey - toQ) / cols, cost);
        return true;
    },
};
