// Procedural ground textures, injected into the terrain's standard
// materials via onBeforeCompile. No texture assets: a world-position
// based value-noise/fbm in the fragment shader MODULATES the existing
// vertex color, so every current coloring rule -- terrain palette,
// neighbor smoothing blends, crater darkening -- stays authoritative and
// the procedural detail rides on top. World-space coordinates make the
// pattern continuous across hex boundaries.
//
// Per-type looks (same rules the terrain palette follows):
//   SAND      fine grain + soft dune banding
//   GRASS     mottled patches + high-frequency blade speckle
//   FOREST    darker, coarser forest-floor patches with brown litter
//   MOUNTAIN  rocky high-frequency detail + altitude SNOW CAP: above
//             uSnowStart the rock fades into noise-broken white,
//             fully snowed at uSnowFull (mountains span y ~1..5).
//   WATER     untouched (its animation/material is handled elsewhere).

const TYPE_IDS: Record<string, number> = {
    SAND: 0,
    GRASS: 1,
    FOREST: 2,
    MOUNTAIN: 3,
};

const NOISE_GLSL = /* glsl */ `
    varying vec3 vGroundWorldPos;
    uniform float uTerrainKind;
    uniform float uSnowStart;
    uniform float uSnowFull;

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
        vec3 ground = diffuseColor.rgb;

        if (uTerrainKind < 0.5) {
            // SAND: fine grain + soft wind-swept dune banding.
            float grain = groundNoise(gp * 24.0);
            float dunes = sin(gp.x * 2.1 + gp.y * 0.8 + groundFbm(gp * 0.9) * 5.0) * 0.5 + 0.5;
            ground *= 0.90 + 0.14 * grain + 0.10 * dunes;
        } else if (uTerrainKind < 1.5) {
            // GRASS: broad mottled patches + tiny blade speckle.
            float patches = groundFbm(gp * 2.6);
            float blades = groundNoise(gp * 30.0);
            ground *= 0.80 + 0.32 * patches + 0.10 * blades;
        } else if (uTerrainKind < 2.5) {
            // FOREST floor: dark humus -- the palette green pulled hard
            // toward deep gray-brown, then coarse shadow patches. Reads as
            // shaded soil under the canopy instead of bright grass.
            float floorPatches = groundFbm(gp * 3.2);
            float litter = groundNoise(gp * 16.0);
            float forestLum = dot(ground, vec3(0.299, 0.587, 0.114));
            vec3 humus = vec3(forestLum) * vec3(0.62, 0.52, 0.42);
            ground = mix(ground, humus, 0.75);
            ground *= 0.55 + 0.30 * floorPatches;
            ground = mix(ground, ground * vec3(1.10, 0.90, 0.65), litter * 0.20);
        } else if (uTerrainKind < 3.5) {
            // MOUNTAIN: pull the palette's warm tan strongly toward cool
            // gray granite (the raw color reads as "sand" on the lower
            // slopes), then add rocky detail + slope striations...
            float rockLum = dot(ground, vec3(0.299, 0.587, 0.114));
            vec3 granite = vec3(rockLum) * vec3(0.82, 0.84, 0.88);
            ground = mix(ground, granite, 0.65);
            float rock = groundFbm(gp * 5.0);
            float striation = groundNoise(vec2(gp.x * 1.6 + vGroundWorldPos.y * 3.0, gp.y * 1.6));
            ground *= 0.74 + 0.34 * rock + 0.12 * striation;
            // ...and the altitude snow cap, edge broken up by noise so the
            // snow line meanders instead of being a straight contour.
            float snowLine = vGroundWorldPos.y + (groundFbm(gp * 2.2) - 0.5) * 1.2;
            float snow = smoothstep(uSnowStart, uSnowFull, snowLine);
            vec3 snowColor = vec3(0.92, 0.95, 0.99) * (0.92 + 0.08 * groundNoise(gp * 12.0));
            ground = mix(ground, snowColor, snow);
        }

        diffuseColor.rgb = ground;
    }
`;

// Inject the procedural ground pattern into a terrain MeshStandardMaterial.
// `terrainType` is the UPPERCASE terrain key; unknown types (WATER) are
// left untouched.
export function applyProceduralGround(material: any, terrainType: string): void {
    const kind = TYPE_IDS[terrainType];
    if (kind === undefined) return;

    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uTerrainKind = { value: kind };
        shader.uniforms.uSnowStart = { value: 2.4 };
        shader.uniforms.uSnowFull = { value: 3.6 };

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vGroundWorldPos;')
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
            );

        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAGMENT);
    };
    // Distinct cache key per terrain kind so three.js doesn't reuse the
    // wrong compiled program across materials sharing the base shader.
    material.customProgramCacheKey = () => `ground-${kind}`;
}
