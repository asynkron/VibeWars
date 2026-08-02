class FootprintSystem {
    static footprints = [];
    static trackTextures = {};
    static trackTexturePromises = {};

    static async initialize() {
        // Get all unique footprint textures from unit types
        const texturePaths = new Set();
        Object.values(UnitSystem.unitTypes).forEach(unitType => {
            if (unitType.footprintTexture) {
                texturePaths.add(unitType.footprintTexture);
            }
        });

        // Load each unique texture
        const loadPromises = Array.from(texturePaths).map(texturePath => {
            return new Promise((resolve, reject) => {
                const loader = new THREE.TextureLoader();
                loader.load(
                    texturePath,
                    (texture) => {
                        this.trackTextures[texturePath] = texture;
                        resolve(texture);
                    },
                    undefined,
                    (err) => reject(err)
                );
            });
        });

        // Wait for all textures to load
        await Promise.all(loadPromises);
        console.log('All footprint textures loaded:', Object.keys(this.trackTextures));
    }

    static getFootprintTexture(unitType) {
        const texturePath = UnitSystem.unitTypes[unitType]?.footprintTexture;
        return texturePath ? this.trackTextures[texturePath] : null;
    }

    static createFootprint(hex, direction = 0, unitType = null) {
        console.log('Creating footprint for hex:', hex.userData);

        // Early exit if the tile has a road
        const tile = gameState.map.getTile(hex.userData.q, hex.userData.r);
        if (tile?.hasRoad) {
            return null;
        }

        // Early exit if no unit type or no texture for the unit type
        if (!unitType || !this.getFootprintTexture(unitType)) {
            return null;
        }

        const footprints = group.getObjectByName("footprints") || new THREE.Group();
        footprints.name = "footprints";

        // Create the footprint mesh using the shared helper
        const footprintMesh = VisualizationSystem.createTexturedHexGeometry(
            hex,
            this.getFootprintTexture(unitType),
            {
                heightOffset: VISUAL_OFFSETS.FOOTPRINT_OFFSET,
                color: '#ffffff',
                opacity: 0.4,
                renderOrder: 25,  // Between highlights (-1) and paths (50)
                textureRotation: Math.PI - direction,
                materialType: 'MeshStandardMaterial',  // Use standard material for lighting
                receiveShadow: true,  // Enable shadow receiving
                castShadow: false,  // Enable shadow casting
                metalness: 0.1,
                roughness: 0.3,
                flatShading: true,
                dithering: false,
            }
        );

        if (!footprintMesh) return null;

        // Create a group for this footprint
        const footprintGroup = new THREE.Group();
        footprintGroup.add(footprintMesh);

        // Position the footprint group at the hex's world position
        const worldPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);
        footprintGroup.position.copy(worldPos);

        footprints.add(footprintGroup);

        // Add footprints group to main group if not already added
        if (!group.getObjectByName("footprints")) {
            console.log('Adding footprints group to main group');
            group.add(footprints);
        }

        // Initialize the lifespan and add to footprints array so it can be updated later
        footprintGroup.userData.turnsLeftToLive = 3;
        this.footprints.push(footprintGroup);

        return footprintGroup;
    }

    static removeFootprint(footprint) {
        const index = this.footprints.indexOf(footprint);
        if (index > -1) {
            this.footprints.splice(index, 1);
        }

        // Remove from footprints group
        const footprintsGroup = group.getObjectByName("footprints");
        if (footprintsGroup) {
            footprintsGroup.remove(footprint);
        }
    }

    static removeFootprintsAt(q, r) {
        // Find all footprints at the given coordinates
        const footprintsToRemove = this.footprints.filter(footprint => {
            const footprintPos = footprint.position;
            const hexPos = GridSystem.getWorldCoordinates(q, r);
            return footprintPos.distanceTo(hexPos) < 0.1; // Small threshold for position comparison
        });

        // Remove each footprint found
        footprintsToRemove.forEach(footprint => this.removeFootprint(footprint));
    }

    static update() {
        // Use a reverse for loop to safely remove elements while iterating
        for (let i = this.footprints.length - 1; i >= 0; i--) {
            const footprint = this.footprints[i];
            footprint.userData.turnsLeftToLive--;

            // Update opacity based on remaining turns
            const maxTurns = 3; // Initial lifespan
            const currentTurns = footprint.userData.turnsLeftToLive;
            const opacity = (currentTurns / maxTurns) * 0.4; // Start at 0.4 opacity

            // Update opacity for all meshes in the footprint group
            footprint.traverse((child) => {
                if (child.isMesh) {
                    child.material.opacity = opacity;
                }
            });

            if (footprint.userData.turnsLeftToLive <= 0) {
                this.removeFootprint(footprint);
            }
        }
    }
}

// Export for use in other files
window.FootprintSystem = FootprintSystem;
