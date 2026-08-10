import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { sampleGerstnerHeight, WATER_SURFACE_LIFT } from './WaterWaveShader';
import { sampleWatercraftPose } from './WaterUnitMotionSystem';

describe('watercraft Gerstner pose', () => {
    it('uses separate bow and stern samples along heading +Z', () => {
        const pose = sampleWatercraftPose(3, 5, 0, 0.7, 1.25);
        expect(pose.frontHeight).toBeCloseTo(sampleGerstnerHeight(3, 5.7, 1.25), 10);
        expect(pose.backHeight).toBeCloseTo(sampleGerstnerHeight(3, 4.3, 1.25), 10);
        expect(pose.height).toBeCloseTo((pose.frontHeight + pose.backHeight) * 0.5, 10);
        expect(pose.pitch).toBeCloseTo(-Math.atan2(
            pose.frontHeight - pose.backHeight,
            1.4
        ), 10);
    });

    it('turns the sample axis with the unit heading', () => {
        const pose = sampleWatercraftPose(3, 5, Math.PI / 2, 0.7, 1.25);
        expect(pose.frontHeight).toBeCloseTo(sampleGerstnerHeight(3.7, 5, 1.25), 10);
        expect(pose.backHeight).toBeCloseTo(sampleGerstnerHeight(2.3, 5, 1.25), 10);
        expect(WATER_SURFACE_LIFT).toBe(0.018);
    });
});
