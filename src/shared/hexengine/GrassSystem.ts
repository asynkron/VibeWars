import { MAP_CONFIG } from '../../constants';
import { getGameStateOrNull } from '../../systems/gameStateStore';
import { viewOptions } from './ViewOptions';

// Real grass blades on grass tiles, close up.
//
// The ground shader already has a `blades` term -- band-limited noise at
// gp * 36 -- and that is what carries turf at any distance worth calling a
// map view. This is what takes over underneath it when the camera comes
// down: actual geometry, so the turf has silhouette against the tile behind
// it and moves in the wind.
//
// ONE DRAW CALL for the whole map. Every blade is an instance of the same
// five-vertex strip, and everything that makes one blade differ from the
// next -- where it stands, which way it faces, how tall it is, when it
// leans -- rides in per-instance data or is hashed from its position in the
// shader. Drawing them one at a time is not an option at these counts.
//
// NOTHING ELSE DEPENDS ON THIS. It reads the tiles once and adds one mesh;
// it can be switched off or deleted without the terrain noticing.

// Blades per tile. The honest lever on cost: three triangles each. 250 was
// not turf -- the blades were countable, and a field you can count reads as
// scattered debris rather than grass. Down again from 480 once the blades
// grew tall enough to read from the play camera: each one covers far more
// ground now, and the draw range below reaches most of the board.
const BLADES_PER_TILE = 320;

// Blades are planted inside this fraction of the hex radius. Short of the
// rim on purpose -- that is where tiles meet and where smoothHexTile has
// jittered the corners, so a blade out there stands in the seam.
const PLANT_RADIUS = 0.82;

// TALL, because this is a strategy board seen from above in a cartoon
// style, not a first-person field. At 0.15 -- a thirteenth of a hex across
// -- the blades were only there under deep zoom; from the camera the game
// is actually played at they vanished into the ground texture entirely.
const BLADE_HEIGHT = 0.30 * MAP_CONFIG.HEX_RADIUS;
// NOT THINNER THAN THIS. At 0.006 a blade covered less than a pixel at any
// real viewing distance, so it flickered between the samples that caught it
// and the ones that missed -- a field of hair crawling with aliasing. Width
// is what buys a stable edge; the earlier flatness it was blamed for was
// really the wind, which swung the tip further than the blade was tall.
const BLADE_WIDTH = 0.019 * MAP_CONFIG.HEX_RADIUS;

// GRASS GOES ON GRASS TILES. Height used to gate this as well, to follow
// the ground shader's own sand-to-grass front -- and it was wrong: on this
// map it silently threw away 70 of the 168 turf tiles, scattered wherever
// the ground sat low, so grass came and went across the board for no reason
// the player could see. The tile's type is the answer to "is this grass".
const TURF_TYPES = new Set(['grass', 'forest']);

// The palette colour a tile carries is much darker than the turf the ground
// shader actually draws from it -- that shader mixes grass between 0.55 and
// 1.55 of the palette green, so its midpoint sits well above the raw value.
// Blades taken straight from the vertex colour came out near black against
// the ground they stand in.
const BLADE_BRIGHTEN = 1.9;

// How far from the CAMERA a blade is still drawn, in world units. Between
// these two the blades are TRANSPARENT, and the block stops being submitted
// only past the second -- so everything culled is already invisible.
//
// DISTANCE, NOT CAMERA HEIGHT. This was a height gate -- one flag for the
// whole field -- and it was wrong in both directions: zoomed in the flag was
// true, so blades were drawn on tiles out at the horizon; zoomed out it was
// false, so the tile directly under the camera had none. Zoom is not
// distance. Every level of detail in this engine keys off the camera-to-tile
// distance.
//
// AND IT HAS TO FADE. An effect that switches off needs a stretch where you
// can see through it, or it arrives a tile at a time as the camera moves and
// every arrival is visible. Alpha -- scaling the geometry away is not the
// same thing and does not count.
// 9 AND 13 WERE A CLOSE-UP RANGE. The board is played from twenty-odd units
// up, where the nearest tile is already past 22 -- so the grass only ever
// appeared under deep zoom, which is not where anyone plays. These reach the
// whole board at a normal top view and only give out when the camera pulls
// right back to its 50-unit ceiling.
const FADE_START = 30;
const FADE_END = 40;

// Side of the square blocks the field is cut into, in world units. About
// three hexes across: small enough that most of the map falls outside the
// frustum and is never submitted, large enough that the whole field is a
// dozen-odd draw calls rather than one per tile.
const CHUNK_SIZE = 2.5;

// The narrowest a blade is allowed to get ON SCREEN, in pixels.
//
// THIS IS WHAT KILLS THE CRAWL. A blade thinner than a pixel does not draw
// as a thin blade -- it flickers between the samples that happen to catch it
// and the ones that miss, and the pattern of hits changes every time the
// camera moves. Below this width the blade is widened to hold the floor and
// its alpha is cut by the same factor, so it covers the same amount of light
// as the thin blade would have and the field does not thicken into a mat as
// it recedes. The standard trick for hair and foliage, and the reason it
// works is that coverage, not width, is what the eye integrates at range.
const MIN_BLADE_PIXELS = 1.5;

// A strip that tapers to a point: five vertices, three triangles. Wider at
// the base than a real blade wants, because at this scale a one-pixel blade
// aliases into a crawling dotted line.
// The tile's elevation. Vertex 13 is the centre of the top fan -- see
// GrassSystem.surfaceY, which interpolates the same fan.
function tileTopY(tileMesh: any): number {
    return tileMesh.geometry.attributes.position.getY(13);
}

function bladeGeometry(): any {
    const w = BLADE_WIDTH, h = BLADE_HEIGHT;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -w, 0, 0,
        w, 0, 0,
        -w * 0.72, h * 0.55, 0,
        w * 0.72, h * 0.55, 0,
        0, h, 0,
    ], 3));
    // Height up the blade, 0 at the root and 1 at the tip. The shader bends
    // and lightens by it, so it does not have to reconstruct it from
    // position and guess at the scale.
    geometry.setAttribute('aUp', new THREE.Float32BufferAttribute([0, 0, 0.55, 0.55, 1], 1));
    geometry.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 4]);
    geometry.computeVertexNormals();
    return geometry;
}

// Wind, and the shading that makes a blade read as a blade.
//
// The lean is driven from WORLD position rather than instance index, so
// neighbouring blades lean together and the field moves in gusts instead of
// every blade doing its own thing. uTime is the clock the terrain shaders
// already run on -- see GridSystem.animateWater, which exists so both halves
// of a shoreline agree; the wind agreeing with them costs nothing.
const GRASS_VERTEX = /* glsl */ `
    // How solid this blade is at this distance. Carried to the fragment
    // stage and multiplied into alpha there, so the field thins out over
    // FADE_START..FADE_END instead of a block of it appearing at once.
    float gDist = distance(cameraPosition, gWorld);
    vGrassFade = 1.0 - smoothstep(uFadeStart, uFadeEnd, gDist);

    // Hold the blade at MIN_BLADE_PIXELS wide and pay for it in alpha.
    // uPxScale converts a world length at unit distance into a fraction of
    // the viewport, so gDist * uPxScale is how much world one pixel spans
    // out here.
    float onePixel = gDist * uPxScale;
    float widen = max(1.0, (uMinPixels * onePixel) / uHalfWidth);
    transformed.x *= widen;
    vGrassFade /= widen;

    // A visible but calm breeze. The broad wave crosses the field in about
    // six seconds; the weaker second wave breaks up the metronome without
    // becoming the rapid leaf-flutter used by deciduous crowns.
    float gust = sin(uTime * 1.0 + gWorld.x * 0.7 + gWorld.z * 0.55)
               + 0.5 * sin(uTime * 1.8 + gWorld.x * 1.9 - gWorld.z * 1.3);
    // Cubed, so the root stays planted and only the top half travels.
    //
    // gust reaches +-1.5, so the 0.085 coefficient moves a 0.30-high blade's
    // tip at most 0.128: a little over two fifths of its height. Enough to read at
    // gameplay zoom, still well short of the loose-flakes look from the old
    // overdriven wind.
    float lean = gust * 0.085 * aUp * aUp * aUp;
    transformed.x += lean;
    transformed.z += lean * 0.6;
`;

const GRASS_FRAGMENT = /* glsl */ `
    // Dark at the root where light does not reach between the blades,
    // bright at the tip. Without it a field of blades reads as one flat mat
    // however good the silhouette is.
    diffuseColor.rgb *= 0.80 + 0.40 * vGrassUp;
    diffuseColor.a *= vGrassFade;
`;

class GrassSystem {
    static meshes: any[] = [];
    static uniforms: any = { uTime: { value: 0 }, uPxScale: { value: 0.002 } };

    // Where the tile's surface actually is at a point inside it.
    //
    // The top is a fan of six triangles around a centre vertex, and
    // smoothHexTile has moved every rim corner in all three axes -- so a
    // blade planted at the tile's own height stands above the surface on one
    // side and buried on the other. This finds the sector the point falls in
    // and interpolates the real triangle.
    private static surfaceY(position: any, localX: number, localZ: number): number {
        const TWO_PI = Math.PI * 2;
        const angle = ((Math.atan2(localZ, localX) + TWO_PI) % TWO_PI);
        const sector = Math.min(5, Math.floor(angle / (Math.PI / 3)));
        const i1 = 6 + sector;
        const i2 = 6 + ((sector + 1) % 6);

        const cx = 0, cz = 0, cy = position.getY(13);
        const b = { x: position.getX(i1), y: position.getY(i1), z: position.getZ(i1) };
        const c = { x: position.getX(i2), y: position.getY(i2), z: position.getZ(i2) };

        // Barycentric in XZ against (centre, b, c).
        const d = (b.z - c.z) * (cx - c.x) + (c.x - b.x) * (cz - c.z);
        if (Math.abs(d) < 1e-6) return cy;
        const wa = ((b.z - c.z) * (localX - c.x) + (c.x - b.x) * (localZ - c.z)) / d;
        const wb = ((c.z - cz) * (localX - c.x) + (cx - c.x) * (localZ - c.z)) / d;
        const wc = 1 - wa - wb;
        return wa * cy + wb * b.y + wc * c.y;
    }

    static init(scene: any, hexGrid: any[]): void {
        // Roads are laid over the tile they run through, so a tile that
        // carries one gets no blades at all -- otherwise grass grows up
        // through the paving. Same test the decorations use, see
        // GridSystem.addDecorations.
        const state = getGameStateOrNull();
        const tiles = hexGrid.filter((hex: any) => {
            const { q, r, type } = hex.userData;
            if (!TURF_TYPES.has(type)) return false;
            return !state?.map?.getTile(q, r)?.hasRoad;
        });
        if (!tiles.length) return;

        const baseGeometry = bladeGeometry();
        const material = new THREE.MeshStandardMaterial({
            // Lit from both sides: a blade is one sheet, and half of them
            // face away from the sun at any moment.
            side: THREE.DoubleSide,
            metalness: 0.0,
            roughness: 0.9,
            // For the fade only. Depth writing stays on: a blade at full
            // alpha is a solid object and has to occlude what is behind it
            // like one, and the far blades that really are see-through have
            // the ground already drawn underneath them.
            transparent: true,
        });
        this.applyGrassShader(material);

        for (const chunk of this.chunkTiles(tiles)) {
            const mesh = this.buildChunk(chunk, baseGeometry, material);
            if (mesh) {
                mesh.userData.excludeFromWaterReflection = true;
                this.meshes.push(mesh);
                scene.add(mesh);
            }
        }
    }

    // Tiles grouped into square blocks of the map.
    //
    // ONE MESH FOR THE WHOLE MAP WAS THE COST. An InstancedMesh is culled or
    // drawn as a unit, so a single field meant all 68,600 blades were
    // submitted every frame while the camera -- which only shows blades at
    // all below SHOW_BELOW_HEIGHT -- had at most a handful of tiles in
    // frame. Measured at +3.4ms on a 30ms frame, nearly all of it off
    // screen. In blocks, the ones behind the camera cost nothing.
    private static chunkTiles(tiles: any[]): any[][] {
        const buckets = new Map<string, any[]>();
        for (const hex of tiles) {
            const tileMesh = this.tileMeshOf(hex);
            if (!tileMesh) continue;
            const key = Math.floor(tileMesh.position.x / CHUNK_SIZE) + ':'
                      + Math.floor(tileMesh.position.z / CHUNK_SIZE);
            const bucket = buckets.get(key);
            if (bucket) bucket.push(tileMesh); else buckets.set(key, [tileMesh]);
        }
        return Array.from(buckets.values());
    }

    private static tileMeshOf(hex: any): any {
        return hex.children.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
    }

    private static buildChunk(tileMeshes: any[], baseGeometry: any, material: any): any {
        // The block's own origin. Instances are placed relative to it so the
        // bounding sphere below can sit at the geometry's local origin --
        // which is what three tests the frustum against.
        //
        // HEIGHT COMES OFF THE GEOMETRY, not the mesh: a tile mesh sits at
        // y = 0 and carries its elevation in its vertices, which is why
        // surfaceY reads vertex 13 rather than a transform. Averaging
        // t.position.y gave 0 for every block.
        let cx = 0, cy = 0, cz = 0;
        for (const t of tileMeshes) {
            cx += t.position.x;
            cy += tileTopY(t);
            cz += t.position.z;
        }
        cx /= tileMeshes.length; cy /= tileMeshes.length; cz /= tileMeshes.length;

        // THE SPHERE IS ON A CLONE, not the shared geometry: three culls an
        // InstancedMesh by `geometry.boundingSphere` moved by the mesh's own
        // matrix, with no knowledge of where the instances went. Sharing one
        // geometry would mean sharing one sphere, and every block but one
        // would be culled wrongly. The clone is five vertices.
        const geometry = baseGeometry.clone();
        let radius = 0;
        for (const t of tileMeshes) {
            const dx = t.position.x - cx, dy = tileTopY(t) - cy, dz = t.position.z - cz;
            radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
        // Plus the tile itself, the tallest blade, and the wind's reach.
        radius += MAP_CONFIG.HEX_RADIUS + BLADE_HEIGHT * 1.35 + 0.05;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);

        const mesh = new THREE.InstancedMesh(geometry, material, tileMeshes.length * BLADES_PER_TILE);
        mesh.castShadow = false;
        // The ground underneath already receives the directional shadow,
        // but bright unshadowed blades drawn over it washed that shadow
        // back out. MeshStandardMaterial already contains Three's shadow
        // chunks, so let the blades sample the same map. They still do NOT
        // cast shadows: keeping tens of thousands of instances out of the
        // shadow pass is the important performance boundary.
        mesh.receiveShadow = true;
        mesh.position.set(cx, cy, cz);
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);

        const dummy = new THREE.Object3D();
        const colour = new THREE.Color();
        let index = 0;

        for (const tileMesh of tileMeshes) {
            const position = tileMesh.geometry.attributes.position;
            const vertexColour = tileMesh.geometry.attributes.color;

            for (let i = 0; i < BLADES_PER_TILE; i++) {
                // Uniform inside a disc: sqrt on the radius, or they crowd
                // the middle.
                const angle = Math.random() * Math.PI * 2;
                const radiusIn = Math.sqrt(Math.random()) * PLANT_RADIUS * MAP_CONFIG.HEX_RADIUS;
                const localX = Math.cos(angle) * radiusIn;
                const localZ = Math.sin(angle) * radiusIn;

                dummy.position.set(
                    tileMesh.position.x + localX - cx,
                    this.surfaceY(position, localX, localZ) - cy,
                    tileMesh.position.z + localZ - cz
                );
                dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
                // Vary height, and lean each blade a little off vertical so
                // the field has some disorder standing still -- without it a
                // still frame is a bed of identical spikes.
                // A good lean off vertical, not a token one: seen from
                // above, a blade standing straight up shows the camera
                // almost no area at all.
                dummy.rotation.z = (Math.random() - 0.5) * 0.7;
                const scale = 0.65 + Math.random() * 0.7;
                dummy.scale.set(1, scale, 1);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);

                // The tile's own colour, so blades sit in the band beneath
                // them rather than in a green of their own.
                if (vertexColour) {
                    colour.setRGB(vertexColour.getX(13), vertexColour.getY(13), vertexColour.getZ(13));
                } else {
                    colour.setRGB(0.35, 0.5, 0.2);
                }
                colour.multiplyScalar(BLADE_BRIGHTEN * (0.85 + Math.random() * 0.35));
                mesh.setColorAt(index, colour);
                index++;
            }
        }

        if (!index) return null;
        mesh.count = index;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        return mesh;
    }

    private static applyGrassShader(material: any): void {
        material.onBeforeCompile = (shader: any) => {
            shader.uniforms.uTime = this.uniforms.uTime;
            shader.uniforms.uFadeStart = { value: FADE_START };
            shader.uniforms.uFadeEnd = { value: FADE_END };
            shader.uniforms.uMinPixels = { value: MIN_BLADE_PIXELS };
            shader.uniforms.uHalfWidth = { value: BLADE_WIDTH };
            shader.uniforms.uPxScale = this.uniforms.uPxScale;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\n uniform float uTime;\n uniform float uFadeStart;\n uniform float uFadeEnd;\n uniform float uMinPixels;\n uniform float uHalfWidth;\n uniform float uPxScale;\n attribute float aUp;\n varying float vGrassUp;\n varying float vGrassFade;')
                .replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n vGrassUp = aUp;\n vec3 gWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;\n' + GRASS_VERTEX
                );
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\n varying float vGrassUp;\n varying float vGrassFade;')
                .replace('#include <color_fragment>', '#include <color_fragment>\n' + GRASS_FRAGMENT);
        };
        material.customProgramCacheKey = () => 'grass-blades-wind-v2';
    }

    // Called every frame. The blades are geometry, so the only cheap lever
    // is not submitting them, and the test for that is HOW FAR THE BLOCK IS
    // FROM THE CAMERA -- see FADE_START. A block is kept while any part of
    // it is inside the fade, which is why its own radius is added; cutting
    // it at the centre distance would clip blades that are still visibly
    // standing at its near edge.
    static update(time: number, camera: any, viewportHeight: number): void {
        if (!this.meshes.length) return;
        this.uniforms.uTime.value = time;
        // World units per pixel, per unit of distance. Recomputed each frame
        // because both terms move: the window resizes and the camera's
        // vertical field of view is not a constant in this engine.
        if (viewportHeight > 0) {
            const halfFov = Math.tan((camera.fov * Math.PI) / 360);
            this.uniforms.uPxScale.value = (2 * halfFov) / viewportHeight;
        }
        const on = viewOptions.grass;
        for (const mesh of this.meshes) {
            if (!on) { mesh.visible = false; continue; }
            const reach = FADE_END + mesh.geometry.boundingSphere.radius;
            mesh.visible = mesh.position.distanceToSquared(camera.position) <= reach * reach;
        }
    }
}

export { GrassSystem };
