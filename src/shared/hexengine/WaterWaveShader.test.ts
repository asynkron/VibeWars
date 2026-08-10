import { describe, expect, it } from 'vitest';
import {
    GERSTNER_BASIS_GLSL,
    GERSTNER_DISPLACEMENT_SCALE,
    GERSTNER_PHASE_SPEED,
    GERSTNER_STEEPNESS,
    GERSTNER_WAVE_GLSL,
    GERSTNER_WAVELENGTHS,
    sampleGerstnerHeight,
    WATER_NORMAL_GLSL,
    WATER_NORMAL_STRENGTH,
    WATER_TIME_SCALE,
    WATER_NORMAL_SIZE,
    WATER_SURFACE_LIFT,
} from './WaterWaveShader';

describe('water animation clocks', () => {
    it('drives the scrolling normal-map water', () => {
        expect(WATER_TIME_SCALE).toBe(0.25);
        expect(WATER_NORMAL_GLSL).toContain('time / 17.0');
        expect(WATER_NORMAL_GLSL).toContain('time / -113.0');
    });
});

describe('board-scale water ripples', () => {
    it('layers dense normal detail over small geometric waves', () => {
        expect(WATER_NORMAL_SIZE).toBe(32);
        expect(WATER_NORMAL_STRENGTH).toBe(0.64);
        expect(GERSTNER_DISPLACEMENT_SCALE).toBe(0.08);
        expect(GERSTNER_PHASE_SPEED).toBe(4);
        expect(GERSTNER_STEEPNESS).toBe(0.4);
        expect(GERSTNER_WAVELENGTHS).toEqual({ large: 10, medium: 5, small: 2.5 });
        expect(WATER_SURFACE_LIFT).toBe(0.018);
        expect(Number.isFinite(sampleGerstnerHeight(2.5, -4.25, 3.75))).toBe(true);
        expect(GERSTNER_WAVE_GLSL).toContain('c * time * 4.0');
        expect(GERSTNER_BASIS_GLSL).toContain('surfaceNormal = normalize(cross(tangent, binormal))');
    });
});
