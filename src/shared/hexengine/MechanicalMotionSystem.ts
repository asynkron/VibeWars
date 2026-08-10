interface MechanicalUnit {
    root: any;
    unitClass: string;
    moving: boolean;
    baseRoll: number;
    baseScaleZ: number;
    lastHeading: number | null;
    turret: any;
    turretBase: any;
    turretLag: number;
    recoilStarted: number;
    recoilStrength: number;
}

// Tiny secondary motion that keeps the silhouettes readable at strategy
// zoom: suspension/engine vibration while driving, lag in any named turret,
// and a quick spring recoil when a weapon fires.
class MechanicalMotionSystem {
    static units: MechanicalUnit[] = [];

    static claim(root: any, unitClass: string): void {
        if (!root || unitClass === 'infantry') return;
        const turret = root.getObjectByName('chin_turret')
            || root.getObjectByName('turret_body')
            || root.getObjectByName('turret');
        this.units.push({
            root,
            unitClass,
            moving: false,
            baseRoll: root.rotation.z,
            baseScaleZ: root.scale.z,
            lastHeading: null,
            turret,
            turretBase: turret?.quaternion.clone() ?? null,
            turretLag: 0,
            recoilStarted: -10,
            recoilStrength: 0,
        });
    }

    static setMoving(root: any, moving: boolean): void {
        const unit = this.units.find((candidate) => candidate.root === root);
        if (!unit) return;
        unit.moving = moving;
        if (!moving) unit.root.rotation.z = unit.baseRoll;
    }

    static headingChanged(root: any, heading: number): void {
        const unit = this.units.find((candidate) => candidate.root === root);
        if (!unit) return;
        if (unit.lastHeading !== null && unit.turret) {
            let delta = heading - unit.lastHeading;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            unit.turretLag = THREE.MathUtils.clamp(unit.turretLag - delta * 0.42, -0.24, 0.24);
        }
        unit.lastHeading = heading;
    }

    static recoil(root: any, effect: string): void {
        const unit = this.units.find((candidate) => candidate.root === root);
        if (!unit) return;
        unit.recoilStarted = performance.now() / 1000;
        unit.recoilStrength = effect.includes('rocket') ? 0.018 : 0.035;
    }

    static animate(time: number): void {
        const yaw = new THREE.Quaternion();
        for (let i = this.units.length - 1; i >= 0; i--) {
            const unit = this.units[i];
            if (!unit.root.parent) {
                this.units.splice(i, 1);
                continue;
            }

            if (unit.moving) {
                const heavy = unit.unitClass === 'tank' || unit.unitClass === 'artillery' || unit.unitClass === 'aa';
                unit.root.rotation.z = unit.baseRoll + Math.sin(time * (heavy ? 18 : 23)) * (heavy ? 0.006 : 0.009);
            }

            const recoilAge = time - unit.recoilStarted;
            const recoil = recoilAge >= 0 && recoilAge < 0.24
                ? Math.sin((recoilAge / 0.24) * Math.PI) * unit.recoilStrength
                : 0;
            unit.root.scale.z = unit.baseScaleZ * (1 - recoil);

            if (unit.turret && unit.turretBase) {
                unit.turretLag *= 0.88;
                yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), unit.turretLag);
                unit.turret.quaternion.copy(unit.turretBase).multiply(yaw);
            }
        }
    }

    static clear(): void {
        this.units.length = 0;
    }
}

export { MechanicalMotionSystem };
