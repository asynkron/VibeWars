import { scene } from '../../render';

interface DustCloud {
    points: any;
    velocities: any[];
    start: number;
    duration: number;
    baseSize: number;
    baseOpacity: number;
    growth: number;
}

interface GroundParticleStyle {
    count: number;
    radius: number;
    opacity: number;
    color: number;
    size: number;
    duration: number;
    horizontalSpeed: number;
    upwardSpeed: number;
    growth: number;
    backwardBias: number;
    sideOffset: number;
    sideSpeed: number;
}

const TRACKED_GROUND_CLASSES = new Set(['tank', 'artillery', 'aa']);

// Kept as data rather than buried in the emitter so sand dust and grass mud
// can be art-directed independently without touching movement code.
export function movementGroundStyle(unitClass: string, terrainType: string): GroundParticleStyle | null {
    if (!TRACKED_GROUND_CLASSES.has(unitClass)) return null;
    switch (terrainType.toUpperCase()) {
        case 'SAND':
            return {
                count: 12, radius: 0.26, opacity: 0.72, color: 0xaaa59d,
                size: 0.62, duration: 1.35, horizontalSpeed: 0.38,
                upwardSpeed: 0.19, growth: 0.95, backwardBias: 0.40,
                sideOffset: 0.20, sideSpeed: 0.10,
            };
        case 'GRASS':
        case 'FOREST':
            return {
                count: 14, radius: 0.10, opacity: 0.92, color: 0x865b38,
                size: 0.46, duration: 1.15, horizontalSpeed: 0.20,
                upwardSpeed: 0.56, growth: 0.20, backwardBias: 0.68,
                sideOffset: 0.30, sideSpeed: 0.52,
            };
        default:
            return null;
    }
}

// Short-lived, low particle-count ground interaction. One render-loop
// update owns every cloud, so movement does not create independent rAF
// chains or permanent objects.
class GroundInteractionSystem {
    static clouds: DustCloud[] = [];
    static texture: any = null;

    private static getTexture(): any {
        if (!this.texture) {
            this.texture = new THREE.TextureLoader().load('/assets/textures/smoke1.png');
            this.texture.colorSpace = THREE.SRGBColorSpace;
        }
        return this.texture;
    }

    static emitMovementSurface(
        position: any,
        unitClass: string,
        terrainType: string,
        travelDirection: any,
        intensity: number = 1
    ): void {
        const style = movementGroundStyle(unitClass, terrainType);
        if (!style) return;
        this.emit(position, {
            ...style,
            count: Math.max(2, Math.round(style.count * intensity)),
            size: style.size * Math.sqrt(intensity),
        }, travelDirection);
    }

    static emitRotorWash(position: any): void {
        this.emit(position, {
            count: 16, radius: 0.72, opacity: 0.34, color: 0x8b806f,
            size: 0.48, duration: 0.62, horizontalSpeed: 0.95,
            upwardSpeed: 0.10, growth: 1.0, backwardBias: 0,
            sideOffset: 0, sideSpeed: 0,
        }, null);
    }

    private static emit(position: any, style: GroundParticleStyle, travelDirection: any): void {
        const positions = new Float32Array(style.count * 3);
        const velocities: any[] = [];
        const backward = travelDirection
            ? new THREE.Vector3(-travelDirection.x, 0, -travelDirection.z).normalize()
            : new THREE.Vector3();
        const sideways = travelDirection
            ? new THREE.Vector3(travelDirection.z, 0, -travelDirection.x).normalize()
            : new THREE.Vector3();
        for (let i = 0; i < style.count; i++) {
            const angle = Math.random() * Math.PI * 2;
            // Alternate particles between the left and right track. Mud gets
            // two distinct motocross-like fans rather than one centre puff.
            const side = i % 2 === 0 ? -1 : 1;
            const trackOffset = style.sideOffset * (0.82 + Math.random() * 0.18);
            const startRadius = Math.random() * style.radius;
            positions[i * 3] = position.x + Math.cos(angle) * startRadius
                + sideways.x * side * trackOffset;
            positions[i * 3 + 1] = position.y + 0.06 + Math.random() * 0.07;
            positions[i * 3 + 2] = position.z + Math.sin(angle) * startRadius
                + sideways.z * side * trackOffset;
            const speed = style.horizontalSpeed * (0.65 + Math.random() * 0.55);
            velocities.push(new THREE.Vector3(
                Math.cos(angle) * speed + backward.x * style.backwardBias,
                style.upwardSpeed * (0.72 + Math.random() * 0.56),
                Math.sin(angle) * speed + backward.z * style.backwardBias
                    + sideways.z * side * style.sideSpeed,
            ));
            velocities[i].x += sideways.x * side * style.sideSpeed;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: style.color,
            map: this.getTexture(),
            transparent: true,
            depthWrite: false,
            opacity: style.opacity,
            size: style.size,
            sizeAttenuation: true,
            blending: THREE.NormalBlending,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 18;
        scene.add(points);
        this.clouds.push({
            points,
            velocities,
            start: performance.now() / 1000,
            duration: style.duration,
            baseSize: material.size,
            baseOpacity: style.opacity,
            growth: style.growth,
        });
    }

    static animate(time: number): void {
        for (let i = this.clouds.length - 1; i >= 0; i--) {
            const cloud = this.clouds[i];
            const age = time - cloud.start;
            const progress = age / cloud.duration;
            if (progress >= 1 || age < -1) {
                scene.remove(cloud.points);
                cloud.points.geometry.dispose();
                cloud.points.material.dispose();
                this.clouds.splice(i, 1);
                continue;
            }
            const dt = 1 / 60;
            const positions = cloud.points.geometry.attributes.position;
            for (let p = 0; p < cloud.velocities.length; p++) {
                positions.setXYZ(
                    p,
                    positions.getX(p) + cloud.velocities[p].x * dt,
                    positions.getY(p) + cloud.velocities[p].y * dt,
                    positions.getZ(p) + cloud.velocities[p].z * dt,
                );
            }
            positions.needsUpdate = true;
            cloud.points.material.opacity = cloud.baseOpacity * (1 - progress) * (1 - progress);
            cloud.points.material.size = cloud.baseSize * (1 + progress * cloud.growth);
        }
    }

    static clear(): void {
        for (const cloud of this.clouds) {
            scene.remove(cloud.points);
            cloud.points.geometry.dispose();
            cloud.points.material.dispose();
        }
        this.clouds.length = 0;
    }
}

export { GroundInteractionSystem };
