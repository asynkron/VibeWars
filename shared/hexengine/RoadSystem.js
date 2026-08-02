// RoadSystem.js - Handles road generation and management

class RoadSystem {
    static roads = [];
    static roadTextures = {};
    static roadTexturePromises = {};
    static terrainCosts = {
        'SAND': 1,
        'GRASS': 1,
        'FOREST': 2,
        'MOUNTAIN': Infinity,
        'WATER': Infinity
    };

    static async initialize() {
        // Load road texture
        const texturePath = 'assets/textures/road.png';
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                texturePath,
                (texture) => {
                    // Set texture filtering to nearest-neighbor for crisp edges
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    this.roadTextures[texturePath] = texture;
                    resolve(texture);
                },
                undefined,
                (err) => reject(err)
            );
        });
    }

    static getRoadTexture() {
        return this.roadTextures['assets/textures/road.png'];
    }

    static generateRoad(startQ, startR, endQ, endR) {
        // Create a temporary unit using the Droid type
        const roadUnit = {
            type: 'Road',
            move: Infinity,  // Unlimited movement range
            q: startQ,      // Current position
            r: startR,      // Current position
            playerIndex: 0  // Required for some pathfinding checks
        };

        // Get the path using the pathfinding system
        const path = PathfindingSystem.getPath(startQ, startR, endQ, endR, Infinity, roadUnit);

        if (path.length === 0) {
            console.warn('No valid path found for road construction');
            return false;
        }
        else {

        }

        // Mark each tile in the path as having a road
        path.forEach(hex => {
            const tile = gameState.map.getTile(hex.userData.q, hex.userData.r);
            if (tile) {
                tile.hasRoad = true;

                // Trigger terrain smoothing to update the visual representation
                GridSystem.smoothHexTile(hex);
            }
        });

        return true;
    }

    static getRoadCost(terrainType) {
        return this.terrainCosts[terrainType] || Infinity;
    }

    static createRoad(hex) {

        const roads = group.getObjectByName("roads") || new THREE.Group();
        roads.name = "roads";

        // Get all neighbor coordinates
        const neighborCoords = GridSystem.getHexNeighborsCoords(hex.userData.q, hex.userData.r);

        // Create a group for this road
        const roadGroup = new THREE.Group();

        // Get the world position of the current hex
        const currentPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);

        // Check each neighbor for roads
        for (let i = 0; i < 6; i++) {
            const [nq, nr] = neighborCoords[i];
            // Get the tile data for this neighbor
            const tile = gameState.map.getTile(nq, nr);
            if (tile?.hasRoad) {
                // Get rotation using UnitSystem helper
                const rotation = UnitSystem.getRotation(hex.userData.q, hex.userData.r, nq, nr);

                // Create road mesh for this direction
                const roadMesh = VisualizationSystem.createTexturedHexGeometry(
                    hex,
                    this.getRoadTexture(),
                    {
                        heightOffset: VISUAL_OFFSETS.ROAD_OFFSET,
                        color: '#ffffff',
                        opacity: 1.0,
                        renderOrder: 0,  // Same as terrain
                        depthWrite: true,
                        textureRotation: Math.PI - rotation,
                        materialType: 'MeshStandardMaterial',  // Use standard material for lighting
                        receiveShadow: true,  // Enable shadow receiving
                        castShadow: true,  // Enable shadow casting
                        metalness: 0.15,
                        roughness: 0.5,
                        flatShading: true,
                        dithering: false,
                    }
                );
                if (roadMesh) {
                    // Ensure shadows are enabled on the mesh itself
                    roadMesh.castShadow = true;
                    roadMesh.receiveShadow = true;
                    roadGroup.add(roadMesh);
                }
            }
        }

        // Position the road group at the hex's world position
        roadGroup.position.copy(currentPos);

        roads.add(roadGroup);

        // Add the roads group to the scene if it's not already there
        if (!group.getObjectByName("roads")) {
            group.add(roads);
        }

        // Add to roads array
        this.roads.push(roadGroup);

        return roadGroup;
    }

    static removeRoad(road) {
        const index = this.roads.indexOf(road);
        if (index > -1) {
            this.roads.splice(index, 1);
        }

        // Remove from roads group
        const roadsGroup = group.getObjectByName("roads");
        if (roadsGroup) {
            roadsGroup.remove(road);
        }
    }

    static removeRoadsAt(q, r) {
        // Find all roads at the given coordinates
        const roadsToRemove = this.roads.filter(road => {
            const roadPos = road.position;
            const hexPos = GridSystem.getWorldCoordinates(q, r);
            return roadPos.distanceTo(hexPos) < 0.1; // Small threshold for position comparison
        });

        // Remove each road found
        roadsToRemove.forEach(road => this.removeRoad(road));
    }
}

// Export for use in other files
window.RoadSystem = RoadSystem;

console.log('RoadSystem.js loaded'); 