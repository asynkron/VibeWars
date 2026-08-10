import { describe, expect, it } from 'vitest';
import { movementGroundStyle } from './GroundInteractionSystem';

describe('movementGroundStyle', () => {
    it('gives tracked vehicles grey expanding dust on sand', () => {
        const style = movementGroundStyle('tank', 'SAND');
        expect(style?.color).toBe(0xaaa59d);
        expect(style?.growth).toBeGreaterThan(0.5);
    });

    it('gives tracked vehicles smaller, darker and more vertical mud on grass', () => {
        const dust = movementGroundStyle('tank', 'SAND')!;
        const mud = movementGroundStyle('tank', 'GRASS')!;
        expect(mud.size).toBeLessThan(dust.size);
        expect(mud.upwardSpeed).toBeGreaterThan(dust.upwardSpeed);
        expect(mud.sideOffset).toBeGreaterThan(dust.sideOffset);
        expect(mud.sideSpeed).toBeGreaterThan(mud.horizontalSpeed);
        expect(mud.duration).toBeLessThan(dust.duration);
    });

    it('treats visually grass-covered forest floor as mud terrain too', () => {
        expect(movementGroundStyle('tank', 'FOREST')).toEqual(
            movementGroundStyle('tank', 'GRASS')
        );
    });

    it('does not emit these effects for infantry, aircraft or unsupported terrain', () => {
        expect(movementGroundStyle('infantry', 'GRASS')).toBeNull();
        expect(movementGroundStyle('air', 'SAND')).toBeNull();
        expect(movementGroundStyle('tank', 'MOUNTAIN')).toBeNull();
    });
});
