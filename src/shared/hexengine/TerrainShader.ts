// Procedural ground textures, injected into the terrain's standard
// materials via onBeforeCompile. No texture assets: a world-position
// based value-noise/fbm in the fragment shader paints the ground.
//
// THE RULE: the fragment's WORLD HEIGHT decides the texture, exactly like
// the terrain ladder that assigns tile types -- sand < grass < forest <
// rock < snow. Tile MATERIAL no longer matters for the look. This is what
// makes the smoothed slopes cohesive: edge smoothing stretches low tiles
// (sand fords, grass) up the mountainside as steep ramps, and a
// height-driven shader recolors those ramps through the whole ladder on
// the way up instead of dragging their lowland color to the summit.
//
// Band colors come from TerrainSystem's palette (same source as tile
// coloring); band borders meander via noise. The mesh's vertex color is
// kept as a DARKENING signal relative to the material's own palette
// luminance, so crater scorching and shading blends still show through.
// WATER is untouched (its animation/material is handled elsewhere).

import { TerrainSystem } from './TerrainSystem';

const GROUND_TYPES = new Set(['SAND', 'GRASS', 'FOREST', 'MOUNTAIN']);

// Shared noise toolkit (no declarations of its own).
const NOISE_GLSL_CORE = /* glsl */ `
    float groundHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float groundNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), u.x),
            mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    float groundFbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
            value += amplitude * groundNoise(p);
            p = p * 2.03 + vec2(17.31, 9.17);
            amplitude *= 0.5;
        }
        return value;
    }
`;

const GROUND_FRAGMENT = /* glsl */ `
    {
        vec2 gp = vGroundWorldPos.xz;
        float y = vGroundWorldPos.y;
        // Shared border wobble so the band lines meander organically
        // instead of tracing flat contour lines.
        float wob = groundFbm(gp * 2.2) - 0.5;

        // Band masks up the height ladder (thresholds follow the terrain
        // config: sand tops ~0.2, grass ~0.45, forest ~0.9, then rock).
        float toGrass  = smoothstep(0.20, 0.34, y + wob * 0.10);
        float toForest = smoothstep(0.44, 0.58, y + wob * 0.14);
        float toRock   = smoothstep(0.85, 1.20, y + wob * 0.30);
        float toSnow   = smoothstep(uSnowStart, uSnowFull, y + wob * 1.2);

        // Per-band procedural detail, each tinted by its palette color.
        float dunes = sin(gp.x * 2.1 + gp.y * 0.8 + groundFbm(gp * 0.9) * 5.0) * 0.5 + 0.5;
        vec3 sandC = uSandColor * (0.88 + 0.14 * groundNoise(gp * 24.0) + 0.10 * dunes);

        vec3 grassC = uGrassColor * (0.80 + 0.32 * groundFbm(gp * 2.6) + 0.10 * groundNoise(gp * 30.0));

        vec3 forestC = uForestColor * (0.85 + 0.45 * groundFbm(gp * 3.2) + 0.15 * groundNoise(gp * 16.0));

        float rockDetail = 0.74 + 0.34 * groundFbm(gp * 5.0)
            + 0.12 * groundNoise(vec2(gp.x * 1.6 + y * 3.0, gp.y * 1.6));
        float rockLum = dot(uRockColor, vec3(0.299, 0.587, 0.114));
        vec3 rockC = vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05) * rockDetail;

        vec3 snowC = vec3(0.92, 0.95, 0.99) * (0.92 + 0.08 * groundNoise(gp * 12.0));

        // Climb the ladder.
        vec3 band = mix(sandC, grassC, toGrass);
        band = mix(band, forestC, toForest);
        band = mix(band, rockC, toRock);
        band = mix(band, snowC, toSnow);

        // Vertex color as a darkening signal relative to this material's
        // own palette luminance: untouched tiles pass 1.0, crater-scorched
        // or shadow-blended vertices darken the band correspondingly.
        float vLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        band *= clamp(vLum / max(uPaletteLum, 0.001), 0.35, 1.05);

        diffuseColor.rgb = band;
    }
`;

// Animated water surface: drifting ripple shimmer across all water, and
// white lapping foam at the shorelines. The foam MASK comes from the
// existing vertex colors -- smoothHexTile paints land-adjacent rim
// vertices with WATER_FOAM_COLOR (higher green than deep water), and the
// interpolated gradient across each triangle gives a soft shore band the
// animation plays inside. uTime is driven per frame by
// GridSystem.animateWater via material.userData.shader.
const WATER_FRAGMENT = /* glsl */ `
    {
        vec2 wp = vGroundWorldPos.xz;

        // Shore foam MASK first, from the raw vertex-color gradient (the
        // land-adjacent rims are painted a green-heavier foam color) --
        // sampled BEFORE the ripple modulation so the shimmer can't push
        // open water over the threshold.
        float foamMask = smoothstep(0.30, 0.44, diffuseColor.g);

        // Two drifting ripple layers shimmering across the whole surface.
        float ripple1 = groundNoise(wp * 3.0 + vec2(uTime * 0.35, uTime * 0.22));
        float ripple2 = groundNoise(wp * 6.5 - vec2(uTime * 0.28, uTime * 0.41));
        diffuseColor.rgb *= 0.86 + 0.14 * ripple1 + 0.08 * ripple2;
        // Lapping: the foam edge surges in and out, its rhythm offset
        // around the shoreline by position + noise so waves break at
        // different moments along the beach.
        float lap = sin(uTime * 1.7 + wp.x * 2.3 + wp.y * 1.9 + groundNoise(wp * 4.0) * 5.0) * 0.5 + 0.5;
        // Broken white caps inside the foam band -- patches of churn, not
        // a solid blanket.
        float caps = groundNoise(wp * 11.0 + vec2(uTime * 0.6, -uTime * 0.35));
        float foam = foamMask * (0.25 + 0.75 * lap) * smoothstep(0.55, 0.85, caps + foamMask * 0.25);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), clamp(foam, 0.0, 0.7));
    }
`;

export function applyWaterSurface(material: any): void {
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uTime = { value: 0 };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vGroundWorldPos;')
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n varying vec3 vGroundWorldPos;\n uniform float uTime;\n' + NOISE_GLSL_CORE
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAGMENT);
        // Expose the shader so animateWater can drive uTime each frame.
        material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'water-surface';
}

// Inject the height-banded procedural ground into a terrain
// MeshStandardMaterial. `terrainType` is the UPPERCASE terrain key;
// non-ground types (WATER) are left untouched.
export function applyProceduralGround(material: any, terrainType: string): void {
    if (!GROUND_TYPES.has(terrainType)) return;

    const paletteColor = new THREE.Color(TerrainSystem.getTerrainColor(terrainType));
    const paletteLum = 0.299 * paletteColor.r + 0.587 * paletteColor.g + 0.114 * paletteColor.b;

    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uSandColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('SAND')) };
        shader.uniforms.uGrassColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('GRASS')) };
        shader.uniforms.uForestColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('FOREST')) };
        shader.uniforms.uRockColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('MOUNTAIN')) };
        shader.uniforms.uPaletteLum = { value: paletteLum };
        shader.uniforms.uSnowStart = { value: 2.4 };
        shader.uniforms.uSnowFull = { value: 3.6 };

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vGroundWorldPos;')
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n varying vec3 vGroundWorldPos;\n' +
                ' uniform vec3 uSandColor;\n uniform vec3 uGrassColor;\n uniform vec3 uForestColor;\n' +
                ' uniform vec3 uRockColor;\n uniform float uPaletteLum;\n uniform float uSnowStart;\n' +
                ' uniform float uSnowFull;\n' + NOISE_GLSL_CORE
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAGMENT);
    };
    // All ground materials share one height-banded program (uniforms
    // differ per material); distinct key from three.js's stock shader.
    material.customProgramCacheKey = () => 'ground-height-banded';
}
