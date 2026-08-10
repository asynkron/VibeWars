// Normal-mapped water detail ported from Sean Bradley's ocean example:
// https://github.com/Sean-Bradley/three.js/blob/gerstner-waves/examples/webgl_shaders_ocean_gerstner.html

const WATER_NORMAL_TEXTURE = 'assets/textures/waternormals.jpg';

// Shared clock for all four scrolling normal-map samples.
export const WATER_TIME_SCALE = 0.25;

export const GERSTNER_PHASE_SPEED = 4.0;
export const GERSTNER_STEEPNESS = 0.4;
// The demo's steepness is preserved exactly on every wave. This one global
// multiplier is the only height adaptation for VibeWars' much smaller world.
export const GERSTNER_DISPLACEMENT_SCALE = 0.08;
export const GERSTNER_WAVELENGTHS = Object.freeze({
    large: 10,
    medium: 5,
    small: 2.5,
});

// getNoise divides these coordinates by ~100. At size 1 that means almost no
// normal-map repetition across a VibeWars map; 32 gives ripples a few world
// units wide while retaining the reference shader's four-octave composition.
export const WATER_NORMAL_SIZE = 32;
// Strength of the fine normal-map ripples layered over the Gerstner surface.
// 1.0 is the original full-strength normal map; 0.0 leaves only Gerstner normals.
export const WATER_NORMAL_STRENGTH = 0.64;

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
        waveA: { value: new THREE.Vector4(0, 1, GERSTNER_STEEPNESS, GERSTNER_WAVELENGTHS.large) },
        waveB: { value: new THREE.Vector4(0.5, 0.8660254037844386, GERSTNER_STEEPNESS, GERSTNER_WAVELENGTHS.medium) },
        waveC: { value: new THREE.Vector4(0.8660254037844386, 0.5, GERSTNER_STEEPNESS, GERSTNER_WAVELENGTHS.small) },
    };
}

export const GERSTNER_WAVE_GLSL = /* glsl */ `
    uniform float time;
    uniform vec4 waveA;
    uniform vec4 waveB;
    uniform vec4 waveC;

    vec3 GerstnerWave(vec4 wave, vec3 p) {
        float k = 2.0 * PI / wave.w;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xy) - c * time * ${GERSTNER_PHASE_SPEED.toFixed(1)});
        float a = wave.z / k;
        return vec3(d.x * a * cos(f), d.y * a * cos(f), a * sin(f));
    }
`;

// Analytic tangent frame for the same displaced surface as GerstnerWave.
// The normal map is transformed through this basis in the fragment shader,
// making its small ripples ride on the geometric wave instead of remaining in
// a separate flat world-space layer.
export const GERSTNER_BASIS_GLSL = /* glsl */ `
    void AccumulateGerstnerFrame(
        vec4 wave,
        vec3 p,
        float displacementScale,
        inout vec3 tangent,
        inout vec3 binormal
    ) {
        float k = 2.0 * PI / wave.w;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xy) - c * time * ${GERSTNER_PHASE_SPEED.toFixed(1)});
        float q = wave.z * displacementScale;
        tangent += vec3(
            -d.x * d.x * q * sin(f),
            -d.x * d.y * q * sin(f),
             d.x * q * cos(f)
        );
        binormal += vec3(
            -d.x * d.y * q * sin(f),
            -d.y * d.y * q * sin(f),
             d.y * q * cos(f)
        );
    }

    void GerstnerBasis(
        vec3 p,
        float displacementScale,
        out vec3 tangent,
        out vec3 binormal,
        out vec3 surfaceNormal
    ) {
        tangent = vec3(1.0, 0.0, 0.0);
        binormal = vec3(0.0, 1.0, 0.0);
        AccumulateGerstnerFrame(waveA, p, displacementScale, tangent, binormal);
        AccumulateGerstnerFrame(waveB, p, displacementScale, tangent, binormal);
        AccumulateGerstnerFrame(waveC, p, displacementScale, tangent, binormal);
        tangent = normalize(tangent);
        binormal = normalize(binormal);
        surfaceNormal = normalize(cross(tangent, binormal));
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
