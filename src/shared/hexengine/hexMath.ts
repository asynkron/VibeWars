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

// Steps between two hexes.
export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
    const a = hexToCube(q1, r1);
    const b = hexToCube(q2, r2);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

// Aliases under HexCoord's own names, so the simulation layer can do
// `import * as HexCoord from './hexMath'` and read exactly as it did when
// it imported the class. Keeps the call sites unchanged and the diff
// honest about what actually moved: the dependency, not the arithmetic.
export const getNeighbors = hexNeighbors;
export const getDistance = hexDistance;
