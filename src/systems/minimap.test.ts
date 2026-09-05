import { describe, expect, it } from 'vitest';
import { OrthographicCamera } from 'three';
import { getMinimapWorldPosition } from './minimap';

describe('minimap navigation', () => {
    const camera = new OrthographicCamera(-30, 30, 20, -20, 0.1, 1000);
    camera.position.set(10, 100, 15);
    camera.rotation.x = -Math.PI / 2;
    const overlay = { getBoundingClientRect: () => new DOMRect(500, 56, 300, 300) };

    it.each([
        [650, 206, 10, 15], [500, 56, -20, -5], [800, 356, 40, 35],
        [900, 500, 40, 35], // Dragging beyond the overlay stops at its edge.
    ])('maps pointer (%s, %s) to the rendered ground', (clientX, clientY, x, z) => {
        const point = getMinimapWorldPosition({ clientX, clientY }, overlay, camera)!;
        expect(point.x).toBeCloseTo(x);
        expect(point.z).toBeCloseTo(z);
        expect(point.y).toBe(0);
    });

    it('ignores a hidden minimap', () => {
        expect(getMinimapWorldPosition({ clientX: 0, clientY: 0 }, {
            getBoundingClientRect: () => new DOMRect(),
        }, camera)).toBeNull();
    });
});
