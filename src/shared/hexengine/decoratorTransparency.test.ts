import { describe, expect, it } from 'vitest';
import { setDecoratorObscured } from './decoratorTransparency';

function decorator(...materials: any[]) {
    return {
        traverse(visitor: (child: any) => void) {
            visitor({ isMesh: true, material: materials.length === 1 ? materials[0] : materials });
        },
    };
}

describe('decorator transparency restoration', () => {
    it('restores an authored transparent foliage fringe instead of making a white shell', () => {
        const foliage = { transparent: true, opacity: 0.82, depthWrite: true };
        const tree = decorator(foliage);

        setDecoratorObscured(tree, true);
        expect(foliage).toMatchObject({ transparent: true, depthWrite: false });
        expect(foliage.opacity).toBeCloseTo(0.246);

        setDecoratorObscured(tree, false);
        expect(foliage).toMatchObject({ transparent: true, opacity: 0.82, depthWrite: true });
    });

    it('restores an ordinary opaque material exactly', () => {
        const material = { transparent: false, opacity: 0.7, depthWrite: true };
        const building = decorator(material);

        setDecoratorObscured(building, true);
        setDecoratorObscured(building, false);

        expect(material).toMatchObject({ transparent: false, opacity: 0.7, depthWrite: true });
    });

    it('does not overwrite the original snapshot when refreshed while occupied', () => {
        const material = { transparent: true, opacity: 1, depthWrite: true };
        const tree = decorator(material);

        setDecoratorObscured(tree, true);
        setDecoratorObscured(tree, true);
        setDecoratorObscured(tree, false);

        expect(material).toMatchObject({ transparent: true, opacity: 1, depthWrite: true });
    });

    it('restores every material in a multi-material mesh', () => {
        const foliage = { transparent: true, opacity: 0.9, depthWrite: true };
        const trunk = { transparent: false, opacity: 1, depthWrite: true };
        const tree = decorator(foliage, trunk);

        setDecoratorObscured(tree, true);
        setDecoratorObscured(tree, false);

        expect(foliage).toMatchObject({ transparent: true, opacity: 0.9, depthWrite: true });
        expect(trunk).toMatchObject({ transparent: false, opacity: 1, depthWrite: true });
    });
});
