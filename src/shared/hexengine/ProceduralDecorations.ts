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

function mat(color: number) {
    return new THREE.MeshStandardMaterial({
        color,
        metalness: 0.05,
        roughness: 0.85,
        flatShading: true,
    });
}

function addMesh(parent: any, geometry: any, color: number, x: number, y: number, z: number): any {
    const mesh = new THREE.Mesh(geometry, mat(color));
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
        addMesh(tree, new THREE.ConeGeometry(radius, coneH, 6), vary(0x1d4a2a, rng, 0.18), 0, y, 0);
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
        addMesh(tree, new THREE.IcosahedronGeometry(radius, 0), vary(0x3f7d3a, rng, 0.2), dx, y, dz);
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
            (rng() - 0.5) * 0.2
        );
    }
    return bush;
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

// Random offset within the hex, keeping clear of the rim.
function scatter(rng: () => number, maxRadius: number): { x: number; z: number } {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * maxRadius;
    return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
}

// Build the decoration group for a tile, or null for none. Deterministic
// per (q, r): reloads produce the identical map dressing.
export function createProceduralDecoration(terrainType: string, q: number, r: number): any | null {
    const rng = tileRng(q, r);
    const group = new THREE.Group();

    switch (terrainType) {
        case 'FOREST': {
            // A grove: conifer-heavy mix, always present.
            const trees = 3 + Math.floor(rng() * 3);
            for (let i = 0; i < trees; i++) {
                const tree = rng() < 0.65 ? makeConifer(rng) : makeDeciduous(rng);
                const { x, z } = scatter(rng, 0.55);
                tree.position.set(x, 0, z);
                tree.rotation.y = rng() * Math.PI * 2;
                const s = 0.8 + rng() * 0.35;
                tree.scale.set(s, s, s);
                group.add(tree);
            }
            break;
        }
        case 'GRASS': {
            const roll = rng();
            if (roll < 0.30) {
                // Bushes.
                const bushes = 1 + Math.floor(rng() * 2);
                for (let i = 0; i < bushes; i++) {
                    const bush = makeBush(rng);
                    const { x, z } = scatter(rng, 0.5);
                    bush.position.set(x, 0, z);
                    group.add(bush);
                }
            } else if (roll < 0.45) {
                // A lone deciduous tree.
                const tree = makeDeciduous(rng);
                const { x, z } = scatter(rng, 0.4);
                tree.position.set(x, 0, z);
                tree.rotation.y = rng() * Math.PI * 2;
                group.add(tree);
            } else {
                return null; // open grassland
            }
            break;
        }
        case 'SAND': {
            if (rng() < 0.35) {
                const rocks = makeRocks(rng, 0xb8a98c);
                const { x, z } = scatter(rng, 0.45);
                rocks.position.set(x, 0, z);
                group.add(rocks);
            } else {
                return null;
            }
            break;
        }
        case 'MOUNTAIN': {
            if (rng() < 0.5) {
                const rocks = makeRocks(rng, 0x7d7a74);
                const { x, z } = scatter(rng, 0.4);
                rocks.position.set(x, 0, z);
                group.add(rocks);
            } else {
                return null;
            }
            break;
        }
        default:
            return null; // WATER etc.
    }

    return group.children.length > 0 ? group : null;
}
