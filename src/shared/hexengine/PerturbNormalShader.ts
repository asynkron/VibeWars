// Screen-space bump (Blinn's perturb-normal-without-tangents, same scheme
// as three.js's bumpmap chunk, but fed a procedural height instead of a
// texture). This tiny shared shader chunk deliberately has no engine
// imports, so focused renderers can reuse decoration materials without
// booting TerrainSystem and the complete game graph.
export const PERTURB_GLSL = /* glsl */ `
    vec3 groundPerturbNormal(vec3 worldPos, vec3 viewNormal, float bumpH, float scale) {
        float fw = length(fwidth(worldPos));
        float bumpFade = 1.0 - smoothstep(0.08, 0.35, fw);
        if (bumpFade <= 0.001) return viewNormal;
        vec3 sigX = dFdx(worldPos);
        vec3 sigY = dFdy(worldPos);
        vec3 wN = inverseTransformDirection(viewNormal, viewMatrix);
        vec3 r1 = cross(sigY, wN);
        vec3 r2 = cross(wN, sigX);
        float det = dot(sigX, r1);
        if (abs(det) < 1e-7) return viewNormal;
        vec2 dH = vec2(dFdx(bumpH), dFdy(bumpH)) * scale * bumpFade;
        vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
        return normalize((viewMatrix * vec4(normalize(abs(det) * wN - grad), 0.0)).xyz);
    }
`;
