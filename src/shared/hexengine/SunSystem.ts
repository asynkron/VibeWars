import { markShadowsDirty } from './ShadowBudget';

// One authoritative, fixed mid-afternoon sun for the whole renderer. Its direction
// drives the directional light, the photographed sun in the reflection sky,
// and the highlight on the water. Lower than the old 13:00 position for
// longer shadows, while light intensity stays full daylight.
const DAYLIGHT_AZIMUTH_DEGREES = 118;
const DAYLIGHT_ELEVATION_DEGREES = 53;
const LIGHT_DISTANCE = 100;

export class SunSystem {
    private static light: any = null;
    private static center = new THREE.Vector3();
    private static direction = new THREE.Vector3(0.5, 0.7, -0.5).normalize();
    private static color = new THREE.Color(0xffffff);
    private static azimuthDegrees = DAYLIGHT_AZIMUTH_DEGREES;
    private static elevationDegrees = DAYLIGHT_ELEVATION_DEGREES;

    static init(scene: any, light: any): void {
        this.light = light;
        light.target.position.copy(this.center);
        if (!light.target.parent) scene.add(light.target);
        this.setDaylightDirection();
    }

    static setCenter(x: number, y: number, z: number): void {
        this.center.set(x, y, z);
        if (!this.light) return;
        this.light.target.position.copy(this.center);
        this.updateLightPosition();
        markShadowsDirty();
    }

    static animate(_seconds: number): void {}

    // Unit vector from the board toward the sun.
    static getDirection(target?: any): any {
        // With no target, return the stable vector reference used by shader
        // uniforms. setAngles mutates this vector instead of replacing it, so
        // every material sees live slider changes without recompilation.
        return target ? target.copy(this.direction) : this.direction;
    }

    static getAngles(): { azimuth: number; elevation: number } {
        return {
            azimuth: this.azimuthDegrees,
            elevation: this.elevationDegrees,
        };
    }

    static setAngles(azimuthDegrees: number, elevationDegrees: number): void {
        this.azimuthDegrees = ((azimuthDegrees % 360) + 360) % 360;
        this.elevationDegrees = THREE.MathUtils.clamp(elevationDegrees, 0, 180);
        this.updateDirectionFromAngles();
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

    private static setDaylightDirection(): void {
        this.azimuthDegrees = DAYLIGHT_AZIMUTH_DEGREES;
        this.elevationDegrees = DAYLIGHT_ELEVATION_DEGREES;
        this.updateDirectionFromAngles();
    }

    private static updateDirectionFromAngles(): void {
        const azimuth = THREE.MathUtils.degToRad(this.azimuthDegrees);
        const elevation = THREE.MathUtils.degToRad(this.elevationDegrees);
        const horizontal = Math.cos(elevation);
        this.direction.set(
            Math.cos(azimuth) * horizontal,
            Math.sin(elevation),
            Math.sin(azimuth) * horizontal,
        ).normalize();
        this.updateLightPosition();
        markShadowsDirty();
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
