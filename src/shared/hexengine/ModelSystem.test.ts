import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { ModelSystem } from './ModelSystem';

function material(sharedGlow = false) {
    const source: any = {
        userData: sharedGlow ? { sharedGlowMaterial: true } : {},
        onBeforeCompile(shader: any) {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                '#include <color_fragment>\n// authored pass'
            );
        },
        customProgramCacheKey: () => 'authored',
        clone() {
            // Mirrors THREE.Material.clone(): material values survive, custom
            // shader callbacks do not.
            return {
                userData: { ...source.userData },
                clone: source.clone,
            };
        },
    };
    return source;
}

function model(materials: any[]) {
    const children = materials.map((entry) => ({ isMesh: true, material: entry }));
    return {
        children,
        traverse(visitor: (child: any) => void) {
            children.forEach(visitor);
        },
    };
}

describe('ModelSystem.enhanceUnitContrast', () => {
    it('adds display contrast while preserving an existing material shader pass', () => {
        const source = material();
        const root = model([source, source]);

        ModelSystem.enhanceUnitContrast(root);

        expect(root.children[0].material).not.toBe(source);
        expect(root.children[1].material).toBe(root.children[0].material);
        const shader = {
            fragmentShader: '#include <color_fragment>\n#include <dithering_fragment>',
        };
        root.children[0].material.onBeforeCompile(shader);
        expect(shader.fragmentShader).toContain('// authored pass');
        expect(shader.fragmentShader).toContain('unitSCurve');
        expect(root.children[0].material.customProgramCacheKey()).toBe('unit-contrast-v1|authored');
    });

    it('leaves the globally shared emissive glow material untouched', () => {
        const glow = material(true);
        const root = model([glow]);

        ModelSystem.enhanceUnitContrast(root);

        expect(root.children[0].material).toBe(glow);
    });
});
