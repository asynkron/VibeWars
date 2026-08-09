// A fixed set of PointLights that live in the scene forever, lent out to
// the attack effects instead of being created and destroyed per shot.
//
// WHY. The number of lights in the scene is a shader define, so adding one
// invalidates every material's program parameters and three re-initialises
// all of them. Measured in the running game: the first frame after a light
// is added takes 3585 ms, and the frame after adding a second takes 3347.
// Removing costs nothing, and re-adding the same light later costs 44 ms
// because the program is cached by then -- so the price is paid once per
// distinct light COUNT, and it lands as a multi-second freeze the first
// time the player fires each kind of weapon.
//
// Pre-warming the counts at startup was the obvious fix and does not work:
// each new count costs its own ~3.4 s, so warming one through five would
// add seventeen seconds to loading.
//
// Keeping the count CONSTANT does work. The pool is added before the first
// render, so the compile that was going to happen anyway includes it and
// startup costs nothing extra. Effects then borrow a light and hand it
// back, and the count never changes again.
//
// The lights are RE-PARENTED rather than added and removed: an effect
// attaches one to its projectile so it travels with it, exactly as before.
// Object3D.add moves a child between parents without it ever leaving the
// scene, which is the whole trick -- the light is somewhere else in the
// graph, but three still counts exactly POOL_SIZE of them.
//
// Cost: measured at +2.4 ms per frame for four always-on lights (24.4 ->
// 26.8 ms). Worth it against multi-second freezes.

// Four covers the largest single effect -- the cannon's muzzle flash,
// tracer and impact are three at once -- with one spare for an overlap.
// A claim beyond that returns null and the effect simply renders without
// its light, which is a dimmer explosion rather than a broken one.
const POOL_SIZE = 4;

class LightPool {
    private static lights: any[] = [];
    private static home: any = null;
    private static lent = new Set<any>();

    // Call once, with the group the effects live in, BEFORE the first
    // render -- see the header.
    static init(home: any): void {
        if (this.lights.length > 0 || !home) return;
        this.home = home;
        for (let i = 0; i < POOL_SIZE; i++) {
            const light = new THREE.PointLight(0xffffff, 0, 8);
            light.userData.pooled = true;
            home.add(light);
            this.lights.push(light);
        }
    }

    static owns(object: any): boolean {
        return !!object?.userData?.pooled;
    }

    // Effects must remain valid when the fixed pool is exhausted. Keeping
    // these writes here makes the nullable result from claim() impossible to
    // forget inside an animation frame (where an exception would also skip
    // that effect's teardown and leave its geometry in the scene forever).
    static setIntensity(light: any, intensity: number): void {
        if (!this.owns(light)) return;
        light.intensity = intensity;
    }

    static setPosition(light: any, position: any): void {
        if (!this.owns(light)) return;
        light.position.copy(position);
    }

    // Borrow a light configured for this effect, or null if all four are
    // already out. The caller parents it wherever it should travel.
    static claim(color: number, intensity: number, distance: number): any | null {
        for (const light of this.lights) {
            if (this.lent.has(light)) continue;
            this.lent.add(light);
            light.color.setHex(color);
            light.intensity = intensity;
            light.distance = distance;
            light.position.set(0, 0, 0);
            return light;
        }
        return null;
    }

    // Hand it back: dark again, and home in the scene rather than parented
    // to an effect that is about to be disposed.
    static release(light: any): void {
        if (!this.owns(light)) return;
        this.lent.delete(light);
        light.intensity = 0;
        light.position.set(0, 0, 0);
        this.home?.add(light);
    }

    // Effects are torn down on map teardown too; nothing should stay lit.
    static releaseAll(): void {
        for (const light of this.lights) this.release(light);
    }
}

export { LightPool };
