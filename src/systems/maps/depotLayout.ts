// Where a forge depot's four pieces sit, for any of its six orientations.
//
// The depot is the anchor hex plus its SOUTH-WEST, SOUTH and SOUTH-EAST
// neighbours -- three consecutive hex directions, so the shape is a fan
// opening south, not a compass rose. The four models are cut for exactly
// that: each one's open edges face inward and its capped edges face out, so
// the arrangement is not negotiable, only its heading is.
//
// WHY THIS FILE EXISTS. Both map providers used to spell the cells out as
// `(q-1,r)`, `(q+1,r)`, `(q,r+1)` -- which is the fan only on an EVEN
// column. On an odd one those three cells are somewhere else entirely and
// the trim ends up buried inside the building. Both files carried the same
// hardcoded table and the same shouted comment about parity, and between
// them they could place a depot two ways: facing south, or the whole map
// point-reflected so it faced north.
//
// Doing the turn in cube coordinates removes both limits at once. A sixth
// of a turn is one permutation with a sign flip, identical for every hex on
// the board, so all six headings come out of the same three offsets -- and
// the parity rule disappears, because nothing is spelled out in offset
// coordinates any more.
import { hexToCube, cubeToHex, cubeRotate60 } from '../../shared/hexengine/hexMath';
import type { BuildingSpawn } from '../../types';

// The fan at rest, as cube offsets from the anchor: south-west, south,
// south-east. Paired with the model that is cut for that corner.
//
// The names are POSITIONS IN THE FAN, not compass directions, and stop
// being literal the moment the depot turns -- at two sixths the piece
// called `forgeDepotN` faces south-east. Renaming them would reach into
// BuildingType, the .glb files and the tests for no gain: what the names
// have to encode is which model joins which, and they still do.
const FAN: Array<[BuildingSpawn['type'], number, number, number]> = [
    ['forgeDepotN', 0, 0, 0],
    ['forgeDepotW', -1, 0, 1],
    ['forgeDepotS', 0, -1, 1],
    ['forgeDepotE', 1, -1, 0],
];

// Six, and every one of them a legal arrangement -- a hex turned a sixth of
// a turn maps every edge onto another edge, so the trim still lands on
// edges, just different ones.
export const DEPOT_TURNS = [0, 1, 2, 3, 4, 5] as const;

export type DepotCell = [BuildingSpawn['type'], number, number];

// The four cells this depot occupies, anchored at (q, r) and turned
// `turns` sixths. Any anchor column works.
export function depotCells(q: number, r: number, turns: number = 0): DepotCell[] {
    const anchor = hexToCube(q, r);
    const steps = ((turns % 6) + 6) % 6;
    return FAN.map(([type, dx, dy, dz]) => {
        let v = { x: dx, y: dy, z: dz };
        for (let i = 0; i < steps; i++) v = cubeRotate60(v.x, v.y, v.z);
        const cell = cubeToHex(anchor.x + v.x, anchor.z + v.z);
        return [type, cell.q, cell.r];
    });
}

// What to write into the spawn so BuildingSystem turns the models with the
// cells. It applies rotationDeg verbatim, so the two only agree while
// cubeRotate60 turns the same way a positive Y rotation does.
export function depotRotationDeg(turns: number): number {
    return (((turns % 6) + 6) % 6) * 60;
}
