// One non-tiled wave field shared by the lit water material and the planar
// reflection overlay. It changes NORMALS and reflection coordinates only --
// never geometry or base colour -- so the lake stays calm while highlights
// and reflected detail acquire small, organic ripples.
//
// There is deliberately NO lattice/value/Perlin noise here. Even when used
// only for phase warping its square cells became visible as a mechanical grid.
// This is the calm-lake adaptation of the Gerstner example: six very small,
// oblique components with incommensurate directions, wavelengths and phases.
// We evaluate the analytic slope for lighting/reflection but do not displace
// the sparse tile geometry, which would turn each hex into a hinged plate.
export const WATER_WAVE_GLSL = /* glsl */ `
    void vwGerstner(
        vec2 p,
        float t,
        vec2 direction,
        float wavelength,
        float amplitude,
        float phase,
        inout float height,
        inout vec2 slope
    ) {
        vec2 d = normalize(direction);
        float k = 6.28318530718 / wavelength;
        // Deep-water dispersion, slowed to the visual scale of a calm lake.
        float omega = sqrt(9.8 * k) * 0.20;
        float f = k * dot(d, p) - omega * t + phase;
        height += amplitude * sin(f);
        slope += d * (amplitude * k * cos(f));
    }

    void vwGerstnerSum(vec2 p, float t, out float height, out vec2 slope) {
        height = 0.0;
        slope = vec2(0.0);
        vwGerstner(p, t, vec2( 0.96,  0.28), 8.30, 0.038, 0.00, height, slope);
        vwGerstner(p, t, vec2( 0.79,  0.61), 5.10, 0.024, 1.73, height, slope);
        vwGerstner(p, t, vec2( 0.93, -0.36), 3.40, 0.014, 3.11, height, slope);
        vwGerstner(p, t, vec2( 0.52,  0.85), 2.15, 0.008, 4.47, height, slope);
        vwGerstner(p, t, vec2(-0.23,  0.97), 1.37, 0.004, 2.36, height, slope);
        vwGerstner(p, t, vec2( 0.71, -0.70), 0.83, 0.002, 5.19, height, slope);
    }

    float vwWaveHeight(vec2 p, float t) {
        float height;
        vec2 slope;
        vwGerstnerSum(p, t, height, slope);
        return height;
    }

    vec3 vwWaveNormal(vec2 p, float t) {
        float height;
        vec2 slope;
        vwGerstnerSum(p, t, height, slope);
        return normalize(vec3(-slope.x, 1.0, -slope.y));
    }
`;
