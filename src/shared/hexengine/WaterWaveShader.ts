// This module is a direct port of Sean Bradley's Gerstner-water example:
// https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html
//
// Keep the wave function, the three source waves and the four normal-map
// samples in sync with that reference. The render systems only adapt the
// example's XY plane to VibeWars' XZ water plane.

const WATER_NORMAL_TEXTURE = 'assets/textures/waternormals.jpg';

// Preserve every relative Gerstner/normal-map speed from the reference while
// running its whole water clock more slowly at the scale of this board.
export const WATER_TIME_SCALE = 0.35;

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
        waveA: { value: new THREE.Vector4(0, 1, 0.4, 60) },
        waveB: { value: new THREE.Vector4(0.5, 0.8660254037844386, 0.4, 30) },
        waveC: { value: new THREE.Vector4(0.8660254037844386, 0.5, 0.4, 15) },
    };
}

// Copied from the reference vertex shader. Do not replace this with a
// home-grown multi-wave approximation: these are the waves the example uses.
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
        float f = k * (dot(d, p.xy) - c * time);
        float a = steepness / k;

        return vec3(
            d.x * (a * cos(f)),
            d.y * (a * cos(f)),
            a * sin(f)
        );
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
