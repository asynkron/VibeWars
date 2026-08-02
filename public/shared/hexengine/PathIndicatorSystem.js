// PathIndicatorSystem.js

class PathIndicatorSystem {
    static pathIndicators = [];
    static pathTexture = null;
    static pathTexturePromise = null;
    static animationFrameId = null;
    static animationStartTime = 0;
    static animationSpeed = 3; // Increased from 2 to 3 for faster pulsation
    static animationScale = 0.2; // How much to scale (0.2 = 20% larger/smaller)

    static async initialize() {
        // Load the path texture
        this.pathTexturePromise = new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            console.log('Loading path texture from: assets/textures/path.png');
            loader.load(
                'assets/textures/path.png',
                (texture) => {
                    console.log('Path texture loaded successfully');
                    this.pathTexture = texture;
                    texture.needsUpdate = true;
                    texture.flipY = false;  // Ensure texture isn't flipped
                    texture.format = THREE.RGBAFormat;  // Ensure correct format
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    resolve(texture);
                },
                (progress) => {
                    console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
                },
                (err) => {
                    console.error('Error loading path texture:', err);
                    reject(err);
                }
            );
        });

        // Wait for texture to load
        await this.pathTexturePromise;
        console.log('Path texture loaded and ready');

        // Start the animation loop
        this.startAnimation();
    }

    static startAnimation() {
        this.animationStartTime = performance.now();
        this.animate();
    }

    static stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    static animate() {
        const currentTime = performance.now();
        const elapsed = (currentTime - this.animationStartTime) / 1000; // Convert to seconds

        // Calculate the scale factor using a sine wave
        const scale = 1 + Math.sin(elapsed * this.animationSpeed) * this.animationScale;

        // Update all path indicators
        this.pathIndicators.forEach(indicatorGroup => {
            const mesh = indicatorGroup.children[0];
            if (mesh && mesh.material && mesh.material.map) {
                mesh.material.map.repeat.set(scale, scale);
                mesh.material.map.needsUpdate = true;
            }
        });

        // Request next frame
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    static createPathIndicator(hex, direction = 0) {
        console.log('Creating path indicator for hex:', hex.userData);

        const pathIndicators = group.getObjectByName("pathIndicators") || new THREE.Group();
        pathIndicators.name = "pathIndicators";

        // Create the path indicator mesh using the shared helper
        const pathIndicator = VisualizationSystem.createTexturedHexGeometry(
            hex,
            this.pathTexture,
            {
                heightOffset: VISUAL_OFFSETS.PATH_HEIGHT,
                color: '#00ff00',
                opacity: 0.8,
                renderOrder: 100,
                textureRotation: -direction
            }
        );

        if (!pathIndicator) return null;

        // Create a group for this indicator
        const indicatorGroup = new THREE.Group();
        indicatorGroup.add(pathIndicator);

        // Position the indicator group at the hex's world position
        const worldPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);
        indicatorGroup.position.copy(worldPos);

        pathIndicators.add(indicatorGroup);

        // Add pathIndicators group to main group if not already added
        if (!group.getObjectByName("pathIndicators")) {
            console.log('Adding pathIndicators group to main group');
            group.add(pathIndicators);
        }

        // Add to pathIndicators array for tracking
        this.pathIndicators.push(indicatorGroup);

        return indicatorGroup;
    }

    static clearPathIndicators() {
        // Remove all path indicators from the group
        const pathIndicators = group.getObjectByName("pathIndicators");
        if (pathIndicators) {
            group.remove(pathIndicators);
        }

        // Clear the array
        this.pathIndicators = [];
    }

    static showPath(path, unit) {

        // Clear any existing path indicators
        this.clearPathIndicators();

        if (path.length < 1) return;  // Need at least 1 hex to show direction

        // Get unit's current position - handle both Three.js mesh and game state unit objects
        const prevCoord = new HexCoord(unit.q, unit.r);

        // Create new path indicators for each hex in the path
        for (let i = 0; i < path.length; i++) {
            const currentHex = path[i];
            const currentCoord = new HexCoord(currentHex.userData.q, currentHex.userData.r);

            // Calculate direction from previous position to current position
            const direction = UnitSystem.getRotation(
                prevCoord.q,
                prevCoord.r,
                currentCoord.q,
                currentCoord.r
            );

            this.createPathIndicator(currentHex, direction);

            // Update previous position for next iteration
            prevCoord.q = currentCoord.q;
            prevCoord.r = currentCoord.r;
        }
    }
}

// Export for use in other files
window.PathIndicatorSystem = PathIndicatorSystem; 