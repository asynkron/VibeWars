import { markShadowsDirty } from './ShadowBudget';

// One authoritative sun for the whole renderer. Its direction drives the
// directional light, the photographed sun in the reflection sky, and the
// analytic highlight on the water.
const ORBIT_SECONDS = 24 * 60;
// The initial camera looks north from the south edge, so beginning with the
// sun in the north makes its water glint visible immediately. The orbit then
// carries it around the board continuously.
const INITIAL_AZIMUTH = -Math.PI * 0.5;
const BASE_ELEVATION = THREE.MathUtils.degToRad(48);
const ELEVATION_SWING = THREE.MathUtils.degToRad(10);
const SHADOW_STEP = THREE.MathUtils.degToRad(0.75);
const LIGHT_DISTANCE = 100;

export class SunSystem {
    private static light: any = null;
    private static center = new THREE.Vector3();
    private static direction = new THREE.Vector3(0.5, 0.7, -0.5).normalize();
    private static color = new THREE.Color(0xffffff);
    private static startedAt: number | null = null;
    private static lastShadowDirection = new THREE.Vector3();

    static init(scene: any, light: any): void {
        this.light = light;
        this.startedAt = null;
        light.target.position.copy(this.center);
        if (!light.target.parent) scene.add(light.target);
        this.updateOrbit(0, true);
    }

    static setCenter(x: number, y: number, z: number): void {
        this.center.set(x, y, z);
        if (!this.light) return;
        this.light.target.position.copy(this.center);
        this.updateLightPosition();
        markShadowsDirty();
    }

    static animate(seconds: number): void {
        if (!this.light) return;
        this.startedAt ??= seconds;
        const elapsed = seconds - this.startedAt;
        this.updateOrbit((elapsed % ORBIT_SECONDS) / ORBIT_SECONDS, false);
    }

    // Unit vector from the board toward the sun.
    static getDirection(target = new THREE.Vector3()): any {
        return target.copy(this.direction);
    }

    static getColor(target = new THREE.Color()): any {
        return target.copy(this.color);
    }

    static getIntensity(): number {
        return this.light?.intensity ?? 0;
    }

    // Intersection between the sun ray and the horizontal reflection-sky
    // plane. This keeps the visible photographed sun on the exact same ray
    // as the light and water highlight.
    static getSkyPosition(height: number, target = new THREE.Vector3()): any {
        const rise = Math.max(this.direction.y, 0.1);
        const distance = (height - this.center.y) / rise;
        return target.copy(this.direction).multiplyScalar(distance).add(this.center);
    }

    private static updateOrbit(progress: number, forceShadow: boolean): void {
        const angle = progress * Math.PI * 2;
        const azimuth = INITIAL_AZIMUTH + angle;
        const elevation = BASE_ELEVATION + Math.sin(angle) * ELEVATION_SWING;
        const horizontal = Math.cos(elevation);
        this.direction.set(
            Math.cos(azimuth) * horizontal,
            Math.sin(elevation),
            Math.sin(azimuth) * horizontal,
        ).normalize();
        this.updateLightPosition();

        const angularChange = this.lastShadowDirection.lengthSq() === 0
            ? Infinity
            : Math.acos(THREE.MathUtils.clamp(
                this.lastShadowDirection.dot(this.direction),
                -1,
                1,
            ));
        if (forceShadow || angularChange >= SHADOW_STEP) {
            this.lastShadowDirection.copy(this.direction);
            markShadowsDirty();
        }
    }

    private static updateLightPosition(): void {
        if (!this.light) return;
        this.light.position.copy(this.direction)
            .multiplyScalar(LIGHT_DISTANCE)
            .add(this.center);
        this.light.target.position.copy(this.center);
        this.light.target.updateMatrixWorld();
    }
}
