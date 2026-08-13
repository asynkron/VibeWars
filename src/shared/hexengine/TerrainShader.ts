// Procedural ground textures, injected into the terrain's standard
// materials via onBeforeCompile. No texture assets: a world-position
// based value-noise/fbm in the fragment shader paints the ground.
//
// THE NATURAL-GROUND RULE: the fragment's WORLD HEIGHT decides the texture, exactly like
// the terrain ladder that assigns tile types -- sand < grass < forest <
// rock. Tile MATERIAL no longer matters for the look. This is what
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
// shoreline, where the ground shader builds a static sand/gravel/stone band.
// Near-shore water shading belongs to WaterReflectionSystem, never on land.
//
// CONCRETE is the deliberate exception: a building foundation keeps its
// authored surface at any elevation, and a vertical quay suppresses the
// land-side run-up that only makes physical sense on a sloped beach.

import { TerrainSystem } from './TerrainSystem';
import { PERTURB_GLSL } from './PerturbNormalShader';
export { PERTURB_GLSL } from './PerturbNormalShader';
import { MAP_CONFIG } from '../../constants';
import { VIEW_UNIFORMS } from './ViewOptions';
import { SunSystem } from './SunSystem';
import {
    MATERIAL_CALIBRATION_GLSL,
    MATERIAL_CALIBRATION_UNIFORMS,
} from './MaterialCalibration';
import {
    getWaterNormalTexture,
    WATER_NORMAL_GLSL,
    WATER_NORMAL_SIZE,
} from './WaterWaveShader';

const GROUND_TYPES = new Set(['SAND', 'GRASS', 'FOREST', 'MOUNTAIN', 'CONCRETE']);

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

    // Band-limit for procedural detail -- the shader-side analogue of a
    // mipmap. Pass the SAME coordinate a noise term samples with (its
    // frequency already multiplied in); fwidth then measures how many
    // noise cycles one pixel spans, and the fade rolls the term off as it
    // approaches the Nyquist limit. High-frequency grain sampled past
    // that limit cannot resolve -- it can only shimmer and moire.
    // Callers mix the term toward its mean (0.5) by this factor.
    // Thresholds sit ABOVE the textbook Nyquist point on purpose: at 0.35
    // cycles/pixel the fade was already eating the grain at gameplay zoom
    // and the grass went flat. Let it shimmer slightly at the margin and
    // only kill it when it truly cannot resolve.
    float groundDetailFade(vec2 sampleCoord) {
        float fw = max(fwidth(sampleCoord.x), fwidth(sampleCoord.y));
        return 1.0 - smoothstep(0.8, 1.6, fw);
    }
`;

// The terrain's own additions on top of that: everything shoreline, plus
// the richer noises the ground materials build their look from.
const NOISE_GLSL_CORE = NOISE_GLSL_BASE + /* glsl */ `
    // Smooth 3D value noise for rock volumes. Sampling world XYZ instead of
    // only XZ keeps the same mineral structure across tops and steep faces.
    float groundNoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        vec2 zStride = vec2(37.0, 17.0);
        float n000 = groundHash(i.xy + (i.z + 0.0) * zStride);
        float n100 = groundHash(i.xy + vec2(1.0, 0.0) + (i.z + 0.0) * zStride);
        float n010 = groundHash(i.xy + vec2(0.0, 1.0) + (i.z + 0.0) * zStride);
        float n110 = groundHash(i.xy + vec2(1.0, 1.0) + (i.z + 0.0) * zStride);
        float n001 = groundHash(i.xy + (i.z + 1.0) * zStride);
        float n101 = groundHash(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * zStride);
        float n011 = groundHash(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * zStride);
        float n111 = groundHash(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * zStride);
        float z0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
        float z1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
        return mix(z0, z1, u.z);
    }

    float groundFbm3(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
            value += amplitude * groundNoise3(p);
            p = p * 2.03 + vec3(17.31, 9.17, 13.73);
            amplitude *= 0.5;
        }
        return value;
    }

    // Cellular (voronoi) noise: x = distance to the nearest feature point,
    // y = to the second nearest, z = the nearest cell's own hash. x makes
    // round things (pebbles), y - x is ~0 along cell borders (rock cracks),
    // z tints each cell as one object instead of a continuous gradient.
    vec3 groundVoronoi(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float f1 = 8.0;
        float f2 = 8.0;
        float id = 0.0;
        for (int x = -1; x <= 1; x++) {
            for (int yy = -1; yy <= 1; yy++) {
                vec2 g = vec2(float(x), float(yy));
                float h = groundHash(i + g);
                vec2 o = vec2(h, groundHash(i + g + vec2(31.7, 17.3)));
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < f1) { f2 = f1; f1 = d; id = h; }
                else if (d < f2) { f2 = d; }
            }
        }
        return vec3(sqrt(f1), sqrt(f2), id);
    }

    vec3 groundTriplanarWeights(vec3 worldNormal) {
        vec3 weights = pow(abs(worldNormal), vec3(5.0));
        return weights / max(weights.x + weights.y + weights.z, 0.0001);
    }

    vec3 groundTriplanarVoronoi(vec3 p, vec3 worldNormal) {
        vec3 weights = groundTriplanarWeights(worldNormal);
        vec3 fromX = groundVoronoi(p.yz + vec2(11.7, 3.1));
        vec3 fromY = groundVoronoi(p.xz + vec2(5.3, 17.9));
        vec3 fromZ = groundVoronoi(p.xy + vec2(23.4, 7.6));
        return fromX * weights.x + fromY * weights.y + fromZ * weights.z;
    }

    float groundTriplanarFbm(vec3 p, vec3 worldNormal) {
        vec3 weights = groundTriplanarWeights(worldNormal);
        return groundFbm(p.yz + vec2(2.9, 13.7)) * weights.x
            + groundFbm(p.xz + vec2(19.1, 4.2)) * weights.y
            + groundFbm(p.xy + vec2(7.4, 21.3)) * weights.z;
    }

    vec3 groundHeightWorldNormal(
        vec3 worldPos,
        vec3 worldNormal,
        float height,
        float strength
    ) {
        vec3 sigX = dFdx(worldPos);
        vec3 sigY = dFdy(worldPos);
        vec3 r1 = cross(sigY, worldNormal);
        vec3 r2 = cross(worldNormal, sigX);
        float det = dot(sigX, r1);
        if (abs(det) < 0.0000001) return worldNormal;
        vec2 dH = vec2(dFdx(height), dFdy(height)) * strength;
        vec3 gradient = sign(det) * (dH.x * r1 + dH.y * r2);
        return normalize(abs(det) * worldNormal - gradient);
    }

    // Shared lower-rock relief. x = per-block tint/height, y = fissure,
    // z = ridge, w = moss. Both the mountain foothill and the shoreline call
    // this exact function; the coast is no longer a second imitation of rock.
    vec4 groundFoothillRockFields(vec2 worldXZ, vec2 warp) {
        vec3 plate = groundVoronoi(worldXZ * 1.3 + warp * 1.2);
        float crackZone = smoothstep(
            0.62,
            0.86,
            groundFbm(worldXZ * 1.3 + warp * 1.6)
        );
        float crack = (1.0 - smoothstep(0.02, 0.14, plate.y - plate.x))
            * crackZone;
        float ridge = 1.0 - abs(2.0 * groundFbm(worldXZ * 5.0) - 1.0);
        float moss = smoothstep(
            0.40,
            0.75,
            groundFbm(worldXZ * 3.5 + warp * 1.8)
        );
        return vec4(plate.z, crack, ridge, moss);
    }

    float groundFoothillRockHeight(vec4 fields, float mossStrength) {
        return fields.x * 0.5 + fields.z * 0.40 - fields.y * 0.7
            + fields.w * mossStrength * 0.3;
    }

`;

const SHORE_GLSL = /* glsl */ `
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

`;

// Colour and strength of the hex grid overlay. Dark rather than bright so
// it reads as a drawn boundary over both rock and water.
const GRID_COLOR = 'vec3(0.04, 0.05, 0.07)';
const GRID_STRENGTH = '0.8';

const GROUND_FRAGMENT = /* glsl */ `
    {
        vec2 gp = vGroundWorldPos.xz;
        float y = vGroundWorldPos.y;
        gSandSheen = 0.0;
        gRockSheen = 0.0;
        gShoreStone = 0.0;
        gShoreWetness = 0.0;
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

        // What each band is actually WORTH once the bands above it have had
        // their say -- the mix chain at the bottom is
        //   low*(1-toForest)(1-toRock) + forest*toForest(1-toRock)
        //   + rock*toRock
        // and a band whose weight is zero cannot change a single pixel.
        //
        // Every band used to be computed for every fragment and then
        // multiplied away, which is where this shader's time went: a beach
        // pixel paid for the rock band's voronoi (nine cells, eighteen
        // hashes), its crack zones, its ridges and its lichen; a mountain
        // top paid for wind ripples in sand it is two kilometres above.
        // Roughly 250 sin() a fragment, of which a grass pixel needs 68.
        //
        // The gates are exact, not approximate: smoothstep returns exactly
        // 0 and exactly 1 outside its edges, so this skips only terms that
        // were already contributing nothing. Nothing about the picture
        // changes. And the branches are coherent in practice -- a warp of
        // neighbouring fragments is almost always inside one band, and
        // where it straddles a boundary both sides run and it costs what it
        // always did.
        float wRock   = toRock;
        float wForest = toForest * (1.0 - toRock);
        float wLow    = (1.0 - toForest) * (1.0 - toRock);

        // Hoisted OUT of the branches on purpose: groundDetailFade takes
        // fwidth, and a derivative inside control flow some lanes skip is
        // undefined -- the one thing that makes this restructuring unsafe
        // if done carelessly. They are pure gradient math with no hashes in
        // them, so computing them unconditionally costs nothing.
        float fade42 = groundDetailFade(gp * 42.0);
        float fade36 = groundDetailFade(gp * 36.0);
        float fade52 = groundDetailFade(gp * 52.0);

        // Cheap enough to keep in the open, and the texture-toggle path
        // below needs it whether or not the rock band is live.
        float rockLum = dot(uRockColor, vec3(0.299, 0.587, 0.114));

        // Shared domain warp: every band's patchwork is bent through the
        // same low-frequency field, so patches meander organically instead
        // of showing value-noise's axis-aligned blobbiness.
        vec2 warp = vec2(groundFbm(gp * 1.1), groundFbm(gp * 1.1 + vec2(5.2, 1.3))) - 0.5;

        // --- The LOW band: sand, the grass front that closes over it, and
        // the exposed soil along that front. One block, because the grass
        // mask is what mixes sand into grass and both heights feed the same
        // relief term.
        vec3 lowC = vec3(0.0);
        float lowH = 0.0;
        if (wLow > 0.0) {
        // --- Sand: broad patches, fine grain, and WIND RIPPLES -- a
        // noise-warped sine so the ridges run in drifts the way windblown
        // sand actually lies, and they carry most of the band's relief.
        // (The voronoi pebbles this band used to scatter are gone: at map
        // scale they read as strewn potatoes, not stones.)
            // --- Sand -> grass: not a fade but a FRONT. The turf closes in
            // patches (clump noise pushing against the transition height),
            // with a strip of exposed earth where the turf thins out. The
            // window opens at 0.70 -- sand's own base height -- so even
            // sand tiles a step from the grass line carry some of the
            // front, not just the narrow smoothed ramps between tiles.
            //
            // COMPUTED FIRST, because the mask it produces decides which of
            // the two halves below is worth computing at all. Sand and
            // grass are the same band by height, so both used to run on
            // every low fragment -- and on open turf, where grassMask
            // saturates at exactly 1, the entire sand half was multiplied
            // away: patches, grain and ripples, 36 sin() a pixel over more
            // than half the screen. Same skip as the
            // outer bands, one level in, and exact for the same reason.
            float trans = smoothstep(0.70, 0.98, y + wob * 0.10);
            float clump = groundFbm(gp * 4.5 + warp * 3.5);
            float front = trans * 0.75 + clump * 0.45;
            float grassMask = smoothstep(0.52, 0.72, front);
            // Only textured, exposed sand gets the lower roughness below.
            // Its actual highlight direction comes from the ripple height
            // field's perturbed normal, so dune faces glint selectively.
            gSandSheen = (1.0 - grassMask) * wLow * uShowTextures;

            // The strip where the front actually is -- 0 < grassMask < 1 --
            // runs both halves and blends them, exactly as before. Most of
            // the sand band lives here on purpose (see the 0.70 window
            // above); the saving is on open grass, not on the beach.
            vec3 sandC = vec3(0.0);
            vec3 soilC = vec3(0.0);
            float sandH = 0.0;
            float soilBand = 0.0;
            if (grassMask < 1.0) {
                float patches = groundFbm(gp * 1.7 + warp * 2.6);
                // The finest noises are band-limited: past the point where
                // a pixel can resolve them they collapse to their mean
                // instead of shimmering. See groundDetailFade.
                float grain = mix(0.5, groundNoise(gp * 42.0), fade42);
                float rippleS = sin(dot(gp, vec2(9.0, 4.0)) + groundFbm(gp * 1.2) * 9.0) * 0.5 + 0.5;
                sandC = uSandColor * (0.80 + 0.40 * patches) * (0.94 + 0.10 * grain)
                    * (0.90 + 0.14 * rippleS);
                // A continuous soil strip, never a field of individual
                // seeds, pebbles or cones. Fixed neutral-brown endpoints
                // keep this boundary gray-brown even though the beach
                // palette itself is warm peach.
                soilBand = smoothstep(0.18, 0.48, front)
                    * (1.0 - smoothstep(0.72, 0.95, front));
                soilC = mix(vec3(0.18, 0.16, 0.13), vec3(0.30, 0.26, 0.20), clump);
                sandH = patches * 0.20 + grain * 0.06 + rippleS * 0.45;
            }

            // --- Grass: mottled meadow -- dark mossy hollows to worn
            // yellow-green, plus a fine blade-scale shimmer. Mixing between
            // two TINTS of the palette green (not scaling one) is what
            // gives the hue drift real turf has.
            vec3 grassC = vec3(0.0);
            float grassH = 0.0;
            if (grassMask > 0.0) {
                float meadow = groundFbm(gp * 2.6 + warp * 3.0);
                float blades = mix(0.5, groundNoise(gp * 36.0), fade36);
                grassC = mix(uGrassColor * vec3(0.55, 0.62, 0.45),
                             uGrassColor * vec3(1.55, 1.45, 1.00), meadow);
                grassC *= 0.90 + 0.20 * blades;
                // Amplify the rounded TERRAIN slope's relation to the sun,
                // independent of GrassSystem's individual blade shader.
                // Flat ground is neutral; faces leaning toward the sun
                // brighten, while faces leaning away deepen in shade.
                vec3 grassWorldNormal = inverseTransformDirection(normalize(vTileNormal), viewMatrix);
                float grassSunDelta = dot(grassWorldNormal, uSunDirection) - uSunDirection.y;
                grassC *= clamp(1.0 + grassSunDelta * 0.90, 0.68, 1.22);
                grassC = calibrateMaterialColor(
                    grassC,
                    uGrassCalibration,
                    uGrassCalibrationBalance
                );
                grassH = meadow * 0.30 + blades * 0.10;
            }

            // Exposed soil lies over the blended sand-and-grass so it stays
            // confined to the irregular turf edge instead of tinting the
            // whole beach.
            lowC = mix(sandC, grassC, grassMask);
            lowC = mix(lowC, soilC, soilBand * 0.85);

            // Relief for the bump pass, reusing the values the colour was
            // computed from so light and shadow fall exactly where the
            // colour says they should. The soil stays flush with the sand;
            // it is a material transition, not scattered geometry.
            lowH = mix(sandH * 0.6, grassH, grassMask);
        }

        // --- Forest floor: the same recipe pitched darker and mossier.
        vec3 forestC = vec3(0.0);
        float forestH = 0.0;
        if (wForest > 0.0) {
            float moss = groundFbm(gp * 3.2 + warp * 2.2);
            forestC = mix(uForestColor * vec3(0.62, 0.72, 0.52),
                          uForestColor * vec3(1.55, 1.50, 1.10), moss);
            forestC *= 0.88 + 0.24 * groundNoise(gp * 18.0);
            forestH = moss * 0.35;
        }

        // --- Rock. Preserve the established foothill recipe verbatim: its
        // dirty, mossy forest-to-stone transition already works. A separate
        // upperRock mask introduces the smoother brown summit treatment only
        // after the mountain has risen well above that transition.
        vec3 rockC = vec3(0.0);
        float rockH = 0.0;
        float rockAltitude = smoothstep(1.9, 4.8, y);
        vec3 summitRock = vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05);
        vec3 foothillRock = vec3(rockLum * 0.85) * vec3(0.92, 0.80, 0.66);
        if (wRock > 0.0) {
            // Original lower-mountain material.
            vec4 rockFields = groundFoothillRockFields(gp, warp);
            float plateTint = rockFields.x;
            float crack = rockFields.y;
            float ridge = rockFields.z;
            float mossPatch = rockFields.w;
            vec3 rockBase = mix(foothillRock, summitRock, rockAltitude);
            rockC = rockBase * (0.88 + 0.22 * plateTint) * (0.86 + 0.22 * ridge)
                * (0.90 + 0.20 * groundNoise(vec2(gp.x * 1.6 + y * 3.0, gp.y * 1.6)));
            rockC = mix(rockC, rockBase * 0.50, crack * 0.45);
            rockC = mix(rockC, uSandColor * vec3(0.50, 0.44, 0.38), crack * 0.30);
            float stain = smoothstep(0.50, 0.80, groundFbm(gp * 2.0 + warp * 2.5));
            rockC = mix(rockC, uForestColor * vec3(1.30, 1.40, 1.00), mossPatch * 0.60 * (1.0 - rockAltitude));
            rockC = mix(rockC, uSandColor * vec3(0.55, 0.50, 0.44) * (0.85 + 0.30 * plateTint),
                        stain * 0.35 * (1.0 - rockAltitude));
            rockC += vec3(0.45, 0.47, 0.52) * smoothstep(0.90, 0.98, groundNoise(gp * 52.0))
                * fade52 * (1.0 - crack) * rockAltitude;
            rockH = groundFoothillRockHeight(rockFields, 1.0 - rockAltitude);

            // Upper mountain only. Keep the established stone itself and
            // change it gently: warmer mineral balance, softer relief and a
            // little 3D mottling. There is deliberately no replacement top
            // material and no seam mask capable of drawing contour lines.
            float upperRock = smoothstep(3.15, 4.15, y + wob * 0.18);
            vec3 mineralP = vGroundWorldPos * 0.78;
            float mineralBroad = groundFbm3(mineralP * 0.72 + vec3(3.7, 11.2, 6.4));
            float mineralMid = groundFbm3(mineralP * 2.15 + vec3(17.4, 5.1, 23.6));
            float mineralFine = groundNoise3(mineralP * 8.2 + vec3(31.0, 47.0, 59.0));
            vec3 upperC = rockC;
            vec3 warmRock = upperC * vec3(1.07, 0.97, 0.86);
            float warmAmount = 0.34 + mineralBroad * 0.22;
            upperC = mix(upperC, warmRock, warmAmount);
            upperC *= 0.93 + mineralMid * 0.12;
            upperC *= 0.985 + mineralFine * 0.030;

            // Dirt collects broadly in shallow upper faces and creases. Two
            // offset scales keep it stained and broken rather than painting
            // another continuous brown cap over the mountain.
            vec3 mountainWorldNormal = inverseTransformDirection(normalize(vTileNormal), viewMatrix);
            float upperFacing = smoothstep(0.30, 0.78, mountainWorldNormal.y);
            float dirtLarge = groundFbm(gp * 0.64 + warp * 0.92 + vec2(27.6, 8.4));
            float dirtBreakup = groundFbm(gp * 2.7 + warp * 1.8 + vec2(6.1, 31.7));
            float upperDirt = smoothstep(0.54, 0.70,
                dirtLarge + (dirtBreakup - 0.5) * 0.18);
            upperDirt *= mix(0.48, 1.0, upperFacing);
            vec3 dryEarth = mix(
                uSandColor * vec3(0.48, 0.39, 0.29),
                uForestColor * vec3(0.48, 0.39, 0.24),
                dirtBreakup
            );
            upperC = mix(upperC, dryEarth, upperDirt * 0.52);

            // Dark damp staining follows another field so it overlaps dirt
            // imperfectly, giving accumulated grime instead of one flat mask.
            float dampField = groundFbm3(mineralP * 0.86 + vec3(41.0, 7.3, 19.6));
            float dampStain = smoothstep(0.59, 0.76, dampField)
                * smoothstep(0.36, 0.72, upperDirt + upperFacing * 0.35);
            vec3 dampEarth = uForestColor * vec3(0.31, 0.32, 0.20);
            upperC = mix(upperC, dampEarth, dampStain * 0.48);

            // Moss is more present now, but remains dark olive and heavily
            // broken by a second field so it cannot read as lime-green rivers.
            float upperMossField = groundFbm(gp * 0.48 + warp * 0.65 + vec2(4.8, 11.2));
            float upperMossEdge = groundFbm(gp * 2.3 + warp * 1.4 + vec2(17.1, 3.6));
            float upperMoss = smoothstep(0.66, 0.78,
                upperMossField + (upperMossEdge - 0.5) * 0.13);
            upperMoss *= smoothstep(0.36, 0.58, upperMossEdge) * upperFacing;
            upperMoss *= mix(0.55, 1.0, dampStain);
            vec3 upperMossColor = mix(
                uForestColor * vec3(0.56, 0.68, 0.34),
                uGrassColor * vec3(0.36, 0.39, 0.20),
                upperMossEdge * 0.42
            );
            upperC = mix(upperC, upperMossColor, upperMoss * 0.68);

            // Retain the old rock shape but soften it toward the summit;
            // the 3D field adds shallow, continuous surface weathering.
            float upperH = rockH * 0.46
                + mineralBroad * 0.12 + mineralMid * 0.055
                + mineralFine * 0.012 + upperDirt * 0.035
                + upperMoss * 0.075 - dampStain * 0.025;
            rockC = mix(rockC, upperC, upperRock);
            rockH = mix(rockH, upperH, upperRock);
            gRockSheen = wRock * mix(
                mix(0.10, 0.48, rockAltitude),
                0.12,
                upperRock
            ) * uShowTextures;
        }

        // Climb the ladder.
        vec3 band = lowC;
        band = mix(band, forestC, toForest);
        band = mix(band, rockC, toRock);

        // Relief for the bump pass (normal_fragment below): each band's
        // height field reuses the values its color was already computed
        // from, so light and shadow fall exactly where the color says they
        // should -- cracks recessed, pebbles and facets raised. Rock gets
        // by far the strongest relief and continues unchanged to the summit.
        gBumpH = mix(mix(lowH, forestH, toForest), rockH * 1.1, toRock);
        gBumpH *= uShowTextures;

        // Texture toggle. The flat version keeps the height LADDER -- sand
        // still reads as sand and rock as rock -- and drops only the
        // procedural detail on top of it. Turning the bands off too would
        // not be "textures off", it would be "terrain off".
        vec3 flatBand = mix(uSandColor, uGrassColor, toGrass);
        flatBand = mix(flatBand, uForestColor, toForest);
        flatBand = mix(flatBand, mix(foothillRock, summitRock, rockAltitude), toRock);
        band = mix(flatBand, band, uShowTextures);

        // Building foundations are terrain, but they are not part of the
        // natural height ladder above. Their inherited world height may be
        // sand-low or mountain-high; neither is allowed to repaint concrete
        // as beach, turf or rock. Override only the base surface here, then
        // continue through the shared vertex-darkening, shoreline wash and
        // grid code below so a concrete quay meets water exactly like land.
        if (uIsConcrete > 0.5) {
            gSandSheen = 0.0;
            gRockSheen = 0.0;
            float concreteMottle = groundFbm(gp * 2.6);
            float poreFade = groundDetailFade(gp * 38.0);
            float pores = mix(0.5, groundNoise(gp * 38.0), poreFade);
            float aggregate = smoothstep(0.86, 0.98, pores);
            float hairline = 1.0 - smoothstep(
                0.0,
                0.035,
                abs(groundNoise(gp * 1.45 + vec2(3.7, 8.1)) - 0.5)
            );
            vec3 concrete = uConcreteColor * (0.84 + 0.24 * concreteMottle);
            concrete = mix(concrete, uConcreteColor * 0.56, hairline * 0.30);
            concrete = mix(concrete, vec3(0.64, 0.63, 0.59), aggregate * 0.22);
            band = mix(uConcreteColor, concrete, uShowTextures);
            gBumpH = (concreteMottle * 0.16 + aggregate * 0.10 - hairline * 0.18)
                * uShowTextures;
        }

        // Vertex color as a darkening signal relative to this vertex's OWN
        // pristine luminance, baked at build time: untouched tiles pass
        // exactly 1.0 whatever color the map generator gave them, and only
        // crater scorch (which darkens the live color after build) pulls
        // the ratio down. Dividing by the terrain TYPE's palette luminance
        // instead is what made perlin sand tiles -- whose colors are
        // lerped toward the darker grass band -- render dimmer than the
        // grass tiles next to them, when both showed the same bands.
        float vLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        band *= clamp(vLum / max(vPristineLum, 0.001), 0.35, 1.05);

        // ---- Rocky shoreline -----------------------------------------
        // shore is one at the real water-facing edge and falls inland.
        // Low-frequency noise tears up both limits, avoiding a clean ribbon.
        // Crucially, this is LAND only: no blue sheet and no white animated
        // foam are painted over it. Shallow water lives on the water mesh.
        float shore = shoreBand(vTileLocal / uHexRadius, vShoreA, vShoreB, 1.06);
        if (shore > 0.001 && uIsConcrete < 0.5) {
            vec3 shoreWorldNormal = normalize(cross(
                dFdx(vGroundWorldPos),
                dFdy(vGroundWorldPos)
            ));

            // Original shoreline shader: large triplanar masses, broken
            // crevices, weathered facets and its own warm mineral palette.
            float macro = groundFbm3(vGroundWorldPos * 0.42 + vec3(3.8, 7.1, 11.6));
            float coastWarp = macro - 0.5;
            float coast = smoothstep(-0.045, 0.15, shore + coastWarp * 0.18);

            vec3 rockWarp = vec3(
                groundNoise3(vGroundWorldPos * 0.71 + vec3(3.1, 11.7, 5.4)),
                groundNoise3(vGroundWorldPos * 0.71 + vec3(17.3, 2.8, 9.6)),
                groundNoise3(vGroundWorldPos * 0.71 + vec3(7.9, 19.4, 1.2))
            ) - 0.5;
            vec3 rockCoord = vGroundWorldPos * 1.12 + rockWarp * 0.92;
            vec3 rockCell = groundTriplanarVoronoi(
                rockCoord,
                shoreWorldNormal
            );
            float medium = groundTriplanarFbm(
                vGroundWorldPos * 3.65 + rockWarp * 1.8,
                shoreWorldNormal
            );
            float grain = groundNoise3(
                vGroundWorldPos * 11.0 + vec3(12.4, 4.7, 18.1)
            );

            float blockCrown = 1.0 - smoothstep(0.10, 0.79, rockCell.x);
            float cavityLine = 1.0 - smoothstep(
                0.035,
                0.145,
                rockCell.y - rockCell.x
            );
            float cavityBreak = smoothstep(
                0.43,
                0.62,
                medium * 0.62 + grain * 0.38
            );
            float cavity = cavityLine * cavityBreak;
            float facet = smoothstep(
                0.48,
                0.74,
                blockCrown * 0.50 + medium * 0.30 + macro * 0.20
            );

            float shoreRockHeight = macro * 0.30 + blockCrown * 0.48
                + medium * 0.14 + facet * 0.15 + grain * 0.025
                - cavity * 0.54;
            vec3 rockNormal = groundHeightWorldNormal(
                vGroundWorldPos,
                shoreWorldNormal,
                shoreRockHeight,
                0.74
            );
            float rockSun = smoothstep(
                -0.28,
                0.76,
                dot(rockNormal, normalize(uSunDirection))
            );

            vec3 stone = mix(
                vec3(0.18, 0.17, 0.155),
                vec3(0.43, 0.40, 0.35),
                clamp(rockCell.z * 0.16 + macro * 0.43 + medium * 0.41, 0.0, 1.0)
            );
            stone = mix(stone, vec3(0.60, 0.56, 0.49), facet * rockSun * 0.30);
            stone *= mix(0.72, 1.10, rockSun);
            stone *= 0.94 + grain * 0.11;
            // Cavities should read as shaded stone, not soot-black holes.
            // Preserve the local mineral hue while darkening it moderately.
            stone = mix(stone, stone * vec3(0.48, 0.46, 0.43), cavity * 0.68);

            // Keep the coastline's original mask exactly. Only its inland
            // material changes from sand to grass below.
            float rockCoverage = smoothstep(
                0.08,
                0.38,
                shore * 0.78 + macro * 0.27 + medium * 0.08
            );

            vec4 mountainRoughnessFields = groundFoothillRockFields(gp, warp);
            // The coast transition is explicitly GRASS -> ROCK. Low shoreline
            // tiles are classified as sand by terrain height, so mixing from
            // band here preserved a pink sand strip. Rebuild the established
            // grass material at the coast and use it as the only inland side.
            float coastMeadow = groundFbm(gp * 2.6 + warp * 3.0);
            float coastBlades = mix(0.5, groundNoise(gp * 36.0), fade36);
            vec3 coastGrass = mix(
                uGrassColor * vec3(0.55, 0.62, 0.45),
                uGrassColor * vec3(1.55, 1.45, 1.00),
                coastMeadow
            );
            coastGrass *= 0.90 + 0.20 * coastBlades;
            vec3 coastGrassWorldNormal = inverseTransformDirection(
                normalize(vTileNormal),
                viewMatrix
            );
            float coastGrassSunDelta = dot(coastGrassWorldNormal, uSunDirection)
                - uSunDirection.y;
            coastGrass *= clamp(1.0 + coastGrassSunDelta * 0.90, 0.68, 1.22);
            coastGrass = calibrateMaterialColor(
                coastGrass,
                uGrassCalibration,
                uGrassCalibrationBalance
            );
            vec3 beach = mix(coastGrass, stone, rockCoverage);

            // The exposed rock mass above the water gets the wet material,
            // not merely a thin strip at the waterline. rockCoverage excludes
            // the inland earth pockets, so soil remains dry.
            float exposedRockWetness = rockCoverage;
            vec3 wetStone = pow(max(beach, vec3(0.0)), vec3(1.18))
                * vec3(0.70, 0.73, 0.75);
            beach = mix(beach, wetStone, exposedRockWetness * 0.92);

            // Preserve the coastline's original final mask so its water-facing
            // edge remains untouched. Only the inland side inside beach is new.
            band = mix(band, beach, coast * 0.97);
            // Combination, not replacement: preserve the shoreline's whole
            // height field and add the mountain's full established roughness
            // into the lighting normal. This changes relief only, never color.
            float mountainRoughness = groundFoothillRockHeight(
                mountainRoughnessFields,
                1.0
            );
            gBumpH = mix(
                gBumpH,
                shoreRockHeight + mountainRoughness,
                coast
            );
            gSandSheen *= 1.0 - coast * 0.72;
            gShoreStone = coast * uShowTextures;
            gShoreWetness = coast * exposedRockWetness * uShowTextures;
        }

        // Grid last, so it draws over the beach wash rather than under it.
        band = mix(band, ${GRID_COLOR}, hexGridLine(vTileLocal / uHexRadius, uShowGrid) * ${GRID_STRENGTH});

        diffuseColor.rgb = band;
    }
`;

// Flat water surface. Shore wash and foam live exclusively in the ground
// shader above; putting a second procedural band on the water made the lake
// edge look like two unrelated effects stacked across the same boundary.
const WATER_FRAGMENT = /* glsl */ `
    {
        // Flat diagnostic baseline: reflection supplies all surface detail.
        // Do not paint procedural ripples into the water body while the
        // cloud and planar projections are being judged.

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
    ' attribute float aWaterPin;\n' +
    ' attribute vec3 aTileNormal;\n attribute vec2 aTileLocal;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;\n' +
    ' attribute float aPristineLum;\n varying float vPristineLum;';

const SHORE_VERTEX_BODY =
    ' vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n' +
    ' vShoreA = aShoreA;\n vShoreB = aShoreB;\n vTileLocal = aTileLocal;\n' +
    ' vPristineLum = aPristineLum;\n' +
    // Into view space, where the fragment shader's own normal lives.
    ' vTileNormal = normalize(normalMatrix * aTileNormal);';

const SHORE_FRAGMENT_DECL =
    ' varying vec3 vGroundWorldPos;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;\n uniform float uHexRadius;\n' +
    ' uniform float uShowGrid;\n uniform float uShowTextures;\n' +
    ' varying float vPristineLum;';


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

// Ground relief: bend the merged tile normal by the height field the color
// pass stored in gBumpH (zeroed when textures are toggled off), so cracks,
// pebbles and grass clumps actually catch the sun instead of being painted
// shading. Runs AFTER the fan merge -- the relief must ride on the single
// surface, not fight it.
const GROUND_NORMAL_FRAGMENT = TILE_NORMAL_FRAGMENT + /* glsl */ `
    {
        float groundReliefStrength = mix(0.22, 0.42, gShoreStone);
        normal = groundPerturbNormal(
            vGroundWorldPos,
            normal,
            gBumpH,
            groundReliefStrength
        );
    }
`;

const GROUND_SURFACE_ROUGHNESS_FRAGMENT = /* glsl */ `
    // Dry dune sand is still broadly rough, but not perfectly chalk-matte.
    // Lowering roughness only for the procedural sand band lets the normal
    // perturbation place a soft glint on dune faces aligned with the sun.
    roughnessFactor = mix(roughnessFactor, 0.52, gSandSheen);
    // Rock uses the same light-driven response, weighted toward clean
    // higher-altitude stone. Cracks and ridges supply its changing normal.
    roughnessFactor = mix(roughnessFactor, 0.56, gRockSheen);
    // Coast stone must not sparkle. Keep the whole exposed/submerged rock at
    // maximum roughness; wetness changes diffuse contrast only.
    roughnessFactor = mix(roughnessFactor, 1.0, gShoreStone);
`;

const GROUND_SURFACE_METALNESS_FRAGMENT = /* glsl */ `
    // Natural coast stone has no metallic response. Explicitly zero it for
    // the whole coast mesh, including the vertical part below water level.
    metalnessFactor = mix(metalnessFactor, 0.0, gShoreStone);
`;

const GROUND_CAST_SHADOW_FRAGMENT = /* glsl */ `
    // Three's shadow map already removes directional light, but the strong
    // ambient fill remains untouched and makes cast tree/building shadows
    // read too pale. Sample the same shadow mask and reduce only that ambient
    // contribution; fully lit ground remains byte-for-byte unchanged.
    float groundCastShadow = getShadowMask();
    reflectedLight.indirectDiffuse *= mix(0.72, 1.0, groundCastShadow);
`;

// The reference shader derives its small-scale surface normal from the same
// four waternormals.jpg samples used by three.js Water. The water mesh itself
// stays planar; all visible ripple detail comes from this normal field.
const WATER_NORMAL_FRAGMENT = /* glsl */ `
    {
        vec4 noise = getNoise(vGroundWorldPos.xz * size);
        vec3 surfaceNormal = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));
        normal = normalize(mat3(viewMatrix) * surfaceNormal);
    }
`;

export function applyWaterSurface(material: any): void {
    // The merged reflector is the one visible water surface. Keep these tile
    // meshes as geometry/raycast proxies only; rendering both produced two
    // offset shoreline silhouettes once their coast vertices were pinned.
    material.colorWrite = false;
    material.depthWrite = false;

    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.time = { value: 0 };
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        shader.uniforms.size = { value: WATER_NORMAL_SIZE };
        shader.uniforms.normalSampler = { value: getWaterNormalTexture() };
        // The SAME uniform objects every other terrain material gets, so
        // one toggle reaches the whole map. See ViewOptions.
        shader.uniforms.uShowGrid = VIEW_UNIFORMS.showGrid;
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                '#include <common>\n' + SHORE_VERTEX_DECL
            )
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n' + SHORE_VERTEX_BODY
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n' + SHORE_FRAGMENT_DECL + '\n' +
                NOISE_GLSL_CORE + PERTURB_GLSL + WATER_NORMAL_GLSL + SHORE_GLSL
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAGMENT)
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n' + WATER_NORMAL_FRAGMENT
            );
        material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'water-surface-flat-proxy-v3';
}

// Inject the height-banded procedural ground into a terrain
// MeshStandardMaterial. `terrainType` is the UPPERCASE terrain key;
// non-ground types (WATER) are left untouched.
export function applyProceduralGround(material: any, terrainType: string): void {
    if (!GROUND_TYPES.has(terrainType)) return;

    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uSandColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('SAND')) };
        shader.uniforms.uGrassColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('GRASS')) };
        shader.uniforms.uForestColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('FOREST')) };
        shader.uniforms.uRockColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('MOUNTAIN')) };
        shader.uniforms.uConcreteColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('CONCRETE')) };
        shader.uniforms.uIsConcrete = { value: terrainType === 'CONCRETE' ? 1 : 0 };
        shader.uniforms.uSunDirection = { value: SunSystem.getDirection() };
        shader.uniforms.uGrassCalibration = MATERIAL_CALIBRATION_UNIFORMS.grass.parameters;
        shader.uniforms.uGrassCalibrationBalance = MATERIAL_CALIBRATION_UNIFORMS.grass.balance;
        shader.uniforms.uBeachCalibration = MATERIAL_CALIBRATION_UNIFORMS.beach.parameters;
        shader.uniforms.uBeachCalibrationBalance = MATERIAL_CALIBRATION_UNIFORMS.beach.balance;
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
                ' uniform vec3 uRockColor;\n uniform vec3 uConcreteColor;\n' +
                ' uniform float uIsConcrete;\n uniform vec3 uSunDirection;\n' +
                ' uniform vec4 uGrassCalibration;\n uniform vec3 uGrassCalibrationBalance;\n' +
                ' uniform vec4 uBeachCalibration;\n uniform vec3 uBeachCalibrationBalance;\n' +
                // Written by the color pass, read by the bump pass below --
                // GLSL globals are how the two injection points share state.
                ' float gBumpH;\n float gSandSheen;\n float gRockSheen;\n' +
                ' float gShoreStone;\n float gShoreWetness;\n' +
                MATERIAL_CALIBRATION_GLSL + NOISE_GLSL_CORE + PERTURB_GLSL + SHORE_GLSL
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAGMENT)
            .replace(
                '#include <roughnessmap_fragment>',
                '#include <roughnessmap_fragment>\n' + GROUND_SURFACE_ROUGHNESS_FRAGMENT
            )
            .replace(
                '#include <metalnessmap_fragment>',
                '#include <metalnessmap_fragment>\n' + GROUND_SURFACE_METALNESS_FRAGMENT
            )
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n' + GROUND_NORMAL_FRAGMENT
            )
            .replace(
                '#include <shadowmap_pars_fragment>',
                '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>'
            )
            .replace(
                '#include <lights_fragment_end>',
                '#include <lights_fragment_end>\n' + GROUND_CAST_SHADOW_FRAGMENT
            );
        material.userData.shader = shader;
    };
    // All ground materials share one height-banded program (uniforms
    // differ per material); distinct key from three.js's stock shader.
    material.customProgramCacheKey = () => 'ground-height-banded-v14-matte-coast';
}
