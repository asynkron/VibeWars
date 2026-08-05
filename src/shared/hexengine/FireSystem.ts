// The look of a burning tile: flames, embers, and the soot they leave.
//
// STRICTLY COSMETIC. Every rule about fire -- what catches, how it spreads,
// how long it lasts, what it costs to walk through -- lives in fire.ts and
// is shared with the simulation. This file only reads the board and makes
// it visible, so nothing here can make the live game and the AI disagree.
//
// NO LIGHTS. The obvious way to make fire glow is a PointLight per burning
// tile, and it is the one thing that must not happen: the scene's light
// count is a shader define, LightPool exists precisely because adding one
// costs a measured 3.5-second frame, and its whole pool is four. A dozen
// simultaneous fires would exhaust it or recompile every material on the
// map. The glow instead comes from emissive pushed past render.ts's
// BLOOM_THRESHOLD (1.70), so the existing UnrealBloomPass haloes it -- the
// same trick GlowSystem uses for the depot's energy panels.
//
// ONE LONG-LIVED PARTICLE SYSTEM PER FIRE, not a new one per turn. Every
// other effect in this codebase is one-shot: it schedules its own rAF chain
// and disposes itself. A fire lives six turns, so re-firing a one-shot each
// turn would allocate a geometry, a shader and a Points object per fire per
// turn -- and would walk into VisualizationSystem's teardown, which disposes
// the SHARED cached particle textures out from under everyone. Nothing here
// disposes a texture it did not create.

import { MAP_CONFIG } from '../../constants';
import { scene } from '../../render';
import { GridSystem } from './GridSystem';
import { HexCoord } from './HexCoord';
import { isBurning } from './fire';
import type { TileLike } from '../../types';

// Flames per tile. Enough to read as fire at map zoom, few enough that a
// forest going up does not become a particle benchmark.
const FLAMES_PER_TILE = 14;

// Emissive strength of the flame material. Above render.ts's
// BLOOM_THRESHOLD of 1.70, which is what makes the bloom pass pick it up;
// below that it would just be an orange sprite.
const FLAME_EMISSIVE = 3.2;

const FLAME_COLOR = 0xff7a1a;
const EMBER_COLOR = 0xffd27a;

// How dark burnt scenery goes. Not fully black -- charcoal still catches
// the sun, and a pure black silhouette reads as a hole in the map.
const SOOT = 0.18;

interface Fire {
    q: number;
    r: number;
    points: any;
    material: any;
}

class FireSystem {
    private static fires = new Map<string, Fire>();
    private static group: any = null;

    private static key(q: number, r: number): string {
        return `${q},${r}`;
    }

    private static root(): any {
        if (!this.group || this.group.parent !== scene) {
            this.group = new THREE.Group();
            this.group.name = 'fires';
            scene.add(this.group);
        }
        return this.group;
    }

    // Bring the visuals in line with the board.
    //
    // Driven from the board rather than from events, deliberately: a fire
    // can start from a player's click, from a replayed AI plan, or from a
    // spread roll at turn start, and a visual layer that had to be told
    // about each of those separately would miss one. This asks the map what
    // is burning and makes the scene match.
    static sync(map: { cols: number; rows: number; getTile(q: number, r: number): TileLike | null }): void {
        if (!scene || typeof THREE === 'undefined') return;

        const alive = new Set<string>();
        for (let q = 0; q < map.cols; q++) {
            for (let r = 0; r < map.rows; r++) {
                const tile = map.getTile(q, r);
                if (!isBurning(tile)) continue;
                alive.add(this.key(q, r));
                if (!this.fires.has(this.key(q, r))) this.light(q, r, tile.height);
            }
        }

        for (const [key, fire] of [...this.fires]) {
            if (alive.has(key)) continue;
            this.extinguish(key, fire);
            const tile = map.getTile(fire.q, fire.r);
            if (tile?.burned) this.char(fire.q, fire.r);
        }
    }

    private static light(q: number, r: number, height: number): void {
        const world = new HexCoord(q, r).getWorldPosition();
        const positions = new Float32Array(FLAMES_PER_TILE * 3);
        const phases = new Float32Array(FLAMES_PER_TILE);
        const speeds = new Float32Array(FLAMES_PER_TILE);

        // Deterministic scatter would be pointless here -- this is decor,
        // and two fires on the same tile never coexist.
        for (let i = 0; i < FLAMES_PER_TILE; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * MAP_CONFIG.HEX_RADIUS * 0.6;
            positions[i * 3] = Math.cos(angle) * dist;
            positions[i * 3 + 1] = Math.random() * 0.2;
            positions[i * 3 + 2] = Math.sin(angle) * dist;
            phases[i] = Math.random();
            speeds[i] = 0.6 + Math.random() * 0.7;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        // The flame climbs, narrows and fades, then wraps. `mod` on the
        // per-particle phase is what makes one Points object loop forever
        // instead of needing to be rebuilt every turn.
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uFlame: { value: new THREE.Color(FLAME_COLOR) },
                uEmber: { value: new THREE.Color(EMBER_COLOR) },
                uEmissive: { value: FLAME_EMISSIVE },
            },
            vertexShader: `
                attribute float aPhase;
                attribute float aSpeed;
                uniform float uTime;
                varying float vLife;
                void main() {
                    vLife = mod(uTime * aSpeed * 0.6 + aPhase, 1.0);
                    vec3 p = position;
                    p.y += vLife * 0.9;
                    p.xz *= 1.0 - vLife * 0.45;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = (26.0 * (1.0 - vLife * 0.6)) / -mv.z;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform vec3 uFlame;
                uniform vec3 uEmber;
                uniform float uEmissive;
                varying float vLife;
                void main() {
                    vec2 d = gl_PointCoord - vec2(0.5);
                    float r = length(d);
                    if (r > 0.5) discard;
                    float soft = smoothstep(0.5, 0.05, r);
                    // Hot and pale at the base, redder as it rises.
                    vec3 color = mix(uEmber, uFlame, vLife);
                    // Emissive above the bloom threshold: this is what
                    // makes the flames halo instead of adding a light.
                    gl_FragColor = vec4(color * uEmissive, soft * (1.0 - vLife));
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geometry, material);
        points.position.set(world.x, height + 0.05, world.z);
        points.frustumCulled = false;
        this.root().add(points);
        this.fires.set(this.key(q, r), { q, r, points, material });
    }

    private static extinguish(key: string, fire: Fire): void {
        fire.points.parent?.remove(fire.points);
        fire.points.geometry.dispose();
        // Our own ShaderMaterial, built here -- safe to dispose. Textures
        // from VisualizationSystem's shared cache are NOT, which is why this
        // effect uses none.
        fire.material.dispose();
        this.fires.delete(key);
    }

    // Blacken what is left standing.
    //
    // Through the per-tile decoration material, which ProceduralDecorations
    // gives every tile its own copy of precisely so one tile can be changed
    // without touching the map. The trunks stay: the owner asked for burnt
    // stumps rather than bare ground, and it also reads better -- a tile
    // that simply emptied would look like the fire deleted the map.
    private static char(q: number, r: number): void {
        const hex = GridSystem.findHex(q, r);
        const decor = hex?.userData?.decorator;
        if (!decor?.material) return;
        decor.material.color?.multiplyScalar?.(SOOT);
        decor.material.emissive?.setScalar?.(0);
        if (decor.material.vertexColors) {
            // The merged geometry carries per-vertex colour; darken it too
            // or the vertex colours would fight the material's.
            const colors = decor.geometry?.attributes?.color;
            if (colors) {
                for (let i = 0; i < colors.count * colors.itemSize; i++) colors.array[i] *= SOOT;
                colors.needsUpdate = true;
            }
        }
        decor.material.needsUpdate = true;
    }

    // Per-frame, from render.ts's frame loop -- ONE call driving every fire,
    // rather than a rAF chain per tile the way the one-shot effects do.
    static animate(seconds: number): void {
        for (const fire of this.fires.values()) {
            fire.material.uniforms.uTime.value = seconds;
        }
    }

    // A new match must not inherit the last one's flames.
    static clear(): void {
        for (const [key, fire] of [...this.fires]) this.extinguish(key, fire);
        this.fires.clear();
    }
}

export { FireSystem };
