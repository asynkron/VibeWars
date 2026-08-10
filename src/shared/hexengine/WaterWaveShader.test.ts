import { describe, expect, it } from 'vitest';
import {
    WATER_NORMAL_GLSL,
    WATER_TIME_SCALE,
    WATER_NORMAL_SIZE,
} from './WaterWaveShader';

describe('water animation clocks', () => {
    it('drives the scrolling normal-map water', () => {
        expect(WATER_TIME_SCALE).toBe(0.25);
        expect(WATER_NORMAL_GLSL).toContain('time / 17.0');
        expect(WATER_NORMAL_GLSL).toContain('time / -113.0');
    });
});

describe('board-scale water ripples', () => {
    it('uses dense normal detail', () => {
        expect(WATER_NORMAL_SIZE).toBe(32);
    });
});
