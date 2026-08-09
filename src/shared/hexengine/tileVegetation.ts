// Does this tile have burnable greenery drawn on it?
//
// Fire needs an answer both sides agree on. The renderer knows, because it
// drew the scenery; the simulation must know too, and it can never ask --
// ProceduralDecorations is on workerSafety's FORBIDDEN list, and the AI's
// import graph has to stay canvas-free.
//
// So the decision moves here, import-free, and BOTH sides call it. That is
// the same split unitStats/terrainStats/skills already made: the renderer
// keeps the meshes, the rule moves somewhere the worker can reach.
//
// WHY THIS FILE IMPORTS NOTHING, not even `hash` from ./utils: utils.ts
// line 2 is `import { GridSystem } from './GridSystem'`, so pulling one
// seven-line integer function out of it drags in the whole renderer and
// dies on `new THREE.TextureLoader()` at module load inside a worker. The
// hash is copied below rather than imported, and tileVegetation.test.ts
// pins the copy against the original's output.
//
// The predicate REPLAYS ProceduralDecorations.createProceduralDecoration's
// rng stream rather than guessing at it, because the two must agree exactly
// -- a fire on a visibly bare tile is the bug this file exists to prevent.
// Draw costs of the helpers it has to skip past: pick() = 1, place() = 3
// with spin and 2 without (scatter draws 2, the spin draws 1).

// Copy of utils.hash. See the note above for why it is a copy.
function hash(seed: number): number {
    let h = seed;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return h;
}

// Copy of ProceduralDecorations.tileRng -- mulberry32 seeded per (q, r), so
// the same tile always dresses itself the same way.
export function tileRng(q: number, r: number): () => number {
    let a = (hash(q * 733 + r * 3079) ^ 0x9e3779b9) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The height below which a MOUNTAIN tile is "foot" -- alive with undergrowth
// rather than bare rock. Mirrors ProceduralDecorations' `foot` test.
const MOUNTAIN_FOOT_HEIGHT = 2.0;

// Whether the scenery on this tile can catch fire.
//
// GREENERY BURNS, STONE DOES NOT, and the difference is not visible from
// "does this tile have a decorator". SAND is decorated 35% of the time and
// every one of those is rocks; a third of what MOUNTAIN places is rocks too.
// Treating "decorated" as "burnable" is the easy way to set fire to bare
// gravel, so this walks the same branches the generator does and counts only
// conifers, deciduous trees, bushes, tufts, logs and dead trees.
//
// `tileHeight` is the height the tile was DECORATED at, which is not
// necessarily its height now -- craters lower tiles and the scenery is never
// regenerated. Callers must pass the height from map build time; see
// FireState, which snapshots this once and never asks again.
export function hasVegetation(terrainType: string, q: number, r: number, tileHeight: number = 0): boolean {
    switch (terrainType) {
        // Always a grove: 3-5 trees, and FOREST never emits rocks.
        case 'FOREST':
            return true;

        // One roll decides all four branches, and it is the first draw:
        // <0.30 bushes, <0.45 a lone deciduous, <0.52 a dead tree or log,
        // and above that bare grassland. None of them is stone, so here
        // "has vegetation" really is "has anything".
        case 'GRASS':
            return tileRng(q, r)() < 0.52;

        // Rocks only, ever. No roll needed -- and deliberately not taken,
        // so nothing downstream depends on this branch's stream position.
        case 'SAND':
            return false;

        // The only terrain that needs the stream replayed, because rocks
        // must be skipped without being counted, and skipping them still
        // costs the draws they would have made.
        case 'MOUNTAIN': {
            const rng = tileRng(q, r);
            let vegetated = false;
            if (tileHeight < MOUNTAIN_FOOT_HEIGHT) {
                if (rng() < 0.55) { vegetated = true; skip(rng, 4); }   // tuft: pick 1 + place-spin 3
                if (rng() < 0.45) { vegetated = true; skip(rng, 3); }   // bush: pick 1 + place-no-spin 2
                if (rng() < 0.4) skip(rng, 3);                          // rocks: not vegetation
            } else if (rng() < 0.5) {
                skip(rng, 3);                                           // rocks: not vegetation
            }
            // The rare hardy conifer, at any height.
            if (rng() < 0.08) vegetated = true;
            return vegetated;
        }

        // WATER and anything else: the generator returns null.
        default:
            return false;
    }
}

// The generator may have chosen vegetation for this terrain position, but
// roads and buildings replace it before anything is drawn. Fire must answer
// for the scenery that survives those placement passes, not for the hidden
// procedural choice underneath them.
export function hasBurnableVegetation(
    terrainType: string,
    q: number,
    r: number,
    tileHeight: number,
    hasRoad: boolean,
    hasBuilding: boolean,
): boolean {
    return !hasRoad && !hasBuilding && hasVegetation(terrainType, q, r, tileHeight);
}

function skip(rng: () => number, draws: number): void {
    for (let i = 0; i < draws; i++) rng();
}
