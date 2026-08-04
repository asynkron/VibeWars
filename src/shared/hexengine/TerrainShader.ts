// Procedural ground textures, injected into the terrain's standard
// materials via onBeforeCompile. No texture assets: a world-position
// based value-noise/fbm in the fragment shader paints the ground.
//
// THE RULE: the fragment's WORLD HEIGHT decides the texture, exactly like
// the terrain ladder that assigns tile types -- sand < grass < forest <
// rock < snow. Tile MATERIAL no longer matters for the look. This is what
// makes the smoothed slopes cohesive: edge smoothing stretches low tiles
// (sand fords, grass) up the mountainside as steep ramps, and a
// height-driven shader recolors those ramps through the whole ladder on
// the way up instead of dragging their lowland color to the summit.
//
// Band colors come from TerrainSystem's palette (same source as tile
// coloring); band borders meander via noise. The mesh's vertex color is
// kept as a DARKENING signal relative to the material's own palette
// luminance, so crater scorching and shading blends still show through.
// The water SURFACE has its own shader below; the two meet at the
// shoreline, where the ground shader runs the wash up the sand from the
// same wave phase the water foams with.

import { TerrainSystem } from './TerrainSystem';
import { MAP_CONFIG } from '../../constants';
import { VIEW_UNIFORMS } from './ViewOptions';

const GROUND_TYPES = new Set(['SAND', 'GRASS', 'FOREST', 'MOUNTAIN']);

// Shared noise toolkit (no declarations of its own). Exported because the
// road decal paints its gravel from the same noise the ground does --
// metalling that comes from a different generator than the dirt around it
// reads as a sticker laid on the terrain.
export const NOISE_GLSL_BASE = /* glsl */ `
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

// The terrain's own additions on top of that: everything shoreline.
const NOISE_GLSL_CORE = NOISE_GLSL_BASE + /* glsl */ `
    // --- Shoreline geometry ------------------------------------------
    // Every tile carries a flag per hex edge saying whether that edge
    // borders the other element (painted by GridSystem.paintShoreEdges).
    // Distance to one such edge, in hex radii: 0 ON the edge, growing
    // toward the tile centre. A hexagon's edge e faces the direction
    // (e + 0.5) * 60 degrees and sits one apothem (cos 30) out from the
    // centre, so the signed distance is just that minus the projection.
    // Edges that border nothing return a large number so min() skips them.
    float shoreEdgeDistance(vec2 local, float borders, float edgeIndex) {
        if (borders < 0.5) return 10.0;
        float th = (edgeIndex + 0.5) * 1.0471975512;
        return 0.8660254 - dot(local, vec2(cos(th), sin(th)));
    }

    // Distance to the nearest of the SIX hex edges, in hex radii: 0 on the
    // border, 0.866 at the centre. Same half-plane trick as
    // shoreEdgeDistance but with no per-edge flags, since the grid overlay
    // wants every edge rather than only the ones facing water.
    float hexEdgeDistance(vec2 local) {
        float d = 10.0;
        for (int i = 0; i < 6; i++) {
            float th = (float(i) + 0.5) * 1.0471975512;
            d = min(d, 0.8660254 - dot(local, vec2(cos(th), sin(th))));
        }
        return d;
    }

    // The grid overlay itself, as a 0..1 mask. Drawn from tile-local
    // coordinates rather than as line geometry, so it follows the terrain
    // over every slope and crater for free and costs no extra objects.
    float hexGridLine(vec2 local, float enabled) {
        if (enabled < 0.5) return 0.0;
        return 1.0 - smoothstep(0.0, 0.05, hexEdgeDistance(local));
    }

    // How far up the beach (or out to sea) this fragment is, 1 right at
    // the waterline and 0 once it is width hex radii away. Measuring
    // real distance to the real edges is what makes the band follow the
    // WHOLE coast -- a per-vertex signal can only pin values at corners,
    // so it thins out between them and drops edges entirely.
    float shoreBand(vec2 local, vec3 edgesA, vec3 edgesB, float width) {
        float d = shoreEdgeDistance(local, edgesA.x, 0.0);
        d = min(d, shoreEdgeDistance(local, edgesA.y, 1.0));
        d = min(d, shoreEdgeDistance(local, edgesA.z, 2.0));
        d = min(d, shoreEdgeDistance(local, edgesB.x, 3.0));
        d = min(d, shoreEdgeDistance(local, edgesB.y, 4.0));
        d = min(d, shoreEdgeDistance(local, edgesB.z, 5.0));
        return clamp(1.0 - d / width, 0.0, 1.0);
    }

    // Shoreline surge phase, 0 = drawn back, 1 = wave at its peak. Both
    // the water and the land shaders call this with the SAME world
    // position and time, so a crest breaking offshore is the crest that
    // runs up the sand -- one wave, not two animations that happen to be
    // adjacent. The position terms + noise offset the rhythm along the
    // beach so waves break at different moments down the coast.
    float shoreLap(vec2 p, float t) {
        return sin(t * 1.7 + p.x * 2.3 + p.y * 1.9 + groundNoise(p * 4.0) * 5.0) * 0.5 + 0.5;
    }

    // Broken churn inside the foam -- patches, not a solid blanket. Shared
    // for the same reason as shoreLap: the same speckle drifts across the
    // waterline instead of stopping at it.
    float shoreCaps(vec2 p, float t) {
        return groundNoise(p * 11.0 + vec2(t * 0.6, -t * 0.35));
    }
`;

// Colour and strength of the hex grid overlay. Dark rather than bright so
// it reads as a drawn boundary over both snow and water.
const GRID_COLOR = 'vec3(0.04, 0.05, 0.07)';
const GRID_STRENGTH = '0.8';

const GROUND_FRAGMENT = /* glsl */ `
    {
        vec2 gp = vGroundWorldPos.xz;
        float y = vGroundWorldPos.y;
        // Shared border wobble so the band lines meander organically
        // instead of tracing flat contour lines.
        float wob = groundFbm(gp * 2.2) - 0.5;

        // Band masks up the height ladder. These MUST track
        // TerrainSystem's baseHeight/heightVariation table: the shader
        // decides the look from world height alone, so lifting the terrain
        // without moving these repaints grass as forest and forest as rock.
        // Current table: sand 0.70-0.85, grass 0.90-1.20, forest 1.10-1.70,
        // mountain 1.60-6.10.
        float toGrass  = smoothstep(0.80, 0.94, y + wob * 0.10);
        float toForest = smoothstep(1.04, 1.24, y + wob * 0.14);
        float toRock   = smoothstep(1.60, 2.05, y + wob * 0.30);
        float toSnow   = smoothstep(uSnowStart, uSnowFull, y + wob * 1.2);

        // Per-band procedural detail, each tinted by its palette color.
        float dunes = sin(gp.x * 2.1 + gp.y * 0.8 + groundFbm(gp * 0.9) * 5.0) * 0.5 + 0.5;
        vec3 sandC = uSandColor * (0.88 + 0.14 * groundNoise(gp * 24.0) + 0.10 * dunes);

        vec3 grassC = uGrassColor * (0.80 + 0.32 * groundFbm(gp * 2.6) + 0.10 * groundNoise(gp * 30.0));

        vec3 forestC = uForestColor * (0.85 + 0.45 * groundFbm(gp * 3.2) + 0.15 * groundNoise(gp * 16.0));

        float rockDetail = 0.74 + 0.34 * groundFbm(gp * 5.0)
            + 0.12 * groundNoise(vec2(gp.x * 1.6 + y * 3.0, gp.y * 1.6));
        float rockLum = dot(uRockColor, vec3(0.299, 0.587, 0.114));
        vec3 rockC = vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05) * rockDetail;

        vec3 snowC = vec3(0.92, 0.95, 0.99) * (0.92 + 0.08 * groundNoise(gp * 12.0));

        // Climb the ladder.
        vec3 band = mix(sandC, grassC, toGrass);
        band = mix(band, forestC, toForest);
        band = mix(band, rockC, toRock);
        band = mix(band, snowC, toSnow);

        // Texture toggle. The flat version keeps the height LADDER -- sand
        // still reads as sand and rock as rock -- and drops only the
        // procedural detail on top of it. Turning the bands off too would
        // not be "textures off", it would be "terrain off".
        vec3 flatBand = mix(uSandColor, uGrassColor, toGrass);
        flatBand = mix(flatBand, uForestColor, toForest);
        flatBand = mix(flatBand, vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05), toRock);
        flatBand = mix(flatBand, vec3(0.92, 0.95, 0.99), toSnow);
        band = mix(flatBand, band, uShowTextures);

        // Vertex color as a darkening signal relative to this material's
        // own palette luminance: untouched tiles pass 1.0, crater-scorched
        // or shadow-blended vertices darken the band correspondingly.
        float vLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        band *= clamp(vLum / max(uPaletteLum, 0.001), 0.35, 1.05);

        // ---- Beach: the LAND half of the water's shore foam ----
        // shore is 1 at the waterline and falls to 0 a fixed distance
        // inland, measured against this tile's water-facing edges -- so it
        // reads as "how far up the beach am I". The water shader derives
        // its foam from the same function against its land-facing edges,
        // so the two bands meet along the whole shared edge.
        float shore = shoreBand(vTileLocal / uHexRadius, vShoreA, vShoreB, 0.38);
        if (shore > 0.001) {
            float lap = shoreLap(gp, uTime);

            // Permanently damp sand: the strip the waves keep reaching,
            // darker and cooler, no white. Its edge wobbles with noise so
            // it does not read as a clean offset of the coastline.
            float wet = smoothstep(0.30, 0.85, shore + (groundFbm(gp * 3.0) - 0.5) * 0.12);
            band *= mix(vec3(1.0), vec3(0.60, 0.65, 0.72), wet * 0.9);

            // The sheet surges: a high lap pushes the water further UP the
            // beach, i.e. down to a lower shore. Even fully drawn back it
            // stops at 0.92 rather than 1.0, so a thin lip of water always
            // sits against the waterline -- a shore that empties completely
            // between waves reads as the effect switching off.
            float reach = mix(0.92, 0.62, lap);
            float sheet = smoothstep(reach, min(reach + 0.12, 1.0), shore);

            // What runs up the sand is WATER, not foam: a film carrying the
            // sea's own blue with the sand showing through it, so the beach
            // reads as the sea stretching a little way up the land.
            // Whitening the whole sheet instead just draws a pale ribbon
            // winding along the coast.
            band = mix(band, mix(band, uWaterColor * 1.45, 0.62), sheet);

            // White surf rides the FRONT of that film -- a band at the top
            // of its run, with the blue trailing back down to the sea
            // behind it. front is 0 at the leading edge and grows
            // seaward, so the surf band sits just inside the water's reach.
            float front = shore - reach;
            float caps = shoreCaps(gp, uTime);
            float surf = smoothstep(0.13, 0.02, front) * smoothstep(-0.05, 0.015, front);
            // Cut by the same churn the water foams with, so the edge
            // scatters instead of tracing a clean contour around the tile.
            // The surge only dims the surf to half -- it never puts it out.
            surf *= smoothstep(0.30, 0.70, caps + 0.30) * mix(0.5, 1.0, smoothstep(0.0, 0.45, lap));
            band = mix(band, vec3(0.95, 0.98, 1.0), clamp(surf, 0.0, 0.80));
        }

        // Grid last, so it draws over the beach wash rather than under it.
        band = mix(band, ${GRID_COLOR}, hexGridLine(vTileLocal / uHexRadius, uShowGrid) * ${GRID_STRENGTH});

        diffuseColor.rgb = band;
    }
`;

// Animated water surface: drifting ripple shimmer across all water, and
// white lapping foam at the shorelines. The foam band is measured from
// the tile's LAND-facing edges (shoreBand over the aShoreA/aShoreB flags
// GridSystem paints), the mirror of what the ground shader does with its
// water-facing ones -- so foam covers every shared edge and stops dead at
// a water-to-water seam. uTime is driven per frame by
// GridSystem.animateWater via material.userData.shader.
const WATER_FRAGMENT = /* glsl */ `
    {
        // Water-side foam is currently OFF so the beach can be judged on
        // its own. Set back to 1.0 to bring the surf on the water back.
        const float WATER_FOAM_STRENGTH = 0.0;

        vec2 wp = vGroundWorldPos.xz;

        // 1 hard against the land, falling off out to sea.
        float shore = shoreBand(vTileLocal / uHexRadius, vShoreA, vShoreB, 0.40);

        // Two drifting ripple layers shimmering across the whole surface.
        float ripple1 = groundNoise(wp * 3.0 + vec2(uTime * 0.35, uTime * 0.22));
        float ripple2 = groundNoise(wp * 6.5 - vec2(uTime * 0.28, uTime * 0.41));
        diffuseColor.rgb *= 0.86 + 0.14 * ripple1 + 0.08 * ripple2;

        // Lapping: the foam breathes in and out with the same shoreLap the
        // ground shader runs on the sand just across the waterline, so this
        // crest and the sheet washing up the beach are one wave. A wave at
        // its peak drags foam further out to sea (a lower shore).
        float lap = shoreLap(wp, uTime);
        float caps = shoreCaps(wp, uTime);
        float foamMask = smoothstep(mix(0.58, 0.24, lap), 1.0, shore);
        // Breathes in strength as well as width, so a drawn-back wave
        // leaves the shallows blue -- but never below a residual trim, so
        // there is always some surf against the land.
        float foam = foamMask * (0.40 + 0.60 * lap) * smoothstep(0.45, 0.82, caps + foamMask * 0.35);
        foam *= WATER_FOAM_STRENGTH;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), clamp(foam, 0.0, 0.7));

        // Water carries the grid too -- a grid that stops at the coastline
        // is worse than none, since the tiles you most need to count are
        // the ones a unit cannot cross.
        diffuseColor.rgb = mix(
            diffuseColor.rgb,
            ${GRID_COLOR},
            hexGridLine(vTileLocal / uHexRadius, uShowGrid) * ${GRID_STRENGTH}
        );
    }
`;

// Wiring both terrain shaders share: world position for the noise, and
// the tile-local position + per-edge shore flags the shoreline is
// measured from. Tile-local IS the raw vertex position -- the geometry is
// built around the origin and the mesh is translated into place -- so no
// tile-centre uniform is needed.
const SHORE_VERTEX_DECL =
    ' varying vec3 vGroundWorldPos;\n attribute vec3 aShoreA;\n attribute vec3 aShoreB;\n' +
    ' attribute vec3 aTileNormal;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;';

const SHORE_VERTEX_BODY =
    ' vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n' +
    ' vShoreA = aShoreA;\n vShoreB = aShoreB;\n vTileLocal = position.xz;\n' +
    // Into view space, where the fragment shader's own normal lives.
    ' vTileNormal = normalize(normalMatrix * aTileNormal);';

const SHORE_FRAGMENT_DECL =
    ' varying vec3 vGroundWorldPos;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;\n uniform float uHexRadius;\n' +
    ' uniform float uTime;\n uniform float uShowGrid;\n uniform float uShowTextures;';


// The top face is a fan of six triangles and the terrain material is
// flat-shaded, so every slice shades off its own plane and the tile reads
// as six wedges -- flat shading takes the normal from the triangle, so no
// amount of flattening the geometry merges them. aTileNormal carries the
// average of those six planes; shading up-facing fragments with it makes
// the fan one surface. A fragment whose own normal disagrees sharply is on
// a near-vertical side, and keeps its own facet.
const TILE_NORMAL_FRAGMENT = /* glsl */ `
    {
        vec3 tileN = normalize(vTileNormal);
        float topness = smoothstep(0.45, 0.80, dot(normal, tileN));
        normal = normalize(mix(normal, tileN, topness));
    }
`;

export function applyWaterSurface(material: any): void {
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        // The SAME uniform objects every other terrain material gets, so
        // one toggle reaches the whole map. See ViewOptions.
        shader.uniforms.uShowGrid = VIEW_UNIFORMS.showGrid;
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + SHORE_VERTEX_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SHORE_VERTEX_BODY);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + SHORE_FRAGMENT_DECL + '\n' + NOISE_GLSL_CORE)
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAGMENT)
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n' + TILE_NORMAL_FRAGMENT
            );
        // Expose the shader so animateWater can drive uTime each frame.
        material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'water-surface';
}

// Inject the height-banded procedural ground into a terrain
// MeshStandardMaterial. `terrainType` is the UPPERCASE terrain key;
// non-ground types (WATER) are left untouched.
export function applyProceduralGround(material: any, terrainType: string): void {
    if (!GROUND_TYPES.has(terrainType)) return;

    const paletteColor = new THREE.Color(TerrainSystem.getTerrainColor(terrainType));
    const paletteLum = 0.299 * paletteColor.r + 0.587 * paletteColor.g + 0.114 * paletteColor.b;

    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uSandColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('SAND')) };
        shader.uniforms.uGrassColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('GRASS')) };
        shader.uniforms.uForestColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('FOREST')) };
        shader.uniforms.uRockColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('MOUNTAIN')) };
        // Same source as the water material's own color, so the film
        // running up the beach is the sea, not a blue of its own.
        shader.uniforms.uWaterColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('WATER')) };
        shader.uniforms.uPaletteLum = { value: paletteLum };
        shader.uniforms.uSnowStart = { value: 3.2 };
        shader.uniforms.uSnowFull = { value: 4.6 };
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        // Shared by reference across every ground material -- see ViewOptions.
        shader.uniforms.uShowGrid = VIEW_UNIFORMS.showGrid;
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + SHORE_VERTEX_DECL)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SHORE_VERTEX_BODY);

        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n' + SHORE_FRAGMENT_DECL + '\n' +
                ' uniform vec3 uSandColor;\n uniform vec3 uGrassColor;\n uniform vec3 uForestColor;\n' +
                ' uniform vec3 uRockColor;\n uniform vec3 uWaterColor;\n uniform float uPaletteLum;\n' +
                ' uniform float uSnowStart;\n uniform float uSnowFull;\n' + NOISE_GLSL_CORE
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAGMENT)
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n' + TILE_NORMAL_FRAGMENT
            );
        // Expose the shader so animateWater can drive uTime each frame --
        // the beach wash animates on the same clock as the water.
        material.userData.shader = shader;
    };
    // All ground materials share one height-banded program (uniforms
    // differ per material); distinct key from three.js's stock shader.
    material.customProgramCacheKey = () => 'ground-height-banded';
}
