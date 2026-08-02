/**
 * GridSystem.js - Manages the hex grid and provides grid-related utilities.
 */
class GridSystem {
    static hexGrid = [];
    static textureLoader = new THREE.TextureLoader();
    static textures = {}; // Cache for loaded textures
    static materialCache = new Map(); // Cache for materials
    static miniHexGeometry = null; // Shared geometry for minimap hexes

    static getOption(key) {
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
    static generateHexBufferData(radius, height) {
        const vertices = [];
        const uvs = [];
        const indices = [];

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
    static applyVertexColors(geometry, vertices) {
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
    static createHexGeometryWithColor(radius, height, color) {
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
    static createHexGeometry(radius = MAP_CONFIG.HEX_RADIUS, height = 1) {
        return this.createHexGeometryWithColor(radius, height, 0xffffff);
    }

    // ---------------------------
    // Mesh Creation Helpers
    // ---------------------------
    // Creates the invisible bounding mesh used for raycasting
    static createBoundingMesh(height, x, z) {
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
    static createBaseHexMesh(color, height, x, z, type) {
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
    static loadTexture(path) {
        if (!this.textures[path]) {
            console.log(`Loading texture: ${path}`);
            this.textures[path] = this.textureLoader.load(
                path,
                (loadedTexture) => {
                    console.log(`Texture loaded successfully: ${path}`);
                    loadedTexture.wrapS = THREE.RepeatWrapping;
                    loadedTexture.wrapT = THREE.RepeatWrapping;
                    loadedTexture.repeat.set(1, 1);
                    loadedTexture.encoding = THREE.sRGBEncoding;
                    loadedTexture.minFilter = THREE.LinearMipMapLinearFilter;
                    loadedTexture.magFilter = THREE.LinearFilter;
                    const renderer = window.renderer;
                    if (renderer) {
                        loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    }
                    loadedTexture.needsUpdate = true;
                },
                undefined,
                (error) => {
                    console.error(`Error loading texture ${path}:`, error);
                }
            );
        }
        return this.textures[path];
    }

    static createStandardMaterial(type) {
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
        this.materialCache.set(type, material);
        return material;
    }

    static createDecoratorMaterial(color) {
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
    static addHex(hex) {
        this.hexGrid.push(hex);
    }

    static getHexIntersects(raycaster) {
        const intersectObjects = [];
        console.log('Starting hex intersection check');

        GridSystem.hexGrid.forEach((hexGroup, index) => {
            let foundBoundingMesh = false;
            hexGroup.children.forEach((child) => {
                if (child instanceof THREE.Mesh && child.userData.isBoundingMesh) {
                    foundBoundingMesh = true;
                    intersectObjects.push(child);
                }
            });
            if (!foundBoundingMesh) {
                console.warn(`Hex ${index} has no bounding mesh!`);
            }
        });

        console.log(`Found ${intersectObjects.length} bounding meshes for intersection testing`);
        const intersects = raycaster.intersectObjects(intersectObjects, false);
        console.log('Intersection results:', intersects.length);
        return intersects;
    }

    static createHexShape(radius = MAP_CONFIG.HEX_RADIUS) {
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
    static createHexPrism(color, x, z, height, moveCost, type = 'grass', q, r) {
        const hexGroup = new THREE.Group();

        // Create and add the bounding mesh
        const boundingMesh = this.createBoundingMesh(height, x, z);
        hexGroup.add(boundingMesh);

        // Create and add the base hex mesh
        const hexMesh = this.createBaseHexMesh(color, height, x, z, type);
        hexGroup.add(hexMesh);

        // Set up shared userData for this hex group
        const userData = { x, z, height, moveCost, type, q, r };
        if (type === 'water') {
            userData.timeOffset = Math.random() * Math.PI * 2;
            userData.originalHeight = height;
        }
        hexGroup.userData = userData;
        boundingMesh.userData = { ...userData, isBoundingMesh: true };

        // Add decoration if available
        const shouldDecorate = this.getOption('enableDecorations') && typeof ModelSystem !== 'undefined';
        const decoration = shouldDecorate ? TerrainSystem.getRandomDecoration(type.toUpperCase()) : null;
        if (decoration && ModelSystem.getModel && ModelSystem.getModel(decoration.model)) {
            const decorMesh = ModelSystem.getModel(decoration.model).clone();
            const decoratorColor = addColorVariation(decoration.color, 0.1);
            const decorMaterial = this.createDecoratorMaterial(decoratorColor);
            decorMesh.traverse((child) => {
                if (child.isMesh) {
                    child.material = decorMaterial;
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            decorMesh.position.set(x, height, z);
            decorMesh.rotation.y = Math.floor(Math.random() * 6) * (Math.PI / 3);
            hexGroup.userData.decorator = decorMesh;
            hexGroup.add(decorMesh);
        }

        return hexGroup;
    }

    // Creates the mini map hex using shared geometry
    static createMiniHex(color, x, z) {
        const miniHexGroup = new THREE.Group();
        if (!this.miniHexGeometry) {
            const vertices = [];
            const indices = [];
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
    static async createMap(mapSource) {
        console.log("Starting map creation...");

        if (this.getOption('loadModels') && typeof ModelSystem !== 'undefined') {
            await this.loadTileModels();
            console.log("3D models loaded");
        }

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
                    hex.children.forEach((child) => {
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

        console.log("Map created with 3D models, total hexes:", this.hexGrid.length);
        return { mapCenterX, mapCenterZ, mapReady: true };
    }

    static getWorldCoordinates(q, r) {
        const x = MAP_CONFIG.HEX_RADIUS * 1.5 * q;
        const z = MAP_CONFIG.HEX_RADIUS * Math.sqrt(3) * (r + (q % 2) / 2);
        return new THREE.Vector3(x, 0, z);
    }

    static getWorldCoordinatesWithHeight(q, r, height = 0) {
        const position = this.getWorldCoordinates(q, r);
        position.y = height;
        return position;
    }

    // ---------------------------
    // Neighbor & Smoothing Helpers
    // ---------------------------
    static getHexNeighborsCoords(q, r) {
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

    static getHexNeighbors(q, r) {
        return this.getHexNeighborsCoords(q, r).map(([nq, nr]) => this.findHex(nq, nr));
    }

    static smoothHexTile(hexGroup) {
        const hexMesh = hexGroup.children.find(
            (child) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
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

            vertexNeighbors[i].forEach((neighbor) => {
                if (neighbor) {
                    totalHeight += neighbor.userData.height;
                    count++;
                    const neighborMesh = neighbor.children.find(
                        (child) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
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

            const hasWaterNeighbor = vertexNeighbors[i].some((n) => n && n.userData.type === 'water');
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
                const hasLandNeighbor = vertexNeighbors[i].some((n) => n && n.userData.type !== 'water');
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
        const tile = gameState.map.getTile(q, r);
        if (tile?.hasRoad) {
            RoadSystem.createRoad(hexGroup);
        }
    }

    static smoothTerrain() {
        this.hexGrid.forEach((hexGroup) => this.smoothHexTile(hexGroup));
    }

    // ---------------------------
    // Animation & Update Helpers
    // ---------------------------
    static animateWater(time) {
        this.hexGrid.forEach((hexGroup) => {
            if (hexGroup.userData.type !== 'water') return;
            const hexMesh = hexGroup.children.find(
                (child) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
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

    static updateDecoratorTransparency(hex) {
        if (!hex || !hex.userData || !hex.userData.decorator) return;
        const unit = gameState.getUnitAt(hex.userData.q, hex.userData.r);
        const decorator = hex.userData.decorator;
        decorator.traverse((child) => {
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
        this.hexGrid.forEach((hex) => this.updateDecoratorTransparency(hex));
    }

    static updateHexGeometry(hexMesh, waterHeight, isWater = false) {
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

    static updateHexAndBoundingMeshHeight(hex, newHeight, craterColor) {
        const hexMesh = hex.children.find(
            (child) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
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
        const boundingMesh = hex.children.find((child) => child.userData.isBoundingMesh);
        if (boundingMesh) {
            const boundingPosition = boundingMesh.geometry.attributes.position;
            boundingPosition.setY(13, newHeight);
            boundingPosition.needsUpdate = true;
        }
        if (hex.userData.decorator) {
            hex.userData.decorator.position.y = newHeight;
        }
    }

    static convertHexToWater(hex, tile) {
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
            (child) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (hexMesh) {
            hexMesh.material = this.createStandardMaterial('water');
            hexMesh.geometry.userData.intendedColor = new THREE.Color(tile.color);
            this.updateHexGeometry(hexMesh, waterHeight, true);
        }
        const boundingMesh = hex.children.find((child) => child.userData.isBoundingMesh);
        if (boundingMesh) {
            boundingMesh.userData.type = 'water';
            this.updateHexGeometry(boundingMesh, waterHeight, true);
        }
    }

    static modifyHexHeight(coord, heightFactor) {
        if (typeof gameState === 'undefined' || !gameState?.map) {
            return false;
        }
        const hex = this.findHex(coord.q, coord.r);
        const tile = gameState.map.getTile(coord.q, coord.r);
        if (!hex || !tile || hex.userData.type === 'water') return false;

        const newHeight = Math.max(0, tile.height + heightFactor);
        const waterHeight = TerrainSystem.getTerrainBaseHeight('WATER');

        if (newHeight <= waterHeight) {
            this.convertHexToWater(hex, tile);
        } else {
            tile.height = newHeight;
            hex.userData.height = newHeight;
            hex.userData.originalHeight = newHeight;
            const craterColor = new THREE.Color(CRATER_COLOR);
            this.updateHexAndBoundingMeshHeight(hex, newHeight, craterColor);
        }

        FootprintSystem.removeFootprintsAt(coord.q, coord.r);
        this.smoothHexTile(hex);
        this.getHexNeighbors(coord.q, coord.r).forEach((neighbor) => {
            if (neighbor) this.smoothHexTile(neighbor);
        });
        return true;
    }

    static findHex(q, r) {
        return this.hexGrid.find((h) => h.userData.q === q && h.userData.r === r);
    }

    static getUnitAtHex(hex) {
        if (!hex) return null;
        if (typeof gameState === 'undefined' || !gameState?.units) {
            return null;
        }
        return gameState.units.find(
            (unit) => unit.q === hex.userData.q && unit.r === hex.userData.r
        );
    }

    static async loadTileModels() {
        try {
            if (!this.getOption('enableDecorations') || typeof ModelSystem === 'undefined') {
                return false;
            }
            const modelConfigs = {};
            Object.values(TerrainSystem.terrainTypes).forEach((terrain) => {
                terrain.decorations.forEach((decoration) => {
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
            console.log('Finished loading 3D models');
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
console.log('GridSystem.js loaded');
