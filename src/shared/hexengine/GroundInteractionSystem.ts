import { scene } from '../../render';

interface DustCloud {
    points: any;
    velocities: any[];
    start: number;
    duration: number;
    baseSize: number;
    baseOpacity: number;
    rotorWash: boolean;
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

    static emitMovementDust(position: any, unitClass: string): void {
        const heavy = unitClass === 'tank' || unitClass === 'artillery' || unitClass === 'aa';
        this.emit(position, heavy ? 11 : 7, heavy ? 0.42 : 0.29, heavy ? 0.56 : 0.38, false);
    }

    static emitRotorWash(position: any): void {
        this.emit(position, 16, 0.72, 0.34, true);
    }

    private static emit(position: any, count: number, radius: number, opacity: number, rotorWash: boolean): void {
        const positions = new Float32Array(count * 3);
        const velocities: any[] = [];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const startRadius = rotorWash ? radius * (0.35 + Math.random() * 0.35) : Math.random() * radius * 0.25;
            positions[i * 3] = position.x + Math.cos(angle) * startRadius;
            positions[i * 3 + 1] = position.y + Math.random() * 0.05;
            positions[i * 3 + 2] = position.z + Math.sin(angle) * startRadius;
            const speed = (rotorWash ? 0.95 : 0.42) * (0.65 + Math.random() * 0.55);
            velocities.push(new THREE.Vector3(
                Math.cos(angle) * speed,
                rotorWash ? 0.08 + Math.random() * 0.06 : 0.18 + Math.random() * 0.12,
                Math.sin(angle) * speed,
            ));
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: rotorWash ? 0x8b806f : 0x705d46,
            map: this.getTexture(),
            transparent: true,
            depthWrite: false,
            opacity,
            size: rotorWash ? 0.48 : 0.36,
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
            duration: rotorWash ? 0.62 : 0.48,
            baseSize: material.size,
            baseOpacity: opacity,
            rotorWash,
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
            cloud.points.material.size = cloud.baseSize * (1 + progress * (cloud.rotorWash ? 1.0 : 0.65));
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
