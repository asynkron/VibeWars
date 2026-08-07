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
    // rOuter/rInner set the dot size (fade edge to solid core, in cell
    // units), keep gates which cells grow a dot at all.
    vec2 decorLeafDots(vec2 uv, float rOuter, float rInner, float keep) {
        vec2 cell = floor(uv);
        vec2 f = fract(uv);
        float best = 0.0;
        float id = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 g = vec2(float(x), float(y));
                float h = decorHash(cell + g);
                vec2 c = g + vec2(h, decorHash(cell + g + 11.0));
                // Scalloped, not circular: noise keyed per dot perturbs
                // the rim distance, so the edge lobes like a tuft of
                // leaves instead of tracing a clean disc.
                float lobe = decorNoise(f * 13.0 + h * 41.0) - 0.5;
                float m = smoothstep(rOuter, rInner, length(f - c) + lobe * 0.20) * step(keep, h);
                if (m > best) { best = m; id = h; }
            }
        }
        return vec2(best, id);
    }

    // The full crown-dot field: three plane projections, each weighted by
    // how face-on it sees the surface (radial normal -- the crown pieces
    // are origin-centered), best dot wins. An oblique projection smears
    // its dots into brush strokes; the weighting keeps them round on
    // every side. Shared by the fringe shell AND the solid crown -- same
    // frequencies, offsets and cell hashes, so inner and outer leaves
    // line up -- with the density dialed per caller: the fringe wants
    // sparse dots against nothing, the solid crown wants leaves covering
    // MOST of it with dark gaps between.
    // shift decorrelates the pattern between callers (the fringe shell
    // samples a shifted copy of the field, so its dots do NOT sit exactly
    // over the crown's own) while the plane weighting still comes from
    // the TRUE position.
    vec2 decorCrownDots(vec3 lp, vec3 shift, float freq, float rOuter, float rInner, float keep) {
        vec3 pn = normalize(lp + vec3(0.0008));
        vec3 sp = lp + shift;
        vec2 dxy = decorLeafDots(sp.xy * freq, rOuter, rInner, keep);
        dxy.x *= smoothstep(0.25, 0.60, abs(pn.z));
        vec2 dzy = decorLeafDots(sp.zy * freq + 31.0, rOuter, rInner, keep);
        dzy.x *= smoothstep(0.25, 0.60, abs(pn.x));
        vec2 dxz = decorLeafDots(sp.xz * freq + 17.0, rOuter, rInner, keep);
        dxz.x *= smoothstep(0.25, 0.60, abs(pn.y));
        vec2 best = dxy;
        if (dzy.x > best.x) best = dzy;
        if (dxz.x > best.x) best = dxz;
        return best;
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

        // Crowns are 10% see-through -- REAL alpha, not screen-door
        // dither (tried, read as pixel noise). The material is transparent
        // and the shader sets alpha per kind: trunks and rocks stay 1.0,
        // foliage drops to 0.9. At 90% opacity the merged mesh's internal
        // sort errors are invisible.
        if (vDecorKind > 1.5) diffuseColor.a *= 0.90;

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
            // Conifers run DARK -- spruce and pine hold deep green even
            // in full sun.
            diffuseColor.rgb *= fringe * clump * 0.80;
            // Each branch tier is a gentle ridge; kept mild so the light
            // reads texture without embossing the whole tree.
            dBumpH = (1.0 - abs(2.0 * band - 1.0)) * 0.22 + needleField * 0.30;
        } else if (vDecorKind < 2.5) {
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
            vec2 crown = decorCrownDots(vDecorLocalPos, vec3(0.0), 17.0, 1.10, 0.25, 0.0);
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
            // ...and per-dot ALPHA: some leaf clusters sit denser than
            // others, so the canopy breathes instead of being one evenly
            // frosted pane.
            diffuseColor.a *= 0.85 + 0.15 * decorHash(vec2(crown.y * 47.3, 5.9));
            // Crown self-shadowing: the underside of a canopy is where
            // the light does not reach. This cheap vertical AO does more
            // for "tree, not gumdrop" than any amount of surface noise.
            diffuseColor.rgb *= mix(0.70, 1.05, smoothstep(-0.30, 0.28, vDecorLocalPos.y));
            // The dots ARE the relief: raised leaf clusters over recessed
            // shadow gaps.
            dBumpH = crown.x * 0.5;
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
            // Sparse and small against the sky, sampling a SHIFTED copy
            // of the field so the fringe leaves sit between the crown's
            // own rather than exactly on top of them.
            vec2 dot1 = decorCrownDots(vDecorLocalPos, vec3(4.3, 8.9, 2.7), 9.0, 0.40, 0.20, 0.45);
            // Soft rims with REAL alpha now that the material is
            // transparent: each fringe leaf fades smoothly from solid
            // core to nothing -- the blurry edge the dither could only
            // approximate.
            if (dot1.x < 0.04) discard;
            // Rim fade times a PER-DOT opacity: every outer leaf has its
            // own density, from nearly solid to a thin translucent one.
            diffuseColor.a *= smoothstep(0.04, 0.45, dot1.x)
                * (0.55 + 0.45 * decorHash(vec2(dot1.y * 57.3, 7.7)));
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

// The golden angle (137.5 degrees). Rolling each successive branch by this
// much around the bole is what real stems do, and it is why a tree never
// shows two limbs stacked in the same plane -- the one arrangement that
// would make a procedural fork read as a mechanical Y.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LIMB_UP = new THREE.Vector3(0, 1, 0);

// Sweep one limb: a chain of tapered, open-ended cylinders laid tip to
// tail, each one aimed slightly differently from the last, so the limb
// CURVES instead of standing as a straight stick. Every piece is its own
// mesh -- which costs nothing, because mergeDecorations folds the whole
// tile into a single draw anyway, and keeping them separate preserves the
// per-mesh local frame the bark shader reads (atan around the piece's own
// axis, not around the tree's).
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

// A leaf cluster: the crown blob the old tree had, shrunk and hung on a
// branch tip. Same kind-2 leaf-dot shading and the same fringe shell, so
// nothing about the canopy material changes -- only where the mass sits.
function addCluster(parent: any, rng: () => number, at: any, radius: number, color: number, seed: number): void {
    const blob = addMesh(
        parent,
        roughen(new THREE.IcosahedronGeometry(radius, 1), seed, radius * 0.40),
        vary(color, rng, 0.2),
        at.x, at.y, at.z,
        2
    );
    // Squashed, because a canopy spreads wider than it is tall. Set before
    // the fringe, which copies the scale.
    blob.scale.set(1, 0.74 + rng() * 0.22, 1);
    addFringe(parent, blob);
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
// So: a bare bole for the lower half, 3-4 primaries leaving it on a
// golden-angle spiral, each forking into two secondaries that are pulled
// back toward vertical (phototropism -- branches climb for light, they do
// not keep flying outward), and a small crown at every tip. The GAPS
// between those crowns are the point: they are what lets the branches
// show through, and branches showing through is what says "tree".
function makeDeciduous(rng: () => number): any {
    const tree = new THREE.Group();
    const height = 0.95 + rng() * 0.45;
    const seed = Math.floor(height * 4096);
    const barkColor = vary(0x6b4a2c, rng, 0.15);
    // Deep forest green to yellowish light green, per TREE -- the low end
    // dips into the conifer range on purpose.
    const leafColor = lerpHex(0x395a2b, 0x5f7d36, seedT(seed * 97));

    // The bole: kept bare, so the crown sits ON something visible.
    const boleH = height * (0.44 + rng() * 0.12);
    const rTrunk = 0.05 + rng() * 0.022;
    const lean = new THREE.Vector3((rng() - 0.5) * 0.10, 1, (rng() - 0.5) * 0.10);
    const bole = growLimb(tree, rng, new THREE.Vector3(0, 0, 0), lean, boleH, rTrunk * 1.35, rTrunk * 0.62, 3, 6, 0, 0.06, barkColor);

    const primaries = 3 + Math.floor(rng() * 2);
    const roll = rng() * Math.PI * 2;
    let cluster = 0;
    for (let i = 0; i < primaries; i++) {
        const a = roll + i * GOLDEN_ANGLE;
        const tilt = 0.62 + rng() * 0.34;
        const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
        // Primaries leave the bole staggered over its top third rather
        // than all from one point, which is the difference between a tree
        // and an umbrella frame.
        const start = bole.tip.clone();
        start.y -= boleH * 0.28 * rng();
        const rPrim = rTrunk * (0.50 + rng() * 0.14);
        const limb = growLimb(tree, rng, start, dir, height * (0.30 + rng() * 0.14), rPrim, rPrim * 0.45, 2, 5, 0.07, 0.30, barkColor);

        // Fork axis: a vector perpendicular to the limb, rolled around it
        // so each pair of secondaries splits in its own plane.
        const side = new THREE.Vector3().crossVectors(limb.heading, LIMB_UP);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().applyAxisAngle(limb.heading, rng() * Math.PI);
        for (let j = 0; j < 2; j++) {
            const sdir = limb.heading.clone().applyAxisAngle(side, (j === 0 ? 1 : -1) * (0.42 + rng() * 0.34));
            // Up-pull: without it the secondaries carry on outward and
            // the crown flattens into a spread cone.
            sdir.lerp(LIMB_UP, 0.22 + rng() * 0.14).normalize();
            const twig = growLimb(tree, rng, limb.tip, sdir, height * (0.17 + rng() * 0.10), rPrim * 0.45, rPrim * 0.22, 2, 4, 0.05, 0.34, barkColor);
            addCluster(tree, rng, twig.tip, 0.15 + rng() * 0.055, leafColor, seed + cluster++);
        }
    }
    // One more mass over the fork itself, filling the hole the outward
    // primaries leave in the middle of the canopy.
    const crownTop = bole.tip.clone();
    crownTop.y += height * 0.16;
    addCluster(tree, rng, crownTop, 0.17 + rng() * 0.05, leafColor, seed + cluster);
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
