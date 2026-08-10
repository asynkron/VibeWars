import { describe, expect, it } from 'vitest';
import {
    GERSTNER_DISPLACEMENT_SCALE,
    GERSTNER_NORMAL_GLSL,
    GERSTNER_PHASE_SPEED,
    GERSTNER_WAVE_GLSL,
    GERSTNER_WAVELENGTHS,
    WATER_TIME_SCALE,
    WATER_NORMAL_SIZE,
} from './WaterWaveShader';

describe('water animation clocks', () => {
    it('speeds Gerstner topology without changing the normal-map clock', () => {
        expect(WATER_TIME_SCALE).toBe(0.05);
        expect(GERSTNER_PHASE_SPEED).toBe(4);
        expect(GERSTNER_WAVE_GLSL).toContain('c * time * 4.0');
        expect(GERSTNER_NORMAL_GLSL).toContain('c * time * 4.0');
    });
});

describe('board-scale water waves', () => {
    it('uses short, low Gerstner waves and dense normal detail', () => {
        expect(GERSTNER_DISPLACEMENT_SCALE).toBe(0.18);
        expect(WATER_NORMAL_SIZE).toBe(32);
        expect(GERSTNER_WAVELENGTHS).toEqual({
            large: 10,
            medium: 5,
            small: 2.5,
        });
    });
});
