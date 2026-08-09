// The pool's whole reason for existing is that the NUMBER of lights in the
// scene never changes, so that is what these tests check: not that the
// lights look right, but that none ever enters or leaves.
//
// Built on plain objects rather than the THREE stub, which is a
// permissive proxy that would answer "yes" to every question asked of it.

import { describe, it, expect, beforeEach } from 'vitest';

// Minimal stand-ins for the three API the pool touches.
class FakeObject3D {
    children: any[] = [];
    parent: any = null;
    userData: any = {};
    add(child: any) {
        if (child.parent) child.parent.children = child.parent.children.filter((c: any) => c !== child);
        child.parent = this;
        this.children.push(child);
        return this;
    }
    remove(child: any) {
        this.children = this.children.filter((c: any) => c !== child);
        child.parent = null;
        return this;
    }
}

class FakePointLight extends FakeObject3D {
    isLight = true;
    color = { hex: 0xffffff, setHex(h: number) { this.hex = h; } };
    position = {
        x: 0, y: 0, z: 0,
        set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; },
        copy(other: any) { this.x = other.x; this.y = other.y; this.z = other.z; },
    };
    constructor(public colorHex: number, public intensity: number, public distance: number) {
        super();
        this.color.hex = colorHex;
    }
}

(globalThis as any).THREE = { PointLight: FakePointLight };

const { LightPool } = await import('./LightPool');

// Count every light anywhere under the root, which is the number three
// turns into a shader define.
function lightsInScene(root: any): number {
    let n = 0;
    const walk = (o: any) => { if (o.isLight) n++; for (const c of o.children) walk(c); };
    walk(root);
    return n;
}

// ONE scene for the whole file, because that is how the pool is really
// used: init() runs once per page load and is deliberately idempotent, so
// building a fresh scene per test would leave the lights parented to the
// first one and test a state the game never reaches.
const scene = new FakeObject3D();
const home = new FakeObject3D();
scene.add(home);
LightPool.init(home);

describe('LightPool', () => {
    beforeEach(() => {
        // Hand everything back so one test cannot exhaust the next.
        LightPool.releaseAll();
    });

    it('puts a fixed number of lights in the scene up front', () => {
        expect(lightsInScene(scene)).toBeGreaterThan(0);
    });

    it('keeps the light count identical while an effect borrows one', () => {
        // THE contract. A light entering or leaving the scene changes a
        // shader define, and three then re-initialises every material --
        // measured at 3585 ms for the first frame after.
        const before = lightsInScene(scene);
        const effect = new FakeObject3D();
        scene.add(effect);

        const light = LightPool.claim(0xff0000, 10, 8);
        expect(light).not.toBeNull();
        effect.add(light);
        expect(lightsInScene(scene)).toBe(before);

        LightPool.release(light);
        expect(lightsInScene(scene)).toBe(before);
    });

    it('brings a borrowed light home, not wherever the effect left it', () => {
        const effect = new FakeObject3D();
        scene.add(effect);
        const light = LightPool.claim(0xff0000, 10, 8);
        effect.add(light);
        expect(light.parent).toBe(effect);

        LightPool.release(light);
        // Back under the pool's own group, so disposing the effect cannot
        // drag it out of the scene.
        expect(light.parent).toBe(home);
        expect(light.intensity).toBe(0);
    });

    it('configures the light it hands out', () => {
        const light = LightPool.claim(0x4444ff, 14, 7);
        expect(light.color.hex).toBe(0x4444ff);
        expect(light.intensity).toBe(14);
        expect(light.distance).toBe(7);
    });

    it('does not hand the same light to two effects at once', () => {
        const a = LightPool.claim(0xff0000, 10, 8);
        const b = LightPool.claim(0x00ff00, 10, 8);
        expect(a).not.toBe(b);
    });

    it('returns null when every light is out, rather than growing', () => {
        // Growing the pool would be the tempting fix and is exactly wrong:
        // it changes the count. An effect without its light is dimmer; an
        // effect that adds one freezes the game for three seconds.
        const held: any[] = [];
        for (let i = 0; i < 20; i++) {
            const l = LightPool.claim(0xffffff, 5, 5);
            if (l === null) break;
            held.push(l);
        }
        expect(LightPool.claim(0xffffff, 5, 5)).toBeNull();
        expect(lightsInScene(scene)).toBe(held.length);
    });

    it('lets an effect keep animating when the pool is exhausted', () => {
        const held: any[] = [];
        let light;
        while ((light = LightPool.claim(0xffffff, 5, 5)) !== null) held.push(light);
        const unavailable = LightPool.claim(0xffffff, 5, 5);

        expect(unavailable).toBeNull();
        expect(() => {
            LightPool.setPosition(unavailable, { x: 4, y: 5, z: 6 });
            LightPool.setIntensity(unavailable, 12);
        }).not.toThrow();
    });

    it('updates a borrowed effect light through the null-safe API', () => {
        const light = LightPool.claim(0xffffff, 5, 5);

        LightPool.setPosition(light, { x: 4, y: 5, z: 6 });
        LightPool.setIntensity(light, 12);

        expect(light.position).toMatchObject({ x: 4, y: 5, z: 6 });
        expect(light.intensity).toBe(12);
    });

    it('makes a released light available again', () => {
        const held: any[] = [];
        let l;
        while ((l = LightPool.claim(0xffffff, 5, 5)) !== null) held.push(l);
        expect(LightPool.claim(0xffffff, 5, 5)).toBeNull();

        LightPool.release(held[0]);
        expect(LightPool.claim(0xffffff, 5, 5)).not.toBeNull();
    });

    it('ignores a release of something it does not own', () => {
        const stranger = new FakePointLight(0xffffff, 3, 3);
        scene.add(stranger);
        expect(() => LightPool.release(stranger)).not.toThrow();
        // Left exactly where it was: the pool must not adopt other lights.
        expect(stranger.parent).toBe(scene);
        expect(stranger.intensity).toBe(3);
    });

    it('recognises its own lights and nothing else', () => {
        const mine = LightPool.claim(0xffffff, 5, 5);
        expect(LightPool.owns(mine)).toBe(true);
        expect(LightPool.owns(new FakePointLight(0xffffff, 1, 1))).toBe(false);
        expect(LightPool.owns(null)).toBe(false);
        expect(LightPool.owns(undefined)).toBe(false);
    });

    it('releaseAll darkens everything it lent out', () => {
        const a = LightPool.claim(0xff0000, 10, 8);
        const b = LightPool.claim(0x00ff00, 10, 8);
        const effect = new FakeObject3D();
        scene.add(effect);
        effect.add(a); effect.add(b);

        LightPool.releaseAll();

        expect(a.intensity).toBe(0);
        expect(b.intensity).toBe(0);
        expect(a.parent).toBe(home);
        expect(LightPool.claim(0xffffff, 1, 1)).not.toBeNull();
    });
});
