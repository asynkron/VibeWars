/**
 * GridSystem.js - Manages the hex grid and provides grid-related utilities.
 */
import { group, miniMapScene, renderer } from '../../render';
import { BuildingSystem } from './BuildingSystem';
import { RoadSystem } from './RoadSystem';
import { FootprintSystem } from './FootprintSystem';
import { TerrainSystem } from './TerrainSystem';
import { groundTexture, GROUND_TILE_WORLD } from './groundTexture';
import { applyProceduralGround, applyWaterSurface } from './TerrainShader';
import { createProceduralDecoration } from './ProceduralDecorations';
import { markShadowsDirty } from './ShadowBudget';
import { addColorVariation, getVertexOffsets } from './utils';
import { MAP_CONFIG, CRATER_COLOR } from '../../constants';
import { getGameState, getGameStateOrNull } from '../../systems/gameStateStore';
import { selectedMapProvider } from '../../systems/maps/mapRegistry';
import type { GameUnit } from '../../types';

class GridSystem {
    static hexGrid: any[] = [];
    static textureLoader = new THREE.TextureLoader();
    static textures: Record<string, any> = {}; // Cache for loaded textures
    static materialCache = new Map(); // Cache for materials
    static miniHexGeometry: any = null; // Shared geometry for minimap hexes

    static getOption(key: string) {
        const engine = typeof window !== 'undefined' ? window.HEX_ENGINE : null;
        if (engine?.getOption) {
            const value = engine.getOption(key);
            if (typeof value !== 'undefined') {
                return value;
            }
        }
        throw new Error(`GridSystem option "${key}" is not configured.`);
    }

    // ---------------------------
    // Geometry Helpers
    // ---------------------------
    // Generates vertices, UVs, and indices for a hexagon prism
    static generateHexBufferData(radius: number, height: number) {
        const vertices: any[] = [];
        const uvs: any[] = [];
        const indices: any[] = [];

        // Bottom vertices (indices 0-5)
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            vertices.push(radius * Math.cos(angle), 0, radius * Math.sin(angle));
            uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
        }

        // Top vertices (indices 6-11)
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            vertices.push(radius * Math.cos(angle), height, radius * Math.sin(angle));
            uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
        }

        // Center vertices (bottom: index 12, top: index 13)
        vertices.push(0, 0, 0, 0, height, 0);
        uvs.push(0.5, 0.5, 0.5, 0.5);

        // Top face triangles ("pizza slices")
        for (let i = 0; i < 6; i++) {
            indices.push(13, 6 + ((i + 1) % 6), 6 + i);
        }

        // Bottom face triangles ("pizza slices")
        for (let i = 0; i < 6; i++) {
            indices.push(12, i, (i + 1) % 6);
        }

        // Side faces (two triangles per side)
        for (let i = 0; i < 6; i++) {
            const next = (i + 1) % 6;
            indices.push(i, i + 6, next);
            indices.push(i + 6, next + 6, next);
        }

        return { vertices, uvs, indices };
    }

    // Applies vertex colors to a geometry based on geometry.userData.intendedColor
    static applyVertexColors(geometry: any, vertices: any[]) {
        const colors = new Float32Array(vertices.length);
        const lums = new Float32Array(vertices.length / 3);
        const intendedColor = geometry.userData.intendedColor;
        for (let i = 0; i < vertices.length; i += 3) {
            if (intendedColor) {
                colors[i] = intendedColor.r;
                colors[i + 1] = intendedColor.g;
                colors[i + 2] = intendedColor.b;
                lums[i / 3] = 0.299 * intendedColor.r + 0.587 * intendedColor.g + 0.114 * intendedColor.b;
            } else {
                colors[i] = colors[i + 1] = colors[i + 2] = 1;
                lums[i / 3] = 1;
            }
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        // The vertex's PRISTINE luminance, frozen at build time (and kept
        // in step by terrain smoothing, which runs pre-scorch). The ground
        // shader divides the live vertex luminance by this to read "how
        // much has this vertex been darkened since build" -- craters and
        // shadow blends. It used to divide by the terrain TYPE's palette
        // luminance instead, which broke on the perlin maps: their tiles
        // carry colors LERPED between bands, so a sand tile leaning toward
        // grass measured far darker than the bright sand palette and the
        // shader dimmed the whole tile as if scorched.
        geometry.setAttribute('aPristineLum', new THREE.Float32BufferAttribute(lums, 1));
    }

    // Creates a BufferGeometry for a hex with the specified color
    static createHexGeometryWithColor(radius: number, height: number, color: number | string) {
        const geometry = new THREE.BufferGeometry();
        geometry.userData.intendedColor = new THREE.Color(color);
        const { vertices, uvs, indices } = this.generateHexBufferData(radius, height);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        this.applyVertexColors(geometry, vertices);
        // Shoreline flags, one per hex edge, split over two vec3 attributes
        // (edges 0-2 and 3-5). Constant across the tile and zero until
        // paintShoreEdges fills them in, so inland tiles never wash.
        const vertexCount = vertices.length / 3;
        geometry.setAttribute('aShoreA', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3));
        geometry.setAttribute('aShoreB', new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3));

        // One shared normal for the whole top face (see smoothHexTile).
        // Straight up until the tile is smoothed -- which is also the right
        // answer for the flat-topped prisms that skip smoothing.
        const tileNormals = new Float32Array(vertexCount * 3);
        for (let v = 0; v < vertexCount; v++) tileNormals[v * 3 + 1] = 1;
        geometry.setAttribute('aTileNormal', new THREE.Float32BufferAttribute(tileNormals, 3));
        return geometry;
    }

    // Refactored to use the helper above; defaults to white color
    static createHexGeometry(radius: number = MAP_CONFIG.HEX_RADIUS, height: number = 1) {
        return this.createHexGeometryWithColor(radius, height, 0xffffff);
    }

    // ---------------------------
    // Mesh Creation Helpers
    // ---------------------------
    // Creates the invisible bounding mesh used for raycasting
    static createBoundingMesh(height: number, x: number, z: number) {
        const boundingGeometry = this.createHexGeometry(MAP_CONFIG.HEX_RADIUS, height);
        const boundingMaterial = new THREE.MeshBasicMaterial({
            visible: false,
            side: THREE.DoubleSide,
        });
        const boundingMesh = new THREE.Mesh(boundingGeometry, boundingMaterial);
        boundingMesh.position.set(x, 0, z);
        boundingMesh.userData = { isBoundingMesh: true };
        boundingMesh.raycast = THREE.Mesh.prototype.raycast;
        return boundingMesh;
    }

    // Creates the main hex mesh with shadows using the refactored geometry helper
    static createBaseHexMesh(color: number | string, height: number, x: number, z: number, type: string) {
        const geometry = this.createHexGeometryWithColor(MAP_CONFIG.HEX_RADIUS, height, color);
        const material = this.createStandardMaterial(type);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, 0, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // ---------------------------
    // Material Helpers
    // ---------------------------
    static loadTexture(path: string) {
        if (!this.textures[path]) {
            this.textures[path] = this.textureLoader.load(
                path,
                (loadedTexture: any) => {
                    loadedTexture.wrapS = THREE.RepeatWrapping;
                    loadedTexture.wrapT = THREE.RepeatWrapping;
                    loadedTexture.repeat.set(1, 1);
                    loadedTexture.encoding = THREE.sRGBEncoding;
                    loadedTexture.minFilter = THREE.LinearMipMapLinearFilter;
                    loadedTexture.magFilter = THREE.LinearFilter;
                    if (renderer) {
                        loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    }
                    loadedTexture.needsUpdate = true;
                },
                undefined,
                (error: any) => {
                    console.error(`Error loading texture ${path}:`, error);
                }
            );
        }
        return this.textures[path];
    }

    static createStandardMaterial(type: string) {
        if (this.materialCache.has(type)) {
            return this.materialCache.get(type);
        }
        const baseColor = new THREE.Color(0xffffff);
        const materialProps = TerrainSystem.getTerrainMaterial(type.toUpperCase());
        const material = new THREE.MeshStandardMaterial({
            color: baseColor,
            metalness: materialProps.metalness,
            roughness: materialProps.roughness,
            flatShading: true,
            dithering: false,
            vertexColors: true,
        });
        // Procedural surface detail: height-banded ground texturing for
        // land, animated ripple + shore foam for water.
        if (type.toUpperCase() === 'WATER') {
            applyWaterSurface(material);
        } else {
            applyProceduralGround(material, type.toUpperCase());
        }
        this.materialCache.set(type, material);
        return material;
    }

    static createDecoratorMaterial(color: number | string) {
        const baseColor = new THREE.Color(color);
        return new THREE.MeshStandardMaterial({
            color: baseColor,
            metalness: 0.2,
            roughness: 0.7,
            flatShading: true,
            dithering: true,
        });
    }

    // ---------------------------
    // Grid & Mesh Management
    // ---------------------------
    static addHex(hex: any) {
        this.hexGrid.push(hex);
    }

    static getHexIntersects(raycaster: any) {
        const intersectObjects: any[] = [];

        GridSystem.hexGrid.forEach((hexGroup: any, index: number) => {
            let foundBoundingMesh = false;
            hexGroup.children.forEach((child: any) => {
                if (child instanceof THREE.Mesh && child.userData.isBoundingMesh) {
                    foundBoundingMesh = true;
                    intersectObjects.push(child);
                }
            });
            if (!foundBoundingMesh) {
                console.warn(`Hex ${index} has no bounding mesh!`);
            }
        });

        return raycaster.intersectObjects(intersectObjects, false);
    }

    static createHexShape(radius: number = MAP_CONFIG.HEX_RADIUS) {
        const shape = new THREE.Shape();
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            const x = radius * Math.cos(angle);
            const y = radius * Math.sin(angle);
            i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
        }
        return shape;
    }

    // ---------------------------
    // Hex Mesh Creation
    // ---------------------------
    static createHexPrism(color: number | string, x: number, z: number, height: number, moveCost: number, type: string = 'grass', q: number, r: number) {
        const hexGroup = new THREE.Group();

        // Create and add the bounding mesh
        const boundingMesh = this.createBoundingMesh(height, x, z);
        hexGroup.add(boundingMesh);

        // Create and add the base hex mesh
        const hexMesh = this.createBaseHexMesh(color, height, x, z, type);
        hexGroup.add(hexMesh);

        // Set up shared userData for this hex group
        const userData: any = { x, z, height, moveCost, type, q, r };
        if (type === 'water') {
            userData.timeOffset = Math.random() * Math.PI * 2;
            userData.originalHeight = height;
        }
        hexGroup.userData = userData;
        boundingMesh.userData = { ...userData, isBoundingMesh: true };

        // Decoration happens LATER, in decorateTerrain -- see the note
        // there for why it cannot happen here.
        return hexGroup;
    }

    // Plant the procedural decorations: a grove on forest, bushes and lone
    // trees on grass, stones on sand, outcrops on mountains, generated
    // deterministically per (q, r).
    //
    // THIS IS A SEPARATE PASS BECAUSE OF ORDER. It used to run inside
    // createHexPrism, which is the earliest possible moment -- before the
    // roads are laid and before the buildings are placed -- so it could not
    // know about either, and planted trees in the middle of roads and
    // underneath depots. The roads cannot simply be moved earlier instead:
    // RoadSystem.generateRoad routes with PathfindingSystem, which walks
    // the hex objects, so the grid has to exist first. So the grid is built,
    // then the roads are routed over it, and only then does anything grow.
    //
    // The buildings are still placed after this, but their tiles are known
    // from the map provider before any of it, so they can be skipped up
    // front. That matters more than it looks: BuildingSystem.attachVisual
    // only removes a previous decorator when it is the building's OWN, so
    // a tree that was already there is not removed, only orphaned -- it
    // stays a child of the hex, standing inside the depot.
    // Height of the tile's SMOOTHED top surface at a tile-local offset.
    // The top face is a fan: center vertex (13) out to the six rim
    // vertices (6-11), whose heights smoothing has pulled toward the
    // neighbors. Find which slice the point is in and interpolate over
    // that triangle -- this is the exact surface the renderer draws, so
    // whatever is placed with it stands on the ground rather than on the
    // flat pre-smoothing top.
    static surfaceHeightAt(hexMesh: any, dx: number, dz: number): number {
        const pos = hexMesh?.geometry?.attributes?.position;
        if (!pos || pos.count < 14) return 0;
        let a = Math.atan2(dz, dx);
        if (a < 0) a += Math.PI * 2;
        const i = Math.floor(a / (Math.PI / 3)) % 6;
        const j = (i + 1) % 6;
        const ax = pos.getX(6 + i), az = pos.getZ(6 + i), ay = pos.getY(6 + i);
        const bx = pos.getX(6 + j), bz = pos.getZ(6 + j), by = pos.getY(6 + j);
        const cy = pos.getY(13);
        const denom = ax * bz - az * bx;
        if (Math.abs(denom) < 1e-9) return cy;
        const wa = (dx * bz - dz * bx) / denom;
        const wb = (ax * dz - az * dx) / denom;
        return cy * (1 - wa - wb) + ay * wa + by * wb;
    }

    static decorateTerrain() {
        if (!this.getOption('enableDecorations')) return;
        const state = getGameStateOrNull();
        const occupied = new Set(
            (selectedMapProvider().buildings ?? []).map((b) => `${b.q},${b.r}`)
        );

        for (const hexGroup of this.hexGrid) {
            const { q, r, x, z, height, type } = hexGroup.userData;
            if (hexGroup.userData.decorator) continue;
            if (occupied.has(`${q},${r}`)) continue;
            if (state?.map?.getTile(q, r)?.hasRoad) continue;

            // Per-piece ground sampling, as an offset from the decorator
            // group's own y (the tile's logical height). The small sink
            // guarantees contact when the interpolated surface lands a
            // hair below a piece's base.
            const hexMesh = hexGroup.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
            );
            const groundAt = (dx: number, dz: number) =>
                this.surfaceHeightAt(hexMesh, dx, dz) - height - 0.02;

            const decorMesh = createProceduralDecoration(type.toUpperCase(), q, r, height, groundAt);
            if (decorMesh) {
                decorMesh.position.set(x, height, z);
                hexGroup.userData.decorator = decorMesh;
                hexGroup.add(decorMesh);
            }
        }
    }

    // Creates the mini map hex using shared geometry
    static createMiniHex(color: number | string, x: number, z: number) {
        const miniHexGroup = new THREE.Group();
        if (!this.miniHexGeometry) {
            const vertices: any[] = [];
            const indices: any[] = [];
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                vertices.push(
                    Math.cos(angle) * MAP_CONFIG.HEX_RADIUS * 0.8,
                    0,
                    Math.sin(angle) * MAP_CONFIG.HEX_RADIUS * 0.8
                );
            }
            vertices.push(0, 0, 0);
            for (let i = 0; i < 6; i++) {
                indices.push(6, i, (i + 1) % 6);
            }
            this.miniHexGeometry = new THREE.BufferGeometry();
            this.miniHexGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            this.miniHexGeometry.setIndex(indices);
        }
        const glowColor = new THREE.Color(color).multiplyScalar(1.5);
        const mainMaterial = new THREE.MeshBasicMaterial({
            color: glowColor,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
        });
        const mainHex = new THREE.Mesh(this.miniHexGeometry, mainMaterial);
        mainHex.position.set(x, 0, z);
        miniHexGroup.add(mainHex);
        return miniHexGroup;
    }

    // ---------------------------
    // Map & Coordinate Helpers
    // ---------------------------
    static async createMap(mapSource: any) {
        // Decorations are generated procedurally (see
        // ProceduralDecorations) -- no tile decoration models to load.

        this.clear();

        const mapCenterX = (MAP_CONFIG.COLS * MAP_CONFIG.HEX_RADIUS * 1.5) / 2;
        const mapCenterZ = (MAP_CONFIG.ROWS * MAP_CONFIG.HEX_RADIUS * Math.sqrt(3)) / 2;

        const mapData = mapSource?.map ? mapSource.map : mapSource;

        for (let q = 0; q < MAP_CONFIG.COLS; q++) {
            for (let r = 0; r < MAP_CONFIG.ROWS; r++) {
                const x = MAP_CONFIG.HEX_RADIUS * 1.5 * q;
                const z = MAP_CONFIG.HEX_RADIUS * Math.sqrt(3) * (r + (q % 2) / 2);
                const tile = mapData?.getTile(q, r);
                if (tile) {
                    const type = tile.type.toLowerCase();
                    const { color, height, moveCost } = tile;
                    const hex = this.createHexPrism(color, x, z, height, moveCost, type, q, r);
                    hex.userData.q = q;
                    hex.userData.r = r;
                    hex.userData.type = type;
                    // Update bounding mesh coordinates
                    hex.children.forEach((child: any) => {
                        if (child.userData.isBoundingMesh) {
                            child.userData.q = q;
                            child.userData.r = r;
                        }
                    });
                    group.add(hex);
                    this.addHex(hex);
                    const miniHex = this.createMiniHex(color, x, z);
                    miniMapScene.add(miniHex);
                }
            }
        }

        return { mapCenterX, mapCenterZ, mapReady: true };
    }

    // A one-hex apron around the board, on every map.
    //
    // The playable grid ends in mid-air, and a hard edge reads as the edge
    // of the world rather than the edge of a board. This ring is the ramp
    // between the two: its outer rim sits at 0, flush with the ground
    // plane, and its inner rim is WELDED to the board's own corners, so the
    // ground climbs onto the map instead of stopping against a cliff.
    //
    // WELDED, not computed. The first attempt worked out a height per
    // vertex and left a step half a tile tall, for two reasons worth
    // keeping: it ran from createMap, which is BEFORE smoothTerrain, so it
    // read authored heights rather than the smoothed rim the board actually
    // ends at -- and it averaged each vertex with this tile's own 0, which
    // halves every lift. smoothHexTile also jitters the rim in x and z, not
    // only y, so even the right height would have left a horizontal gap.
    //
    // Snapping to the nearest real corner fixes all three at once: same
    // position, same height, same jitter. It must therefore run AFTER
    // smoothTerrain -- see the call in game.ts.
    //
    // No neighbour lookup, deliberately. getHexNeighbors branches on
    // (q % 2 === 1), and the ring starts at q = -1 where JS gives -1, so it
    // would take the even-column branch and return the wrong hexes. Nearest
    // corner within a third of a hex needs no parity at all.
    //
    // IT IS THE GROUND, not a tile. Same image and world scale as
    // GroundSystem's plane, with UVs written from WORLD position rather
    // than the hex's radial mapping, so where the apron meets the plane the
    // canopy simply continues. That is also why it does not use the
    // height-banded terrain shader: that one picks its look from world
    // height and paints sand at 0 however the tile is labelled.
    //
    // DECORATION ONLY. Never goes through addHex, so it stays out of
    // hexGrid and out of smoothing, water animation and every traversal
    // that treats a hex as playable ground. No bounding mesh either: those
    // are what picking reads, and an apron tile that answered a click would
    // offer moves onto a hex the simulation has never heard of.
    static createBorderRing() {
        const R = MAP_CONFIG.HEX_RADIUS;
        const texture = groundTexture(renderer.capabilities.getMaxAnisotropy());
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.0,
            roughness: 0.95,
        });

        // Every corner the board actually ends at, in world space, read off
        // the smoothed geometry rather than recomputed from the heightmap.
        const corners: Array<{ x: number; y: number; z: number }> = [];
        this.hexGrid.forEach((hexGroup: any) => {
            const mesh = hexGroup.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
            );
            if (!mesh) return;
            const p = mesh.geometry.attributes.position;
            for (let j = 6; j < 12; j++) {
                corners.push({
                    x: mesh.position.x + p.getX(j),
                    y: p.getY(j),
                    z: mesh.position.z + p.getZ(j),
                });
            }
        });
        // A third of a hex: close enough that only a corner the board and
        // the apron genuinely share can match, far enough to survive the
        // rim jitter.
        const snapRadius = (R / 3) * (R / 3);

        for (let q = -1; q <= MAP_CONFIG.COLS; q++) {
            for (let r = -1; r <= MAP_CONFIG.ROWS; r++) {
                if (q >= 0 && q < MAP_CONFIG.COLS && r >= 0 && r < MAP_CONFIG.ROWS) continue;
                const x = R * 1.5 * q;
                const z = R * Math.sqrt(3) * (r + (((q % 2) + 2) % 2) / 2);

                const geometry = this.createHexGeometry(R, 0);
                const position = geometry.attributes.position;

                let rimTotal = 0;
                for (let i = 0; i < 6; i++) {
                    const v = i + 6;
                    const wx = x + position.getX(v);
                    const wz = z + position.getZ(v);
                    let best: { x: number; y: number; z: number } | null = null;
                    let bestDistance = Infinity;
                    for (const corner of corners) {
                        const dx = corner.x - wx, dz = corner.z - wz;
                        const distance = dx * dx + dz * dz;
                        if (distance < bestDistance) { bestDistance = distance; best = corner; }
                    }
                    if (best && bestDistance <= snapRadius) {
                        position.setXYZ(v, best.x - x, best.y, best.z - z);
                        rimTotal += best.y;
                    }
                }
                // The centre follows the rim, so the surface is a ramp
                // rather than a rim pulled up around a pinned middle.
                position.setY(13, rimTotal / 6);

                // World-space UVs: the canopy continues across the seam.
                const uv = geometry.attributes.uv;
                for (let i = 0; i < position.count; i++) {
                    uv.setXY(
                        i,
                        (x + position.getX(i)) / GROUND_TILE_WORLD,
                        (z + position.getZ(i)) / GROUND_TILE_WORLD
                    );
                }
                position.needsUpdate = true;
                uv.needsUpdate = true;
                geometry.computeVertexNormals();

                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(x, 0, z);
                mesh.receiveShadow = true;
                mesh.castShadow = false;
                mesh.userData.isBorderTile = true;
                group.add(mesh);
            }
        }
    }

    static getWorldCoordinates(q: number, r: number) {
        const x = MAP_CONFIG.HEX_RADIUS * 1.5 * q;
        const z = MAP_CONFIG.HEX_RADIUS * Math.sqrt(3) * (r + (q % 2) / 2);
        return new THREE.Vector3(x, 0, z);
    }

    static getWorldCoordinatesWithHeight(q: number, r: number, height: number = 0) {
        const position = this.getWorldCoordinates(q, r);
        position.y = height;
        return position;
    }

    // ---------------------------
    // Neighbor & Smoothing Helpers
    // ---------------------------
    static getHexNeighborsCoords(q: number, r: number) {
        const isOddColumn = q % 2 === 1;
        const neighborOffsets = isOddColumn
            ? [
                [1, 0],
                [0, -1],
                [-1, 0],
                [-1, 1],
                [0, 1],
                [1, 1],
            ]
            : [
                [1, -1],
                [0, -1],
                [-1, -1],
                [-1, 0],
                [0, 1],
                [1, 0],
            ];
        return neighborOffsets.map(([dq, dr]) => [q + dq, r + dr]);
    }

    static getHexNeighbors(q: number, r: number) {
        return this.getHexNeighborsCoords(q, r).map(([nq, nr]) => this.findHex(nq, nr));
    }

    // Marks which of a tile's six edges border the OTHER element -- water
    // for a land tile, land for a water tile. This is what both terrain
    // shaders build their shoreline from.
    //
    // Doing it per EDGE rather than per corner is the whole point: a corner
    // is shared by two edges, so a corner value cannot say "foam along this
    // edge but not that one". Marking corners meant an edge whose two ends
    // each also touch open water fell below the threshold and got no
    // shoreline at all, which is why stretches of coast came out bare.
    //
    // Edge e spans corners e and e+1, and faces neighbors[5 - e]: the
    // neighbour those two corners share (see vertexNeighbors below, where
    // corner e is bounded by neighbours 5-e and 6-e).
    static paintShoreEdges(geometry: any, neighbors: any[], type: string) {
        const edgesA = geometry.attributes.aShoreA;
        const edgesB = geometry.attributes.aShoreB;
        if (!edgesA || !edgesB) return;

        const flags = [];
        for (let e = 0; e < 6; e++) {
            const neighbor = neighbors[5 - e];
            const neighborIsWater = !!neighbor && neighbor.userData.type === 'water';
            const bordersOther = type === 'water' ? !!neighbor && !neighborIsWater : neighborIsWater;
            flags.push(bordersOther ? 1 : 0);
        }

        // Same value on every vertex: the flags describe the TILE, and the
        // fragment shader measures its own distance to those edges.
        for (let v = 0; v < edgesA.count; v++) {
            edgesA.setXYZ(v, flags[0], flags[1], flags[2]);
            edgesB.setXYZ(v, flags[3], flags[4], flags[5]);
        }
        edgesA.needsUpdate = true;
        edgesB.needsUpdate = true;
    }

    static smoothHexTile(hexGroup: any) {
        const hexMesh = hexGroup.children.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (!hexMesh) return;

        const geometry = hexMesh.geometry;
        const position = geometry.attributes.position;
        const { q, r, height: currentHeight, type } = hexGroup.userData;

        // Building tiles keep their pristine flat-topped hexagonal prism:
        // no rim smoothing, no vertex jitter. The tile itself IS the
        // building's plinth -- a solid, straight foundation from the
        // ground up -- instead of a tilted surface leaving the building
        // half in the air. (Authored building spawns are static provider
        // data, so this is known before buildings are initialized.)
        const neighbors = this.getHexNeighbors(q, r);
        // Shoreline signal first: it is about which EDGES border the other
        // element, which holds for building tiles too -- a harbour tile
        // skips the rim smoothing below but still has a beach.
        this.paintShoreEdges(geometry, neighbors, type);

        const buildings = selectedMapProvider().buildings ?? [];
        if (buildings.some((b) => b.q === q && b.r === r)) return;

        // Smooth non-water hexes based on neighbors
        const currentCenter = this.getWorldCoordinatesWithHeight(q, r, currentHeight);
        const vertexNeighbors = [
            [neighbors[0], neighbors[5]],
            [neighbors[5], neighbors[4]],
            [neighbors[4], neighbors[3]],
            [neighbors[3], neighbors[2]],
            [neighbors[2], neighbors[1]],
            [neighbors[1], neighbors[0]],
        ];

        for (let i = 0; i < 6; i++) position.setY(i, 0);
        position.setY(12, 0);
        const normals = new Float32Array(position.count * 3);

        for (let i = 0; i < 6; i++) {
            const vertexIndex = i + 6;
            let totalHeight = currentHeight, count = 1;
            const neighborCenters = [currentCenter];
            const currentColor = hexMesh.geometry.userData.intendedColor;
            let totalR = currentColor.r, totalG = currentColor.g, totalB = currentColor.b;

            vertexNeighbors[i].forEach((neighbor: any) => {
                if (neighbor) {
                    totalHeight += neighbor.userData.height;
                    count++;
                    const neighborMesh = neighbor.children.find(
                        (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
                    );
                    if (neighborMesh && neighbor.userData.type !== 'water' && type !== 'water') {
                        const neighborColor = neighborMesh.geometry.userData.intendedColor;
                        totalR += neighborColor.r;
                        totalG += neighborColor.g;
                        totalB += neighborColor.b;
                    }
                    const neighborCenter = this.getWorldCoordinatesWithHeight(
                        neighbor.userData.q,
                        neighbor.userData.r,
                        neighbor.userData.height
                    );
                    neighborCenters.push(neighborCenter);
                }
            });

            const hasWaterNeighbor = vertexNeighbors[i].some((n: any) => n && n.userData.type === 'water');
            const finalHeight =
                hasWaterNeighbor || type === 'water'
                    ? TerrainSystem.getTerrainBaseHeight('WATER')
                    : totalHeight / count;
            const [avgR, avgG, avgB] =
                type === 'water'
                    ? [currentColor.r, currentColor.g, currentColor.b]
                    : [totalR / count, totalG / count, totalB / count];

            const seed = finalHeight * 1000;
            const offsets = getVertexOffsets(seed);
            position.setXYZ(
                vertexIndex,
                position.getX(vertexIndex) + offsets.x,
                finalHeight,
                position.getZ(vertexIndex) + offsets.z
            );

            const colors = geometry.attributes.color;
            if (type === 'water') {
                // Flat water colour: the foam is no longer a rim tint
                // painted per corner but a real band the shader measures
                // from the tile's land-facing EDGES (see paintShoreEdges).
                colors.setXYZ(vertexIndex, currentColor.r, currentColor.g, currentColor.b);
            } else {
                colors.setXYZ(vertexIndex, avgR, avgG, avgB);
                // Smoothing runs at build time, before any scorch -- the
                // blended color IS this vertex's pristine state, so the
                // reference luminance follows it. See applyVertexColors.
                const pristine = geometry.attributes.aPristineLum;
                if (pristine) {
                    pristine.setX(vertexIndex, 0.299 * avgR + 0.587 * avgG + 0.114 * avgB);
                    pristine.needsUpdate = true;
                }
            }
            colors.needsUpdate = true;

            let normal;
            if (neighborCenters.length >= 3) {
                const v1 = new THREE.Vector3().subVectors(neighborCenters[1], neighborCenters[0]);
                const v2 = new THREE.Vector3().subVectors(neighborCenters[2], neighborCenters[0]);
                normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
            } else if (neighborCenters.length === 2) {
                const v1 = new THREE.Vector3().subVectors(neighborCenters[1], neighborCenters[0]);
                const up = new THREE.Vector3(0, 1, 0);
                normal = new THREE.Vector3().crossVectors(v1, up).normalize().add(up).normalize();
            } else {
                normal = new THREE.Vector3(0, 1, 0);
            }
            normals.set([normal.x, normal.y, normal.z], vertexIndex * 3);
            normals.set([normal.x, normal.y, normal.z], i * 3);
        }
        position.setY(12, 0);

        // Centre vertex at the CENTROID of the six rim vertices, in all
        // three axes. The rim is jittered in x/z and uneven in y, so a
        // centre pinned to the tile origin at the midpoint of the highest
        // and lowest rim vertex sits off the surface the rim describes --
        // it domes or dishes the top face, and each of the six fan
        // triangles ends up on its own plane, catching the light
        // differently. The centroid lies on that surface, so the fan reads
        // as one face. (animateWater already re-centres water tiles this
        // way every frame; this brings land in line.)
        let centerX = 0, centerY = 0, centerZ = 0;
        for (let i = 6; i < 12; i++) {
            centerX += position.getX(i);
            centerY += position.getY(i);
            centerZ += position.getZ(i);
        }
        position.setXYZ(13, centerX / 6, centerY / 6, centerZ / 6);

        // ONE normal for the whole top face: the average of the six fan
        // triangles' own planes. The material is flat-shaded, so without
        // this each slice shades from its own plane and the tile reads as
        // six wedges no matter how nearly coplanar they are -- flat shading
        // takes the normal from the triangle, not from the vertices. The
        // terrain shaders blend toward this on up-facing fragments, which
        // leaves the near-vertical sides faceted as they should be.
        const tileCenter = new THREE.Vector3(position.getX(13), position.getY(13), position.getZ(13));
        const rimVertex = (i: number) =>
            new THREE.Vector3(position.getX(6 + i), position.getY(6 + i), position.getZ(6 + i));
        const tileNormal = new THREE.Vector3();
        for (let i = 0; i < 6; i++) {
            const toNext = rimVertex((i + 1) % 6).sub(tileCenter);
            const toThis = rimVertex(i).sub(tileCenter);
            tileNormal.add(new THREE.Vector3().crossVectors(toNext, toThis));
        }
        // Degenerate fans (a perfectly flat, zero-area case) fall back to up.
        if (tileNormal.lengthSq() < 1e-12) tileNormal.set(0, 1, 0);
        tileNormal.normalize();
        if (tileNormal.y < 0) tileNormal.negate();

        const tileNormals = geometry.attributes.aTileNormal;
        if (tileNormals) {
            for (let v = 0; v < tileNormals.count; v++) {
                tileNormals.setXYZ(v, tileNormal.x, tileNormal.y, tileNormal.z);
            }
            tileNormals.needsUpdate = true;
        }

        const centerNormal = new THREE.Vector3(0, 0, 0);
        let validNormals = 0;
        for (let i = 0; i < 6; i++) {
            const idx = i * 3;
            if (normals[idx] !== undefined) {
                centerNormal.add(new THREE.Vector3(normals[idx], normals[idx + 1], normals[idx + 2]));
                validNormals++;
            }
        }
        if (validNormals > 0) centerNormal.divideScalar(validNormals).normalize();
        else centerNormal.set(0, 1, 0);
        normals.set([centerNormal.x, centerNormal.y, centerNormal.z], 12 * 3);
        normals.set([centerNormal.x, centerNormal.y, centerNormal.z], 13 * 3);
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        position.needsUpdate = true;

        // Re-lay the road over the new surface. The REMOVE is the point:
        // smoothing runs again on every terrain deformation, and on the six
        // neighbours too, so creating without removing stacked a fresh road
        // group on the old one every time. One artillery attack is six
        // rockets x seven re-smoothed tiles, which measured at +36 to +42
        // duplicate decals -- growing without bound, with the stale copies
        // left floating over the crater they were supposed to follow.
        const tile = getGameState().map.getTile(q, r);
        if (tile?.hasRoad) {
            RoadSystem.removeRoadsAt(q, r);
            RoadSystem.createRoad(hexGroup);
        }
    }

    static smoothTerrain() {
        this.hexGrid.forEach((hexGroup: any) => this.smoothHexTile(hexGroup));
    }

    // ---------------------------
    // Animation & Update Helpers
    // ---------------------------
    static animateWater(time: number) {
        // Drive the ripple/foam animation on EVERY terrain shader, not just
        // water: the ground materials run the beach wash off the same
        // uTime, and a wave only reads as one wave if both halves of the
        // shoreline are on the same clock.
        this.materialCache.forEach((material: any) => {
            const uniforms = material?.userData?.shader?.uniforms;
            if (uniforms?.uTime) uniforms.uTime.value = time;
        });
        this.hexGrid.forEach((hexGroup: any) => {
            if (hexGroup.userData.type !== 'water') return;
            const hexMesh = hexGroup.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
            );
            if (!hexMesh) return;
            const geometry = hexMesh.geometry;
            const position = geometry.attributes.position;
            const { timeOffset, originalHeight } = hexGroup.userData;
            const amplitude = 0.01, frequency = 3;
            const waveHeight = Math.sin((time + timeOffset) * frequency) * amplitude;

            // Add circular movement in x and z
            const circleRadius = 0.01; // Radius of circular movement
            const circleFrequency = 2; // Speed of circular movement
            const xOffset = Math.cos((time + timeOffset) * circleFrequency) * circleRadius;
            const zOffset = Math.sin((time + timeOffset) * circleFrequency) * circleRadius;

            // Get the base center position (index 13)
            const baseX = (position.getX(6) + position.getX(7) + position.getX(8) + position.getX(9) + position.getX(10) + position.getX(11)) / 6;
            const baseZ = (position.getZ(6) + position.getZ(7) + position.getZ(8) + position.getZ(9) + position.getZ(10) + position.getZ(11)) / 6;

            // Update center vertex position (index 13) relative to the calculated base center
            position.setXYZ(13,
                baseX + xOffset,
                originalHeight + waveHeight,
                baseZ + zOffset
            );
            position.needsUpdate = true;
        });
    }

    static updateDecoratorTransparency(hex: any) {
        if (!hex || !hex.userData || !hex.userData.decorator) return;
        const unit = getGameState().getUnitAt(hex.userData.q, hex.userData.r);
        const decorator = hex.userData.decorator;
        decorator.traverse((child: any) => {
            if (child.isMesh) {
                if (unit) {
                    child.material.transparent = true;
                    child.material.opacity = 0.3;
                    child.material.depthWrite = false;
                    child.material.depthTest = true;
                    child.material.side = THREE.DoubleSide;
                } else {
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                    child.material.depthWrite = true;
                    child.material.depthTest = true;
                    child.material.side = THREE.DoubleSide;
                }
            }
        });
    }

    static updateAllDecoratorTransparency() {
        this.hexGrid.forEach((hex: any) => this.updateDecoratorTransparency(hex));
    }

    static updateHexGeometry(hexMesh: any, waterHeight: number, isWater: boolean = false) {
        if (!hexMesh) return;
        markShadowsDirty();
        const geometry = hexMesh.geometry;
        const position = geometry.attributes.position;
        const colors = geometry.attributes.color;
        for (let i = 0; i < 6; i++) position.setY(i, 0);
        position.setY(12, 0);
        const topHeight = isWater ? waterHeight : hexMesh.userData.height;
        for (let i = 6; i < 12; i++) position.setY(i, topHeight);
        position.setY(13, topHeight);
        if (isWater) {
            const waterColor = new THREE.Color(TerrainSystem.getTerrainColor('WATER'));
            for (let i = 0; i < position.count; i++) {
                colors.setXYZ(i, waterColor.r, waterColor.g, waterColor.b);
            }
            colors.needsUpdate = true;
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    static updateHexAndBoundingMeshHeight(hex: any, newHeight: number, craterColor: any) {
        markShadowsDirty();
        const hexMesh = hex.children.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (hexMesh) {
            const geometry = hexMesh.geometry;
            const position = geometry.attributes.position;
            const colors = geometry.attributes.color;
            position.setY(13, newHeight);
            colors.setXYZ(13, craterColor.r, craterColor.g, craterColor.b);
            colors.needsUpdate = true;
            position.needsUpdate = true;
        }
        const boundingMesh = hex.children.find((child: any) => child.userData.isBoundingMesh);
        if (boundingMesh) {
            const boundingPosition = boundingMesh.geometry.attributes.position;
            boundingPosition.setY(13, newHeight);
            boundingPosition.needsUpdate = true;
        }
        if (hex.userData.decorator) {
            hex.userData.decorator.position.y = newHeight;
        }
    }

    static convertHexToWater(hex: any, tile: any) {
        const waterHeight = TerrainSystem.getTerrainBaseHeight('WATER');
        tile.type = 'WATER';
        tile.height = waterHeight;
        tile.color = TerrainSystem.getTerrainColor('WATER');
        tile.moveCost = TerrainSystem.terrainTypes.WATER.moveCost;
        hex.userData.type = 'water';
        hex.userData.height = waterHeight;
        hex.userData.originalHeight = waterHeight;
        hex.userData.timeOffset = Math.random() * Math.PI * 2;
        if (hex.userData.decorator) {
            hex.remove(hex.userData.decorator);
            hex.userData.decorator = null;
        }
        const hexMesh = hex.children.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (hexMesh) {
            hexMesh.material = this.createStandardMaterial('water');
            hexMesh.geometry.userData.intendedColor = new THREE.Color(tile.color);
            this.updateHexGeometry(hexMesh, waterHeight, true);
        }
        const boundingMesh = hex.children.find((child: any) => child.userData.isBoundingMesh);
        if (boundingMesh) {
            boundingMesh.userData.type = 'water';
            this.updateHexGeometry(boundingMesh, waterHeight, true);
        }
    }

    static modifyHexHeight(coord: { q: number; r: number }, heightFactor: number): boolean {
        const currentState = getGameStateOrNull();
        if (!currentState?.map) {
            return false;
        }
        const hex = this.findHex(coord.q, coord.r);
        const tile = currentState.map.getTile(coord.q, coord.r);
        if (!hex || !tile || hex.userData.type === 'water') return false;

        const newHeight = Math.max(0, tile.height + heightFactor);
        const waterHeight = TerrainSystem.getTerrainBaseHeight('WATER');

        if (newHeight <= waterHeight) {
            this.convertHexToWater(hex, tile);
            // The decorator (a factory, possibly) is gone -- keep the
            // building bookkeeping in step with the visuals.
            BuildingSystem.onTileSunk(coord.q, coord.r);
        } else {
            tile.height = newHeight;
            hex.userData.height = newHeight;
            hex.userData.originalHeight = newHeight;
            const craterColor = new THREE.Color(CRATER_COLOR);
            this.updateHexAndBoundingMeshHeight(hex, newHeight, craterColor);
        }

        FootprintSystem.removeFootprintsAt(coord.q, coord.r);
        this.smoothHexTile(hex);
        this.getHexNeighbors(coord.q, coord.r).forEach((neighbor: any) => {
            if (neighbor) this.smoothHexTile(neighbor);
        });
        return true;
    }

    static findHex(q: number, r: number) {
        return this.hexGrid.find((h: any) => h.userData.q === q && h.userData.r === r);
    }

    static getUnitAtHex(hex: any) {
        if (!hex) return null;
        const currentState = getGameStateOrNull();
        if (!currentState?.units) {
            return null;
        }
        return currentState.units.find(
            (unit: GameUnit) => unit.q === hex.userData.q && unit.r === hex.userData.r
        );
    }

    static clear() {
        this.hexGrid.length = 0;
    }
}

// Expose hexGrid for external scripting integrations
window.hexGrid = GridSystem.hexGrid;
window.GridSystem = GridSystem;

export { GridSystem };
