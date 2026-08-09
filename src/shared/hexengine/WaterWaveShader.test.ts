import { describe, expect, it } from 'vitest';
import {
    GERSTNER_NORMAL_GLSL,
    GERSTNER_PHASE_SPEED,
    GERSTNER_WAVE_GLSL,
    WATER_TIME_SCALE,
} from './WaterWaveShader';

describe('water animation clocks', () => {
    it('speeds Gerstner topology without changing the normal-map clock', () => {
        expect(WATER_TIME_SCALE).toBe(0.05);
        expect(GERSTNER_PHASE_SPEED).toBe(4);
        expect(GERSTNER_WAVE_GLSL).toContain('c * time * 4.0');
        expect(GERSTNER_NORMAL_GLSL).toContain('c * time * 4.0');
    });
});
