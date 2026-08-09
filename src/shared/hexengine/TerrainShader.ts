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
import {
    createGerstnerUniforms,
    GERSTNER_WAVE_GLSL,
    getWaterNormalTexture,
    WATER_NORMAL_GLSL,
} from './WaterWaveShader';

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

`;

// Screen-space bump (Blinn's perturb-normal-without-tangents, same scheme
// as three.js's bumpmap chunk, but fed a procedural height instead of a
// texture). Positions and normal move through WORLD space so the same
// height field bends top faces and cliff sides alike; the result comes
// back in view space, where the lighting lives. Exported so the
// decorations (trees, rocks) relieve their surfaces with the same tool.
export const PERTURB_GLSL = /* glsl */ `
    vec3 groundPerturbNormal(vec3 worldPos, vec3 viewNormal, float bumpH, float scale) {
        // Distance/angle band-limit for ALL relief, in one place: fade the
        // bump out as one pixel grows to cover the features it encodes.
        // Far tiles and grazing slopes are exactly where per-pixel bump
        // turns into interference shimmer, and exactly where it stops
        // adding anything a real mip chain would have kept.
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

    // Shoreline surge phase, 0 = drawn back, 1 = wave at its peak. Both
    // position and noise offset the rhythm along the beach so waves break at
    // different moments down the coast. This LAND effect is intentionally
    // independent of the open-water wave implementation.
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
        gWaterFilm = 0.0;
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

        // What each band is actually WORTH once the bands above it have had
        // their say -- the mix chain at the bottom is
        //   low*(1-toForest)(1-toRock)(1-toSnow) + forest*toForest(1-toRock)(1-toSnow)
        //   + rock*toRock(1-toSnow) + snow*toSnow
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
        float wSnow   = toSnow;
        float wRock   = toRock * (1.0 - toSnow);
        float wForest = toForest * (1.0 - toRock) * (1.0 - toSnow);
        float wLow    = (1.0 - toForest) * (1.0 - toRock) * (1.0 - toSnow);

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
        // of showing value-noise's axis-aligned blobbiness. Under full snow
        // nothing it feeds is visible.
        vec2 warp = vec2(0.0);
        if (wSnow < 1.0) {
            warp = vec2(groundFbm(gp * 1.1), groundFbm(gp * 1.1 + vec2(5.2, 1.3))) - 0.5;
        }

        // --- The LOW band: sand, the grass front that closes over it, and
        // the straw and tufts along that front. One block, because the
        // grass mask is what mixes sand into grass and both heights feed
        // the same relief term.
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
            // a fringe of dry straw runs ahead of every patch edge, and
            // lone tufts stand out on the open sand -- the way grassland
            // actually gives out into beach, instead of one airbrushed
            // gradient. The window opens at 0.70 -- sand's own base height
            // -- so even sand tiles a step from the grass line carry some
            // of the front, not just the narrow smoothed ramps between
            // tiles.
            //
            // COMPUTED FIRST, because the mask it produces decides which of
            // the two halves below is worth computing at all. Sand and
            // grass are the same band by height, so both used to run on
            // every low fragment -- and on open turf, where grassMask
            // saturates at exactly 1, the entire sand half was multiplied
            // away: patches, grain, ripples and the tuft voronoi, 54 sin()
            // a pixel over more than half the screen. Same skip as the
            // outer bands, one level in, and exact for the same reason.
            float trans = smoothstep(0.70, 0.98, y + wob * 0.10);
            float clump = groundFbm(gp * 4.5 + warp * 3.5);
            float front = trans * 0.75 + clump * 0.45;
            float grassMask = smoothstep(0.52, 0.72, front);

            // The strip where the front actually is -- 0 < grassMask < 1 --
            // runs both halves and blends them, exactly as before. Most of
            // the sand band lives here on purpose (see the 0.70 window
            // above); the saving is on open grass, not on the beach.
            vec3 sandC = vec3(0.0);
            vec3 dryC = vec3(0.0);
            float sandH = 0.0;
            float straw = 0.0;
            float tufts = 0.0;
            if (grassMask < 1.0) {
                float patches = groundFbm(gp * 1.7 + warp * 2.6);
                // The finest noises are band-limited: past the point where
                // a pixel can resolve them they collapse to their mean
                // instead of shimmering. See groundDetailFade.
                float grain = mix(0.5, groundNoise(gp * 42.0), fade42);
                float rippleS = sin(dot(gp, vec2(9.0, 4.0)) + groundFbm(gp * 1.2) * 9.0) * 0.5 + 0.5;
                sandC = uSandColor * (0.80 + 0.40 * patches) * (0.94 + 0.10 * grain)
                    * (0.90 + 0.14 * rippleS);
                straw = smoothstep(0.28, 0.56, front) * (1.0 - grassMask);
                vec3 tuft = groundVoronoi(gp * 8.0 + warp * 2.0);
                tufts = (1.0 - smoothstep(0.12, 0.24, tuft.x)) * step(0.45, tuft.z)
                    * smoothstep(0.02, 0.25, trans) * (1.0 - grassMask);
                dryC = mix(uSandColor * vec3(0.95, 0.88, 0.62),
                           uGrassColor * vec3(1.60, 1.45, 0.70), 0.45)
                    * (0.85 + 0.30 * clump);
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
                grassH = meadow * 0.30 + blades * 0.10;
            }

            // Composed in the ORIGINAL order: the dry fringe goes over the
            // blended sand-and-grass, not over the sand alone. Nesting the
            // two mixes the other way round is not the same arithmetic in
            // the transition strip, and the strip is the only place either
            // term is visible.
            lowC = mix(sandC, grassC, grassMask);
            lowC = mix(lowC, dryC, max(straw * 0.85, tufts * 0.9));

            // Relief for the bump pass, reusing the values the colour was
            // computed from so light and shadow fall exactly where the
            // colour says they should. Tufts and the straw fringe stand a
            // little proud of the sand.
            lowH = mix(sandH * 0.6 + tufts * 0.55 + straw * 0.15, grassH, grassMask);
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

        // --- Rock: mostly UNBROKEN stone. Cracks live only in patchy
        // fracture zones (crackZone gates them off elsewhere), because a
        // real mountainside is plate on plate of solid rock with the odd
        // seam -- not a crazed glaze. And the band matures with altitude:
        // bare is 0 where the rock has just climbed out of the forest --
        // dark gray, mossy, dirt-stained -- and 1 high up where the stone
        // finally stands clean. That reads as forest -> dark mossy rock ->
        // bare gray, instead of a hard green-to-gray seam.
        vec3 rockC = vec3(0.0);
        float rockH = 0.0;
        if (wRock > 0.0) {
            vec3 plate = groundVoronoi(gp * 1.3 + warp * 1.2);
            // High threshold on purpose: deep seams are fine, MANY seams
            // are not -- only the strongest patches of the zone field crack
            // at all, so most faces stay whole.
            float crackZone = smoothstep(0.62, 0.86, groundFbm(gp * 1.3 + warp * 1.6));
            float crack = (1.0 - smoothstep(0.02, 0.14, plate.y - plate.x)) * crackZone;
            float ridge = 1.0 - abs(2.0 * groundFbm(gp * 5.0) - 1.0);
            float bare = smoothstep(1.9, 3.6, y);
            vec3 rockBase = vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05) * mix(0.52, 1.0, bare);
            rockC = rockBase * (0.88 + 0.22 * plate.z) * (0.86 + 0.22 * ridge)
                * (0.90 + 0.20 * groundNoise(vec2(gp.x * 1.6 + y * 3.0, gp.y * 1.6)));
            // Cracks: shadowed, and floored with dirt rather than black.
            rockC = mix(rockC, rockBase * 0.50, crack * 0.45);
            rockC = mix(rockC, uSandColor * vec3(0.50, 0.44, 0.38), crack * 0.30);
            // Life on the stone -- moss/lichen carrying the FOREST's tone
            // up over the transition zone, dirt staining with it, both gone
            // by the time the rock is bare.
            float stain = smoothstep(0.50, 0.80, groundFbm(gp * 2.0 + warp * 2.5));
            float mossPatch = smoothstep(0.40, 0.75, groundFbm(gp * 3.5 + warp * 1.8));
            rockC = mix(rockC, uForestColor * vec3(1.30, 1.40, 1.00), mossPatch * 0.60 * (1.0 - bare));
            rockC = mix(rockC, uSandColor * vec3(0.55, 0.50, 0.44) * (0.85 + 0.30 * plate.z),
                        stain * 0.35 * (1.0 - bare));
            rockC += vec3(0.45, 0.47, 0.52) * smoothstep(0.90, 0.98, groundNoise(gp * 52.0))
                * fade52 * (1.0 - crack) * bare;
            rockH = plate.z * 0.5 + ridge * 0.40 - crack * 0.7 + mossPatch * (1.0 - bare) * 0.3;
        }

        // Snow's one noise serves both its colour and its relief, so it is
        // drawn once here rather than twice down the chain.
        vec3 snowC = vec3(0.0);
        float snowN = 0.0;
        if (wSnow > 0.0) {
            snowN = groundNoise(gp * 12.0);
            snowC = vec3(0.92, 0.95, 0.99) * (0.92 + 0.08 * snowN);
        }

        // Climb the ladder.
        vec3 band = lowC;
        band = mix(band, forestC, toForest);
        band = mix(band, rockC, toRock);
        band = mix(band, snowC, toSnow);

        // Relief for the bump pass (normal_fragment below): each band's
        // height field reuses the values its color was already computed
        // from, so light and shadow fall exactly where the color says they
        // should -- cracks recessed, pebbles and facets raised. Rock gets
        // by far the strongest relief; snow softens everything under it.
        gBumpH = mix(mix(lowH, forestH, toForest), rockH * 1.1, toRock);
        gBumpH = mix(gBumpH, 0.06 * snowN, toSnow);
        gBumpH *= uShowTextures;

        // Texture toggle. The flat version keeps the height LADDER -- sand
        // still reads as sand and rock as rock -- and drops only the
        // procedural detail on top of it. Turning the bands off too would
        // not be "textures off", it would be "terrain off".
        vec3 flatBand = mix(uSandColor, uGrassColor, toGrass);
        flatBand = mix(flatBand, uForestColor, toForest);
        flatBand = mix(flatBand, vec3(rockLum * 1.7) * vec3(0.97, 1.0, 1.05), toRock);
        flatBand = mix(flatBand, vec3(0.92, 0.95, 0.99), toSnow);
        band = mix(flatBand, band, uShowTextures);

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
            // between waves reads as the effect switching off. The withdrawn
            // limit is 0.82 because the crest itself extends 0.17 farther
            // seaward: 0.82 + 0.17 = 0.99, so the complete white line always
            // remains inside the land tile instead of being clipped away at
            // shore == 1. The 0.82..1.0 remainder stays as visible blue film.
            float reach = mix(0.82, 0.62, lap);
            float sheet = smoothstep(reach, min(reach + 0.12, 1.0), shore);
            // Flatten over the whole remaining run to the coast rather than
            // switching normal at the sheet's inner edge. This feathers the
            // sloped land geometry into the flat lake normal.
            gWaterFilm = smoothstep(reach, 1.0, shore);

            // What runs up the sand is WATER, not foam: a film carrying the
            // sea's own blue with the sand showing through it, so the beach
            // reads as the sea stretching a little way up the land.
            // Whitening the whole sheet instead just draws a pale ribbon
            // winding along the coast.
            // The little run-up strip deliberately has no planar reflection,
            // but raw water albedo is darker than the reflected lake beside
            // it. Ease toward the lake's average daylight value at the outer
            // edge so the two separate meshes do not meet as a hard navy line.
            float waterEdgeBlend = smoothstep(reach + 0.04, 1.0, shore);
            vec3 filmWater = mix(uWaterColor, uWaterColor * 1.36, waterEdgeBlend);
            band = mix(band, filmWater, sheet);

            // White surf rides the FRONT of that film -- a band at the top
            // of its run, with the blue trailing back down to the sea
            // behind it. front is 0 at the leading edge and grows
            // seaward, so the surf band sits just inside the water's reach.
            float front = shore - reach;
            float caps = shoreCaps(gp, uTime);
            // A slightly broader crest than the old 0.13..-0.05 strip. It
            // remains a line rather than turning the whole wash white.
            float surf = smoothstep(0.17, 0.025, front) * smoothstep(-0.07, 0.025, front);
            // Churn breaks up the intensity without punching holes through
            // the whole crest. Keeping a brighter floor is what makes the
            // slightly wider white line read continuously along the coast.
            surf *= mix(0.35, 1.0, smoothstep(0.30, 0.70, caps + 0.30))
                * mix(0.65, 1.0, smoothstep(0.0, 0.45, lap));

            // A soft shader-local halo keeps the foam luminous while the
            // expensive full-screen bloom toggle is off. The HDR-white core
            // deliberately crosses render.ts's bloom threshold when that
            // pass is enabled; ordinary sunlit sand remains below it.
            float surfHalo = (1.0 - smoothstep(0.07, 0.25, abs(front - 0.035)))
                * smoothstep(0.18, 0.62, caps + 0.22)
                * mix(0.45, 1.0, lap);
            band += vec3(0.22, 0.27, 0.34) * surfHalo;
            band = mix(band, vec3(1.62, 1.69, 1.78), clamp(surf, 0.0, 0.84));

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
    ' attribute vec3 aTileNormal;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;\n' +
    ' attribute float aPristineLum;\n varying float vPristineLum;';

const SHORE_VERTEX_BODY =
    ' vGroundWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n' +
    ' vShoreA = aShoreA;\n vShoreB = aShoreB;\n vTileLocal = position.xz;\n' +
    ' vPristineLum = aPristineLum;\n' +
    // Into view space, where the fragment shader's own normal lives.
    ' vTileNormal = normalize(normalMatrix * aTileNormal);';

// Sean Bradley's reference plane is authored in XY and then rotated onto the
// water. Our tile meshes are authored directly in XZ, so map world XZ into the
// reference plane, run its three calls unchanged, and map the displacement
// back. The minus sign matches the merged Reflector plane's -90 degree X
// rotation, keeping both surfaces coincident.
const WATER_GERSTNER_VERTEX_BODY = /* glsl */ `
    vec3 waterWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 gerstnerPosition = vec3(waterWorldPosition.x, -waterWorldPosition.z, waterWorldPosition.y);
    vec3 gerstnerOffset = vec3(0.0);
    gerstnerOffset += GerstnerWave(waveA, gerstnerPosition);
    gerstnerOffset += GerstnerWave(waveB, gerstnerPosition);
    gerstnerOffset += GerstnerWave(waveC, gerstnerPosition);
    gerstnerOffset *= 0.035 * (1.0 - aWaterPin);
    transformed += vec3(gerstnerOffset.x, gerstnerOffset.z, -gerstnerOffset.y);
`;

const SHORE_FRAGMENT_DECL =
    ' varying vec3 vGroundWorldPos;\n varying vec3 vShoreA;\n varying vec3 vShoreB;\n' +
    ' varying vec2 vTileLocal;\n varying vec3 vTileNormal;\n uniform float uHexRadius;\n' +
    ' uniform float uTime;\n uniform float uShowGrid;\n uniform float uShowTextures;\n' +
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
        vec3 groundBaseNormal = normal;
        vec3 flatWaterNormal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
        normal = groundPerturbNormal(vGroundWorldPos, normal, gBumpH, 0.22);
        normal = normalize(mix(normal, flatWaterNormal, gWaterFilm));
    }
`;

// Match the film to the water material's surface response as well as its
// colour. These run after GROUND_FRAGMENT has written gWaterFilm and before
// lighting consumes roughnessFactor / metalnessFactor.
const GROUND_WATER_ROUGHNESS_FRAGMENT = /* glsl */ `
    roughnessFactor = mix(roughnessFactor, 0.68, gWaterFilm);
`;

const GROUND_WATER_METALNESS_FRAGMENT = /* glsl */ `
    metalnessFactor = mix(metalnessFactor, 0.0, gWaterFilm);
`;

// The reference shader derives its small-scale surface normal from the same
// four waternormals.jpg samples used by three.js Water. Geometry displacement
// comes from the exact Gerstner vertex function above.
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
        Object.assign(shader.uniforms, createGerstnerUniforms());
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uHexRadius = { value: MAP_CONFIG.HEX_RADIUS };
        shader.uniforms.size = { value: 1 };
        shader.uniforms.normalSampler = { value: getWaterNormalTexture() };
        // The SAME uniform objects every other terrain material gets, so
        // one toggle reaches the whole map. See ViewOptions.
        shader.uniforms.uShowGrid = VIEW_UNIFORMS.showGrid;
        shader.uniforms.uShowTextures = VIEW_UNIFORMS.showTextures;
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                '#include <common>\n' + SHORE_VERTEX_DECL + '\n' + GERSTNER_WAVE_GLSL
            )
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n' + SHORE_VERTEX_BODY + '\n' + WATER_GERSTNER_VERTEX_BODY
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
        // Expose the shader so animateWater can drive uTime each frame.
        material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'water-surface-sean-bradley-gerstner';
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
        // Same source as the water material's own color, so the film
        // running up the beach is the sea, not a blue of its own.
        shader.uniforms.uWaterColor = { value: new THREE.Color(TerrainSystem.getTerrainColor('WATER')) };
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
                ' uniform vec3 uRockColor;\n uniform vec3 uWaterColor;\n' +
                ' uniform float uSnowStart;\n uniform float uSnowFull;\n' +
                // Written by the color pass, read by the bump pass below --
                // GLSL globals are how the two injection points share state.
                ' float gBumpH;\n float gWaterFilm;\n' +
                NOISE_GLSL_CORE + PERTURB_GLSL + SHORE_GLSL
            )
            .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAGMENT)
            .replace(
                '#include <roughnessmap_fragment>',
                '#include <roughnessmap_fragment>\n' + GROUND_WATER_ROUGHNESS_FRAGMENT
            )
            .replace(
                '#include <metalnessmap_fragment>',
                '#include <metalnessmap_fragment>\n' + GROUND_WATER_METALNESS_FRAGMENT
            )
            .replace(
                '#include <normal_fragment_begin>',
                '#include <normal_fragment_begin>\n' + GROUND_NORMAL_FRAGMENT
            );
        // Expose the shader so animateWater can drive uTime each frame --
        // the beach wash animates on the same clock as the water.
        material.userData.shader = shader;
    };
    // All ground materials share one height-banded program (uniforms
    // differ per material); distinct key from three.js's stock shader.
    material.customProgramCacheKey = () => 'ground-height-banded';
}
