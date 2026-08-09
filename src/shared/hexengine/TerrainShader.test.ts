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
});
