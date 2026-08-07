// Hex-grid arithmetic, with no dependency on three.js or on anything that
// renders.
//
// It used to live only in HexCoord, which imports GridSystem -- whose class
// body runs `new THREE.TextureLoader()` at module scope. That put a live
// WebGL context between the pure simulation layer and a distance
// calculation, and is what stopped the AI search from running anywhere
// without a canvas.
//
// HexCoord re-exports these, so every existing caller is unchanged.

// Odd-q offset coordinates, the layout GridSystem builds: odd columns sit
// half a row lower, so which rows count as adjacent depends on the
// column's parity. Getting this wrong is invisible on even columns and
// wrong on every other one.
export function hexNeighbors(q: number, r: number): { q: number; r: number }[] {
    const isOddColumn = q % 2 === 1;
    return [
        { q: q - 1, r: r - (isOddColumn ? 0 : 1) },
        { q: q, r: r - 1 },
        { q: q + 1, r: r - (isOddColumn ? 0 : 1) },
        { q: q + 1, r: r + 1 - (isOddColumn ? 0 : 1) },
        { q: q, r: r + 1 },
        { q: q - 1, r: r + 1 - (isOddColumn ? 0 : 1) },
    ];
}

// Offset to cube coordinates, where distance is a simple max of the axes.
export function hexToCube(q: number, r: number): { x: number; y: number; z: number } {
    const x = q;
    const z = r - (q - (q & 1)) / 2;
    const y = -x - z;
    return { x, y, z };
}

// Cube back to odd-q offset. The exact inverse of hexToCube -- both write
// the same `(q - (q & 1)) / 2` term, so they agree on negative columns too,
// where JS's & on a negative odd number still yields 1.
export function cubeToHex(x: number, z: number): { q: number; r: number } {
    return { q: x, r: z + (x - (x & 1)) / 2 };
}

// One sixth of a turn, applied to a cube VECTOR (an offset between two
// hexes, not a position).
//
// This exists because rotating a multi-hex shape is trivial here and a trap
// in offset coordinates, where which cells are adjacent depends on the
// column's parity -- the reason the forge depot was pinned to even columns
// and to two orientations. In cube space a turn is a permutation with a
// sign flip, the same one for every hex on the board, and six applications
// return the original.
//
// The direction is the one that matches a POSITIVE three.js rotation about
// Y in this grid's layout (x = 1.5q, z = sqrt(3)(r + (q%2)/2)), so cells and
// models turn together. Get this backwards and a depot's edge trim ends up
// facing inward -- which is exactly what the parity rule was guarding
// against, so it fails the same way and is worth eyeballing rather than
// trusting.
export function cubeRotate60(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return { x: -y, y: -z, z: -x };
}

// Steps between two hexes. Written out rather than composed from
// hexToCube: the AI search asks this for every (unit, enemy) pair in every
// scored child, millions of times per turn, and two cube objects per call
// were pure GC pressure. Same arithmetic as hexToCube, same answers --
// with x = q, the y axis is -x - z, so dy = -dx - dz.
export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
    const z1 = r1 - (q1 - (q1 & 1)) / 2;
    const z2 = r2 - (q2 - (q2 & 1)) / 2;
    const dx = q1 - q2;
    const dz = z1 - z2;
    const dy = -dx - dz;
    return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

// Aliases under HexCoord's own names, so the simulation layer can do
// `import * as HexCoord from './hexMath'` and read exactly as it did when
// it imported the class. Keeps the call sites unchanged and the diff
// honest about what actually moved: the dependency, not the arithmetic.
export const getNeighbors = hexNeighbors;
export const getDistance = hexDistance;
