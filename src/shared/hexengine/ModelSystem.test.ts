import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import { MODEL_LOADER_MATERIAL_SETTINGS, ModelSystem } from './ModelSystem';

function material(sharedGlow = false) {
    const source: any = {
        map: {},
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
                map: source.map,
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

describe('ModelSystem.enhanceTexturedModelContrast', () => {
    it('adds display contrast while preserving an existing material shader pass', () => {
        const source = material();
        const root = model([source, source]);

        ModelSystem.enhanceTexturedModelContrast(root);

        expect(root.children[0].material).not.toBe(source);
        expect(root.children[1].material).toBe(root.children[0].material);
        const shader = {
            fragmentShader: '#include <color_fragment>\n#include <dithering_fragment>',
        };
        root.children[0].material.onBeforeCompile(shader);
        expect(shader.fragmentShader).toContain('// authored pass');
        expect(shader.fragmentShader).toContain('unitSCurve');
        expect(shader.fragmentShader).toContain(
            `mix(unitColor, unitSCurve, ${MODEL_LOADER_MATERIAL_SETTINGS.contrastStrength.toFixed(2)})`
        );
        expect(root.children[0].material.customProgramCacheKey()).toBe(
            `unit-contrast-v2-${MODEL_LOADER_MATERIAL_SETTINGS.contrastStrength}-${MODEL_LOADER_MATERIAL_SETTINGS.saturation}|authored`
        );
    });

    it('leaves the globally shared emissive glow material untouched', () => {
        const glow = material(true);
        const root = model([glow]);

        ModelSystem.enhanceTexturedModelContrast(root);

        expect(root.children[0].material).toBe(glow);
    });

    it('leaves untextured loader materials untouched', () => {
        const plain = material();
        plain.map = null;
        const root = model([plain]);

        ModelSystem.enhanceTexturedModelContrast(root);

        expect(root.children[0].material).toBe(plain);
    });

    it('supports a stronger unit profile without changing the building default', () => {
        const source = material();
        const root = model([source]);

        ModelSystem.enhanceTexturedModelContrast(
            root,
            MODEL_LOADER_MATERIAL_SETTINGS.unitContrastStrength
        );

        const shader = {
            fragmentShader: '#include <color_fragment>\n#include <dithering_fragment>',
        };
        root.children[0].material.onBeforeCompile(shader);
        expect(shader.fragmentShader).toContain(
            `mix(unitColor, unitSCurve, ${MODEL_LOADER_MATERIAL_SETTINGS.unitContrastStrength.toFixed(2)})`
        );
        expect(MODEL_LOADER_MATERIAL_SETTINGS.contrastStrength).toBe(0.68);
    });
});
