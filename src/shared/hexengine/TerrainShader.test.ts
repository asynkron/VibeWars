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
    it('uses the concrete surface override', () => {
        const shader = compile('CONCRETE');
        expect(shader.uniforms.uIsConcrete.value).toBe(1);
        expect(shader.fragmentShader).toContain('if (uIsConcrete > 0.5)');
    });

    it('does not repaint ordinary ground as concrete', () => {
        expect(compile('GRASS').uniforms.uIsConcrete.value).toBe(0);
    });

    it('replaces the complete former sand material with coastline stone', () => {
        const shader = compile('SAND');
        expect(shader.fragmentShader).toContain('groundTriplanarVoronoi');
        expect(shader.fragmentShader).toContain('float coastHeight =');
        expect(shader.fragmentShader).toContain('groundFoothillRockFields');
        expect(shader.fragmentShader).toContain(
            'vec4 coastRoughnessFields = groundFoothillRockFields(gp, warp)',
        );
        expect(shader.fragmentShader).toContain(
            'lowC = mix(coastStone, grassC, grassMask)',
        );
        expect(shader.fragmentShader).toContain(
            'lowH = mix(coastHeight, grassH, grassMask)',
        );
        expect(shader.fragmentShader).toContain(
            'gShoreStone = (1.0 - grassMask) * wLow',
        );
        expect(shader.uniforms.uSandColor).toBeUndefined();
        expect(shader.fragmentShader).not.toMatch(
            /uSandColor|gSandSheen|sandC|sandH|rippleS|uBeachCalibration/,
        );
        expect(shader.fragmentShader).toContain(
            'roughnessFactor = mix(roughnessFactor, 1.0, gShoreStone)',
        );
        expect(shader.fragmentShader).toContain(
            'metalnessFactor = mix(metalnessFactor, 0.0, gShoreStone)',
        );
    });
});
