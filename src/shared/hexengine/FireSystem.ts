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
import { markShadowsDirty, scene } from '../../render';
import { GridSystem } from './GridSystem';
import { VisualizationSystem } from './VisualizationSystem';
import { HexCoord } from './HexCoord';
import { FIRE_DURATION, isBurning } from './fire';
import type { TileLike } from '../../types';

// A fire is two layers, the way createExplosion is: a bright textured flame
// body and a dark plume above it. The first version of this used untextured
// procedural points and read as a handful of sparks -- the sprites are what
// give it volume.
const FLAMES_PER_TILE = 44;
const SMOKE_PER_TILE = 18;

// Point size is `base * (SIZE_SCALE / -viewZ)`, the same perspective
// scaling createParticleEffect uses. The 300 is not decorative: at 26 the
// sprites are a few pixels across at map zoom, which is exactly the "small
// ember pixels" this replaced.
const SIZE_SCALE = 300.0;
const FLAME_SIZE = 0.9;
const SMOKE_SIZE = 1.2;

// Seconds for one particle to travel its arc before it wraps. Flames are
// quick and tight; smoke is slow and drifts higher.
const FLAME_LIFE = 1.1;
const SMOKE_LIFE = 2.6;

// How high each layer climbs, in hex radii.
const FLAME_RISE = 0.85;
const SMOKE_RISE = 2.4;

// Emissive multiplier on the flame layer. Above render.ts's
// BLOOM_THRESHOLD of 1.70, which is what makes the UnrealBloomPass halo it
// into something that reads as heat rather than as an orange decal.
// 1.8, not 2.6. Additive blending SUMS overlapping sprites, so a value
// chosen to bloom one particle clips every channel where twenty overlap and
// the column goes white.
//
// THE CURE IS BRIGHTNESS, NOT SIZE. The first attempt at this fixed the
// white by shrinking the sprites and thinning the count as well, which
// turned a fire into orange glitter -- the volume was never the problem.
// Big sprites, many of them, each contributing less: that is a fire.
// Just over render.ts's BLOOM_THRESHOLD of 1.70 is all it takes, because
// the heat is supposed to come from the bloom pass.
const FLAME_EMISSIVE = 1.8;

const FLAME_HOT = 0xffa528;   // saturated amber at the base -- a paler
                              // hot colour washes straight to white once
                              // the additive sprites stack.
const FLAME_COOL = 0xd83506;  // deep red-orange at the tips
const SMOKE_COLOR = 0x2b2622;

const FLAME_TEXTURES = [
    'assets/textures/explosion1.png',
    'assets/textures/explosion2.png',
    'assets/textures/explosion3.png',
    'assets/textures/explosion4.png',
];
const SMOKE_TEXTURES = [
    'assets/textures/smoke1.png',
    'assets/textures/smoke2.png',
    'assets/textures/smoke3.png',
    'assets/textures/smoke4.png',
];

// A fire's size over its life, indexed by how many turns it has been
// burning: catches small, roars in the middle, dies back down. The owner's
// curve -- small, medium, large, huge, large, medium -- rather than a fire
// that arrives at full size and stays there, which is what it did before
// and which read as a switch being flipped.
//
// One entry per turn of FIRE_DURATION. A shorter table would silently clamp
// the tail of a longer fire to full size, so tileScale() asserts nothing and
// simply reads the last entry when it runs off the end.
const FIRE_GROWTH = [0.34, 0.62, 0.88, 1.20, 0.88, 0.62];

// After the flames are out the tile keeps smoking for a couple of turns:
// medium, then thin. Purely cosmetic -- the tile is already ash and already
// harmless by then, so this deliberately never enters the simulation or the
// event log the neutrality digest hashes.
const SMOULDER_TURNS = 2;
const SMOULDER_SCALE = [0.85, 0.45];

// How dark burnt scenery goes. Not fully black -- charcoal still catches
// the sun, and a pure black silhouette reads as a hole in the map.
const SOOT = 0.18;

interface Fire {
    q: number;
    r: number;
    // [flame, smoke]. The flame layer is hidden once the tile stops
    // burning; the smoke layer outlives it by SMOULDER_TURNS.
    layers: Array<{ points: any; material: any }>;
    // Turns of smoke left after the flames go out. -1 while still alight.
    smoulder: number;
    charred: boolean;
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
                const fire = this.fires.get(this.key(q, r))!;
                this.setScale(fire, this.growthOf(tile.burning));
                // The stems blacken on the fire's LAST burning turn, not
                // after it -- the owner's step 6 is "medium, sooty trunk
                // left", so the char has to land while it is still alight.
                if (tile.burning <= 1 && !fire.charred) {
                    this.char(q, r);
                    fire.charred = true;
                }
            }
        }

        for (const [key, fire] of [...this.fires]) {
            if (alive.has(key)) continue;
            const tile = map.getTile(fire.q, fire.r);
            if (tile?.burned && fire.smoulder < 0) {
                // Burnt out rather than merely gone: drop the flames, keep
                // the plume, and let tickSmoulder count it down.
                if (!fire.charred) { this.char(fire.q, fire.r); fire.charred = true; }
                fire.smoulder = SMOULDER_TURNS;
                fire.layers[0].points.visible = false;
                this.setScale(fire, SMOULDER_SCALE[0]);
                continue;
            }
            if (fire.smoulder > 0) continue;   // still smoking
            this.extinguish(key, fire);
        }
    }

    // How big a fire that has `burning` turns left should be drawn.
    private static growthOf(burning: number): number {
        const age = FIRE_DURATION - burning;   // 0 on the turn it is lit
        return FIRE_GROWTH[Math.min(Math.max(age, 0), FIRE_GROWTH.length - 1)];
    }

    private static setScale(fire: Fire, scale: number): void {
        for (const layer of fire.layers) layer.material.uniforms.uScale.value = scale;
    }

    // One turn of the smoke tail, called from GameState.nextTurn beside the
    // board's own fire tick.
    //
    // Separate from sync() because sync is also called the moment a player
    // lights a fire, and a countdown living in there would burn a turn of
    // smoke every time somebody struck a match somewhere else on the map.
    static tickSmoulder(): void {
        for (const [key, fire] of [...this.fires]) {
            if (fire.smoulder < 0) continue;
            fire.smoulder--;
            if (fire.smoulder <= 0) { this.extinguish(key, fire); continue; }
            this.setScale(fire, SMOULDER_SCALE[SMOULDER_TURNS - fire.smoulder] ?? SMOULDER_SCALE[SMOULDER_SCALE.length - 1]);
        }
    }

    private static light(q: number, r: number, height: number): void {
        const world = new HexCoord(q, r).getWorldPosition();
        const base = { x: world.x, y: height + 0.04, z: world.z };
        const fire: Fire = { q, r, layers: [], smoulder: -1, charred: false };

        fire.layers.push(this.layer({
            base,
            count: FLAMES_PER_TILE,
            texturePaths: FLAME_TEXTURES,
            size: FLAME_SIZE,
            life: FLAME_LIFE,
            rise: FLAME_RISE,
            spread: 0.55,
            hot: FLAME_HOT,
            cool: FLAME_COOL,
            emissive: FLAME_EMISSIVE,
            additive: true,
        }));
        fire.layers.push(this.layer({
            base: { ...base, y: base.y + 0.35 },
            count: SMOKE_PER_TILE,
            texturePaths: SMOKE_TEXTURES,
            size: SMOKE_SIZE,
            life: SMOKE_LIFE,
            rise: SMOKE_RISE,
            spread: 0.42,
            hot: SMOKE_COLOR,
            cool: SMOKE_COLOR,
            emissive: 1.0,
            additive: false,
        }));

        this.fires.set(this.key(q, r), fire);
    }

    // One looping billboard column.
    //
    // The shape is createParticleEffect's -- one THREE.Points, per-particle
    // attributes, motion integrated in the vertex shader from a `uTime`
    // uniform, four textures picked by an index attribute. The difference is
    // that this one WRAPS: `mod` on a per-particle phase makes a single
    // object burn forever, where every other effect in the codebase tears
    // itself down after one pass. A fire lives six turns, so re-firing a
    // one-shot each turn would allocate a geometry, a shader and a Points
    // per fire per turn -- and would hit createParticleEffect's teardown,
    // which disposes the SHARED cached textures out from under everyone.
    private static layer(opts: any): { points: any; material: any } {
        const { base, count, texturePaths, size, life, rise, spread, hot, cool, emissive, additive } = opts;

        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const drifts = new Float32Array(count * 2);
        const texIndex = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * MAP_CONFIG.HEX_RADIUS * spread;
            positions[i * 3] = base.x + Math.cos(angle) * dist;
            positions[i * 3 + 1] = base.y;
            positions[i * 3 + 2] = base.z + Math.sin(angle) * dist;
            // Staggered so the column is full at t=0 instead of pulsing.
            phases[i] = Math.random();
            sizes[i] = size * (0.65 + Math.random() * 0.7);
            drifts[i * 2] = (Math.random() - 0.5) * 0.35;
            drifts[i * 2 + 1] = (Math.random() - 0.5) * 0.35;
            texIndex[i] = Math.floor(Math.random() * 4);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 2));
        geometry.setAttribute('aTexIndex', new THREE.BufferAttribute(texIndex, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                // Textures come from VisualizationSystem's shared cache and
                // are NEVER disposed here -- see extinguish().
                pointTextures: { value: texturePaths.map((path: string) => VisualizationSystem.particleTexture(path)) },
                uHot: { value: new THREE.Color(hot) },
                uCool: { value: new THREE.Color(cool) },
                uEmissive: { value: emissive },
                uLife: { value: life },
                uRise: { value: rise },
                // A UNIFORM, NOT AN INTERPOLATED CONSTANT. Writing
                // `${SIZE_SCALE}` into the source stringified 300.0 as
                // "300", GLSL read that as an int, `int / float` is a type
                // error, and the program silently never compiled -- the
                // whole effect drew nothing at all with no console error to
                // say so. Uniforms are typed; template literals are not.
                uSizeScale: { value: SIZE_SCALE },
                // The life curve, driven per turn from sync(). A uniform
                // rather than a rebuild: a growing fire that reallocated its
                // geometry every turn would restart every particle's phase
                // and visibly stutter.
                uScale: { value: FIRE_GROWTH[0] },
            },
            vertexShader: `
                attribute float aPhase;
                attribute float aSize;
                attribute vec2 aDrift;
                attribute float aTexIndex;
                uniform float uTime;
                uniform float uLife;
                uniform float uRise;
                uniform float uSizeScale;
                uniform float uScale;
                varying float vLife;
                varying float vTexIndex;
                void main() {
                    // The wrap. One object, burning forever.
                    vLife = mod(uTime / uLife + aPhase, 1.0);
                    vTexIndex = aTexIndex;

                    vec3 p = position;
                    p.y += vLife * uRise * uScale;
                    // Lean as it rises, so the column curls instead of
                    // standing like a pillar.
                    p.xz += aDrift * vLife * vLife;

                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    // Swells then shrinks, the same sin(progress) shape the
                    // explosion uses -- a sprite that only ever shrinks
                    // reads as debris rather than as flame.
                    float swell = sin(vLife * 3.14159);
                    gl_PointSize = aSize * uScale * (0.35 + swell) * (uSizeScale / -mv.z);
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTextures[4];
                uniform vec3 uHot;
                uniform vec3 uCool;
                uniform float uEmissive;
                varying float vLife;
                varying float vTexIndex;
                void main() {
                    vec4 tex;
                    if (vTexIndex < 0.5) tex = texture2D(pointTextures[0], gl_PointCoord);
                    else if (vTexIndex < 1.5) tex = texture2D(pointTextures[1], gl_PointCoord);
                    else if (vTexIndex < 2.5) tex = texture2D(pointTextures[2], gl_PointCoord);
                    else tex = texture2D(pointTextures[3], gl_PointCoord);

                    // Hot and pale where it is born, cooling as it climbs.
                    vec3 color = mix(uHot, uCool, vLife);
                    // Fades in fast, out slow, so the base of the column
                    // stays solid and only the top dissolves.
                    // Peaks well below 1, and this -- not the sprite size --
                    // is what keeps a dense column from summing to white.
                    // Forty overlapping additive sprites reach full
                    // brightness long before any single one does.
                    float fade = 0.30 * smoothstep(0.0, 0.10, vLife) * (1.0 - smoothstep(0.40, 1.0, vLife));

                    // THE SHAPE COMES FROM ALPHA, THE COLOUR FROM US.
                    // createParticleEffect multiplies by tex.rgb, which is
                    // right for its own sprites but renders these ones
                    // BLACK: the smoke and explosion PNGs carry their shape
                    // in the alpha channel over near-black colour, so
                    // tinting through rgb multiplies the flame down to
                    // nothing. Measured, not guessed -- at 12x size the
                    // sprites drew as black streaks over the map.
                    float alpha = tex.a * fade;
                    if (alpha < 0.01) discard;
                    gl_FragColor = vec4(color * uEmissive, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = additive ? 101 : 100;
        this.root().add(points);
        return { points, material };
    }

    private static extinguish(key: string, fire: Fire): void {
        for (const layer of fire.layers) {
            layer.points.parent?.remove(layer.points);
            layer.points.geometry.dispose();
            // The geometry and the ShaderMaterial are ours to dispose. The
            // TEXTURES are not: they come from VisualizationSystem's shared
            // cache, and createParticleEffect's teardown already disposes
            // them out from under everyone else. Not repeating that here.
            layer.material.dispose();
        }
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
        if (!decor?.material?.userData?.burnUniform) return;
        // One uniform on the tile's own decoration material. The foliage is
        // discarded in the fragment shader and the bark darkens, so what is
        // left is bare blackened stems -- darkening the leaves instead still
        // read as a canopy from map height.
        decor.material.userData.burnUniform.value = 1;
        // Shadows are generated on demand -- renderer.shadowMap.autoUpdate
        // is false -- so without this the tile keeps casting the shadow of
        // a canopy it no longer has.
        markShadowsDirty();
        // Transparency is driven separately (a unit standing here dims the
        // scenery), so re-apply whatever it should currently be.
        GridSystem.updateDecoratorTransparency?.(hex);
    }

    // Per-frame, from render.ts's frame loop -- ONE call driving every fire,
    // rather than a rAF chain per tile the way the one-shot effects do.
    static animate(seconds: number): void {
        for (const fire of this.fires.values()) {
            for (const layer of fire.layers) layer.material.uniforms.uTime.value = seconds;
        }
    }

    // A new match must not inherit the last one's flames.
    static clear(): void {
        for (const [key, fire] of [...this.fires]) this.extinguish(key, fire);
        this.fires.clear();
    }
}

export { FireSystem };
