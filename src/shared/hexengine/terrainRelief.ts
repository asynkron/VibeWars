// Coherent, deterministic relief for authored maps.
//
// The old per-tile height was `base + hash(cell) * variation` -- WHITE
// NOISE. Every tile drew its own number with no reference to its
// neighbours, so nothing ever rose or fell across more than one hex. On the
// 12x18 map that put the middle half of all land inside a band 0.153 high,
// which is what "the grass is very flat" means numerically: the ground has
// no features, only jitter, and the corner-averaging in
// GridSystem.smoothHexTile then averages most of the jitter away again.
//
// This is value noise instead: heights are drawn on a LATTICE coarser than
// the hex grid and interpolated between, so a hillside spans several hexes
// and reads as a hillside. Three octaves -- a broad one for the shape of
// the land, a middle one for shoulders and hollows, a fine one so the
// surface is not glassy.
//
// EVERYTHING HERE IS PURE AND DETERMINISTIC. No Math.random, no Date, no
// module state: the same cell yields the same height on every load, in the
// browser and in the headless simulation, which is what makes a competitive
// map a competitive map. It also imports nothing, so the simulation and its
// workers can call it (see systems/sim/workerSafety.test.ts).

// Odd-q offset -> world units, measured in hex RADII. Adjacent columns are
// 1.5 radii apart and adjacent rows sqrt(3), with odd columns pushed half a
// row down. Working in world units rather than in (q, r) is what keeps the
// noise ISOTROPIC: a ridge is the same width whichever way it runs, which
// it would not be if the lattice were laid out on the raw indices.
const SQRT3 = 1.7320508075688772;

export function hexToWorldUnits(q: number, r: number): [number, number] {
    return [1.5 * q, SQRT3 * (r + 0.5 * (q & 1))];
}

// 32-bit integer hash. Math.imul, not `*`, because a plain multiply of two
// 32-bit values overflows the 53 bits a double can hold exactly and silently
// drops the low bits -- which is where a hash keeps its quality.
function latticeValue(ix: number, iy: number, seed: number): number {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296; // [0, 1)
}

// Smoothstep, so the interpolation has zero slope at the lattice points.
// Plain linear interpolation would leave a visible crease along every
// lattice line -- the terrain equivalent of a low-poly seam.
function ease(t: number): number {
    return t * t * (3 - 2 * t);
}

// Value noise in [0, 1): four lattice corners, eased bilinear blend.
function valueNoise(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = ease(x - x0);
    const fy = ease(y - y0);
    const n00 = latticeValue(x0, y0, seed);
    const n10 = latticeValue(x0 + 1, y0, seed);
    const n01 = latticeValue(x0, y0 + 1, seed);
    const n11 = latticeValue(x0 + 1, y0 + 1, seed);
    const top = n00 + (n10 - n00) * fx;
    const bottom = n01 + (n11 - n01) * fx;
    return top + (bottom - top) * fy;
}

// Octaves, in hex RADII. 1.5 radii per column and sqrt(3) per row, so a
// hex step is about 1.73 units -- divide a wavelength by that to read it in
// hexes.
//
//   11.0 units ~ 6.4 hexes   the shape of the land: one broad rise and one
//                            broad hollow across a 12-wide map, which is
//                            what you want to be able to see from the game
//                            camera without the map turning into dunes.
//    4.6 units ~ 2.7 hexes   shoulders and hollows hanging off the big
//                            shapes, at the scale a unit moves in a turn.
//    2.0 units ~ 1.2 hexes   surface texture, just above per-tile. Kept
//                            small so it never dominates: this is the ONLY
//                            octave the old white-noise field had.
//
// The weights fall off faster than the usual 1/2 per octave because the
// tiles are large and the geometry is faceted -- a hex is a flat plate, so
// high-frequency detail lands as a stray tilted tile rather than as detail.
const OCTAVES: Array<[wavelength: number, weight: number, seed: number]> = [
    [11.0, 1.0, 0x5f1],
    [4.6, 0.4, 0xb27],
    [2.0, 0.15, 0x3ad],
];

const TOTAL_WEIGHT = OCTAVES.reduce((sum, [, weight]) => sum + weight, 0);

// Summed octaves at one point, normalised to [-1, 1].
function fieldAt(q: number, r: number): number {
    const [x, y] = hexToWorldUnits(q, r);
    let total = 0;
    for (const [wavelength, weight, seed] of OCTAVES) {
        total += (valueNoise(x / wavelength, y / wavelength, seed) - 0.5) * 2 * weight;
    }
    return total / TOTAL_WEIGHT;
}

// Relief in [-1, 1] at a cell, SYMMETRIC UNDER THE MAP'S OWN ROTATION.
//
// This is the part that matters for a competitive map, and it is worth
// being precise about why it is exact rather than approximate.
//
// The old code got symmetry by evaluating the noise at the SOURCE cell --
// the northern cell a southern one copies. That works for white noise,
// where neighbours are unrelated anyway. It does NOT work for coherent
// noise: the field would run continuously down the northern half and then
// jump to a completely different part of itself at the waist, leaving a
// seam straight across the middle of the map.
//
// So the field is symmetrised instead. For the half-turn map
// (q, r) -> (cols-1-q, rows-1-r), take any continuous field f and average
// it with its own image:
//
//     relief(q, r) = (f(q, r) + f(cols-1-q, rows-1-r)) / 2
//
// Evaluate that at the rotated cell and the two terms simply swap places.
// Floating-point addition is COMMUTATIVE -- a + b and b + a produce the
// same bits, unlike addition of three or more terms, which is not
// associative -- and halving is exact in binary. So the two cells agree
// bit for bit, not merely to within a tolerance. And because it is built
// from a continuous field it is itself continuous: no seam.
export function symmetricRelief(q: number, r: number, cols: number, rows: number): number {
    return (fieldAt(q, r) + fieldAt(cols - 1 - q, rows - 1 - r)) / 2;
}

// How far, in hexes, every cell is from the nearest tile matching a
// predicate -- a breadth-first flood over the odd-q neighbourhood.
// Distances are integers, so a symmetric input set gives an exactly
// symmetric output with no floating point involved at all.
export function distanceField(
    cols: number,
    rows: number,
    isSource: (q: number, r: number) => boolean
): number[][] {
    const dist: number[][] = [];
    const queue: Array<[number, number]> = [];
    for (let q = 0; q < cols; q++) {
        dist[q] = [];
        for (let r = 0; r < rows; r++) {
            if (isSource(q, r)) {
                dist[q][r] = 0;
                queue.push([q, r]);
            } else {
                dist[q][r] = Infinity;
            }
        }
    }
    for (let head = 0; head < queue.length; head++) {
        const [q, r] = queue[head];
        const even = q % 2 === 0;
        const offsets = even
            ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
            : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
        for (const [dq, dr] of offsets) {
            const nq = q + dq;
            const nr = r + dr;
            if (nq < 0 || nr < 0 || nq >= cols || nr >= rows) continue;
            if (dist[nq][nr] !== Infinity) continue;
            dist[nq][nr] = dist[q][r] + 1;
            queue.push([nq, nr]);
        }
    }
    return dist;
}

// How much of a tile's height above the waterline survives, given how many
// hexes it is from open water. Zero at the water's edge, one once the
// shore is out of reach.
//
// THIS IS THE FIX FOR THE CRATERS. Nothing was wrong with the renderer:
// GridSystem.smoothHexTile pulls a land tile's water-facing corners down to
// the waterline so the beach MEETS the water instead of hanging over it,
// which is right. The problem was that the land was authored a full unit
// too high at the water's edge -- median 1.028 -- so "meeting the water"
// meant falling 1.028 across half a hex, six times the entire variation of
// the rest of the map. A ring of that around a lake is a crater wall, and
// that is exactly what it looked like.
//
// Sloping the ground into the water over three hexes leaves the same
// renderer snapping a drop of about 0.2, which is a beach.
export function shoreFactor(hexesFromWater: number, reach: number): number {
    if (!isFinite(hexesFromWater) || hexesFromWater >= reach) return 1;
    if (hexesFromWater <= 0) return 0;
    return ease(hexesFromWater / reach);
}
