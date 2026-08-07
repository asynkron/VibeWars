// Procedural hex decorations -- no model assets. Simple primitive
// assemblies (cones, blobs, boxes) generated deterministically per tile
// from a (q, r)-seeded PRNG, and matched to the TERRAIN TYPE instead of
// the old "any random OBJ on any tile" table:
//
//   FOREST    a small grove: 3-5 trees, conifer-heavy with some deciduous
//   GRASS     occasional bushes, sometimes a lone deciduous tree
//   SAND      sparse beach stones
//   MOUNTAIN  rock outcrops
//   WATER     nothing
//
// Each decoration is a THREE.Group registered as the hex's decorator, so
// all existing behaviors keep working: unit-on-tile transparency dimming
// (traverses child meshes), removal when the tile sinks into water, and
// the factory decorator replacing it on building tiles.

import { hash } from './utils';
import { PERTURB_GLSL } from './TerrainShader';

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

// World-position noise injected into every decoration material: foliage,
// bark, and rock surfaces get organic light/dark patterning instead of
// flat single-color faces. One shared compiled program for all
// decorations (same cache key); the per-material base color still comes
// from the instance.
const DECOR_NOISE_GLSL = /* glsl */ `
    varying vec3 vDecorWorldPos;
    varying vec3 vDecorLocalPos;

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

    // One plane's field of LEAF DOTS for the fringe shell: round patches,
    // each grown from its own grid cell (3x3 neighborhood so a dot can
    // straddle cell borders), most cells growing one and some staying
    // empty. Returns (mask, cell hash) -- the hash lets every dot pick
    // its own shade of green.
    vec2 decorLeafDots(vec2 uv) {
        vec2 cell = floor(uv);
        vec2 f = fract(uv);
        float best = 0.0;
        float id = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 g = vec2(float(x), float(y));
                float h = decorHash(cell + g);
                vec2 c = g + vec2(h, decorHash(cell + g + 11.0));
                float m = smoothstep(0.40, 0.20, length(f - c)) * step(0.45, h);
                if (m > best) { best = m; id = h; }
            }
        }
        return vec2(best, id);
    }
`;

const DECOR_FRAGMENT = /* glsl */ `
    {
        // Base: two octaves of world-space noise with a vertical drift so
        // the pattern wraps around crowns and trunks instead of projecting
        // flat from above.
        vec2 dp = vDecorWorldPos.xz * 7.0 + vec2(vDecorWorldPos.y * 3.1, vDecorWorldPos.y * 2.3);
        float coarse = decorNoise(dp);
        float fine = mix(0.5, decorNoise(dp * 3.7 + 11.0), decorDetailFade(dp * 3.7));
        diffuseColor.rgb *= 0.84 + 0.20 * coarse + 0.08 * fine;
        dBumpH = 0.0;

        if (vDecorKind < -0.5) {
            // ROCK: craggy faces with shadowed crevices and a dirt skirt
            // where the stone meets the ground -- the same weathered-not-
            // clean rule the mountain band follows.
            float crag = decorNoise(vDecorLocalPos.xz * 6.0 + vDecorLocalPos.y * 5.0);
            float crevice = smoothstep(0.10, 0.0, abs(decorNoise(dp * 1.4 + 3.0) - 0.5));
            diffuseColor.rgb *= 0.80 + 0.34 * crag;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, crevice * 0.6);
            float basecoat = smoothstep(0.10, -0.05, vDecorLocalPos.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.35, 0.26), basecoat * 0.35);
            dBumpH = crag * 0.8 - crevice * 0.6;
        } else if (vDecorKind < 0.5) {
            // BARK and dead wood: vertical striations -- strong variation
            // AROUND the trunk, weak along it, so the grain runs the way
            // wood splits.
            float bAngle = atan(vDecorLocalPos.z, vDecorLocalPos.x + 0.0008);
            float stria = decorNoise(vec2(bAngle * 5.0, vDecorLocalPos.y * 1.4));
            diffuseColor.rgb *= 0.78 + 0.30 * stria;
            dBumpH = stria * 0.5;
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
            diffuseColor.rgb *= fringe * clump;
            // Each branch tier is a gentle ridge; kept mild so the light
            // reads texture without embossing the whole tree.
            dBumpH = (1.0 - abs(2.0 * band - 1.0)) * 0.22 + needleField * 0.30;
        } else if (vDecorKind < 2.5) {
            // DECIDUOUS leaves: patchy variation WITHIN one crown -- some
            // clusters shift toward sunlit yellow-green, others sit in
            // deeper shade, plus fine leaf speckle.
            // The grass band's recipe on a canopy: domain-warped fbm
            // sliding between a shadowed and a sunlit tint of this tree's
            // own base color -- the same natural mottling the meadow has,
            // wrapped around the crown instead of lying on the ground.
            vec2 lp = vDecorLocalPos.xz * 3.2 + vec2(vDecorLocalPos.y * 2.4, -vDecorLocalPos.y * 1.8);
            vec2 lwarp = vec2(decorFbm(lp * 0.8), decorFbm(lp * 0.8 + vec2(5.2, 1.3))) - 0.5;
            float leafField = decorFbm(lp * 2.0 + lwarp * 2.6);
            diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.55, 0.64, 0.52),
                                   diffuseColor.rgb * vec3(1.45, 1.32, 0.82), leafField);
            float speckle = mix(0.5, decorNoise(vDecorWorldPos.xz * 30.0 + vDecorWorldPos.y * 14.0),
                decorDetailFade(vDecorWorldPos.xz * 30.0));
            diffuseColor.rgb *= 0.92 + 0.14 * speckle;
            // Crown self-shadowing: the underside of a canopy is where
            // the light does not reach. This cheap vertical AO does more
            // for "tree, not gumdrop" than any amount of surface noise.
            diffuseColor.rgb *= mix(0.70, 1.05, smoothstep(-0.30, 0.28, vDecorLocalPos.y));
            // Leaf-cluster relief, kept mild -- the color field above does
            // the talking now.
            dBumpH = leafField * 0.40 + speckle * 0.18;
        } else {
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
            // Each plane only contributes where it sees the crown surface
            // FACE-ON (weighted by the radial normal -- the crown pieces
            // are origin-centered blobs). An oblique projection smears its
            // dots into long brush strokes along the surface, and without
            // the weighting those smears win the max and streak the crown.
            vec3 pn = normalize(vDecorLocalPos + vec3(0.0008));
            vec2 dxy = decorLeafDots(vDecorLocalPos.xy * 9.0);
            dxy.x *= smoothstep(0.25, 0.60, abs(pn.z));
            vec2 dzy = decorLeafDots(vDecorLocalPos.zy * 9.0 + 31.0);
            dzy.x *= smoothstep(0.25, 0.60, abs(pn.x));
            vec2 dxz = decorLeafDots(vDecorLocalPos.xz * 9.0 + 17.0);
            dxz.x *= smoothstep(0.25, 0.60, abs(pn.y));
            vec2 dot1 = dxy;
            if (dzy.x > dot1.x) dot1 = dzy;
            if (dxz.x > dot1.x) dot1 = dxz;
            // Soft rims via stochastic coverage (per-pixel dither), solid
            // cores -- still one opaque mesh, no sorting.
            if (dot1.x < decorHash(gl_FragCoord.xy * 0.71)) discard;
            // EVERY DOT ITS OWN GREEN, from its cell hash -- the mix of
            // shades is what reads as individual outer leaves rather than
            // one perforated skin. No bloom: a glint was tried here and
            // read as gloss on a waxed apple.
            diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.62, 0.72, 0.55),
                                   diffuseColor.rgb * vec3(1.35, 1.28, 0.85), dot1.y);
        }
    }
`;

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
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uBurn = material.userData.burnUniform;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vDecorWorldPos;\n varying vec3 vDecorLocalPos;\n varying float vDecorKind;\n attribute vec3 aDecorLocal;\n attribute float aDecorKind;')
            .replace(
                '#include <begin_vertex>',
                // aDecorLocal is the vertex's position in ITS OWN mesh, kept
                // through the merge. The conifer's branch banding and the
                // crown splotches are computed in that frame, so feeding
                // them the merged tile-local position instead would rescale
                // every pattern on the map.
                '#include <begin_vertex>\n vDecorWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n vDecorLocalPos = aDecorLocal;\n vDecorKind = aDecorKind;'
            );
        shader.fragmentShader = shader.fragmentShader
            // dBumpH is written by the color pass and read by the bump
            // pass -- a GLSL global, same wiring as the terrain's gBumpH.
            .replace('#include <common>', '#include <common>\n varying float vDecorKind;\n uniform float uBurn;\n float dBumpH;\n' + DECOR_NOISE_GLSL + PERTURB_GLSL)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + DECOR_FRAGMENT + DECOR_BURN_GLSL)
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n normal = groundPerturbNormal(vDecorWorldPos, normal, dBumpH, 0.14);'
            );
    };
    material.customProgramCacheKey = () => 'decor-organic';
}

function mat(color: number, kind: number = 0) {
    const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: false,
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
function addFringe(parent: any, source: any): void {
    const shell = new THREE.Mesh(source.geometry, source.material.clone());
    shell.userData.decorKind = 3;
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
function makeConifer(rng: () => number): any {
    const tree = new THREE.Group();
    const height = 0.95 + rng() * 0.7;
    // Per-TREE jitter seed, derived from a value the stream already drew --
    // no new rng draws (tileVegetation replays this stream), but two
    // conifers no longer share the exact same lumps.
    const seed = Math.floor(height * 4096);
    const trunkH = height * 0.22;
    addMesh(tree, new THREE.CylinderGeometry(0.05, 0.07, trunkH, 5), vary(0x5a4028, rng, 0.15), 0, trunkH / 2, 0);
    const layers = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const radius = (0.34 - 0.14 * t) * (0.8 + rng() * 0.4);
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
        addFringe(tree, cone);
    }
    return tree;
}

// Deciduous: trunk + 1-3 clumped leaf blobs.
function makeDeciduous(rng: () => number): any {
    const tree = new THREE.Group();
    const trunkH = 0.42 + rng() * 0.25;
    const seed = Math.floor(trunkH * 4096);
    addMesh(tree, new THREE.CylinderGeometry(0.06, 0.08, trunkH, 5), vary(0x6b4a2c, rng, 0.15), 0, trunkH / 2, 0);
    // Deep forest green to yellowish light green, per TREE -- the low end
    // dips into the conifer range on purpose.
    const leafColor = lerpHex(0x395a2b, 0x5f7d36, seedT(seed * 97));
    const blobs = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
        const radius = 0.24 + rng() * 0.16;
        const dx = (rng() - 0.5) * 0.3;
        const dz = (rng() - 0.5) * 0.3;
        const y = trunkH + radius * (0.75 + rng() * 0.3);
        const blob = addMesh(tree, roughen(new THREE.IcosahedronGeometry(radius, 1), seed + i, radius * 0.40), vary(leafColor, rng, 0.2), dx, y, dz, 2);
        addFringe(tree, blob);
    }
    return tree;
}

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

// Rock: 1-3 squashed gray dodecahedra.
function makeRocks(rng: () => number, base: number): any {
    const rocks = new THREE.Group();
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
        const radius = 0.12 + rng() * 0.13;
        // kind -1: the shader gives rock its own craggy treatment, and the
        // burn check (vDecorKind > 0.5 discards foliage) leaves it standing.
        const rock = addMesh(
            rocks,
            roughen(new THREE.DodecahedronGeometry(radius, 1), i, radius * 0.35),
            vary(base, rng, 0.18),
            (rng() - 0.5) * 0.3,
            radius * 0.5,
            (rng() - 0.5) * 0.3,
            -1
        );
        rock.scale.y = 0.6 + rng() * 0.3;
        rock.rotation.y = rng() * Math.PI;
    }
    return rocks;
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
function pick(kind: string, make: (rng: () => number) => any, rng: () => number): any {
    let variants = library.get(kind);
    if (!variants) {
        variants = [];
        for (let i = 0; i < VARIANTS_PER_KIND; i++) {
            const seeded = variantRng(kind, i);
            const proto = make(seeded);
            tintIndividual(proto, seeded);
            variants.push(proto);
        }
        library.set(kind, variants);
    }
    return variants[Math.floor(rng() * variants.length)].clone();
}

// Ground sampler for the tile currently being decorated, set by
// createProceduralDecoration for the duration of one call. Returns the
// smoothed surface height at a tile-local offset, relative to the tile's
// logical height -- so a piece scattered onto sagged ground sinks with
// it instead of hovering at the flat pre-smoothing level.
let currentGroundAt: ((x: number, z: number) => number) | null = null;

// Drop a sub-assembly into the tile group at a scattered position.
function place(group: any, rng: () => number, piece: any, maxRadius: number, spin: boolean = true): void {
    const { x, z } = scatter(rng, maxRadius);
    piece.position.set(x, currentGroundAt ? currentGroundAt(x, z) : 0, z);
    if (spin) piece.rotation.y = rng() * Math.PI * 2;
    group.add(piece);
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
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

    const normalMatrix = new THREE.Matrix3();
    const vertex = new THREE.Vector3();
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

            color[(vOffset + i) * 3] = c.r;
            color[(vOffset + i) * 3 + 1] = c.g;
            color[(vOffset + i) * 3 + 2] = c.b;
            kind[vOffset + i] = k;
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
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    merged.computeBoundingSphere();

    // Colour now comes from the vertices, so the material carries white.
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: false,
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
                const tree = roll < 0.10 ? pick('deadTree', makeDeadTree, rng) : roll < 0.68 ? pick('conifer', makeConifer, rng) : pick('deciduous', makeDeciduous, rng);
                const s = 0.8 + rng() * 0.35;
                tree.scale.set(s, s, s);
                place(group, rng, tree, 0.55);
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
                    place(group, rng, bush, 0.5, false);
                }
            } else if (roll < 0.45) {
                // A lone deciduous tree.
                const tree = pick('deciduous', makeDeciduous, rng);
                place(group, rng, tree, 0.4);
            } else if (roll < 0.52) {
                // A lone dead tree or a fallen log on open ground.
                place(group, rng, rng() < 0.5 ? pick('deadTree', makeDeadTree, rng) : pick('log', makeLog, rng), 0.45);
            } else {
                return null; // open grassland
            }
            break;
        }
        case 'SAND': {
            if (rng() < 0.35) {
                place(group, rng, pick('rocks-sand', (r) => makeRocks(r, 0xb8a98c), rng), 0.45, false);
            } else {
                return null;
            }
            break;
        }
        case 'MOUNTAIN': {
            // The mountain FOOT (low mountain tiles) is alive: undergrowth,
            // shrubs, and rocks between them. Higher up it's bare rock --
            // with the rare, hardy little conifer clinging on.
            const foot = tileHeight < 2.0;
            if (foot) {
                if (rng() < 0.55) place(group, rng, pick('tuft', makeTuft, rng), 0.5);
                if (rng() < 0.45) {
                    const bush = pick('bush', makeBush, rng);
                    place(group, rng, bush, 0.5, false);
                }
                if (rng() < 0.4) place(group, rng, pick('rocks-mountain', (r) => makeRocks(r, 0x7d7a74), rng), 0.4, false);
            } else if (rng() < 0.5) {
                place(group, rng, pick('rocks-mountain', (r) => makeRocks(r, 0x7d7a74), rng), 0.4, false);
            }
            // Uncommon but possible: a lone small conifer on the mountain.
            if (rng() < 0.08) {
                const pine = pick('conifer', makeConifer, rng);
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
