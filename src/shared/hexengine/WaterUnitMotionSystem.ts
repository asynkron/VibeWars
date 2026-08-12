import { getGameState } from '../../systems/gameStateStore';
import { sampleGerstnerHeight, WATER_SURFACE_LIFT } from './WaterWaveShader';

export interface WatercraftPose {
    height: number;
    pitch: number;
    frontHeight: number;
    backHeight: number;
}

export function sampleWatercraftPose(
    centerX: number,
    centerZ: number,
    heading: number,
    halfLength: number,
    seconds: number
): WatercraftPose {
    // UnitSystem heading 0 faces +Z. Sample along that local forward axis.
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const frontHeight = sampleGerstnerHeight(
        centerX + forwardX * halfLength,
        centerZ + forwardZ * halfLength,
        seconds
    );
    const backHeight = sampleGerstnerHeight(
        centerX - forwardX * halfLength,
        centerZ - forwardZ * halfLength,
        seconds
    );

    // Positive Three.js X rotation lowers local +Z, hence the minus sign
    // when the bow (+Z) is higher than the stern.
    return {
        height: (frontHeight + backHeight) * 0.5,
        pitch: -Math.atan2(frontHeight - backHeight, halfLength * 2),
        frontHeight,
        backHeight,
    };
}

export class WaterUnitMotionSystem {
    static animate(seconds: number): void {
        const state = getGameState();
        for (const unit of state.units) {
            const visual = unit.visualUnit;
            if (!visual || visual.userData?.unitClass !== 'naval') continue;
            if (state.map.getTile(unit.q, unit.r)?.type !== 'WATER') continue;

            const halfLength = visual.userData.waterSampleHalfLength ?? 0.45;
            const pose = sampleWatercraftPose(
                visual.position.x,
                visual.position.z,
                visual.rotation.y,
                halfLength,
                seconds
            );
            const baseY = visual.userData.waterBaseY ?? visual.position.y;
            visual.position.y = baseY + WATER_SURFACE_LIFT + pose.height;
            visual.rotation.x = pose.pitch;

            if (visual.userData.sprite) {
                visual.userData.sprite.position.y = visual.position.y + 1.5;
            }
        }
        // Wave-following is a tiny cosmetic pose change. Invalidating the
        // scene-wide shadow and water-reflection caches here made one naval
        // unit redraw the complete random30 board every frame (thousands of
        // draw calls). Real unit movement already invalidates those caches
        // through UnitSystem; the small bob and pitch deliberately do not.
    }
}
