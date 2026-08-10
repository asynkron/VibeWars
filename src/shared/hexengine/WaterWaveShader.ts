// Normal-mapped water detail ported from Sean Bradley's ocean example:
// https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html

const WATER_NORMAL_TEXTURE = 'assets/textures/waternormals.jpg';

// Shared clock for all four scrolling normal-map samples.
export const WATER_TIME_SCALE = 0.25;

// getNoise divides these coordinates by ~100. At size 1 that means almost no
// normal-map repetition across a VibeWars map; 32 gives ripples a few world
// units wide while retaining the reference shader's four-octave composition.
export const WATER_NORMAL_SIZE = 32;

let waterNormalTexture: any = null;

export function getWaterNormalTexture(): any {
    if (waterNormalTexture) return waterNormalTexture;
    waterNormalTexture = new THREE.TextureLoader().load(WATER_NORMAL_TEXTURE);
    waterNormalTexture.wrapS = THREE.RepeatWrapping;
    waterNormalTexture.wrapT = THREE.RepeatWrapping;
    return waterNormalTexture;
}

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
