// Procedural surface for the road decals. RoadSystem still works exactly
// as it did -- one decal per connected direction, each covering the hex
// top and rotated toward that neighbour -- only the image is different:
// road.png is generated in the fragment shader here instead of sampled.
//
// TILE-LOCAL SPACE: the decal mesh is built from the tile's own top-face
// vertices (VisualizationSystem.createHexTopGeometry) and the mesh is then
// placed at the tile's world position, so the raw vertex position IS the
// offset from the tile centre. Divided by the hex radius it gives p, where
// the rim sits at |p| ~ 1, p.x runs along world +x and p.y along world +z.
// Using the position rather than the UVs also means the decal follows the
// jitter in the real rim instead of an idealised hexagon.

import { NOISE_GLSL_BASE } from './TerrainShader';
import { VIEW_UNIFORMS } from './ViewOptions';
import { MAP_CONFIG } from '../../constants';

// Tile-local position (what the decal is shaped from) AND world position
// (what its surface detail is sampled from). `uv` is deliberately not
// used -- three only declares vUv for materials that carry a texture, and
// this one no longer does.
//
// Detail comes from the WORLD position on purpose: sampled in tile-local
// space, the gravel and the ragged edge would restart at every tile border
// and at the seam where two halves meet.
const DECAL_VERTEX_DECL = ' varying vec2 vDecalLocal;\n varying vec2 vDecalWorld;';
const DECAL_VERTEX_BODY =
    ' vDecalLocal = position.xz;\n vDecalWorld = (modelMatrix * vec4(position, 1.0)).xz;';
const DECAL_FRAGMENT_DECL =
    ' varying vec2 vDecalLocal;\n varying vec2 vDecalWorld;\n uniform float uHexRadius;\n' +
    ' uniform float uDirection;\n uniform float uShowTextures;';

// The direction a decal runs, as a unit vector in the ground plane.
// Rotation 0 faces +z (see UnitSystem.getRotation), so heading θ is
// (sin θ, cos θ) -- the same convention the rest of the game uses.
const HEADING_GLSL = /* glsl */ `
    vec2 decalHeading(float rotation) {
        return vec2(sin(rotation), cos(rotation));
    }
`;

// What road.png drew: HALF a road -- a rounded cap at the tile centre with
// a strip running out to one edge. A straight run is two of these back to
// back, a bend is two meeting at the centre, a junction three or more.
const ROAD_FRAGMENT = /* glsl */ `
    {
        vec2 p = vDecalLocal / uHexRadius;
        vec2 wp = vDecalWorld;
        vec2 d = decalHeading(uDirection);

        float along = dot(p, d);
        // World-sampled wobble, so the ragged edge of this half lines up
        // with the half it meets and with the next tile's.
        float across = abs(dot(p, vec2(-d.y, d.x))) + (groundFbm(wp * 3.5) - 0.5) * 0.07;

        // The half itself, plus the cap that ties it to the other halves
        // on this tile. Not 'half' -- reserved word once three compiles
        // this as GLSL ES 3.00 on a WebGL2 context.
        // The ramps are deliberately wide: the alpha threshold below only
        // has this gradient to fade across, so a steep mask leaves a hard
        // rim however soft the threshold is.
        float arm = smoothstep(0.36, 0.14, across) * smoothstep(-0.02, 0.10, along);
        float road = max(arm, smoothstep(0.33, 0.11, length(p)));

        // Crushed aggregate: a mottled base with grit on top of it, rather
        // than one flat swatch of grey. This is most of what stops it
        // looking moulded.
        float grit = groundNoise(wp * 42.0);
        // Not 'patch' -- also a reserved word in GLSL ES 3.00.
        float mottle = groundFbm(wp * 3.2);
        // Kept in the mid tones: a near-black metalling reads as a hole
        // cut in the map against this pastel terrain palette.
        vec3 surface = mix(vec3(0.34, 0.32, 0.30), vec3(0.53, 0.50, 0.46), mottle);
        surface *= 0.86 + 0.28 * grit;

        // Worn wheel ruts either side of the centreline, polished darker
        // by traffic; the crown between them stays lighter.
        float rut = exp(-pow((across - 0.115) / 0.05, 2.0));
        surface *= 1.0 - rut * 0.20;

        // Cracks: the ridge line of a noise field, so they wander and
        // branch instead of tiling.
        float crack = smoothstep(0.035, 0.0, abs(groundFbm(wp * 4.0 + 13.0) - 0.5));
        surface = mix(surface, surface * 0.5, crack * 0.7);

        // Gravel shoulder where the metalling gives out, dusted with the
        // dirt it was cut into.
        float shoulder = smoothstep(0.9, 0.3, road);
        surface = mix(surface, vec3(0.50, 0.41, 0.30) * (0.8 + 0.4 * grit), shoulder * 0.75);

        diffuseColor.rgb = surface;
        // Alpha, not a hard rim: the edge dissolves into the terrain over a
        // wide noisy threshold, so the road thins out into the dirt instead
        // of ending on a cut-out silhouette. Two noise scales -- a coarse
        // one that makes the verge wander, a fine one that breaks the last
        // of it into grit.
        float verge = (groundFbm(wp * 6.0) - 0.5) * 0.26 + (groundNoise(wp * 26.0) - 0.5) * 0.12;
        diffuseColor.a *= smoothstep(0.02, 0.62, road + verge);
        // Roads and tracks are textures too: the toolbar's texture
        // toggle takes them out with the grass and the rock.
        diffuseColor.a *= uShowTextures;
    }
`;

// Grit scatters the specular instead of letting the whole strip catch one
// sheen -- a uniform roughness is what reads as plastic.
const ROAD_ROUGHNESS = /* glsl */ `
    roughnessFactor *= 0.80 + 0.34 * groundNoise(vDecalWorld * 42.0);
    roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
`;

// `direction` is the rotation toward the neighbour this half runs to, in
// the same convention UnitSystem.getRotation returns -- the value the PNG
// version fed to textureRotation.
export function applyRoadSurface(material: any, direction: number): void {
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        shader.uniforms.uDirection = { value: direction };
        // Shared by reference with every terrain material -- see ViewOptions.
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + DECAL_VERTEX_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DECAL_VERTEX_BODY);

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n' + DECAL_FRAGMENT_DECL + '\n' + NOISE_GLSL_BASE + HEADING_GLSL
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + ROAD_FRAGMENT)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + ROAD_ROUGHNESS);
    };
    material.customProgramCacheKey = () => 'road-surface';
}

// The track a vehicle leaves, built the same way the road is: HALF a tile,
// running from the tile centre out to one edge along the given direction.
// Nothing is drawn behind the centre.
const TRACK_FRAGMENT = /* glsl */ `
    {
        vec2 p = vDecalLocal / uHexRadius;
        vec2 wp = vDecalWorld;
        vec2 d = decalHeading(uDirection);

        float along = dot(p, d);
        float across = abs(dot(p, vec2(-d.y, d.x)));

        // Two ruts a track-width apart -- across is unsigned, so one band
        // measured from the centreline gives both at once. Its edges are
        // chewed up by noise sampled in WORLD space, so the wobble carries
        // across the tile border into the next print.
        float wob = (groundFbm(wp * 4.0) - 0.5) * 0.06;
        float rut = smoothstep(0.10, 0.02, abs(across - 0.20 + wob));

        // Tread bars stamped along the rut.
        float bars = 0.5 + 0.5 * sin(along * 28.0 + groundNoise(wp * 5.0) * 3.0);
        rut *= 0.55 + 0.45 * smoothstep(0.25, 0.75, bars);

        // The half: from the tile centre outward, then easing off at the
        // rim so it does not cut off squarely on the hex border.
        rut *= smoothstep(-0.02, 0.08, along) * smoothstep(1.12, 0.85, along);

        // Dark turned earth. Raising the alpha alone only washes the grass
        // out; the mark has to be darker than the ground to read as a rut.
        diffuseColor.rgb = mix(vec3(0.18, 0.09, 0.03), vec3(0.34, 0.19, 0.08), groundNoise(wp * 20.0));
        // diffuseColor.a already carries the material's opacity, which
        // FootprintSystem winds down each turn -- so the print fades.
        diffuseColor.a *= rut;
        diffuseColor.a *= uShowTextures;
    }
`;

// `direction` is the unit's heading, the value the PNG version fed to
// textureRotation.
export function applyTrackSurface(material: any, direction: number): void {
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        shader.uniforms.uDirection = { value: direction };
        // Shared by reference with every terrain material -- see ViewOptions.
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + DECAL_VERTEX_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DECAL_VERTEX_BODY);

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n' + DECAL_FRAGMENT_DECL + '\n' + NOISE_GLSL_BASE + HEADING_GLSL
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + TRACK_FRAGMENT);
    };
    material.customProgramCacheKey = () => 'track-surface';
}
