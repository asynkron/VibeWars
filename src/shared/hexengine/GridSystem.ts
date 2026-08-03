/**
 * GridSystem.js - Manages the hex grid and provides grid-related utilities.
 */
import { group, miniMapScene, renderer } from '../../render';
import { BuildingSystem } from './BuildingSystem';
import { ModelSystem } from './ModelSystem';
import { RoadSystem } from './RoadSystem';
import { FootprintSystem } from './FootprintSystem';
import { TerrainSystem } from './TerrainSystem';
import { applyProceduralGround } from './TerrainShader';
import { createProceduralDecoration } from './ProceduralDecorations';
import { addColorVariation, getVertexOffsets } from './utils';
import { MAP_CONFIG, WATER_FOAM_COLOR, CRATER_COLOR } from '../../constants';
import { getGameState, getGameStateOrNull } from '../../systems/gameStateStore';
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
        const intendedColor = geometry.userData.intendedColor;
        for (let i = 0; i < vertices.length; i += 3) {
            if (intendedColor) {
                colors[i] = intendedColor.r;
                colors[i + 1] = intendedColor.g;
                colors[i + 2] = intendedColor.b;
            } else {
                colors[i] = colors[i + 1] = colors[i + 2] = 1;
            }
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
        // Procedural ground detail (sand grain, grass mottle, forest
        // floor, rock + snow cap) modulating the vertex colors. WATER and
        // unknown types are left untouched.
        applyProceduralGround(material, type.toUpperCase());
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

        // Procedural decoration matched to the terrain type (a grove on
        // forest, bushes/lone trees on grass, stones on sand, outcrops on
        // mountains), generated deterministically per (q, r) -- replaces
        // the old any-random-OBJ-on-any-tile table.
        if (this.getOption('enableDecorations')) {
            const decorMesh = createProceduralDecoration(type.toUpperCase(), q, r, height);
            if (decorMesh) {
                decorMesh.position.set(x, height, z);
                hexGroup.userData.decorator = decorMesh;
                hexGroup.add(decorMesh);
            }
        }

        return hexGroup;
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

    static smoothHexTile(hexGroup: any) {
        const hexMesh = hexGroup.children.find(
            (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (!hexMesh) return;

        const geometry = hexMesh.geometry;
        const position = geometry.attributes.position;
        const { q, r, height: currentHeight, type } = hexGroup.userData;

        // Smooth non-water hexes based on neighbors
        const neighbors = this.getHexNeighbors(q, r);
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

        // Track highest and lowest edge vertices
        let highestHeight = -Infinity;
        let lowestHeight = Infinity;

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

            // Update highest and lowest heights
            highestHeight = Math.max(highestHeight, finalHeight);
            lowestHeight = Math.min(lowestHeight, finalHeight);

            const colors = geometry.attributes.color;
            if (type === 'water') {
                const hasLandNeighbor = vertexNeighbors[i].some((n: any) => n && n.userData.type !== 'water');
                if (hasLandNeighbor) {
                    const foamColor = new THREE.Color(WATER_FOAM_COLOR);
                    colors.setXYZ(vertexIndex, foamColor.r, foamColor.g, foamColor.b);
                } else {
                    colors.setXYZ(vertexIndex, currentColor.r, currentColor.g, currentColor.b);
                }
            } else {
                colors.setXYZ(vertexIndex, avgR, avgG, avgB);
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

        // Set center vertex height to average of highest and lowest edge vertices
        const centerHeight = (highestHeight + lowestHeight) / 2;
        position.setY(13, centerHeight);

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

        // Check if tile has road and create it if needed
        const tile = getGameState().map.getTile(q, r);
        if (tile?.hasRoad) {
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

    static async loadTileModels() {
        try {
            if (!this.getOption('enableDecorations') || typeof ModelSystem === 'undefined') {
                return false;
            }
            const modelConfigs: Record<string, any> = {};
            Object.values(TerrainSystem.terrainTypes).forEach((terrain: any) => {
                terrain.decorations.forEach((decoration: any) => {
                    if (!modelConfigs[decoration.model]) {
                        modelConfigs[decoration.model] = {
                            model: decoration.model,
                            scale: MAP_CONFIG.HEX_RADIUS,
                            rotation: 90,
                        };
                    }
                });
            });
            await ModelSystem.loadModels(modelConfigs);
            return true;
        } catch (error) {
            console.error('Error in loadTileModels:', error);
            return false;
        }
    }

    static clear() {
        this.hexGrid.length = 0;
    }
}

// Expose hexGrid for external scripting integrations
window.hexGrid = GridSystem.hexGrid;
window.GridSystem = GridSystem;

export { GridSystem };
