// Procedural wear for static building models. This is deliberately separate
// from UnitShader's dirty-plate treatment: building textures, team camouflage
// and approved loader contrast stay intact while dirt, rust and scratches are
// layered over the final authored colour.

import { NOISE_GLSL_BASE } from './TerrainShader';

const BUILDING_VERTEX_DECL = /* glsl */ `
    varying vec3 vBuildingWorld;
    varying vec3 vBuildingWorldNormal;
`;

const BUILDING_VERTEX_BODY = /* glsl */ `
    vBuildingWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vBuildingWorldNormal = normalize(mat3(modelMatrix) * normal);
`;

const BUILDING_FRAGMENT_DECL = /* glsl */ `
    varying vec3 vBuildingWorld;
    varying vec3 vBuildingWorldNormal;
    uniform float uBuildingGroundY;
    uniform float uBuildingWearSeed;
    float gBuildingDirt;
    float gBuildingRust;
`;

const buildingWearFragment = (rustable: boolean) => /* glsl */ `
    {
        vec3 wp = vBuildingWorld;
        vec3 wn = normalize(vBuildingWorldNormal);
        float side = 1.0 - abs(wn.y);
        float exposedSurface = 0.32 + side * 0.68;
        vec2 seed = vec2(uBuildingWearSeed, uBuildingWearSeed * 1.731);

        // Mud and soot collect close to the foundation. Sparse rain streaks
        // extend farther up vertical walls without tinting the whole facade.
        float heightAboveGround = max(wp.y - uBuildingGroundY, 0.0);
        float lowDirt = (1.0 - smoothstep(0.06, 0.62, heightAboveGround))
            * groundFbm(wp.xz * 0.72 + seed);
        float rainColumn = smoothstep(
            0.57,
            0.78,
            groundNoise(vec2((wp.x + wp.z) * 2.4, uBuildingWearSeed * 1.9))
        );
        float rainBreakup = smoothstep(
            0.40,
            0.68,
            groundFbm(vec2((wp.x - wp.z) * 0.55, wp.y * 0.13) + seed)
        );
        float rain = rainColumn * rainBreakup * side;
        float roofDirt = smoothstep(
            0.55,
            0.76,
            groundFbm(wp.xz * 0.92 + seed * 1.7)
        ) * smoothstep(0.25, 0.85, wn.y);
        gBuildingDirt = clamp(
            lowDirt * 0.72 + rain * 0.46 + roofDirt * 0.42,
            0.0,
            1.0
        );
        diffuseColor.rgb = mix(
            diffuseColor.rgb,
            vec3(0.105, 0.090, 0.068),
            gBuildingDirt * 0.48
        );

        // Oxidation is restricted in JavaScript to named metal/armour/team
        // materials. A coarse patch seeds thinner vertical rust runs.
        float rustPatch = smoothstep(
            0.50,
            0.73,
            groundFbm(wp.xz * 0.78 + wp.y * 0.16 + seed * 2.3)
        );
        float rustSource = smoothstep(
            0.60,
            0.79,
            groundNoise(wp.xz * 1.35 + seed * 3.1)
        );
        float rustRun = rustSource * smoothstep(
            0.38,
            0.66,
            groundFbm(vec2((wp.x - wp.z) * 0.72, wp.y * 0.12) + seed)
        );
        gBuildingRust = clamp(
            (rustPatch * 0.76 + rustRun * side)
                * exposedSurface
                * ${rustable ? '1.0' : '0.0'},
            0.0,
            1.0
        );
        vec3 darkRust = vec3(0.155, 0.047, 0.018);
        vec3 orangeRust = vec3(0.43, 0.115, 0.025);
        vec3 rustColor = mix(darkRust, orangeRust, rustPatch);
        diffuseColor.rgb = mix(diffuseColor.rgb, rustColor, gBuildingRust * 0.62);

        // Long diagonal score marks, broken into irregular segments by a
        // coarse mask. Unlike thresholded noise these read as scratches,
        // not another layer of freckles.
        float scratchDistance = abs(
            fract(
                (wp.x + wp.z) * 2.7
                    + wp.y * 0.82
                    + uBuildingWearSeed * 0.37
            ) - 0.5
        );
        float scratchLine = 1.0 - smoothstep(0.025, 0.075, scratchDistance);
        float scratchBreakup = smoothstep(
            0.52,
            0.72,
            groundFbm(vec2((wp.x - wp.z) * 0.80, wp.y * 0.42) + seed * 4.7)
        );
        float scratch = scratchLine
            * scratchBreakup
            * exposedSurface
            * groundDetailFade(wp.xz * 8.0);
        diffuseColor.rgb = mix(
            diffuseColor.rgb,
            vec3(0.48, 0.46, 0.42),
            scratch * 0.48
        );
        gBuildingDirt = clamp(gBuildingDirt - scratch * 0.45, 0.0, 1.0);
        gBuildingRust = clamp(gBuildingRust - scratch * 0.30, 0.0, 1.0);
    }
`;

const BUILDING_ROUGHNESS = /* glsl */ `
    roughnessFactor = clamp(
        roughnessFactor
            + gBuildingDirt * 0.28
            + gBuildingRust * 0.20,
        0.0,
        1.0
    );
`;

const BUILDING_METALNESS = /* glsl */ `
    metalnessFactor = mix(metalnessFactor, 0.05, gBuildingRust * 0.82);
`;

const PROTECTED_MATERIAL_TOKENS = [
    'energy', 'emissive', 'light', 'glow', 'beacon', 'void',
    'glass', 'window', 'screen',
];

const RUSTABLE_MATERIAL_TOKENS = [
    'armor', 'armour', 'metal', 'steel', 'iron', 'trim', 'camo', 'panel', 'roof',
];

export function acceptsBuildingWear(material: any): boolean {
    const name = String(material?.name ?? '').toLowerCase();
    return !PROTECTED_MATERIAL_TOKENS.some((token) => name.includes(token));
}

export function isRustableBuildingMaterial(material: any): boolean {
    const name = String(material?.name ?? '').toLowerCase();
    return RUSTABLE_MATERIAL_TOKENS.some((token) => name.includes(token))
        || (name !== 'concrete' && Number(material?.metalness ?? 0) >= 0.15);
}

export function applyBuildingWeathering(
    model: any,
    groundY: number,
    seed: number
): void {
    const ownedMaterials = new Map<any, any>();

    const weather = (source: any) => {
        if (!source || !acceptsBuildingWear(source) || source.userData?.sharedGlowMaterial) {
            return source;
        }
        const existing = ownedMaterials.get(source);
        if (existing) return existing;

        const rustable = isRustableBuildingMaterial(source);
        const previousCompile = source.onBeforeCompile;
        const previousKey = typeof source.customProgramCacheKey === 'function'
            ? source.customProgramCacheKey.bind(source)
            : null;
        const material = source.clone();
        material.userData = { ...material.userData, buildingWeathering: true };
        material.onBeforeCompile = (shader: any, renderer: any) => {
            previousCompile?.call(source, shader, renderer);
            shader.uniforms.uBuildingGroundY = { value: groundY };
            shader.uniforms.uBuildingWearSeed = { value: seed };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\n' + BUILDING_VERTEX_DECL)
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BUILDING_VERTEX_BODY);
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    '#include <common>\n' + BUILDING_FRAGMENT_DECL + '\n' + NOISE_GLSL_BASE
                )
                .replace(
                    '#include <color_fragment>',
                    '#include <color_fragment>\n' + buildingWearFragment(rustable)
                )
                .replace(
                    '#include <roughnessmap_fragment>',
                    '#include <roughnessmap_fragment>\n' + BUILDING_ROUGHNESS
                )
                .replace(
                    '#include <metalnessmap_fragment>',
                    '#include <metalnessmap_fragment>\n' + BUILDING_METALNESS
                );
        };
        material.customProgramCacheKey = () =>
            `building-weather-v1-${rustable ? 'rust' : 'grime'}|${previousKey ? previousKey() : ''}`;
        material.needsUpdate = true;
        ownedMaterials.set(source, material);
        return material;
    };

    model.traverse((child: any) => {
        if (!child.isMesh) return;
        child.material = Array.isArray(child.material)
            ? child.material.map(weather)
            : weather(child.material);
    });
}
