// Procedural hex decorations -- no model assets. Simple primitive
// assemblies (cones, blobs, boxes) generated deterministically per tile
// from a (q, r)-seeded PRNG, and matched to the TERRAIN TYPE instead of
// the old "any random OBJ on any tile" table:
//
//   FOREST    a small grove: 3-5 trees, conifer-heavy with some deciduous
//   GRASS     occasional bushes, sometimes a lone deciduous tree
//   SAND      sparse beach stones
//   MOUNTAIN  undergrowth at the foot, the rare conifer -- never stones
//   WATER     nothing
//
// Each decoration is a THREE.Group registered as the hex's decorator, so
// all existing behaviors keep working: unit-on-tile transparency dimming
// (traverses child meshes), removal when the tile sinks into water, and
// the factory decorator replacing it on building tiles.

import { PERTURB_GLSL } from './PerturbNormalShader';
import { childBranchLength } from './deciduousTreeMath';

// Kept local for the same reason as tileVegetation's pinned copy: utils.ts
// imports GridSystem, while this leaf render module must also be usable by
// focused viewers without booting the complete map dependency graph.
function hash(seed: number): number {
    let h = seed;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return h;
}

// Deterministic per-tile PRNG (mulberry32 over a q/r hash).
function tileRng(q: number, r: number): () => number {
    let a = (hash(q * 733 + r * 3079) ^ 0x9e3779b9) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function vary(color: number, rng: () => number, amount: number): number {
    const c = new THREE.Color(color);
    const f = 1 + (rng() - 0.5) * 2 * amount;
    c.r = Math.min(1, c.r * f);
    c.g = Math.min(1, c.g * f);
    c.b = Math.min(1, c.b * f);
    return c.getHex();
}

// Per-channel lerp between two hex colors -- the foliage palettes are
// RANGES, not single greens. Each tree picks its spot on the range from a
// hash of values the rng stream already drew, so a stand of trees drifts
// from dark spruce-green through olive to sunlit yellow-green instead of
// splitting into "the light kind and the dark kind".
function lerpHex(a: number, b: number, t: number): number {
    const ch = (shift: number) => {
        const from = (a >> shift) & 255;
        const to = (b >> shift) & 255;
        return Math.round(from + (to - from) * t) << shift;
    };
    return ch(16) | ch(8) | ch(0);
}

// 0..1 from an integer seed, for the per-tree palette picks above.
function seedT(seed: number): number {
    return (hash(seed) & 1023) / 1023;
}

// A tile-specific angle that consumes NO decoration rng draws. The worker's
// vegetation predicate replays that stream exactly, so visual variation must
// not move anything downstream in it.
export function rockRotationForTile(q: number, r: number, rockIndex: number): number {
    const seed = Math.imul(q, 73856093) ^ Math.imul(r, 19349663) ^ Math.imul(rockIndex + 17, 83492791);
    return seedT(seed) * Math.PI * 2;
}

// A dark, cool-gray target for living foliage. The amount is stored on
// the cloned tree's foliage meshes and baked into the merged tile colours,
// so every placed tree can have its own tone without cloning materials or
// adding shader programs.
const FOLIAGE_DARK_GRAY = { r: 0x2f / 255, g: 0x33 / 255, b: 0x35 / 255 };

function addFoliageGrayHint(tree: any, amount: number, foliageKind: number): void {
    tree.traverse((child: any) => {
        const kind = child.userData?.decorKind;
        if (child.isMesh && (kind === foliageKind || kind === 3)) {
            child.userData.decorGrayHint = amount;
        }
    });
}

// Irregularize a primitive: displace every vertex by a hash of its
// QUANTIZED POSITION (plus a per-mesh seed). Position-keyed on purpose,
// twice over: duplicated vertices (polyhedron soups, cone seams) share a
// position and therefore move identically, so flat-shaded meshes stay
// watertight -- and NO rng is drawn, so tileVegetation's replay of the
// decoration stream is untouched. This is most of what un-gumdrops the
// crowns: the silhouette breaks before any shading gets involved.
function roughen(geometry: any, seed: number, amount: number, facet: boolean = false): any {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const key = ((Math.round(x * 1024) * 73856093) ^ (Math.round(y * 1024) * 19349663)
            ^ (Math.round(z * 1024) * 83492791) ^ Math.imul(seed + 1, 0x9e3779b9)) | 0;
        const h1 = (hash(key) & 1023) / 1023 - 0.5;
        const h2 = (hash(key ^ 0x68bc21eb) & 1023) / 1023 - 0.5;
        const h3 = (hash(key ^ 0x02e5be93) & 1023) / 1023 - 0.5;
        pos.setXYZ(i, x + h1 * amount, y + h2 * amount, z + h3 * amount);
    }
    pos.needsUpdate = true;
    // REAL normals, now that the decoration material is smooth-shaded.
    // Foliage blobs are vertex soup (non-indexed polyhedra), where
    // computeVertexNormals can only give per-face facets -- exactly the
    // cut-gem look we are leaving. Radial normals make a blob shade as one
    // round canopy however lumpy the jitter left it. Indexed geometry
    // (cones) averages properly, and rocks OPT INTO facets: a boulder
    // should read as split stone, not a pillow.
    if (facet || geometry.index) {
        geometry.computeVertexNormals();
    } else {
        const nor = geometry.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            const len = Math.sqrt(x * x + y * y + z * z) || 1;
            nor.setXYZ(i, x / len, y / len, z / len);
        }
        nor.needsUpdate = true;
    }
    return geometry;
}

// ---------------------------------------------------------------------
// Baked leaf-dot fields
//
// The crown's dot field used to be evaluated per fragment: three plane
// projections, nine cells each, six hashes a cell -- 162 sin() calls for
// every foliage pixel, on a fringe shell that covers 1.35x the crown and
// then discards most of what it computed.
//
// Measured with GPU timer queries (EXT_disjoint_timer_query_webgl2) on a
// tree-heavy view: hiding the decorations took the frame from ~22.4 ms of
// GPU time to ~13.5 ms, while removing only 83 of 423 draw calls and 52k
// of 58k triangles. No machine spends 9 ms on 52k triangles -- it was
// never the geometry, it was this field.
//
// Baked once into a texture, the same lookup is three fetches on hardware
// that is idle during all that ALU. TWO fields, because the callers differ
// in the one parameter a rescale cannot fake: `keep` decides which cells
// grow a dot at all, and that is baked in.
//
// The field TILES: cell coordinates wrap modulo LEAF_CELLS before they are
// hashed, so the texture repeats seamlessly. At the frequencies in use a
// cluster spans ~7 cells, under one period, so no single tuft ever shows
// the repeat -- it can only make two tufts resemble each other, which the
// per-cluster rotation already breaks up.
//
// These are JS ports of the GLSL below, not bit-identical to it: sin() in
// float64 and sin() in float32 diverge wildly once multiplied by 43758,
// and it does not matter, because nothing samples the old path any more.
// What DOES matter is that both fields come from this one function, so
// inner and outer leaves still share a lattice and line up.
const LEAF_TEX_SIZE = 256;
const LEAF_CELLS = 8;
const LEAF_DIST_INNER = 1.5;
const LEAF_DIST_FRINGE = 0.7;

function bakeHash(x: number, y: number): number {
    const s = Math.sin(x * 157.1 + y * 269.5) * 43758.5453123;
    return s - Math.floor(s);
}

function bakeNoise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = bakeHash(ix, iy);
    const b = bakeHash(ix + 1, iy);
    const c = bakeHash(ix, iy + 1);
    const d = bakeHash(ix + 1, iy + 1);
    const lo = a + (b - a) * ux;
    const hi = c + (d - c) * ux;
    return lo + (hi - lo) * uy;
}

// GLSL smoothstep, reversed edges included: the dot mask calls it with
// rOuter > rInner, which the spec handles as a descending ramp.
function bakeSmoothstep(e0: number, e1: number, x: number): number {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
}

// One exactly-uniform value per cell of the wrapped lattice.
//
// The shader hashed unbounded cell coordinates, so its values were a draw
// from uniform(0,1) with effectively infinite samples. A tiling bake has
// LEAF_CELLS^2 = 64 cells, and a 64-sample draw is visibly lumpy in both
// directions this value is used: `keep` gates on it, so a few cells too
// many above the threshold and the fringe comes out sparser than the field
// it replaces, and the same value indexes the cool->warm leaf palette, so a
// low-biased draw comes out darker as well. Measured against the old build
// over the same patch of canvas, the first attempt lost 27% of its foliage
// pixels and 12 points of mean green.
//
// Ranking the cells and handing out (rank + 0.5) / n keeps WHICH cell gets
// which value random, while making the distribution exact by construction.
function stratifiedCells(salt: number): Float32Array {
    const n = LEAF_CELLS * LEAF_CELLS;
    const key = new Float64Array(n);
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
        key[i] = bakeHash(i * 1.7 + salt, i * 0.31 + salt * 2.3);
        order.push(i);
    }
    order.sort((a, b) => key[a] - key[b]);
    const values = new Float32Array(n);
    for (let rank = 0; rank < n; rank++) values[order[rank]] = (rank + 0.5) / n;
    return values;
}

// Which cell grows a dot, and how bright/warm its leaves are.
const cellPick = /*@__PURE__*/ stratifiedCells(0);
// Where inside its cell that dot sits, on the axis the hash used to supply.
const cellOffsetY = /*@__PURE__*/ stratifiedCells(37.4);

// A DISTANCE FIELD, not the finished mask -- and that distinction is the
// whole reason this works at 256 texels.
//
// Baking the mask directly was tried first and came out visibly thinner
// and duller than the shader it replaced: measured over one fixed patch of
// canvas, 36% fewer foliage pixels, mean green 113 -> 92, and the bright
// dot cores gone (p90 205 -> 145). Doubling the texel density recovered
// only a quarter of that, which is the signature of a sampling problem
// rather than a wrong field -- and the culprit is the rim lobe, which runs
// at THIRTEEN cycles per cell. Resolving that from a texture would take
// ~100 texels per cell, a 1024-wide bake per field, for detail no crown is
// ever more than a few pixels wide.
//
// So the split follows the frequencies. What is expensive and SMOOTH gets
// baked: the 3x3 search for the nearest kept dot, which is where all 54
// hashes a plane went. What is cheap and SHARP stays in the shader: one
// noise for the lobe, four hashes, evaluated once per plane instead of
// nine times. And a distance field is the one thing that survives being
// stored coarsely and interpolated -- it is why SDF glyphs stay crisp at
// any size, and it is doing the same job here.
//
// R = distance to the nearest kept dot centre, over distScale. G = that
// dot's cell value, which picks its shade of green.
function makeLeafField(keep: number, distScale: number): any {
    const data = new Uint8Array(LEAF_TEX_SIZE * LEAF_TEX_SIZE * 4);
    for (let py = 0; py < LEAF_TEX_SIZE; py++) {
        for (let px = 0; px < LEAF_TEX_SIZE; px++) {
            const u = ((px + 0.5) / LEAF_TEX_SIZE) * LEAF_CELLS;
            const v = ((py + 0.5) / LEAF_TEX_SIZE) * LEAF_CELLS;
            const cx = Math.floor(u);
            const cy = Math.floor(v);
            const fx = u - cx;
            const fy = v - cy;
            let nearest = Infinity;
            let id = 0;
            for (let gx = -1; gx <= 1; gx++) {
                for (let gy = -1; gy <= 1; gy++) {
                    // Wrapped BEFORE the lookup -- this is the whole seam fix.
                    const wx = (((cx + gx) % LEAF_CELLS) + LEAF_CELLS) % LEAF_CELLS;
                    const wy = (((cy + gy) % LEAF_CELLS) + LEAF_CELLS) % LEAF_CELLS;
                    const cell = wy * LEAF_CELLS + wx;
                    const h = cellPick[cell];
                    // This cell grows nothing, so it has no distance to give.
                    if (h < keep) continue;
                    const dx = fx - (gx + h);
                    const dy = fy - (gy + cellOffsetY[cell]);
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < nearest) { nearest = d; id = h; }
                }
            }
            const o = (py * LEAF_TEX_SIZE + px) * 4;
            // Saturates past distScale, which is set beyond the widest dot
            // plus its lobe -- everything out there masks to zero anyway.
            data[o] = Math.round(Math.min(1, nearest / distScale) * 255);
            data[o + 1] = Math.round(id * 255);
            data[o + 3] = 255;
        }
    }
    const texture = new THREE.DataTexture(data, LEAF_TEX_SIZE, LEAF_TEX_SIZE, THREE.RGBAFormat);
    // Repeat, because the shader indexes it with unbounded cell coordinates.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // No mipmaps. Tried, and rejected: the G channel picks each dot's
    // colour, and the average of two dots' values is a green belonging to
    // neither, so a few levels down every tuft converged on one flat
    // shade. Left unmipped the field aliases exactly as much as the
    // per-fragment version did -- a faithful swap. The win here is cost.
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

// Built on first use rather than at module load: the file is imported by
// code paths that never draw a tree, and a worker importing it must not
// pay for two 256x256 bakes it will never sample.
let leafFields: { inner: any; fringe: any } | null = null;

function getLeafFields(): { inner: any; fringe: any } {
    if (!leafFields) {
        leafFields = {
            // keep, then the distance the field saturates at: just past
            // each caller's widest dot (rOuter 1.10 and 0.40) plus the
            // lobe's reach, so nothing inside the mask's ramp is clipped.
            inner: makeLeafField(0.0, LEAF_DIST_INNER),
            fringe: makeLeafField(0.45, LEAF_DIST_FRINGE),
        };
    }
    return leafFields;
}

// World-position noise injected into every decoration material: foliage,
// bark, and rock surfaces get organic light/dark patterning instead of
// flat single-color faces. One shared compiled program for all
// decorations (same cache key); the per-material base color still comes
// from the instance.
const DECOR_NOISE_GLSL = /* glsl */ `
    varying vec3 vDecorWorldPos;
    varying vec3 vDecorLocalPos;

    // The baked dot fields, and the cell-to-texture scale that indexes
    // them. Kept in step with LEAF_CELLS on the JS side by construction --
    // the define is written from it.
    uniform sampler2D uLeafInner;
    uniform sampler2D uLeafFringe;
    uniform float uDecorLeafScale;
    uniform float uDecorLeafGloss;
    uniform float uDecorInnerCrownOpacity;
    uniform float uDecorOuterCrownOpacity;
    #define DECOR_LEAF_INV_CELLS ${(1 / LEAF_CELLS).toFixed(6)}

    float decorHash(vec2 p) {
        return fract(sin(dot(p, vec2(157.1, 269.5))) * 43758.5453123);
    }

    float decorNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(decorHash(i), decorHash(i + vec2(1.0, 0.0)), u.x),
            mix(decorHash(i + vec2(0.0, 1.0)), decorHash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    // Multi-octave, same construction as the terrain's groundFbm -- the
    // grass and forest-floor bands owe their natural mottling to fbm
    // mixed between two palette tints, and the foliage gets the identical
    // recipe rather than a poor single-octave cousin of it.
    float decorFbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 3; i++) {
            value += amplitude * decorNoise(p);
            p = p * 2.03 + vec2(13.7, 7.9);
            amplitude *= 0.5;
        }
        return value;
    }

    // Same band-limit the terrain's groundDetailFade applies: roll a
    // high-frequency term off to its mean once a pixel spans close to a
    // full noise cycle, instead of letting it shimmer.
    float decorDetailFade(vec2 sampleCoord) {
        float fw = max(fwidth(sampleCoord.x), fwidth(sampleCoord.y));
        return 1.0 - smoothstep(0.8, 1.6, fw);
    }

    // One plane's leaf dots, from the baked distance field.
    //
    // The texture gives the distance to the nearest dot and which dot it
    // is; the mask is finished here, because the rim lobe is thirteen
    // cycles per cell and no texture this size can hold it. Scalloped, not
    // circular: the noise perturbs the rim distance, so the edge lobes
    // like a tuft of leaves instead of tracing a clean disc.
    //
    // ONE noise per plane, where the old code drew nine -- the lobe is
    // keyed on the WINNING dot, and the winner is now known before the
    // lobe is needed rather than being what the loop was searching for.
    vec2 decorLeafDots(sampler2D field, vec2 uv, float rOuter, float rInner, float distScale) {
        vec2 t = texture2D(field, uv * DECOR_LEAF_INV_CELLS).rg;
        float lobe = decorNoise(fract(uv) * 13.0 + t.y * 41.0) - 0.5;
        return vec2(smoothstep(rOuter, rInner, t.x * distScale + lobe * 0.20), t.y);
    }

    // The full crown-dot field: three plane projections, each weighted by
    // how face-on it sees the surface (radial normal -- the crown pieces
    // are origin-centered), best dot wins. An oblique projection smears
    // its dots into brush strokes; the weighting keeps them round on
    // every side.
    //
    // shift decorrelates the pattern between callers (the fringe shell
    // samples a shifted copy of the field, so its dots do NOT sit exactly
    // over the crown's own) while the plane weighting still comes from
    // the TRUE position. Returns (mask, dot value) -- the second is what
    // lets every dot pick its own shade of green.
    vec2 decorCrownDots(sampler2D field, vec3 lp, vec3 shift, float freq, float rOuter, float rInner, float distScale) {
        vec3 pn = normalize(lp + vec3(0.0008));
        vec3 sp = (lp + shift) * freq;
        vec2 dxy = decorLeafDots(field, sp.xy, rOuter, rInner, distScale);
        dxy.x *= smoothstep(0.25, 0.60, abs(pn.z));
        vec2 dzy = decorLeafDots(field, sp.zy + 31.0, rOuter, rInner, distScale);
        dzy.x *= smoothstep(0.25, 0.60, abs(pn.x));
        vec2 dxz = decorLeafDots(field, sp.xz + 17.0, rOuter, rInner, distScale);
        dxz.x *= smoothstep(0.25, 0.60, abs(pn.y));
        vec2 best = dxy;
        if (dzy.x > best.x) best = dzy;
        if (dxz.x > best.x) best = dxz;
        return best;
    }

    // Cellular noise, the terrain groundVoronoi's construction on the
    // decoration hash: x = distance to the nearest feature point, y = to
    // the second nearest (y - x ~ 0 along cell borders -- the cracks),
    // z = the nearest cell's own hash, tinting each plate as one object.
    vec3 decorVoronoi(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float f1 = 8.0;
        float f2 = 8.0;
        float id = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int yy = -1; yy <= 1; yy++) {
                vec2 g = vec2(float(x), float(yy));
                float h = decorHash(i + g);
                vec2 o = vec2(h, decorHash(i + g + vec2(31.7, 17.3)));
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < f1) { f2 = f1; f1 = d; id = h; }
                else if (d < f2) { f2 = d; }
            }
        }
        return vec3(sqrt(f1), sqrt(f2), id);
    }

    // One projection of the stone surface -- the terrain rock band's
    // construction (plates, gated crack seams, ridges) on a 2D slice of
    // the rock's local frame. Returns (plate tint, crack mask, ridge).
    // High crack-zone threshold on purpose, same as the mountainside:
    // deep seams are fine, MANY seams are not -- most faces stay whole.
    vec3 decorRockSlice(vec2 p) {
        vec3 plate = decorVoronoi(p);
        float zone = smoothstep(0.55, 0.80, decorFbm(p * 0.35 + 3.7));
        // Narrow, because at stone scale one voronoi cell IS the stone --
        // a border strip 0.16 cells wide would be a seam fat as a finger.
        float crack = (1.0 - smoothstep(0.015, 0.07, plate.y - plate.x)) * zone;
        float ridge = 1.0 - abs(2.0 * decorFbm(p * 0.9) - 1.0);
        return vec3(plate.z, crack, ridge);
    }
`;

const DECOR_FRAGMENT = /* glsl */ `
    {
        vec2 dp = vDecorWorldPos.xz * 7.0 + vec2(vDecorWorldPos.y * 3.1, vDecorWorldPos.y * 2.3);
        dBumpH = 0.0;

        // Base: two octaves of world-space noise for organic decorations.
        // Rocks get the terrain rock band's recipe below and deliberately
        // skip this layer, whose spots made them look like seeds.
        if (vDecorKind >= -0.5) {
            float coarse = decorNoise(dp);
            float fine = mix(0.5, decorNoise(dp * 3.7 + 11.0), decorDetailFade(dp * 3.7));
            diffuseColor.rgb *= 0.84 + 0.20 * coarse + 0.08 * fine;
        }

        // Crowns are 10% see-through -- REAL alpha, not screen-door
        // dither (tried, read as pixel noise). The material is transparent
        // and the shader sets alpha per kind: trunks and rocks stay 1.0,
        // foliage drops to 0.9. At 90% opacity the merged mesh's internal
        // sort errors are invisible.
        if (vDecorKind > 1.5) diffuseColor.a *= 0.90;

        if (vDecorKind < -0.5) {
            // ROCK: the terrain mountainside's recipe -- plates, seams,
            // moss, dirt -- but at a STONE's scale, not a mountain's. A
            // gameplay stone is a flake OF a mountain: one or two broad
            // mineral faces and at most a single seam, not a whole massif
            // of plates shrunk onto a fist of rock. The low frequency here
            // is what makes that true -- roughly one voronoi cell spans
            // the stone. Evaluated triplanar in the stone's LOCAL frame,
            // so the pattern stays glued to the rock under its per-tile
            // yaw and no world-space pattern is shared between stones.
            vec3 rockP = vDecorLocalPos * 2.2;
            vec3 localDir = normalize(vDecorLocalPos + vec3(0.0008));
            vec3 blend = pow(abs(localDir), vec3(4.0));
            blend /= max(blend.x + blend.y + blend.z, 0.0001);
            vec3 slice = decorRockSlice(rockP.yz + vec2(0.17, 7.41)) * blend.x
                + decorRockSlice(rockP.xz + vec2(3.53, 0.11)) * blend.y
                + decorRockSlice(rockP.xy + vec2(9.29, 0.73)) * blend.z;
            float plateTint = slice.x;
            float crack = slice.y;
            float ridge = slice.z;

            // Fine mineral grain, band-limited so it fades to its mean at
            // distance instead of shimmering away to noise.
            vec2 grainP = vDecorLocalPos.xz * 34.0 + vDecorLocalPos.y * 23.0;
            float grain = mix(0.5, decorNoise(grainP), decorDetailFade(grainP));

            // Base is this stone's own instance color (already varied per
            // rock), shaped by the plate and ridge fields -- and the HUE
            // walks with the plate id, cool blue-gray faces against warm
            // tan ones, so the stone reads as mineral, never one flat gray.
            vec3 stone = diffuseColor.rgb
                * (0.85 + 0.30 * plateTint)
                * (0.88 + 0.20 * ridge)
                * (0.90 + 0.20 * grain);
            stone *= mix(vec3(0.93, 0.98, 1.08), vec3(1.08, 1.00, 0.88), plateTint);

            // FLAT per-face contrast: the facet normal is constant across
            // each chipped face (screen-space derivatives of the local
            // position), so hashing it hands every face its own value --
            // bright faces stand clearly apart from dark ones, the way
            // flat shading reads on split stone.
            vec3 faceN = normalize(cross(dFdx(vDecorLocalPos), dFdy(vDecorLocalPos)));
            float faceTone = decorHash(floor(faceN.xz * 4.0) + floor(faceN.y * 3.0));
            // Skewed DOWN: the lit side already gets its brightness from
            // the sun, so the hash mostly hands out darker faces --
            // otherwise the whole stone bleaches toward white.
            stone *= 0.58 + 0.55 * faceTone;

            // Cracks: shadowed, and floored with dirt rather than black.
            stone = mix(stone, stone * 0.45, crack * 0.50);
            stone = mix(stone, vec3(0.30, 0.26, 0.20), crack * 0.30);

            // Dirt staining in broad patches -- life and weather on the
            // stone, kept gray-brown and moderate so it never tips the
            // whole rock into mud.
            float stain = smoothstep(0.55, 0.85,
                decorFbm(vDecorLocalPos.xy * 5.0 + vDecorLocalPos.z * 3.0 + 2.3));
            stone = mix(stone, vec3(0.42, 0.36, 0.27) * (0.75 + 0.45 * plateTint), stain * 0.38);

            // Moss in LARGE readable patches on upward faces; sub-pixel
            // moss merely averages back into brown at map scale.
            float upward = smoothstep(0.15, 0.72, localDir.y);
            float mossField = decorFbm(vDecorLocalPos.xz * 4.2 + vec2(4.7, 1.9));
            float mossMask = upward * smoothstep(0.38, 0.55, mossField);
            vec3 moss = vec3(0.15, 0.25, 0.08) * (0.80 + 0.45 * ridge);
            diffuseColor.rgb = mix(stone, moss, mossMask * 0.85);

            // Pale lichen flecks on the bare faces, same trick as the
            // high mountainside -- band-limited, and kept off the moss.
            vec2 lichP = vDecorLocalPos.xz * 26.0 + vDecorLocalPos.y * 19.0;
            float lich = smoothstep(0.88, 0.96, decorNoise(lichP)) * decorDetailFade(lichP);
            diffuseColor.rgb += vec3(0.20, 0.21, 0.19) * lich * (1.0 - mossMask);

            // Relief reuses the fields the color came from: plates and
            // ridges raised, seams recessed, moss a soft cushion on top.
            // MUCH shallower than the mountainside's: deep bump on a small
            // faceted stone drowns the flat face lighting that carries it.
            dBumpH = plateTint * 0.25 + ridge * 0.18 - crack * 0.40 + mossMask * 0.12;
        } else if (vDecorKind < 0.5) {
            // BARK and dead wood. Three equally weighted projections make
            // an isotropic 3D-looking field: no axis is privileged, so the
            // cylinder cannot turn the pattern into vertical stripes.
            // World anchoring also prevents each short branch cylinder from
            // restarting the same pattern at every joint.
            vec3 barkP = vDecorWorldPos * 7.0;
            float broad = (
                decorFbm(barkP.xy + vec2(1.7, 5.1))
                + decorFbm(barkP.yz + vec2(8.3, 2.4))
                + decorFbm(barkP.zx + vec2(4.6, 9.2))
            ) / 3.0;
            vec3 midP = vDecorWorldPos * 18.0 + vec3(2.3, 6.7, 10.1);
            float midGrain = (
                decorFbm(midP.xy)
                + decorFbm(midP.yz)
                + decorFbm(midP.zx)
            ) / 3.0;
            vec3 fineP = vDecorWorldPos * 47.0 + vec3(3.1, 7.4, 11.2);
            float fineGrain = (
                decorNoise(fineP.xy)
                + decorNoise(fineP.yz)
                + decorNoise(fineP.zx)
            ) / 3.0;
            float darkPatch = smoothstep(0.57, 0.72, midGrain)
                * smoothstep(0.36, 0.58, 1.0 - broad);
            float palePatch = smoothstep(0.60, 0.74, broad)
                * smoothstep(0.32, 0.56, 1.0 - midGrain);
            float roughScab = smoothstep(0.63, 0.78, fineGrain)
                * smoothstep(0.46, 0.64, midGrain);

            // Layered but restrained colour variation: warm exposed wood,
            // cool weathered areas, and small dark crusts.
            diffuseColor.rgb *= 0.87 + broad * 0.20 + midGrain * 0.08;
            diffuseColor.rgb = mix(
                diffuseColor.rgb,
                diffuseColor.rgb * vec3(0.60, 0.63, 0.61),
                darkPatch * 0.38
            );
            diffuseColor.rgb = mix(
                diffuseColor.rgb,
                diffuseColor.rgb * vec3(1.18, 1.10, 0.95),
                palePatch * 0.28
            );
            diffuseColor.rgb *= 1.0 - roughScab * 0.16;
            dBumpH = broad * 0.10 + midGrain * 0.16
                + fineGrain * 0.055 + roughScab * 0.12 - darkPatch * 0.08;
        } else if (vDecorKind < 1.5) {
            // CONIFER foliage: layered branch fringes that HANG DOWNWARD.
            // In the cone's local frame, iso-lines of (y + droop * radius)
            // slope down and outward -- banding on that coordinate reads
            // as tiers of drooping branches, with a darker underside at
            // each band's lower edge.
            float radial = length(vDecorLocalPos.xz);
            // Epsilon guard: atan(0, 0) at the cone tip is undefined (NaN
            // on many GPUs) and would paint the whole surface black.
            float angle = atan(vDecorLocalPos.z, vDecorLocalPos.x + 0.0008);
            float branchCoord = vDecorLocalPos.y * 9.0 + radial * 16.0 + decorNoise(vec2(angle * 1.4, 3.7)) * 1.6;
            float band = fract(branchCoord);
            float fringe = 0.80 + 0.20 * smoothstep(0.05, 0.45, band);
            // Angular clumping: branches, not a smooth skirt.
            float clump = 0.90 + 0.10 * decorNoise(vec2(angle * 3.0, vDecorLocalPos.y * 5.0));
            // The grass band's recipe on a cone: domain-warped fbm mixing
            // between a shadowed blue-green and a sunlit yellow-green tint
            // of this tree's own base color. The warp wraps around the
            // crown (angle) and down it (y), so the patches lie ON the
            // foliage instead of projecting through it.
            vec2 np = vec2(angle * 1.6, vDecorLocalPos.y * 3.4);
            vec2 nwarp = vec2(decorFbm(np * 0.9), decorFbm(np * 0.9 + vec2(4.2, 1.7))) - 0.5;
            float needleField = decorFbm(np * 2.2 + nwarp * 2.4);
            diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.52, 0.62, 0.55),
                                   diffuseColor.rgb * vec3(1.42, 1.34, 0.88), needleField);
            // Conifers run DARK -- spruce and pine hold deep green even
            // in full sun.
            diffuseColor.rgb *= fringe * clump * 0.80;
            // Each branch tier is a gentle ridge; kept mild so the light
            // reads texture without embossing the whole tree.
            dBumpH = (1.0 - abs(2.0 * band - 1.0)) * 0.22 + needleField * 0.30;
        } else if (vDecorKind < 2.5) {
            if (uDecorInnerCrownOpacity < 0.001) discard;
            // DECIDUOUS leaves: the SAME leaf-dot field the fringe shell
            // uses, as a color pattern -- the solid crown cannot discard,
            // so the gaps between dots become the dark shadowed interior
            // of the canopy, and every dot paints its own shade of green
            // on top. Inner and outer leaves come from one field, so the
            // fringe reads as the crown's own foliage continuing outward.
            // A FULL MOSAIC of leaf dots, no clipping and no gaps: with
            // every cell active (keep 0) and a radius wide enough that
            // the dot fields overlap, each fragment takes the shade of
            // its NEAREST dot -- the whole crown surface is leaves, tiled
            // edge to edge in different greens. (Clipping was tried here
            // and rolled back in favor of full coverage.)
            vec2 crown = decorCrownDots(uLeafInner, vDecorLocalPos, vec3(0.0), 17.0 / uDecorLeafScale, 1.10, 0.25, ${LEAF_DIST_INNER.toFixed(2)});
            // Same two-axis palette as the fringe: HUE walks cool
            // blue-green -> mid -> warm sunlit yellow, and a separate
            // brightness jitter keeps two dots of similar hue apart.
            vec3 coolC = diffuseColor.rgb * vec3(0.55, 0.68, 0.62);
            vec3 midC  = diffuseColor.rgb * vec3(0.85, 0.95, 0.70);
            vec3 warmC = diffuseColor.rgb * vec3(1.45, 1.35, 0.80);
            vec3 dotC = crown.y < 0.5
                ? mix(coolC, midC, crown.y * 2.0)
                : mix(midC, warmC, crown.y * 2.0 - 1.0);
            dotC *= 0.82 + 0.36 * decorHash(vec2(crown.y * 91.7, 13.1));
            // CLUSTER, not blob: a bright core shading darker toward the
            // lobed rim gives each dot the volume of a leaf tuft, and a
            // fine band-limited leaflet texture breaks the interior into
            // individual leaves.
            dotC *= 0.78 + 0.34 * smoothstep(0.05, 0.85, crown.x);
            float leafTexA = mix(0.5, decorNoise(vDecorLocalPos.xz * 55.0 + vDecorLocalPos.y * 40.0),
                decorDetailFade(vDecorLocalPos.xz * 55.0));
            // The inner crown sits DARKER than the fringe: the outer
            // leaves catch the open light, the mass behind them lives in
            // its own shade -- which is also what pushes the fringe
            // forward and gives the canopy depth.
            diffuseColor.rgb = dotC * (0.88 + 0.24 * leafTexA) * 0.74;
            // ...and per-dot ALPHA: most clusters remain dense, while a
            // scattered minority lets noticeably more of the crown behind
            // it show through. This is real partial transparency, not a
            // binary cutout, and every winning leaf-dot owns one density.
            float leafDensity = decorHash(vec2(crown.y * 47.3, 5.9));
            diffuseColor.a *= mix(0.38, 0.88, smoothstep(0.08, 0.92, leafDensity))
                * uDecorInnerCrownOpacity;
            // Crown self-shadowing: the underside of a canopy is where
            // the light does not reach. This cheap vertical AO does more
            // for "tree, not gumdrop" than any amount of surface noise.
            diffuseColor.rgb *= mix(0.70, 1.05, smoothstep(-0.30, 0.28, vDecorLocalPos.y));
            // The dots ARE the relief: raised leaf clusters over recessed
            // shadow gaps.
            dBumpH = crown.x * 0.5;
        } else {
            if (uDecorOuterCrownOpacity < 0.001) discard;
            // FOLIAGE FRINGE (kind 3): the oversized crown shell. Keep
            // only a scattered fraction of its fragments -- a dithered
            // cutout, no transparency involved -- so the crown's hard
            // silhouette dissolves into a ragged fringe of leaf specks.
            // Geometry/alpha make the fuzz; bloom only underlines it.
            // MANY SMALL LEAF DOTS with gaps between them, so the solid
            // crown underneath shows through -- outer leaves in front of
            // inner canopy, which is what gives the fringe depth. Three
            // plane projections, best dot wins: a single 2D projection on
            // a 3D crown stretches its dots into streaks along the
            // projection axis; taking the max over xy/zy/xz keeps them
            // round on every side of the crown.
            // Sparse and small against the sky, sampling a SHIFTED copy
            // of the field so the fringe leaves sit between the crown's
            // own rather than exactly on top of them.
            vec2 dot1 = decorCrownDots(uLeafFringe, vDecorLocalPos, vec3(4.3, 8.9, 2.7), 9.0 / uDecorLeafScale, 0.40, 0.20, ${LEAF_DIST_FRINGE.toFixed(2)});
            // Soft rims with REAL alpha now that the material is
            // transparent. Keep even the faint outer part of the mask so
            // the fringe feathers into the background instead of ending in
            // another crisp contour around the crown.
            if (dot1.x < 0.002) discard;
            // Rim fade times a PER-DOT opacity: every outer leaf has its
            // own density, from nearly solid to a thin translucent one.
            // The deliberately wide ramp is our screen-door-free blur: it
            // cannot blur the background like a post-process pass, but it
            // produces the same soft optical edge through alpha coverage.
            diffuseColor.a *= smoothstep(0.00, 0.62, dot1.x)
                * (0.55 + 0.45 * decorHash(vec2(dot1.y * 57.3, 7.7)))
                * uDecorOuterCrownOpacity;
            // EVERY DOT ITS OWN GREEN -- same palette the inner crown
            // walks (cool -> mid -> warm plus brightness jitter), so the
            // fringe leaves belong to the same tree. No bloom: a glint
            // was tried here and read as gloss on a waxed apple.
            vec3 fCool = diffuseColor.rgb * vec3(0.55, 0.68, 0.62);
            vec3 fMid  = diffuseColor.rgb * vec3(0.85, 0.95, 0.70);
            vec3 fWarm = diffuseColor.rgb * vec3(1.45, 1.35, 0.80);
            diffuseColor.rgb = dot1.y < 0.5
                ? mix(fCool, fMid, dot1.y * 2.0)
                : mix(fMid, fWarm, dot1.y * 2.0 - 1.0);
            diffuseColor.rgb *= 0.82 + 0.36 * decorHash(vec2(dot1.y * 91.7, 13.1));
            // Same cluster treatment as the crown: bright tuft core, and
            // leaflet texture inside. Darkened overall -- the fringe still
            // sits a step lighter than the inner crown (0.84 vs 0.74),
            // keeping the depth, without reading as spring-bright.
            diffuseColor.rgb *= 0.78 + 0.34 * smoothstep(0.05, 0.85, dot1.x);
            float leafTexB = mix(0.5, decorNoise(vDecorLocalPos.xz * 55.0 + vDecorLocalPos.y * 40.0),
                decorDetailFade(vDecorLocalPos.xz * 55.0));
            diffuseColor.rgb *= (0.88 + 0.24 * leafTexB) * 0.84;
        }
    }
`;

// Foliage catches a restrained broad highlight from the directional sun.
// Bark is still matte, but less chalk-flat than stone: a broad, soft
// response across the cylinder is what lets its roundness survive the
// game's strong ambient light.
const DECOR_ROUGHNESS_FRAGMENT = /* glsl */ `
    float barkMask = 1.0 - step(0.5, abs(vDecorKind));
    roughnessFactor = mix(roughnessFactor, 0.66, barkMask);
    roughnessFactor = mix(roughnessFactor, 0.76, step(0.5, vDecorKind));
    float leafRoughness = mix(0.86, 0.08, uDecorLeafGloss);
    roughnessFactor = mix(roughnessFactor, leafRoughness, step(1.5, vDecorKind));
`;

// The game's ambient light is deliberately strong and directionless. On the
// side opposite the sun that can flatten a dark trunk into one brown value.
// A restrained grazing-angle sky response restores the cylinder silhouette
// without adding a viewer-only lamp or turning bark into polished wood.
const DECOR_BARK_VOLUME_FRAGMENT = /* glsl */ `
    float barkVolumeMask = 1.0 - step(0.5, abs(vDecorKind));
    float barkFacing = saturate(dot(normalize(normal), normalize(vViewPosition)));
    float barkSkySheen = pow(1.0 - barkFacing, 1.65);
    reflectedLight.indirectDiffuse += diffuseColor.rgb
        * barkVolumeMask * barkSkySheen * 0.34;
`;

// MeshStandard's dielectric highlight is intentionally restrained. Leaves
// need an additional very narrow white response so a few fluttering faces
// flash when their normal, the sun and the camera align -- never a general
// brightening of the crown.
const DECOR_LEAF_GLINT_FRAGMENT = /* glsl */ `
    #if NUM_DIR_LIGHTS > 0
        float leafGlintMask = step(1.5, vDecorKind);
        vec3 leafLightDir = normalize(directionalLights[0].direction);
        vec3 leafViewDir = normalize(vViewPosition);
        vec3 leafHalfDir = normalize(leafLightDir + leafViewDir);
        float leafAlignment = saturate(dot(normalize(normal), leafHalfDir));
        float leafGlintPower = mix(72.0, 220.0, uDecorLeafGloss);
        float leafGlint = pow(leafAlignment, leafGlintPower);
        float leafSparkle = mix(0.30, 1.0, smoothstep(
            0.35,
            0.80,
            decorNoise(vDecorLocalPos.xz * 42.0 + vDecorLocalPos.y * 27.0)
        ));
        reflectedLight.directSpecular += vec3(1.0)
            * leafGlintMask
            * leafGlint
            * leafSparkle
            * mix(0.08, 0.78, uDecorLeafGloss);
    #endif
`;

// Every tile material points at this one uniform object, so wind costs one
// value update per frame rather than a traversal over all decoration meshes.
const DECOR_WIND_TIME = { value: 0 };

// Positive aDecorWind selects broadleaf sway; negative selects the slower
// conifer branch response; zero keeps trunks, bushes and rocks still. Every
// vertex in one crown or branch tier receives the same anchor, while all parts
// in one tree share the anchor's XZ phase. That makes each volume sway without
// changing its silhouette like a breathing balloon.
const DECOR_WIND_VERTEX = /* glsl */ `
    if (aDecorWind > 0.0) {
        float windPhase = aDecorWindAnchor.x * 2.17 + aDecorWindAnchor.z * 1.63;
        float broadSway = sin(uDecorWindTime * 0.82 + windPhase);
        float leafFlutter = sin(uDecorWindTime * 1.71 + windPhase * 1.37);
        float crownHeight = smoothstep(0.72, 1.92, aDecorWindAnchor.y);
        // A low crown stays restrained while a high crown gets almost twice
        // its sway. The whole cluster still receives one identical offset,
        // so this height response cannot reintroduce pulsing.
        float windAmount = aDecorWind * mix(0.60, 1.14, crownHeight);
        transformed.x += (broadSway * 0.025 + leafFlutter * 0.006) * windAmount;
        transformed.z += (broadSway * 0.014 - leafFlutter * 0.004) * windAmount;
        transformed.y += leafFlutter * 0.003 * windAmount;
    } else if (aDecorWind < 0.0) {
        // Conifer tiers are heavier and springier than leaves: one slow bend
        // with a faint secondary recovery motion. Each entire tier receives
        // one offset, and higher tiers yield more while the trunk stays put.
        float branchPhase = aDecorWindAnchor.x * 1.73 + aDecorWindAnchor.z * 2.09;
        float branchSway = sin(uDecorWindTime * 1.05 + branchPhase);
        float branchRecovery = sin(uDecorWindTime * 2.10 + branchPhase * 1.41);
        float branchHeight = smoothstep(0.38, 3.15, aDecorWindAnchor.y);
        float branchAmount = -aDecorWind * mix(0.48, 1.0, branchHeight);
        transformed.x += (branchSway * 0.058 + branchRecovery * 0.010) * branchAmount;
        transformed.z += (branchSway * 0.034 - branchRecovery * 0.006) * branchAmount;
        transformed.y += branchRecovery * 0.004 * branchAmount;
    }
`;

// Fast leaf flutter belongs in the lighting normal, not the silhouette.
// Rotating the apparent leaf faces produces the characteristic broken,
// high-frequency flashes without scaling or tearing the crown geometry.
const DECOR_LEAF_FLUTTER_NORMAL = /* glsl */ `
    if (aDecorWind > 0.0) {
        float flutterPhase = dot(aDecorLocal, vec3(11.3, 7.7, 9.1))
            + aDecorWindAnchor.x * 3.1 + aDecorWindAnchor.z * 2.3;
        float flutterA = sin(uDecorWindTime * 14.0 + flutterPhase);
        float flutterB = sin(uDecorWindTime * 21.0 + flutterPhase * 1.61);
        float flutter = flutterA * 0.65 + flutterB * 0.35;
        objectNormal = normalize(objectNormal + vec3(
            flutter * 0.115,
            flutterB * 0.042,
            flutterA * 0.095
        ));
    }
`;

export function animateDecorationWind(time: number): void {
    DECOR_WIND_TIME.value = time;
}

export function setDecorationLeafScale(model: any, scale: number): void {
    const value = Math.max(0.35, Math.min(2.5, scale));
    model?.traverse?.((child: any) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (material?.userData?.leafScaleUniform) {
                material.userData.leafScaleUniform.value = value;
            }
        }
    });
}

export function setDecorationLeafGloss(model: any, gloss: number): void {
    const value = Math.max(0, Math.min(1, gloss));
    model?.traverse?.((child: any) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (material?.userData?.leafGlossUniform) {
                material.userData.leafGlossUniform.value = value;
            }
        }
    });
}

export function setDecorationCrownOpacity(model: any, inner: number, outer: number): void {
    const innerValue = Math.max(0, Math.min(1, inner));
    const outerValue = Math.max(0, Math.min(1, outer));
    model?.traverse?.((child: any) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (material?.userData?.innerCrownOpacityUniform) {
                material.userData.innerCrownOpacityUniform.value = innerValue;
            }
            if (material?.userData?.outerCrownOpacityUniform) {
                material.userData.outerCrownOpacityUniform.value = outerValue;
            }
        }
    });
}

// kind: 0 = generic surface (bark, rock), 1 = conifer foliage,
// 2 = deciduous/bush leaves.
// Burning a tile down to bare stems.
//
// The foliage is DISCARDED rather than darkened. Sooty leaves still read as
// a living canopy from map height -- what says "this burned" is the silhouette
// changing, so the crowns go and the trunks stay, blackened.
//
// vDecorKind is already carried through to the fragment shader for the
// banding patterns, so the burn costs one uniform and two lines: kind 0 is
// bark and rock, anything above is leaves or needles.
const DECOR_BURN_GLSL = `
    if (uBurn > 0.5) {
        if (vDecorKind > 0.5) discard;
        diffuseColor.rgb *= mix(1.0, 0.16, uBurn);
    }
`;

function applyOrganicDetail(material: any): void {
    // Created eagerly and kept on the material, because onBeforeCompile does
    // not run until the material is first rendered -- and FireSystem may
    // need to set this before the tile has ever been drawn. The material is
    // per TILE (see mergeDecorations), so this blackens one hex and not the
    // map.
    material.userData.burnUniform = { value: 0 };
    // Map defaults match the approved broadleaf interval. The tree viewer
    // replaces these immediately with its current controls after merging.
    material.userData.leafScaleUniform = { value: 0.60 };
    material.userData.leafGlossUniform = { value: 0.46 };
    material.userData.innerCrownOpacityUniform = { value: 0.95 };
    material.userData.outerCrownOpacityUniform = { value: 1.00 };
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uBurn = material.userData.burnUniform;
        shader.uniforms.uDecorWindTime = DECOR_WIND_TIME;
        shader.uniforms.uDecorLeafScale = material.userData.leafScaleUniform;
        shader.uniforms.uDecorLeafGloss = material.userData.leafGlossUniform;
        shader.uniforms.uDecorInnerCrownOpacity = material.userData.innerCrownOpacityUniform;
        shader.uniforms.uDecorOuterCrownOpacity = material.userData.outerCrownOpacityUniform;
        // Two textures shared by every decoration material on the map --
        // baked once, referenced here, never per tile.
        const fields = getLeafFields();
        shader.uniforms.uLeafInner = { value: fields.inner };
        shader.uniforms.uLeafFringe = { value: fields.fringe };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vDecorWorldPos;\n varying vec3 vDecorLocalPos;\n varying float vDecorKind;\n uniform float uDecorWindTime;\n attribute vec3 aDecorLocal;\n attribute float aDecorKind;\n attribute float aDecorWind;\n attribute vec3 aDecorWindAnchor;')
            .replace(
                '#include <beginnormal_vertex>',
                '#include <beginnormal_vertex>\n' + DECOR_LEAF_FLUTTER_NORMAL
            )
            .replace(
                '#include <begin_vertex>',
                // aDecorLocal is the vertex's position in ITS OWN mesh, kept
                // through the merge. The conifer's branch banding and the
                // crown splotches are computed in that frame, so feeding
                // them the merged tile-local position instead would rescale
                // every pattern on the map.
                '#include <begin_vertex>\n' + DECOR_WIND_VERTEX + '\n vDecorWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vDecorLocalPos = aDecorLocal;\n vDecorKind = aDecorKind;'
            );
        shader.fragmentShader = shader.fragmentShader
            // dBumpH is written by the color pass and read by the bump
            // pass -- a GLSL global, same wiring as the terrain's gBumpH.
            .replace('#include <common>', '#include <common>\n varying float vDecorKind;\n uniform float uBurn;\n float dBumpH;\n' + DECOR_NOISE_GLSL + PERTURB_GLSL)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + DECOR_FRAGMENT + DECOR_BURN_GLSL)
            .replace(
                '#include <roughnessmap_fragment>',
                '#include <roughnessmap_fragment>\n' + DECOR_ROUGHNESS_FRAGMENT
            )
            .replace(
                '#include <lights_fragment_end>',
                '#include <lights_fragment_end>\n'
                    + DECOR_BARK_VOLUME_FRAGMENT
                    + DECOR_LEAF_GLINT_FRAGMENT
            )
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n normal = groundPerturbNormal(vDecorWorldPos, normal, dBumpH, 0.14);'
            );
    };
    material.customProgramCacheKey = () => 'decor-organic-rock-procedural-wind-v12';
}

function mat(color: number, kind: number = 0) {
    const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: false,
        // Double-sided since the crown gaps CLIP: through a hole you see
        // the canopy interior (backfaces), not out the other side.
        side: THREE.DoubleSide,
        // Transparent so the crowns can carry real varying alpha; every
        // non-foliage fragment writes alpha 1.0 and stays visually opaque.
        transparent: true,
    });
    applyOrganicDetail(material);
    return material;
}

// Fuzzy foliage fringe: a slightly larger copy of a crown piece, drawn
// with kind 3 -- the shader keeps only a scattered fraction of its
// fragments (discard-dithered cutout, no transparency), so the silhouette
// gets a ragged fringe of leaf specks instead of a hard shell edge, and
// the sunlit specks on top glint into the bloom pass. Geometry and
// material are shared/cloned, no rng is drawn.
function addFringe(parent: any, source: any, geometry: any = source.geometry): void {
    const shell = new THREE.Mesh(geometry, source.material.clone());
    shell.userData.decorKind = 3;
    // Exactly the same displacement as the inner crown. A larger wind weight
    // moved the shell relative to its core and read as rhythmic scaling.
    shell.userData.decorWind = source.userData.decorWind ?? 0;
    shell.position.copy(source.position);
    shell.rotation.copy(source.rotation);
    // 1.16, not a subtle 1.06: at gameplay zoom a 6% shell sits within a
    // pixel or two of the crown and vanishes. The fringe has to stand
    // clearly off the silhouette to read at all.
    shell.scale.copy(source.scale).multiplyScalar(1.16);
    parent.add(shell);
}

function addMesh(parent: any, geometry: any, color: number, x: number, y: number, z: number, kind: number = 0): any {
    const mesh = new THREE.Mesh(geometry, mat(color, kind));
    // Read back by mergeDecorations, which turns it into a vertex attribute.
    mesh.userData.decorKind = kind;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}

// Conifer: brown trunk + 2-3 stacked dark-green cones.
function makeConifer(rng: () => number, index: number = 0, total: number = 1, dead: boolean = false): any {
    const tree = new THREE.Group();
    // A LADDER ACROSS THE VARIANTS, not a random draw.
    //
    // There are only eight conifers in the whole game -- pick() builds the
    // library once and every tree on every map is a clone of one of them.
    // Randomising the height here therefore samples the range eight times
    // in total, not once per tree: the first attempt at this drew a skewed
    // random height hoping for the occasional spire, and on the loaded map
    // the tallest thing that existed was 2.41, because none of the eight
    // fixed seeds happened to roll high. Chance cannot deliver a rare event
    // out of eight draws that are fixed at build time.
    //
    // So the variants are laid along the range by index instead. pow(1.5)
    // keeps the low end crowded -- most of the set is ordinary forest -- and
    // the last two are genuine spires standing clear of the canopy. rng only
    // jitters, it does not decide.
    const rung = total > 1 ? index / (total - 1) : rng();
    const height = 1.15 + Math.pow(rung, 1.5) * 2.35 + (rng() - 0.5) * 0.16;
    // The crown widens with height, but far more slowly -- a tree twice as
    // tall is nowhere near twice as wide, and scaling radius straight off
    // height turned the tall ones into fir-shaped balloons.
    const spread = Math.pow(height / 1.5, 0.45);
    // Per-TREE jitter seed, derived from a value the stream already drew --
    // no new rng draws (tileVegetation replays this stream), but two
    // conifers no longer share the exact same lumps.
    const seed = Math.floor(height * 4096);
    const trunkH = height * 0.22;
    if (dead) {
        // A snag: the bole carries on all the way up instead of stopping
        // where the crown would have taken over, and the branch tiers are
        // left as bare stubs. Same height ladder as the living tree, so a
        // dead spruce still stands as tall as the one beside it.
        const bare = addMesh(tree, new THREE.CylinderGeometry(0.022, 0.075, height, 5), vary(0x6b6055, rng, 0.15), 0, height / 2, 0);
        bare.rotation.z = (rng() - 0.5) * 0.12;
        const stubs = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < stubs; i++) {
            const len = 0.10 + rng() * 0.16;
            const y = height * (0.30 + 0.60 * (i / stubs)) + rng() * 0.06;
            const stub = addMesh(tree, new THREE.CylinderGeometry(0.011, 0.024, len, 4), vary(0x5c5145, rng, 0.15), 0, y, 0);
            // Downswept, the way a dead conifer's branches hang.
            stub.rotation.z = 1.05 + rng() * 0.75;
            stub.rotation.y = rng() * Math.PI * 2;
            stub.translateY(len / 2);
        }
        return tree;
    }
    addMesh(tree, new THREE.CylinderGeometry(0.05, 0.07, trunkH, 5), vary(0x5a4028, rng, 0.15), 0, trunkH / 2, 0);
    const layers = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const radius = (0.34 - 0.14 * t) * (0.8 + rng() * 0.4) * spread;
        const coneH = height * (0.45 - 0.08 * t);
        const y = trunkH + height * 0.55 * t + coneH / 2 - 0.02;
        // Height segments matter more than radial ones: a default cone has
        // ONE strip from tip to rim, so jitter had nothing to bend and the
        // silhouette stayed a party hat. Rings down the flank let the
        // roughen sag and bulge like drooping branch tiers.
        const ox = ((hash(seed * 31 + i) & 255) / 255 - 0.5) * 0.09;
        const oz = ((hash(seed * 57 + i) & 255) / 255 - 0.5) * 0.09;
        // Dark spruce to sunlit olive, per TREE -- overlapping the
        // deciduous range so the forest is one population, not two teams.
        const needleColor = lerpHex(0x1d4a2a, 0x4a6b30, seedT(seed * 97));
        const cone = addMesh(tree, roughen(new THREE.ConeGeometry(radius, coneH, 8, 3), seed + i, radius * 0.38), vary(needleColor, rng, 0.18), ox, y, oz, 1);
        // Negative wind weights select the slow conifer branch response in
        // DECOR_WIND_VERTEX. Upper, lighter tiers give slightly more.
        cone.userData.decorWind = -(0.70 + 0.16 * t);
        addFringe(tree, cone);
    }
    return tree;
}

const LIMB_UP = new THREE.Vector3(0, 1, 0);

// Sweep one limb: a chain of tapered, open-ended cylinders laid tip to
// tail, each one aimed slightly differently from the last, so the limb
// CURVES instead of standing as a straight stick. Every piece is its own
// mesh -- which costs nothing, because mergeDecorations folds the whole
// tile into a single draw anyway, and keeping them separate preserves the
// per-mesh local frame the bark shader reads, keeping every piece's grain
// aligned with its own axis rather than the whole tree's.
//
// Returns the tip and the heading it arrived with, so a caller can fork
// again from where this limb ended.
function growLimb(
    parent: any,
    rng: () => number,
    from: any,
    dir: any,
    length: number,
    rBase: number,
    rTip: number,
    pieces: number,
    radial: number,
    droop: number,
    wander: number,
    color: number
): { tip: any; heading: any } {
    const cursor = from.clone();
    const heading = dir.clone().normalize();
    const segLen = length / pieces;
    for (let i = 0; i < pieces; i++) {
        // Non-linear taper (the exponent below 1): a limb holds its girth
        // through the first half and thins fast near the tip, which is
        // what wood does. A straight lerp gives a cone, and a cone is the
        // silhouette this whole rewrite exists to get rid of.
        const ra = rBase + (rTip - rBase) * Math.pow(i / pieces, 0.7);
        const rb = rBase + (rTip - rBase) * Math.pow((i + 1) / pieces, 0.7);
        // 1.08 overlap: consecutive pieces meet at an angle, and butted
        // exactly end to end that bend opens a wedge-shaped gap.
        const piece = addMesh(
            parent,
            new THREE.CylinderGeometry(rb, ra, segLen * 1.08, radial, 1, true),
            color,
            cursor.x + heading.x * segLen * 0.5,
            cursor.y + heading.y * segLen * 0.5,
            cursor.z + heading.z * segLen * 0.5
        );
        piece.quaternion.setFromUnitVectors(LIMB_UP, heading);
        cursor.addScaledVector(heading, segLen);
        // Sag and wander applied BETWEEN pieces, so the limb bends at its
        // joints rather than kinking inside one.
        heading.y -= droop;
        heading.x += (rng() - 0.5) * wander;
        heading.z += (rng() - 0.5) * wander;
        heading.normalize();
    }
    return { tip: cursor, heading };
}

export type DeciduousCrownShape = 'ball' | 'disk' | 'dome' | 'drop';

function crownGeometry(shape: DeciduousCrownShape, radius: number, seed: number): any {
    if (shape === 'dome') {
        // Top hemisphere only. SphereGeometry leaves the equator open, so
        // branches remain visible through the missing underside.
        const geometry = new THREE.SphereGeometry(
            radius,
            10,
            2,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2,
        );
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            const y = position.getY(i);
            if (y > radius * 0.08) continue;

            // Turn the perfectly straight equator into loose, hanging leaf
            // clusters. Position-based hashing keeps the duplicated seam
            // vertices together while giving every section a different drop.
            const x = position.getX(i);
            const z = position.getZ(i);
            const edgeKey = Math.imul(Math.round(x * 1024), 73856093)
                ^ Math.imul(Math.round(z * 1024), 19349663)
                ^ Math.imul(seed + 1, 83492791);
            const edgeNoise = (hash(edgeKey) & 1023) / 1023;
            // Most of the rim stays close to the dome, but a few high-noise
            // sections fall dramatically farther and read as separate,
            // hanging foliage clusters instead of one trimmed horizontal rim.
            const hangingDrop = radius * (0.04 + Math.pow(edgeNoise, 2.15) * 0.82);
            position.setY(i, y - hangingDrop);
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        return roughen(
            geometry,
            seed,
            radius * 0.12,
        );
    }

    if (shape === 'drop') {
        const geometry = new THREE.SphereGeometry(radius, 8, 6);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            const y = position.getY(i);
            if (y < 0) {
                // Preserve the round upper hemisphere, then pull the lower
                // one longer while collapsing its rings toward the bottom.
                const normalizedY = Math.max(-1, y / radius);
                const taper = Math.pow(normalizedY + 1, 0.58);
                position.setX(i, position.getX(i) * taper);
                position.setZ(i, position.getZ(i) * taper);
                position.setY(i, y * 1.28);
            } else {
                position.setY(i, y * 0.88);
            }
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        return roughen(geometry, seed, radius * 0.10);
    }

    // Ball and disk keep a twenty-face inner volume: eight faces made the
    // dense crown visibly diamond-shaped. The transparent fringe gets its
    // own cheaper geometry in addCluster below, where the sparse leaf field
    // hides the coarser shell. Disk gets its profile from Y scale below.
    return roughen(
        new THREE.IcosahedronGeometry(radius, 0),
        seed,
        radius * 0.20,
    );
}

// A leaf cluster: the crown blob the old tree had, shrunk and hung on a
// branch tip. Same kind-2 leaf-dot shading and the same fringe shell, so
// nothing about the canopy material changes -- only where the mass sits.
//
// TWENTY FACES for the dense volume, eight for its transparent fringe. The
// inner silhouette stays round while the sparse outer leaves use cheaper
// geometry where its facets are much harder to perceive.
function addCluster(
    parent: any,
    rng: () => number,
    at: any,
    radius: number,
    color: number,
    seed: number,
    shape: DeciduousCrownShape,
): void {
    const blob = addMesh(
        parent,
        crownGeometry(shape, radius, seed),
        vary(color, rng, 0.2),
        at.x, at.y, at.z,
        2
    );
    blob.userData.decorWind = 1;
    const yScale = shape === 'disk'
        ? 0.34 + rng() * 0.14
        : shape === 'drop'
            ? 0.92 + rng() * 0.14
            : 0.74 + rng() * 0.22;
    blob.scale.set(1, yScale, 1);
    // ...and turned, which matters far more at twenty faces than at
    // eighty: a d20 has a recognisable outline, and every cluster on the
    // map sharing it would tile the forest with one repeated silhouette.
    // Always consume the same three rotation draws. Otherwise switching from
    // ball to a directional crown changes the rng position and accidentally
    // rewrites the branch counts and angles generated after this cluster.
    const rotationX = rng() * Math.PI;
    const rotationY = rng() * Math.PI;
    const rotationZ = rng() * Math.PI;
    if (shape === 'ball') {
        blob.rotation.set(rotationX, rotationY, rotationZ);
    } else {
        // Directional profiles must keep their open side or point downward.
        // Yaw still varies their irregular outline without tilting the form.
        blob.rotation.set(0, rotationY * 2, 0);
    }
    // Both set BEFORE the fringe, which copies scale and rotation. Ball and
    // disk can use a coarse shell behind their sparse outer leaf field while
    // their twenty-face inner volume preserves the visible roundness.
    const fringeGeometry = shape === 'ball' || shape === 'disk'
        ? roughen(new THREE.OctahedronGeometry(radius, 0), seed ^ 0x51ed270b, radius * 0.12)
        : undefined;
    addFringe(parent, blob, fringeGeometry);
}

// Deciduous: a trunk-and-branch skeleton carrying its foliage in separate
// clusters.
//
// The old version was a cylinder with one to three balls balanced on top,
// and at hex scale that reads as a lollipop -- because a broadleaf tree's
// entire silhouette signal is the FORK. A bole that splits, splits again,
// and holds its leaves in distinct masses with sky between them. One blob
// on a stick has none of that however much the shader roughens its
// surface, which is why the surface work never fixed it.
//
// The bole is branch generation 1. Every recursive generation is derived
// from its actual parent: child length is one configurable fraction of the
// preceding segment, and radius tapers at the same joint. Foliage exists
// only at the final tips, leaving the supporting structure visible.
const DECIDUOUS_CROWN_SCALE = 1.25;

export interface DeciduousTreeParameters {
    crownShape: DeciduousCrownShape;
    crownScale: number;
    leafScale: number;
    leafGloss: number;
    innerCrownOpacity: number;
    outerCrownOpacity: number;
    branchGravity: number;
    maxBranchesPerFork: number;
    recursionDepth: number;
    branchLengthRatio: number;
    trunkScale: number;
}

export interface DeciduousTreeStats {
    branches: number;
    forks: number;
    crownClusters: number;
    generations: number;
}

const DEFAULT_DECIDUOUS_PARAMETERS: DeciduousTreeParameters = {
    crownShape: 'ball',
    crownScale: 2.15,
    leafScale: 0.45,
    leafGloss: 0.46,
    innerCrownOpacity: 0.79,
    outerCrownOpacity: 0.49,
    branchGravity: 1.38,
    maxBranchesPerFork: 2,
    recursionDepth: 3,
    branchLengthRatio: 0.60,
    trunkScale: 1.50,
};

// Current in-game broadleaf trial profile. Keep this fixed across the eight
// seeded prototypes while evaluating it from the game camera; their height,
// fork angles, branch counts and placement still provide natural variation.
function gameDeciduousParameters(): DeciduousTreeParameters {
    return {
        crownShape: 'dome',
        crownScale: 1.40,
        leafScale: 0.60,
        leafGloss: 0.46,
        innerCrownOpacity: 0.95,
        outerCrownOpacity: 1.00,
        branchGravity: 0,
        maxBranchesPerFork: 3,
        recursionDepth: 2,
        branchLengthRatio: 0.60,
        trunkScale: 1.15,
    };
}

function makeDeciduous(
    rng: () => number,
    index: number = 0,
    total: number = 1,
    dead: boolean = false,
    autumn: boolean = false,
    parameters?: DeciduousTreeParameters,
): any {
    const resolvedParameters = parameters ?? gameDeciduousParameters();
    const tree = new THREE.Group();
    tree.userData.decorationTreeKind = 'deciduous';
    // The workbench keeps its familiar #05 scale. In the game, spread the
    // eight cached prototypes over a taller, bottom-heavy range: most stay
    // ordinary, while the last couple become unmistakable canopy trees.
    // Placement picks among these prototypes randomly, so not every tree is
    // raised and the tall end cannot disappear through eight unlucky rolls.
    const gameRung = total > 1 ? index / (total - 1) : 0.5;
    const height = parameters
        ? 1.15 + rng() * 0.75
        : 1.35 + Math.pow(gameRung, 1.7) * 2.10 + (rng() - 0.5) * 0.12;
    // Keep every prototype's natural proportions here. Tile containment is
    // enforced later, after its placement scale is known, and only compresses
    // X/Z when the actual footprint would cross the owning hex boundary.
    const girth = height / 1.2;
    const seed = Math.floor(height * 4096);
    // Weathered grey once the tree is dead -- live bark under a bare crown
    // reads as a tree that has merely lost its leaves for the season.
    const barkColor = dead ? vary(0x6e6257, rng, 0.15) : vary(0x66513f, rng, 0.12);
    // Deep forest green to yellowish light green, per TREE -- the low end
    // dips into the conifer range on purpose.
    //
    // A TURNED TREE WALKS THE VARIANTS, yellow through orange to red,
    // rather than drawing a colour. Eight prototypes exist for this kind;
    // rolling the shade inside the maker would give eight arbitrary points
    // on the ramp and could easily land all of them in the same third of
    // it. By index, the set is guaranteed to hold all three colours.
    //
    // The crown shader multiplies this base by a fixed hue walk -- cool,
    // mid, warm -- so the dots vary around whatever it is handed. Given a
    // warm base those factors stay inside the warm family, which is why
    // this needs no shader change at all.
    // PULLED MOST OF THE WAY BACK TO GREEN. The pure ramp read as painted
    // rather than turned -- a crown of saturated yellow next to a spruce is
    // a colour swatch, not a tree. Muting it to roughly half green leaves
    // the hue readable while keeping the canopy in the same family as
    // everything around it, and varying how far each tree comes back means
    // one is barely on the turn while its neighbour is well into it.
    const turn = total > 1 ? index / (total - 1) : rng();
    const turned = turn < 0.5 ? lerpHex(0xd8b62c, 0xcf7526, turn * 2)
                              : lerpHex(0xcf7526, 0xa3332a, turn * 2 - 1);
    const leafColor = autumn
        ? lerpHex(turned, 0x395a2b, 0.42 + rng() * 0.20)
        : lerpHex(0x395a2b, 0x5f7d36, seedT(seed * 97));

    // The bole: kept bare, so the crown sits ON something visible.
    const boleH = height * (0.44 + rng() * 0.12);
    const rTrunk = (0.05 + rng() * 0.022) * girth * resolvedParameters.trunkScale;
    const lean = new THREE.Vector3((rng() - 0.5) * 0.10, 1, (rng() - 0.5) * 0.10);
    const bole = growLimb(tree, rng, new THREE.Vector3(0, 0, 0), lean, boleH, rTrunk * 1.35, rTrunk * 0.62, 3, 16, 0, 0.06, barkColor);

    const maxBranches = Math.max(2, Math.min(5, Math.round(resolvedParameters.maxBranchesPerFork)));
    let cluster = 0;
    let branches = 1; // The trunk is branch generation 1.
    let forks = 0;
    const growFork = (
        from: any,
        heading: any,
        parentLength: number,
        parentTipRadius: number,
        level: number,
    ): void => {
        forks++;
        // The percentage applies to the actual parent segment. With the
        // trunk as generation 1, generation N is exactly
        // trunkLength * ratio^(N - 1), never another height estimate.
        const branchLength = childBranchLength(parentLength, resolvedParameters.branchLengthRatio);

        // Build an orthonormal frame around the parent. Children are points
        // around a cone mantle in THIS 3D frame, not rotations around one
        // transverse axis (which can only ever produce a flat fan).
        const reference = Math.abs(heading.y) < 0.92 ? LIMB_UP : new THREE.Vector3(1, 0, 0);
        const coneX = new THREE.Vector3().crossVectors(heading, reference).normalize();
        const coneZ = new THREE.Vector3().crossVectors(heading, coneX).normalize();
        // The control is a ceiling, not a repeated exact count. Every fork
        // draws independently, but never produces a single-child non-fork.
        const branchCount = maxBranches === 2
            ? 2
            : 2 + Math.floor(rng() * (maxBranches - 1));
        const azimuthPhase = rng() * Math.PI * 2;
        const coneOpening = 0.72 + rng() * 0.42;

        const childBaseRadius = parentTipRadius * Math.min(0.88, 1.18 / Math.sqrt(branchCount));
        const childTipRadius = childBaseRadius * 0.42;
        for (let branch = 0; branch < branchCount; branch++) {
            branches++;
            // Start from an even 3D distribution, then move each child by up
            // to 35% of one sector. That preserves separation while removing
            // the manufactured tripod/pentagon silhouette.
            const sector = Math.PI * 2 / branchCount;
            const azimuth = azimuthPhase + branch * Math.PI * 2 / branchCount
                + (rng() - 0.5) * sector * 0.70;
            const opening = coneOpening + (rng() - 0.5) * 0.30;
            const radial = coneX.clone().multiplyScalar(Math.cos(azimuth))
                .addScaledVector(coneZ, Math.sin(azimuth));
            const direction = heading.clone().multiplyScalar(Math.cos(opening))
                .addScaledVector(radial, Math.sin(opening))
                .lerp(LIMB_UP, 0.06 + rng() * 0.06)
                .normalize();
            const child = growLimb(
                tree, rng, from, direction, branchLength,
                // At gameplay scale a branch only needs a solid silhouette.
                // A triangular prism is six side triangles per piece instead
                // of twenty, while the bole remains rounder at 16 sides.
                childBaseRadius, childTipRadius, 2, 3,
                resolvedParameters.branchGravity * 0.12, 0.30, barkColor
            );

            if (level + 1 < resolvedParameters.recursionDepth) {
                growFork(child.tip, child.heading, branchLength, childTipRadius, level + 1);
            } else if (!dead) {
                const depthScale = Math.pow(0.78, resolvedParameters.recursionDepth - 1);
                const densityScale = Math.sqrt(3 / branchCount);
                const crownRadius = (0.14 + rng() * 0.05) * girth * DECIDUOUS_CROWN_SCALE
                    * resolvedParameters.crownScale * depthScale * densityScale;
                addCluster(
                    tree,
                    rng,
                    child.tip,
                    crownRadius,
                    leafColor,
                    seed + cluster++,
                    resolvedParameters.crownShape,
                );
            }
        }
    };

    growFork(bole.tip, bole.heading, boleH, rTrunk * 0.62, 0);
    // Leave the fork open. Foliage belongs at the twig tips above; putting
    // an extra cluster directly on the bole makes a ball sit on the trunk
    // with no supporting branch, hiding the structure that reads as a tree.
    tree.userData.treeStats = {
        branches,
        forks,
        crownClusters: cluster,
        generations: resolvedParameters.recursionDepth + 1,
    } satisfies DeciduousTreeStats;
    return tree;
}

// Focused workbench entry point. It uses the same deterministic broadleaf
// maker and merge path as map decorations, but bypasses the prototype cache
// so parameter changes can rebuild one tree immediately.
export function createDeciduousTreeModel(parameters: Partial<DeciduousTreeParameters> = {}): any {
    const resolved: DeciduousTreeParameters = {
        crownShape: parameters.crownShape === 'disk'
            || parameters.crownShape === 'dome'
            || parameters.crownShape === 'drop'
            ? parameters.crownShape
            : DEFAULT_DECIDUOUS_PARAMETERS.crownShape,
        crownScale: Math.max(0.45, Math.min(3, parameters.crownScale ?? DEFAULT_DECIDUOUS_PARAMETERS.crownScale)),
        leafScale: Math.max(0.35, Math.min(2.5, parameters.leafScale ?? DEFAULT_DECIDUOUS_PARAMETERS.leafScale)),
        leafGloss: Math.max(0, Math.min(1, parameters.leafGloss ?? DEFAULT_DECIDUOUS_PARAMETERS.leafGloss)),
        innerCrownOpacity: Math.max(0, Math.min(1, parameters.innerCrownOpacity ?? DEFAULT_DECIDUOUS_PARAMETERS.innerCrownOpacity)),
        outerCrownOpacity: Math.max(0, Math.min(1, parameters.outerCrownOpacity ?? DEFAULT_DECIDUOUS_PARAMETERS.outerCrownOpacity)),
        branchGravity: Math.max(0, Math.min(3, parameters.branchGravity ?? DEFAULT_DECIDUOUS_PARAMETERS.branchGravity)),
        maxBranchesPerFork: Math.max(2, Math.min(5, Math.round(parameters.maxBranchesPerFork ?? DEFAULT_DECIDUOUS_PARAMETERS.maxBranchesPerFork))),
        recursionDepth: Math.max(1, Math.min(4, Math.round(parameters.recursionDepth ?? DEFAULT_DECIDUOUS_PARAMETERS.recursionDepth))),
        branchLengthRatio: Math.max(0.35, Math.min(0.85, parameters.branchLengthRatio ?? DEFAULT_DECIDUOUS_PARAMETERS.branchLengthRatio)),
        trunkScale: Math.max(0.5, Math.min(2, parameters.trunkScale ?? DEFAULT_DECIDUOUS_PARAMETERS.trunkScale)),
    };
    const rng = variantRng('deciduous', 4);
    const tree = makeDeciduous(rng, 4, VARIANTS_PER_KIND, false, false, resolved);
    const treeStats = tree.userData.treeStats;
    tintIndividual(tree, rng);
    addFoliageGrayHint(tree, 0.14, 2);
    const group = new THREE.Group();
    group.add(tree);
    const merged = mergeDecorations(group);
    if (merged) {
        merged.userData.treeStats = treeStats;
        setDecorationLeafScale(merged, resolved.leafScale);
        setDecorationLeafGloss(merged, resolved.leafGloss);
        setDecorationCrownOpacity(
            merged,
            resolved.innerCrownOpacity,
            resolved.outerCrownOpacity,
        );
    }
    return merged;
}

const BUSH_SCALE = 1.35;
const BUSH_GROUND_SINK = 0.04;

// Bush: 1-3 low blobs, no trunk.
function makeBush(rng: () => number): any {
    const bush = new THREE.Group();
    const blobs = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
        const radius = 0.13 + rng() * 0.10;
        const bushSeed = Math.floor(radius * 8192);
        const blob = addMesh(
            bush,
            roughen(new THREE.IcosahedronGeometry(radius, 1), bushSeed + i, radius * 0.38),
            vary(lerpHex(0x33512a, 0x567336, seedT(bushSeed * 97)), rng, 0.22),
            (rng() - 0.5) * 0.2,
            radius * 0.7,
            (rng() - 0.5) * 0.2,
            2
        );
        addFringe(bush, blob);
    }
    bush.scale.setScalar(BUSH_SCALE);
    return bush;
}

// Dead tree: a bare, slightly leaning trunk with a couple of stubby
// branches. Weathered gray-brown, no foliage.
function makeDeadTree(rng: () => number): any {
    const tree = new THREE.Group();
    const trunkH = 0.5 + rng() * 0.4;
    const trunk = addMesh(tree, new THREE.CylinderGeometry(0.035, 0.06, trunkH, 5), vary(0x6e6257, rng, 0.15), 0, trunkH / 2, 0);
    trunk.rotation.z = (rng() - 0.5) * 0.25;
    const branches = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < branches; i++) {
        const branchL = 0.16 + rng() * 0.16;
        const y = trunkH * (0.45 + rng() * 0.45);
        const branch = addMesh(tree, new THREE.CylinderGeometry(0.015, 0.03, branchL, 4), vary(0x5c5145, rng, 0.15), 0, y, 0);
        branch.rotation.z = 0.9 + rng() * 0.9;
        branch.rotation.y = rng() * Math.PI * 2;
        branch.translateY(branchL / 2);
    }
    return tree;
}

// Fallen log: a horizontal trunk resting on the ground, sometimes with a
// bit of moss on top.
function makeLog(rng: () => number): any {
    const group = new THREE.Group();
    const length = 0.4 + rng() * 0.3;
    const radius = 0.055 + rng() * 0.035;
    const log = addMesh(group, new THREE.CylinderGeometry(radius, radius * 0.9, length, 6), vary(0x5f4a33, rng, 0.18), 0, radius, 0);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rng() * Math.PI;
    if (rng() < 0.6) {
        // Moss patch riding on the log.
        addMesh(
            group,
            roughen(new THREE.IcosahedronGeometry(radius * 0.9, 1), 0, radius * 0.30),
            vary(0x3e6b2f, rng, 0.2),
            (rng() - 0.5) * length * 0.5,
            radius * 1.6,
            0,
            2
        );
    }
    return group;
}

// Grass/shrub tuft: a few tiny cones -- undergrowth for mountain feet
// and forest edges.
function makeTuft(rng: () => number): any {
    const tuft = new THREE.Group();
    const blades = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < blades; i++) {
        const h = 0.08 + rng() * 0.1;
        addMesh(
            tuft,
            new THREE.ConeGeometry(0.03 + rng() * 0.025, h, 4),
            vary(0x5a7d33, rng, 0.25),
            (rng() - 0.5) * 0.14,
            h / 2,
            (rng() - 0.5) * 0.14,
            2
        );
    }
    return tuft;
}

// Rock: one low angular stone, occasionally two -- a lone stone reads as
// geology, a pile of three read as scattered litter.
function makeRocks(rng: () => number, base: number): any {
    const rocks = new THREE.Group();
    const count = rng() < 0.25 ? 2 : 1;
    for (let i = 0; i < count; i++) {
        const radius = 0.12 + rng() * 0.13;
        // kind -1: the shader gives rock its own craggy treatment, and the
        // burn check (vDecorKind > 0.5 discards foliage) leaves it standing.
        const rock = addMesh(
            rocks,
            // Detail 0 keeps broad chipped faces; detail 1 plus radial
            // normals produced smooth round lumps. Rocks explicitly use
            // faceted normals so light catches their planes as stone.
            roughen(new THREE.DodecahedronGeometry(radius, 0), i, radius * 0.22, true),
            vary(base, rng, 0.18),
            (rng() - 0.5) * 0.3,
            0,
            (rng() - 0.5) * 0.3,
            -1
        );
        const yScale = 0.28 + rng() * 0.16;
        // A visibly asymmetric footprint is required for yaw randomisation
        // to mean anything. Near-circular dodecahedra look identical after
        // rotation, which was the original same-direction complaint hiding
        // behind a nominally random angle.
        const longAxis = 1.0 + rng() * 0.55;
        const shortAxis = 0.55 + rng() * 0.25;
        rock.scale.set(longAxis, yScale, shortAxis);
        // Sink the bottom edge slightly into the ground instead of balancing
        // a round body on top of it.
        rock.position.y = radius * yScale * 0.78;
        rock.rotation.y = rng() * Math.PI;
    }
    return rocks;
}

// The cached prototype supplies the geometry, but never its final heading.
// Both the cluster and every stone in it get a tile-specific angle so the
// same elongated silhouettes do not form a repeated compass direction.
// This is hash-based rather than rng-based; see rockRotationForTile.
function orientRocksForTile(rocks: any, q: number, r: number): void {
    rocks.rotation.y = rockRotationForTile(q, r, -1);
    let index = 0;
    rocks.traverse((child: any) => {
        if (child.isMesh && child.userData?.decorKind === -1) {
            child.rotation.y = rockRotationForTile(q, r, index++);
        }
    });
}

// Per-individual tint: nudge every mesh color in the assembly along its
// own warm/cool green axis, so no two trees (or bushes, or rocks) read
// as the exact same shade even when the silhouette repeats.
function tintIndividual(object: any, rng: () => number): void {
    const rf = 1 + (rng() - 0.5) * 0.16;
    const gf = 1 + (rng() - 0.5) * 0.10;
    const bf = 1 + (rng() - 0.5) * 0.16;
    object.traverse((child: any) => {
        if (child.isMesh && child.material?.color) {
            child.material.color.r = Math.min(1, child.material.color.r * rf);
            child.material.color.g = Math.min(1, child.material.color.g * gf);
            child.material.color.b = Math.min(1, child.material.color.b * bf);
        }
    });
}

// Random offset within the hex, keeping clear of the rim.
function scatter(rng: () => number, maxRadius: number): { x: number; z: number } {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * maxRadius;
    return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
}

function measureHorizontalFootprint(piece: any): number {
    piece.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(piece.matrixWorld);
    const vertex = new THREE.Vector3();
    let radius = 0;
    piece.traverse((child: any) => {
        const position = child.geometry?.attributes?.position;
        if (!child.isMesh || !position) return;
        for (let i = 0; i < position.count; i++) {
            vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
            radius = Math.max(radius, Math.hypot(
                vertex.x - origin.x,
                vertex.z - origin.z,
            ));
        }
    });
    return radius;
}

// ---------------------------------------------------------------------
// Prototype library
//
// Every decoration used to be built from scratch: makeConifer() allocates
// a fresh CylinderGeometry, two or three fresh ConeGeometries and a fresh
// MeshStandardMaterial for each, with randomised height, radius and
// colour. Measured on the shipped map that gave 577 decoration meshes
// backed by 577 geometries and 577 materials -- nothing shared with
// anything.
//
// Instead a small set of VARIANTS per kind is built once, and each
// placement clones one. Object3D.clone() copies the transform hierarchy
// and SHARES geometry and material, so a hundred conifers cost the
// geometry of however many variants there are.
//
// Variety survives because it moves from "every tree is unique" to three
// cheaper sources: which variant was drawn, plus the per-placement scale
// and rotation that were already being applied. At hex scale a repeated
// silhouette at a different size and angle does not read as a repeat.
//
// tintIndividual is baked INTO each variant rather than applied per
// placement. Applied per placement it would mutate the SHARED material,
// tinting every instance of that variant at once -- and again on every
// later clone, drifting the colour every time a tile was built.
const VARIANTS_PER_KIND = 8;

const library = new Map<string, any[]>();

// A variant's own rng, independent of any tile, so the library comes out
// identical whatever order tiles happen to be built in.
function variantRng(kind: string, index: number): () => number {
    let a = (hash(index * 7919 + kind.length * 40503 + kind.charCodeAt(0) * 2654) ^ 0x85ebca6b) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Draw a decoration of this kind: a clone of one of its variants.
// The variant's index and the size of the set are handed to the maker,
// because with only VARIANTS_PER_KIND prototypes in existence a maker
// cannot get a spread out of chance. Eight draws from a random height is
// eight arbitrary heights -- ask for rare and tall and you may simply not
// get one, for the life of the build. A maker that wants a range covered
// has to lay its variants along it deliberately; see makeConifer.
function pick(kind: string, make: (rng: () => number, index: number, total: number) => any, rng: () => number): any {
    let variants = library.get(kind);
    if (!variants) {
        variants = [];
        for (let i = 0; i < VARIANTS_PER_KIND; i++) {
            const seeded = variantRng(kind, i);
            const proto = make(seeded, i, VARIANTS_PER_KIND);
            tintIndividual(proto, seeded);
            proto.userData.horizontalFootprint = measureHorizontalFootprint(proto);
            variants.push(proto);
        }
        library.set(kind, variants);
    }
    return variants[Math.floor(rng() * variants.length)].clone();
}

// A living deciduous tree has turned this often: the same tree with an
// autumn crown. Rolled at placement for the reason DEAD_TREE_CHANCE is --
// fifteen percent of eight prototypes is one expected variant, and a
// library is not a population.
const AUTUMN_TREE_CHANCE = 0.15;

// A tree is drawn dead this often: bole and branches, no crown.
//
// ROLLED HERE AT PLACEMENT, not inside the maker. pick() builds its eight
// prototypes once for the life of the process, so a 5% test inside
// makeConifer would be five percent OF EIGHT DRAWS -- four tenths of a
// dead tree expected in the entire build, and most builds would contain
// none at all. The dead forms are their own library kinds instead, and the
// coin is flipped per tree placed.
const DEAD_TREE_CHANCE = 0.05;

// Draw a living tree, or occasionally the standing dead version of it.
function pickTree(kind: 'conifer' | 'deciduous', rng: () => number): any {
    const lifeRoll = rng();
    const dead = lifeRoll < DEAD_TREE_CHANCE;
    if (kind === 'conifer') {
        const tree = dead
            ? pick('conifer-dead', (r, i, n) => makeConifer(r, i, n, true), rng)
            : pick('conifer', makeConifer, rng);
        if (!dead) {
            // Reuse the life/death roll instead of consuming another random
            // number: MapSystem replays the tile stream to determine whether
            // vegetation exists. Among living trees this maps evenly to a
            // clear 55-75% drift toward a dark, cool gray. The foliage
            // shader adds green back through its sun/shadow palette, so a
            // weaker mix disappears once the tree is lit in the scene.
            const livingT = (lifeRoll - DEAD_TREE_CHANCE) / (1 - DEAD_TREE_CHANCE);
            addFoliageGrayHint(tree, 0.55 + livingT * 0.20, 1);
        }
        return tree;
    }
    if (dead) return pick('deciduous-dead', (r, i, n) => makeDeciduous(r, i, n, true), rng);
    const livingT = (lifeRoll - DEAD_TREE_CHANCE) / (1 - DEAD_TREE_CHANCE);
    // Only a living tree can have turned -- a dead one has no crown to
    // colour, and rolling for it would quietly halve the dead rate.
    const tree = rng() < AUTUMN_TREE_CHANCE
        ? pick('deciduous-autumn', (r, i, n) => makeDeciduous(r, i, n, false, true), rng)
        : pick('deciduous', makeDeciduous, rng);
    // Deciduous crowns get the same cool gray, but much more lightly than
    // conifers so their brighter green and autumn colours remain distinct.
    addFoliageGrayHint(tree, 0.10 + livingT * 0.08, 2);
    return tree;
}

// Ground sampler for the tile currently being decorated, set by
// createProceduralDecoration for the duration of one call. Returns the
// smoothed surface height at a tile-local offset, relative to the tile's
// logical height -- so a piece scattered onto sagged ground sinks with
// it instead of hovering at the flat pre-smoothing level.
let currentGroundAt: ((x: number, z: number) => number) | null = null;

// Drop a sub-assembly into the tile group at a scattered position.
function place(
    group: any,
    rng: () => number,
    piece: any,
    maxRadius: number,
    spin: boolean = true,
    groundOffset: number = 0,
): void {
    const { x, z } = scatter(rng, maxRadius);
    const ground = currentGroundAt ? currentGroundAt(x, z) : 0;
    piece.position.set(x, ground + groundOffset, z);
    if (spin) piece.rotation.y = rng() * Math.PI * 2;
    group.add(piece);
}

// A radius-1 pointy hex has an inradius of sqrt(3) / 2. Keeping the complete
// tree inside a slightly smaller circle is conservative but rotation-proof:
// anything inside that circle is inside the hex for every yaw angle.
const TREE_TILE_SAFE_RADIUS = Math.sqrt(3) / 2 - 0.035;

function fitDeciduousTreeScatter(piece: any, requestedScatter: number): number {
    if (piece.userData?.decorationTreeKind !== 'deciduous') return requestedScatter;

    const cachedFootprint = piece.userData.horizontalFootprint;
    let footprint = typeof cachedFootprint === 'number'
        ? cachedFootprint * Math.max(piece.scale.x, piece.scale.z)
        : measureHorizontalFootprint(piece);

    if (footprint > TREE_TILE_SAFE_RADIUS) {
        const compression = TREE_TILE_SAFE_RADIUS / footprint;
        piece.scale.x *= compression;
        piece.scale.z *= compression;
        footprint = TREE_TILE_SAFE_RADIUS;
    }

    return Math.min(
        requestedScatter,
        Math.max(0, TREE_TILE_SAFE_RADIUS - footprint),
    );
}

// ---------------------------------------------------------------------
// Per-tile merge
//
// A decorated tile held five separate meshes -- a trunk, two or three
// cones, a bush -- each its own draw call. Across the shipped map that is
// 577 draws for the scenery alone, out of about 2000 for the whole frame,
// and this scene is bound by draw calls rather than by its 70k triangles.
//
// They all share ONE shader program already (customProgramCacheKey is
// constant), so the only things that stopped them being one mesh were the
// per-material base colour and the per-material kind. Both become vertex
// attributes here, and the tile becomes a single mesh.
//
// ONE MATERIAL PER TILE, not one for the whole map, deliberately:
// GridSystem.updateDecoratorTransparency dims a tile's decoration when a
// unit stands on it by writing material.opacity. A map-wide material would
// make one unit dim every tree in the world.
//
// aDecorLocal is the load-bearing detail. The organic-detail shader
// computes the conifer's branch banding and the crown splotches from the
// vertex's position in ITS OWN mesh; after a merge `position` is
// tile-local, so the original is carried alongside it. Get that wrong and
// every tree on the map silently changes pattern scale.

const MERGE_ATTRS = ['position', 'normal', 'uv'] as const;

function mergeDecorations(group: any): any | null {
    group.updateMatrixWorld(true);

    const parts: any[] = [];
    group.traverse((child: any) => { if (child.isMesh && child.geometry) parts.push(child); });
    if (parts.length === 0) return null;
    if (parts.length === 1 && parts[0].parent === group) {
        // Nothing to merge; leave it alone rather than rebuild it.
        return group;
    }

    let vertices = 0;
    let indices = 0;
    for (const mesh of parts) {
        const g = mesh.geometry;
        vertices += g.attributes.position.count;
        indices += g.index ? g.index.count : g.attributes.position.count;
    }

    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2);
    const local = new Float32Array(vertices * 3);
    const color = new Float32Array(vertices * 3);
    const kind = new Float32Array(vertices);
    const wind = new Float32Array(vertices);
    const windAnchor = new Float32Array(vertices * 3);
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

    const normalMatrix = new THREE.Matrix3();
    const vertex = new THREE.Vector3();
    const treeOrigin = new THREE.Vector3();
    const clusterCenter = new THREE.Vector3();
    let vOffset = 0;
    let iOffset = 0;

    for (const mesh of parts) {
        const g = mesh.geometry;
        const count = g.attributes.position.count;
        // The group sits at the origin while it is being built, so a mesh's
        // matrixWorld already IS its transform within the tile.
        const matrix = mesh.matrixWorld;
        normalMatrix.getNormalMatrix(matrix);

        const src = g.attributes.position;
        const srcNormal = g.attributes.normal;
        const srcUv = g.attributes.uv;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const c = material?.color ?? { r: 1, g: 1, b: 1 };
        const k = mesh.userData.decorKind ?? 0;
        const windWeight = mesh.userData.decorWind ?? 0;
        treeOrigin.set(0, 0, 0).applyMatrix4(mesh.parent.matrixWorld);
        clusterCenter.set(0, 0, 0).applyMatrix4(matrix);
        const grayHint = mesh.userData.decorGrayHint ?? 0;
        const cr = c.r + (FOLIAGE_DARK_GRAY.r - c.r) * grayHint;
        const cg = c.g + (FOLIAGE_DARK_GRAY.g - c.g) * grayHint;
        const cb = c.b + (FOLIAGE_DARK_GRAY.b - c.b) * grayHint;

        for (let i = 0; i < count; i++) {
            // Merged, tile-local.
            vertex.set(src.getX(i), src.getY(i), src.getZ(i));
            // Kept untransformed for the shader -- see the header.
            local[(vOffset + i) * 3] = vertex.x;
            local[(vOffset + i) * 3 + 1] = vertex.y;
            local[(vOffset + i) * 3 + 2] = vertex.z;

            vertex.applyMatrix4(matrix);
            position[(vOffset + i) * 3] = vertex.x;
            position[(vOffset + i) * 3 + 1] = vertex.y;
            position[(vOffset + i) * 3 + 2] = vertex.z;

            if (srcNormal) {
                vertex.set(srcNormal.getX(i), srcNormal.getY(i), srcNormal.getZ(i))
                    .applyMatrix3(normalMatrix).normalize();
                normal[(vOffset + i) * 3] = vertex.x;
                normal[(vOffset + i) * 3 + 1] = vertex.y;
                normal[(vOffset + i) * 3 + 2] = vertex.z;
            }
            if (srcUv) {
                uv[(vOffset + i) * 2] = srcUv.getX(i);
                uv[(vOffset + i) * 2 + 1] = srcUv.getY(i);
            }

            color[(vOffset + i) * 3] = cr;
            color[(vOffset + i) * 3 + 1] = cg;
            color[(vOffset + i) * 3 + 2] = cb;
            kind[vOffset + i] = k;
            wind[vOffset + i] = windWeight;
            // XZ comes from the tree root so every cluster shares one phase;
            // Y comes from this cluster's centre so higher tufts bend a little
            // farther without deforming any individual crown shell.
            windAnchor[(vOffset + i) * 3] = treeOrigin.x;
            windAnchor[(vOffset + i) * 3 + 1] = clusterCenter.y;
            windAnchor[(vOffset + i) * 3 + 2] = treeOrigin.z;
        }

        if (g.index) {
            for (let i = 0; i < g.index.count; i++) index[iOffset + i] = g.index.getX(i) + vOffset;
            iOffset += g.index.count;
        } else {
            for (let i = 0; i < count; i++) index[iOffset + i] = i + vOffset;
            iOffset += count;
        }
        vOffset += count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setAttribute('aDecorLocal', new THREE.BufferAttribute(local, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
    merged.setAttribute('aDecorKind', new THREE.BufferAttribute(kind, 1));
    merged.setAttribute('aDecorWind', new THREE.BufferAttribute(wind, 1));
    merged.setAttribute('aDecorWindAnchor', new THREE.BufferAttribute(windAnchor, 3));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    merged.computeBoundingSphere();

    // Colour now comes from the vertices, so the material carries white.
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: false,
        // Double-sided since the crown gaps CLIP: through a hole you see
        // the canopy interior (backfaces), not out the other side.
        side: THREE.DoubleSide,
        // Transparent so the crowns can carry real varying alpha; every
        // non-foliage fragment writes alpha 1.0 and stays visually opaque.
        transparent: true,
        vertexColors: true,
    });
    applyOrganicDetail(material);

    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // THE SHADOW PASS DOES NOT USE THIS MATERIAL. It renders depth with its
    // own MeshDepthMaterial, which knows nothing about uBurn -- so a burnt
    // tile lost its crown in the colour pass and went on casting a
    // full-canopy shadow. The depth material has to discard the same
    // fragments, from the same uniform.
    mesh.customDepthMaterial = burnAwareDepthMaterial(material);
    return mesh;
}

// A depth material that drops the same fragments the visible one does.
//
// Shares the visible material's burn uniform OBJECT rather than a copy, so
// setting it in one place blackens the tile and clears its shadow together
// -- two uniforms would be two things to keep in step, and the one that got
// forgotten would be the shadow, silently.
function burnAwareDepthMaterial(source: any): any {
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader: any) => {
        shader.uniforms.uBurn = source.userData.burnUniform;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying float vDecorKind;\n attribute float aDecorKind;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n vDecorKind = aDecorKind;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n varying float vDecorKind;\n uniform float uBurn;')
            .replace('void main() {', 'void main() {\n if (uBurn > 0.5 && vDecorKind > 0.5) discard;');
    };
    depth.customProgramCacheKey = () => 'decor-depth-burn';
    return depth;
}

// Build the decoration group for a tile, or null for none. Deterministic
// per (q, r): reloads produce the identical map dressing. `tileHeight`
// zones the mountains: vegetated foot, bare rocky heights.
export function createProceduralDecoration(
    terrainType: string,
    q: number,
    r: number,
    tileHeight: number = 0,
    groundAt: ((x: number, z: number) => number) | null = null
): any | null {
    const rng = tileRng(q, r);
    const group = new THREE.Group();
    // Consumed by place(); refreshed on every call, so no clearing needed.
    currentGroundAt = groundAt;

    switch (terrainType) {
        case 'FOREST': {
            // A grove: conifer-heavy mix, always present.
            const trees = 3 + Math.floor(rng() * 3);
            for (let i = 0; i < trees; i++) {
                // The occasional grove slot is a dead tree instead.
                const roll = rng();
                const tree = roll < 0.10 ? pick('deadTree', makeDeadTree, rng)
                    : roll < 0.68 ? pickTree('conifer', rng) : pickTree('deciduous', rng);
                const s = 0.8 + rng() * 0.35;
                tree.scale.set(s, s, s);
                place(group, rng, tree, fitDeciduousTreeScatter(tree, 0.55));
            }
            // Forest floor litter: a fallen log and/or undergrowth tufts.
            if (rng() < 0.35) place(group, rng, pick('log', makeLog, rng), 0.5);
            if (rng() < 0.4) place(group, rng, pick('tuft', makeTuft, rng), 0.6);
            break;
        }
        case 'GRASS': {
            const roll = rng();
            if (roll < 0.30) {
                // Bushes.
                const bushes = 1 + Math.floor(rng() * 2);
                for (let i = 0; i < bushes; i++) {
                    const bush = pick('bush', makeBush, rng);
                    place(group, rng, bush, 0.5, false, -BUSH_GROUND_SINK);
                }
            } else if (roll < 0.45) {
                // A lone deciduous tree.
                const tree = pickTree('deciduous', rng);
                place(group, rng, tree, fitDeciduousTreeScatter(tree, 0.4));
            } else if (roll < 0.52) {
                // A lone dead tree or a fallen log on open ground.
                place(group, rng, rng() < 0.5 ? pick('deadTree', makeDeadTree, rng) : pick('log', makeLog, rng), 0.45);
            } else {
                return null; // open grassland
            }
            break;
        }
        case 'SAND': {
            // Rare on purpose: sand tiles cluster into beaches, and at 35%
            // a beach carried ten stones -- reading as gravel spill, not
            // "the odd stone here and there".
            if (rng() < 0.10) {
                const rocks = pick('rocks-sand', (r) => makeRocks(r, 0xb8a98c), rng);
                orientRocksForTile(rocks, q, r);
                place(group, rng, rocks, 0.45, false);
            } else {
                return null;
            }
            break;
        }
        case 'MOUNTAIN': {
            // The mountain FOOT (low mountain tiles) is alive: undergrowth
            // and shrubs. Higher up it's bare rock -- with the rare, hardy
            // little conifer clinging on. NO decor stones anywhere on
            // mountains: the tile is already a rock face, and scattered
            // pebbles on top of it read as clutter, not geology.
            const foot = tileHeight < 2.0;
            if (foot) {
                if (rng() < 0.55) place(group, rng, pick('tuft', makeTuft, rng), 0.5);
                if (rng() < 0.45) {
                    const bush = pick('bush', makeBush, rng);
                    place(group, rng, bush, 0.5, false, -BUSH_GROUND_SINK);
                }
            }
            // Uncommon but possible: a lone small conifer on the mountain.
            if (rng() < 0.08) {
                const pine = pickTree('conifer', rng);
                const s = 0.45 + rng() * 0.2;
                pine.scale.set(s, s, s);
                place(group, rng, pine, 0.35);
            }
            if (group.children.length === 0) return null;
            break;
        }
        default:
            return null; // WATER etc.
    }

    // One mesh per tile rather than one per twig -- see mergeDecorations.
    return group.children.length > 0 ? mergeDecorations(group) : null;
}
