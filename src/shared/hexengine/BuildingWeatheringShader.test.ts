import '../../test/threeStub';
import { describe, expect, it } from 'vitest';
import {
    acceptsBuildingWear,
    applyBuildingWeathering,
    isRustableBuildingMaterial,
} from './BuildingWeatheringShader';

function material(name: string, metalness = 0) {
    const source: any = {
        name,
        metalness,
        userData: {},
        onBeforeCompile(shader: any) {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                '#include <color_fragment>\n// authored building pass'
            );
        },
        customProgramCacheKey: () => 'authored',
        clone() {
            return {
                name: source.name,
                metalness: source.metalness,
                userData: { ...source.userData },
                clone: source.clone,
            };
        },
    };
    return source;
}

describe('building material weathering', () => {
    it('protects functional light and void materials', () => {
        expect(acceptsBuildingWear(material('energy'))).toBe(false);
        expect(acceptsBuildingWear(material('beacon'))).toBe(false);
        expect(acceptsBuildingWear(material('voidDark'))).toBe(false);
        expect(acceptsBuildingWear(material('concrete'))).toBe(true);
    });

    it('limits rust to named or metallic surfaces', () => {
        expect(isRustableBuildingMaterial(material('armorDark'))).toBe(true);
        expect(isRustableBuildingMaterial(material('teamCamo'))).toBe(true);
        expect(isRustableBuildingMaterial(material('concrete', 0.8))).toBe(false);
        expect(isRustableBuildingMaterial(material('unknownMetal', 0.2))).toBe(true);
    });

    it('preserves existing shader passes and shares one clone per source material', () => {
        const armor = material('armorDark', 0.6);
        const energy = material('energy');
        const children: any[] = [
            { isMesh: true, material: armor },
            { isMesh: true, material: [armor, energy] },
        ];
        const root = {
            traverse(visitor: (child: any) => void) {
                children.forEach(visitor);
            },
        };

        applyBuildingWeathering(root, 1.25, 7.5);

        expect(children[0].material).not.toBe(armor);
        expect(children[1].material[0]).toBe(children[0].material);
        expect(children[1].material[1]).toBe(energy);
        const shader: any = {
            uniforms: {},
            vertexShader: '#include <common>\n#include <begin_vertex>',
            fragmentShader: [
                '#include <common>',
                '#include <color_fragment>',
                '#include <roughnessmap_fragment>',
                '#include <metalnessmap_fragment>',
            ].join('\n'),
        };
        children[0].material.onBeforeCompile(shader, {});
        expect(shader.fragmentShader).toContain('// authored building pass');
        expect(shader.fragmentShader).toContain('darkRust');
        expect(shader.fragmentShader).toContain('* 1.0');
        expect(shader.uniforms.uBuildingGroundY.value).toBe(1.25);
        expect(shader.uniforms.uBuildingWearSeed.value).toBe(7.5);
        expect(children[0].material.customProgramCacheKey()).toContain('building-weather-v1-rust|authored');
    });
});
