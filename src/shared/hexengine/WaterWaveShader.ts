// This module is a direct port of Sean Bradley's Gerstner-water example:
// https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html
//
// Keep the wave function, directions, wavelengths and four normal-map samples
// in sync with that reference. VibeWars only lowers the shared clock and wave
// steepness for calm lake water, and adapts XY to its XZ water plane.

const WATER_NORMAL_TEXTURE = 'assets/textures/waternormals.jpg';

// Preserve every relative Gerstner/normal-map speed from the reference while
// running its whole water clock more slowly at the scale of this board.
export const WATER_TIME_SCALE = 0.05;

// Gerstner phase speed is independent from the scrolling normal texture.
// Raising the shared clock made the reflection detail rush too; this moves
// only the large-scale wave topology faster while preserving steepness,
// displacement and therefore the amount of reflected-image sway.
export const GERSTNER_PHASE_SPEED = 4.0;

let waterNormalTexture: any = null;

export function getWaterNormalTexture(): any {
    if (waterNormalTexture) return waterNormalTexture;
    waterNormalTexture = new THREE.TextureLoader().load(WATER_NORMAL_TEXTURE);
    waterNormalTexture.wrapS = THREE.RepeatWrapping;
    waterNormalTexture.wrapT = THREE.RepeatWrapping;
    return waterNormalTexture;
}

export function createGerstnerUniforms(): Record<string, any> {
    return {
        time: { value: 0 },
        waveA: { value: new THREE.Vector4(0, 1, 0.05, 60) },
        waveB: { value: new THREE.Vector4(0.5, 0.8660254037844386, 0.035, 30) },
        waveC: { value: new THREE.Vector4(0.8660254037844386, 0.5, 0.025, 15) },
    };
}

// Copied from the reference vertex shader. Do not replace this with a
// home-grown multi-wave approximation.
export const GERSTNER_WAVE_GLSL = /* glsl */ `
    uniform float time;
    uniform vec4 waveA;
    uniform vec4 waveB;
    uniform vec4 waveC;

    vec3 GerstnerWave (vec4 wave, vec3 p) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * PI / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xy) - c * time * ${GERSTNER_PHASE_SPEED.toFixed(1)});
        float a = steepness / k;

        return vec3(
            d.x * (a * cos(f)),
            d.y * (a * cos(f)),
            a * sin(f)
        );
    }
`;

// Shader equivalent of the reference example's getWaveInfo() tangent and
// binormal calculation. The water mesh is authored in local XY with local Z
// as up, so cross(tangent, binormal) produces the displaced face normal.
export const GERSTNER_NORMAL_GLSL = /* glsl */ `
    void GerstnerFrame(
        vec4 wave,
        vec3 p,
        float displacementScale,
        inout vec3 tangent,
        inout vec3 binormal
    ) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * PI / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xy) - c * time * ${GERSTNER_PHASE_SPEED.toFixed(1)});
        float scaledSteepness = steepness * displacementScale;

        tangent += vec3(
            -d.x * d.x * scaledSteepness * sin(f),
            -d.x * d.y * scaledSteepness * sin(f),
             d.x * scaledSteepness * cos(f)
        );
        binormal += vec3(
            -d.x * d.y * scaledSteepness * sin(f),
            -d.y * d.y * scaledSteepness * sin(f),
             d.y * scaledSteepness * cos(f)
        );
    }

    vec3 GerstnerNormal(vec3 p, float displacementScale) {
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 1.0, 0.0);
        GerstnerFrame(waveA, p, displacementScale, tangent, binormal);
        GerstnerFrame(waveB, p, displacementScale, tangent, binormal);
        GerstnerFrame(waveC, p, displacementScale, tangent, binormal);
        return normalize(cross(tangent, binormal));
    }
`;

// Copied from the reference fragment shader. The relatively-prime scales and
// time divisors are what keep the normal detail from becoming a marching
// square texture.
export const WATER_NORMAL_GLSL = /* glsl */ `
    uniform float time;
    uniform float size;
    uniform sampler2D normalSampler;

    vec4 getNoise( vec2 uv ) {
        vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
        vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
        vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
        vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
        vec4 noise = texture2D( normalSampler, uv0 ) +
            texture2D( normalSampler, uv1 ) +
            texture2D( normalSampler, uv2 ) +
            texture2D( normalSampler, uv3 );
        return noise * 0.5 - 1.0;
    }
`;
