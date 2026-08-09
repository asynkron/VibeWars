// Dirty-plate surface for the unit (and building) models, injected into
// their materials via onBeforeCompile like every other procedural surface
// in the engine. The TEAM COLOR stays the base -- everything here is wear
// laid over it: weathered panel mottling, grime streaking down the hull
// sides and collecting low, and sparse chips of bare metal through the
// paint.
//
// All patterns sample OBJECT-space position, not world: units move, and a
// world-sampled pattern would swim across the hull as they drive.
//
// Loader materials differ (GLTF gives MeshStandardMaterial, OBJ/FBX often
// MeshPhong) -- the color injection lands in <color_fragment>, which both
// share, and the roughness tweak targets a chunk only the standard
// material has; String.replace on a missing anchor is a no-op, so the same
// function is safe on every material the loaders produce.

import { NOISE_GLSL_BASE } from './TerrainShader';

const UNIT_VERTEX_DECL = ' varying vec3 vUnitLocal;\n varying vec3 vUnitObjNormal;';
const UNIT_VERTEX_BODY = ' vUnitLocal = position;\n vUnitObjNormal = normal;';
const UNIT_FRAGMENT_DECL =
    ' varying vec3 vUnitLocal;\n varying vec3 vUnitObjNormal;\n' +
    // Written by the color pass, read by the roughness pass below it.
    ' float gPlateGrime;';

const UNIT_FRAGMENT = /* glsl */ `
    {
        vec3 lp = vUnitLocal;
        vec3 on = normalize(vUnitObjNormal);

        // Broad panel mottling: plate that has seen weather, not one even
        // coat of team paint. Strong on purpose -- a unit covers few
        // pixels at gameplay zoom, and a subtle treatment reads as none.
        float mottle = groundFbm(lp.xz * 2.6 + lp.y * 1.9);
        diffuseColor.rgb *= 0.72 + 0.42 * mottle;

        // Grime: streaks running DOWN the vertical surfaces (gated off the
        // tops by the object normal), and dust collecting low on the hull.
        float side = 1.0 - abs(on.y);
        float streaks = smoothstep(0.42, 0.90, groundNoise(vec2((lp.x + lp.z) * 8.0, lp.y * 1.5)));
        // The dust climbs most of the hull now -- these are field
        // vehicles, not showroom stock.
        float low = smoothstep(0.95, 0.10, lp.y);
        float dust = groundFbm(lp.xz * 4.0 + lp.y * 2.5);
        gPlateGrime = clamp(streaks * side * 0.8 + dust * low * 1.1, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.15, 0.11), gPlateGrime * 0.72);

        // Chips and scratches: sparse bare metal through the paint,
        // band-limited so distant units do not sparkle.
        float scratch = smoothstep(0.90, 0.98, groundNoise(lp.xy * 19.0 + lp.z * 11.0))
            * groundDetailFade(lp.xy * 19.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.60, 0.63, 0.66), scratch * 0.55);
        // Bare metal is not dusty.
        gPlateGrime = clamp(gPlateGrime - scratch, 0.0, 1.0);
    }
`;

// Dust is matte; the paint underneath keeps the material's own finish.
const UNIT_ROUGHNESS = /* glsl */ `
    roughnessFactor = clamp(roughnessFactor + gPlateGrime * 0.25, 0.0, 1.0);
`;

// Idempotent (userData flag): createModelWithColor may hand the same
// shared material in through several clones. Chains any onBeforeCompile
// already present (GlowSystem claims some of these materials).
export function applyDirtyPlate(material: any): void {
    if (!material || !material.userData || material.userData.dirtyPlate
        || material.userData.sharedGlowMaterial) return;
    material.userData.dirtyPlate = true;

    const previous = material.onBeforeCompile;
    const previousKey = typeof material.customProgramCacheKey === 'function'
        ? material.customProgramCacheKey.bind(material)
        : null;

    material.onBeforeCompile = (shader: any) => {
        if (previous) previous.call(material, shader);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + UNIT_VERTEX_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + UNIT_VERTEX_BODY);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + UNIT_FRAGMENT_DECL + '\n' + NOISE_GLSL_BASE)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + UNIT_FRAGMENT)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + UNIT_ROUGHNESS);
    };
    material.customProgramCacheKey = () => 'unit-dirty-plate|' + (previousKey ? previousKey() : '');
}

// Every material on a model clone, arrays included.
export function applyDirtyPlateToModel(model: any): void {
    model.traverse((child: any) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (Array.isArray(child.material)) {
            child.material.forEach((mat: any) => applyDirtyPlate(mat));
        } else {
            applyDirtyPlate(child.material);
        }
    });
}
