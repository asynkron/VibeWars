import { describe, expect, it } from 'vitest';
import { applyProceduralGround } from './TerrainShader';

function compile(terrainType: string) {
    const material: any = { userData: {} };
    applyProceduralGround(material, terrainType);
    const shader: any = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader: [
            '#include <common>',
            '#include <color_fragment>',
            '#include <roughnessmap_fragment>',
            '#include <metalnessmap_fragment>',
            '#include <normal_fragment_begin>',
        ].join('\n'),
    };
    material.onBeforeCompile(shader);
    return shader;
}

describe('concrete terrain shader', () => {
    it('uses the concrete surface override but suppresses land-side wave run-up', () => {
        const shader = compile('CONCRETE');
        expect(shader.uniforms.uIsConcrete.value).toBe(1);
        expect(shader.fragmentShader).toContain('if (uIsConcrete > 0.5)');
        expect(shader.fragmentShader).toContain('shoreBand(');
        expect(shader.fragmentShader).toContain('shore > 0.001 && uIsConcrete < 0.5');
    });

    it('does not repaint ordinary ground as concrete', () => {
        expect(compile('GRASS').uniforms.uIsConcrete.value).toBe(0);
    });

    it('keeps the shoreline material and layers mountain roughness onto it', () => {
        const shader = compile('SAND');
        expect(shader.fragmentShader).toContain('groundTriplanarVoronoi');
        expect(shader.fragmentShader).toContain('float shoreRockHeight =');
        expect(shader.fragmentShader).toContain('groundFoothillRockFields');
        expect(shader.fragmentShader).toContain(
            'vec4 mountainRoughnessFields = groundFoothillRockFields(gp, warp)',
        );
        expect(shader.fragmentShader).toContain(
            'shoreRockHeight + mountainRoughness',
        );
        expect(shader.fragmentShader).toContain(
            'gShoreWetness = coast * exposedRockWetness',
        );
        expect(shader.fragmentShader).toContain(
            'vec3 beach = mix(coastGrass, stone, rockCoverage)',
        );
        expect(shader.fragmentShader).toContain(
            'band = mix(band, beach, coast * 0.97)',
        );
        expect(shader.fragmentShader).toContain(
            'roughnessFactor = mix(roughnessFactor, 1.0, gShoreStone)',
        );
        expect(shader.fragmentShader).toContain(
            'metalnessFactor = mix(metalnessFactor, 0.0, gShoreStone)',
        );
    });
});
