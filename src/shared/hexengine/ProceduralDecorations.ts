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
`;

const DECOR_FRAGMENT = /* glsl */ `
    {
        // Base: two octaves of world-space noise with a vertical drift so
        // the pattern wraps around crowns and trunks instead of projecting
        // flat from above.
        vec2 dp = vDecorWorldPos.xz * 7.0 + vec2(vDecorWorldPos.y * 3.1, vDecorWorldPos.y * 2.3);
        float coarse = decorNoise(dp);
        float fine = decorNoise(dp * 3.7 + 11.0);
        diffuseColor.rgb *= 0.84 + 0.20 * coarse + 0.08 * fine;

        if (uDecorKind > 0.5 && uDecorKind < 1.5) {
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
            float fringe = 0.68 + 0.32 * smoothstep(0.05, 0.45, band);
            // Angular clumping: branches, not a smooth skirt.
            float clump = 0.86 + 0.14 * decorNoise(vec2(angle * 3.0, vDecorLocalPos.y * 5.0));
            diffuseColor.rgb *= fringe * clump;
        } else if (uDecorKind > 1.5) {
            // DECIDUOUS leaves: patchy variation WITHIN one crown -- some
            // clusters shift toward sunlit yellow-green, others sit in
            // deeper shade, plus fine leaf speckle.
            float splotch = decorNoise(vDecorLocalPos.xz * 5.0 + vDecorLocalPos.y * 4.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.22, 1.08, 0.62), splotch * 0.45);
            float shade = decorNoise(vDecorLocalPos.zy * 4.2 + 7.0);
            diffuseColor.rgb *= 0.86 + 0.10 * shade;
            float speckle = decorNoise(vDecorWorldPos.xz * 30.0 + vDecorWorldPos.y * 14.0);
            diffuseColor.rgb *= 0.92 + 0.14 * speckle;
        }
    }
`;

// kind: 0 = generic surface (bark, rock), 1 = conifer foliage,
// 2 = deciduous/bush leaves.
function applyOrganicDetail(material: any, kind: number): void {
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uDecorKind = { value: kind };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vDecorWorldPos;\n varying vec3 vDecorLocalPos;')
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n vDecorWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n vDecorLocalPos = position;'
            );
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n uniform float uDecorKind;\n' + DECOR_NOISE_GLSL)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + DECOR_FRAGMENT);
    };
    material.customProgramCacheKey = () => 'decor-organic';
}

function mat(color: number, kind: number = 0) {
    const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: true,
    });
    applyOrganicDetail(material, kind);
    return material;
}

function addMesh(parent: any, geometry: any, color: number, x: number, y: number, z: number, kind: number = 0): any {
    const mesh = new THREE.Mesh(geometry, mat(color, kind));
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
    const trunkH = height * 0.22;
    addMesh(tree, new THREE.CylinderGeometry(0.05, 0.07, trunkH, 5), vary(0x5a4028, rng, 0.15), 0, trunkH / 2, 0);
    const layers = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const radius = (0.34 - 0.14 * t) * (0.8 + rng() * 0.4);
        const coneH = height * (0.45 - 0.08 * t);
        const y = trunkH + height * 0.55 * t + coneH / 2 - 0.02;
        addMesh(tree, new THREE.ConeGeometry(radius, coneH, 6), vary(0x1d4a2a, rng, 0.18), 0, y, 0, 1);
    }
    return tree;
}

// Deciduous: trunk + 1-3 clumped leaf blobs.
function makeDeciduous(rng: () => number): any {
    const tree = new THREE.Group();
    const trunkH = 0.42 + rng() * 0.25;
    addMesh(tree, new THREE.CylinderGeometry(0.06, 0.08, trunkH, 5), vary(0x6b4a2c, rng, 0.15), 0, trunkH / 2, 0);
    const blobs = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
        const radius = 0.24 + rng() * 0.16;
        const dx = (rng() - 0.5) * 0.3;
        const dz = (rng() - 0.5) * 0.3;
        const y = trunkH + radius * (0.75 + rng() * 0.3);
        addMesh(tree, new THREE.IcosahedronGeometry(radius, 0), vary(0x3f7d3a, rng, 0.2), dx, y, dz, 2);
    }
    return tree;
}

// Bush: 1-3 low blobs, no trunk.
function makeBush(rng: () => number): any {
    const bush = new THREE.Group();
    const blobs = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < blobs; i++) {
        const radius = 0.13 + rng() * 0.10;
        addMesh(
            bush,
            new THREE.IcosahedronGeometry(radius, 0),
            vary(0x30632f, rng, 0.22),
            (rng() - 0.5) * 0.2,
            radius * 0.7,
            (rng() - 0.5) * 0.2,
            2
        );
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
            new THREE.IcosahedronGeometry(radius * 0.9, 0),
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
        const rock = addMesh(
            rocks,
            new THREE.DodecahedronGeometry(radius, 0),
            vary(base, rng, 0.18),
            (rng() - 0.5) * 0.3,
            radius * 0.5,
            (rng() - 0.5) * 0.3
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

// Drop a sub-assembly into the tile group at a scattered position.
function place(group: any, rng: () => number, piece: any, maxRadius: number, spin: boolean = true): void {
    const { x, z } = scatter(rng, maxRadius);
    piece.position.set(x, 0, z);
    if (spin) piece.rotation.y = rng() * Math.PI * 2;
    group.add(piece);
}

// Build the decoration group for a tile, or null for none. Deterministic
// per (q, r): reloads produce the identical map dressing. `tileHeight`
// zones the mountains: vegetated foot, bare rocky heights.
export function createProceduralDecoration(terrainType: string, q: number, r: number, tileHeight: number = 0): any | null {
    const rng = tileRng(q, r);
    const group = new THREE.Group();

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

    return group.children.length > 0 ? group : null;
}
