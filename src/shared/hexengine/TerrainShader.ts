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
    uniform float uRockStart;
    uniform float uRockFull;

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
            // FOREST floor: darker coarse patches with brown litter.
            float floorPatches = groundFbm(gp * 3.2);
            float litter = groundNoise(gp * 16.0);
            ground *= 0.70 + 0.34 * floorPatches;
            ground = mix(ground, ground * vec3(1.05, 0.85, 0.55), litter * 0.25);
        } else if (uTerrainKind < 3.5) {
            // MOUNTAIN: rocky detail + slope striations (the granite hue
            // comes from the shared alpine overlay below).
            float rock = groundFbm(gp * 5.0);
            float striation = groundNoise(vec2(gp.x * 1.6 + vGroundWorldPos.y * 3.0, gp.y * 1.6));
            ground *= 0.74 + 0.34 * rock + 0.12 * striation;
        }

        // ALPINE OVERLAY -- applies to EVERY ground type, driven purely by
        // altitude. The mountain's smoothed skirt spills its warm palette
        // onto neighboring grass/sand tiles (their vertex colors blend at
        // the seams), so tying rock to the MATERIAL leaves beige slopes
        // under a gray peak. Instead: as the terrain climbs, whatever is
        // there turns luminance-preserving gray granite, and above the
        // noise-broken snow line it whitens -- one continuous gradient up
        // the whole mountainside.
        // Rock takes over by ALTITUDE or by STEEPNESS: the mountain skirt
        // is steep from its very base, so slope catches the low warm band
        // that the altitude ramp alone misses. Face normal from screen-
        // space derivatives (flat-shaded materials have no vNormal).
        vec3 faceN = normalize(cross(dFdx(vGroundWorldPos), dFdy(vGroundWorldPos)));
        float slope = 1.0 - clamp(abs(faceN.y), 0.0, 1.0);
        float slopeRock = smoothstep(0.45, 0.70, slope) * smoothstep(0.35, 0.55, vGroundWorldPos.y);
        float rockify = max(smoothstep(uRockStart, uRockFull, vGroundWorldPos.y), slopeRock);
        if (rockify > 0.0) {
            float rockLum = dot(ground, vec3(0.299, 0.587, 0.114));
            vec3 granite = vec3(rockLum) * vec3(0.97, 1.0, 1.05);
            granite *= 0.86 + 0.24 * groundFbm(gp * 5.0);
            ground = mix(ground, granite, rockify * 0.9);
        }
        float snowLine = vGroundWorldPos.y + (groundFbm(gp * 2.2) - 0.5) * 1.2;
        float snow = smoothstep(uSnowStart, uSnowFull, snowLine);
        vec3 snowColor = vec3(0.92, 0.95, 0.99) * (0.92 + 0.08 * groundNoise(gp * 12.0));
        ground = mix(ground, snowColor, snow);

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
        // Altitude band where any terrain fades into gray rock -- flat
        // ground (grass/sand tops out around y ~0.5) stays untouched,
        // and the mountain skirt turns granite from its very base.
        shader.uniforms.uRockStart = { value: 0.6 };
        shader.uniforms.uRockFull = { value: 1.3 };

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
