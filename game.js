// game.js
console.log('game.js starting');

// Ensure `group` is defined or imported correctly
// If using modules, import `group` from the appropriate file
// Example: import { group } from './render';

// Game Data
let selectedUnit = null;
let pathLine = null;
let isDragging = false;
let isDraggingMinimap = false;
let isRotating = false;
let previousMousePosition = { x: 0, y: 0 };
let currentUnitIndex = -1;
let currentHighlightedHex = null;  // Track currently highlighted hex

// Event Listeners
function setupEventListeners(matrices) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const minimapOverlay = document.getElementById('minimap-overlay');
    const endTurnButton = document.getElementById('end-turn-button');

    // Add Next Unit button
    const nextUnitButton = document.createElement('button');
    nextUnitButton.id = 'next-unit-button';
    nextUnitButton.textContent = 'Next Unit';
    nextUnitButton.className = 'game-button';  // Use same class as end turn button
    nextUnitButton.style.position = 'absolute';
    nextUnitButton.style.bottom = '10px';
    nextUnitButton.style.left = '10px';  // Position on the left side
    document.body.appendChild(nextUnitButton);

    // Add CSS for consistent button styling
    const style = document.createElement('style');
    style.textContent = `
        .game-button {
            padding: 10px 20px;
            font-size: 16px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.3s;
        }
        .game-button:hover {
            background-color: #45a049;
        }
        .game-button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);

    // Add the same class to end turn button for consistency
    endTurnButton.className = 'game-button';

    function isMinimapPosition(x, y) {
        const rect = minimapOverlay.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    window.addEventListener('mousedown', (event) => {
        const x = event.clientX;
        const y = event.clientY;
        if (isMinimapPosition(x, y)) {
            isDraggingMinimap = true;
        } else if (event.button === 2) { // Right mouse button
            isRotating = true;
            previousMousePosition = { x: event.clientX, y: event.clientY };
        } else {
            isDragging = true;
            previousMousePosition = { x: event.clientX, y: event.clientY };
        }
    });

    window.addEventListener('mousemove', async (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        if (isDraggingMinimap) {
            const worldPos = getMinimapWorldPosition(event, minimapOverlay);
            if (worldPos) {
                setCameraPosition(worldPos.x, worldPos.z, matrices);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (isRotating) {
            const deltaX = (event.clientX - previousMousePosition.x) * 0.01;

            // Get the current camera target (where it's looking at)
            const target = new THREE.Vector3();
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            target.copy(camera.position).add(cameraDirection.multiplyScalar(camera.position.length()));

            // Create a rotation matrix around the Y axis
            const rotationMatrix = new THREE.Matrix4();
            rotationMatrix.makeRotationY(-deltaX);

            // Apply rotation to camera position relative to the target point
            const cameraPosition = new THREE.Vector3().copy(camera.position);
            cameraPosition.sub(target);  // Move to origin
            cameraPosition.applyMatrix4(rotationMatrix);  // Rotate
            cameraPosition.add(target);  // Move back
            camera.position.copy(cameraPosition);

            // Make camera look at the target
            camera.lookAt(target);

            previousMousePosition = { x: event.clientX, y: event.clientY };
            return;
        }

        // Always check for hex intersections for highlighting
        const intersects = getHexIntersects(raycaster);

        // Always remove any existing cursor highlights first
        const highlights = group.getObjectByName("highlights");
        if (highlights) {
            [...highlights.children]
                .filter(child => child.name === "cursorHighlight")
                .forEach(highlight => highlights.remove(highlight));
        }

        if (intersects.length > 0) {
            const intersectedMesh = intersects[0].object;
            const hexGroup = intersectedMesh.parent;

            // Create new highlight and name it
            const highlightGroup = VisualizationSystem.highlightHex(hexGroup, 0x00ff00);
            if (highlightGroup) {
                highlightGroup.name = "cursorHighlight";
            }

            // Show grid coordinates
            console.log(`Tile: (${hexGroup.userData.q}, ${hexGroup.userData.r})`);

            // Handle path visualization if we have a selected unit
            if (selectedUnit) {
                await VisualizationSystem.clearPathLine();
                const path = PathfindingSystem.getPath(selectedUnit.q, selectedUnit.r, hexGroup.userData.q, hexGroup.userData.r, selectedUnit.move, selectedUnit);
                if (path.length > 0 && UnitSystem.isValidMove(selectedUnit, hexGroup, selectedUnit)) {
                    await VisualizationSystem.drawPath(selectedUnit, path);  // Use default VISUAL_COLORS.PATH
                }
            }
        } else {
            if (selectedUnit) {
                await VisualizationSystem.clearPathLine();
            }
        }

        // Handle camera dragging only if we're in drag mode
        if (isDragging) {
            const deltaX = -(event.clientX - previousMousePosition.x) * 0.05;
            const deltaY = -(event.clientY - previousMousePosition.y) * 0.05;
            updateCameraPosition(deltaX, deltaY, matrices);
            previousMousePosition = { x: event.clientX, y: event.clientY };
        }
    });

    window.addEventListener('mouseup', (event) => {
        if (isDraggingMinimap) {
            const worldPos = getMinimapWorldPosition(event, minimapOverlay);
            if (worldPos) {
                setCameraPosition(worldPos.x, worldPos.z, matrices);
            }
            isDraggingMinimap = false;
            event.preventDefault();
            event.stopPropagation();
        } else if (isDragging) {
            isDragging = false;
        } else if (isRotating) {
            isRotating = false;
        }
    });

    window.addEventListener('wheel', (event) => {
        event.preventDefault();
        const deltaHeight = event.deltaY > 0 ? -MAP_CONFIG.CAMERA.ZOOM_SPEED : MAP_CONFIG.CAMERA.ZOOM_SPEED;
        cameraHeight = Math.max(MAP_CONFIG.CAMERA.MIN_HEIGHT, Math.min(MAP_CONFIG.CAMERA.MAX_HEIGHT, cameraHeight + deltaHeight));
        updateCameraZoom(matrices);
    }, { passive: false });

    // Function to handle unit selection
    function selectUnit(unit) {
        if (unit && gameState.isPlayerTurn(0) && unit.playerIndex === 0) {
            // Clear previous selection first, exactly as in the click handler
            if (selectedUnit) {
                selectedUnit = null;
                VisualizationSystem.clearPathLine();
                VisualizationSystem.clearHighlights();
            }
            // Then set the new selection and show highlights
            selectedUnit = unit;
            UnitSystem.handleSelection(unit);
            return true;
        }
        return false;
    }

    window.addEventListener('click', (event) => {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const intersects = getHexIntersects(raycaster);
        if (intersects.length > 0) {
            const hexGroup = intersects[0].object.parent;
            const unitOnHex = gameState.getUnitAt(hexGroup.userData.q, hexGroup.userData.r);

            // Check if we're attacking a highlighted enemy unit
            if (selectedUnit && unitOnHex && unitOnHex.playerIndex !== selectedUnit.playerIndex) {
                const highlights = group.getObjectByName("highlights");
                if (highlights) {
                    // Check if this hex is highlighted by comparing q,r coordinates
                    const isHighlighted = highlights.children.some(highlight => {
                        const highlightCoord = new HexCoord(hexGroup.userData.q, hexGroup.userData.r);
                        const highlightPos = highlightCoord.getWorldPosition();
                        const highlightX = Math.round(highlightPos.x * 10) / 10;
                        const highlightZ = Math.round(highlightPos.z * 10) / 10;
                        const meshX = Math.round(highlight.position.x * 10) / 10;
                        const meshZ = Math.round(highlight.position.z * 10) / 10;
                        return highlightX === meshX && highlightZ === meshZ;
                    });

                    if (isHighlighted) {
                        console.log("Attempting attack...");
                        UnitSystem.attack(selectedUnit, unitOnHex);
                        return;
                    }
                }
            }

            // Normal unit selection and movement logic
            if (unitOnHex) {
                if (selectUnit(unitOnHex)) {
                    return;
                }
            } else if (selectedUnit && UnitSystem.isValidMove(selectedUnit, hexGroup, selectedUnit)) {
                UnitSystem.handleMovement(selectedUnit, hexGroup);
            } else if (selectedUnit) {
                // Clear selection when clicking an empty hex that's not a valid move
                selectedUnit = null;
                VisualizationSystem.clearPathLine();
                VisualizationSystem.clearHighlights();
            }
            return;
        }

        // Clear selection if clicking outside the grid
        if (selectedUnit) {
            selectedUnit = null;
            VisualizationSystem.clearPathLine();
            VisualizationSystem.clearHighlights();
        }
    });

    minimapOverlay.addEventListener('click', (event) => {
        const worldPos = getMinimapWorldPosition(event, minimapOverlay);
        if (worldPos) {
            setCameraPosition(worldPos.x, worldPos.z, matrices);
        }
        event.preventDefault();
        event.stopPropagation();
    });

    // Add end turn button handler
    endTurnButton.addEventListener('click', () => {
        if (gameState.isPlayerTurn(0)) {  // Only allow player to end their turn
            selectedUnit = null;
            VisualizationSystem.clearPathLine();
            VisualizationSystem.clearHighlights();
            gameState.nextTurn();
            FootprintSystem.update();  // Update footprints when turn ends
        }
    });

    // Update end turn button state when turn changes
    const updateEndTurnButton = () => {
        if (gameState.isPlayerTurn(0)) {
            endTurnButton.disabled = false;
            endTurnButton.textContent = "End Turn";
        } else {
            endTurnButton.disabled = true;
            endTurnButton.textContent = "Enemy Turn";
        }
    };

    // Initial button state
    updateEndTurnButton();

    // Add turn change observer
    const originalNextTurn = gameState.nextTurn;
    gameState.nextTurn = function () {
        originalNextTurn.call(this);
        updateEndTurnButton();
        updateNextUnitButton();  // Update next unit button state
        currentUnitIndex = -1;   // Reset unit index on turn change
    };

    // Next Unit button handler
    nextUnitButton.addEventListener('click', () => {
        if (!gameState.isPlayerTurn(0)) return; // Only work during player's turn

        const playerUnits = gameState.units.filter(unit => unit.playerIndex === 0);
        if (playerUnits.length === 0) return;

        // Get next unit
        currentUnitIndex = (currentUnitIndex + 1) % playerUnits.length;
        const nextUnit = playerUnits[currentUnitIndex];

        // First move the camera to the unit
        const worldPos = new HexCoord(nextUnit.q, nextUnit.r).getWorldPosition();
        const height = TerrainSystem.getHeight(HexCoord.findHex(nextUnit.q, nextUnit.r));

        // Transform position based on map tilt    
        const position = new THREE.Vector3(worldPos.x, height, worldPos.z);


        // Set camera position with offset
        camera.position.set(
            position.x,
            position.y + 20,  // Height above unit
            position.z + 15   // Offset back to see unit better
        );
        camera.lookAt(position.x, position.y, position.z);

        // Small delay to ensure camera movement is complete before selection
        setTimeout(() => {
            // Select the unit using the same function as the click handler
            if (selectUnit(nextUnit)) {
                // Force a re-highlight after selection
                UnitSystem.handleSelection(nextUnit);
            }
        }, 50);
    });

    // Update next unit button state when turn changes
    const updateNextUnitButton = () => {
        if (gameState.isPlayerTurn(0)) {
            nextUnitButton.disabled = false;
            nextUnitButton.style.opacity = '1';
        } else {
            nextUnitButton.disabled = true;
            nextUnitButton.style.opacity = '0.5';
        }
    };

    // Initial button state
    updateNextUnitButton();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        minimapOverlay.style.top = '10px';
        minimapOverlay.style.right = '10px';

        // Update next unit button position
        nextUnitButton.style.bottom = '10px';
        nextUnitButton.style.left = '10px';  // Keep it on the left side
    });

    // Prevent context menu from appearing on right click
    window.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
}

async function initGame() {
    // Initialize renderer first
    window.initRenderer();  // This sets up the renderer and adds it to the document

    // Initialize game state
    const gameState = new GameState();
    window.gameState = gameState;  // Make it globally available as before

    // Initialize systems in parallel
    await Promise.all([
        AudioSystem.initialize(),
        FootprintSystem.initialize(),
        PathIndicatorSystem.initialize(),
        VisualizationSystem.initialize(),
        RoadSystem.initialize()
    ]);


    // Set up lighting
    initializeLighting();

    // Initialize skybox
    SkyboxSystem.init();

    // Create map first and wait for it to be ready
    const { mapCenterX, mapCenterZ } = await GridSystem.createMap(gameState);


    // Only initialize units after map is ready
    // Generate roads after map is created but before units
    createRoads(gameState);

    GridSystem.smoothTerrain();


    // Load unit models before initializing units
    await UnitSystem.loadUnitModels();
    console.log("Unit models loaded");

    // Initialize units using gameState
    gameState.initializeUnits();

    // Update decorator transparency for all hexes
    GridSystem.updateAllDecoratorTransparency();

    // Set up event listeners and input handling
    const matrices = setupCamera(mapCenterX, mapCenterZ);
    const { miniMapCamera, mapWidth, mapHeight, highlightGroup } = setupMinimap(mapCenterX, mapCenterZ);
    setupEventListeners(matrices);

    // Center camera on map
    camera.position.set(mapCenterX, 20, mapCenterZ + 15);
    camera.lookAt(mapCenterX, 0, mapCenterZ);

    // Start animation
    animate(miniMapCamera, matrices, mapWidth, mapHeight, highlightGroup);

}

// Make sure to call initGame as async
window.onload = () => {
    initGame().catch(error => {
        console.error("Error initializing game:", error);
    });
};

console.log('game.js loaded, initGame defined');

// Remove the import and use the global THREE object
const OBJLoader = THREE.OBJLoader;

// Make OBJLoader available globally
window.OBJLoader = OBJLoader;

function createRoads(gameState) {
    for (let i = 0; i < 10; i++) {
        // Find a random valid start point (not water)
        let startQ, startR;
        do {
            startQ = Math.floor(Math.random() * MAP_CONFIG.COLS);
            startR = Math.floor(Math.random() * MAP_CONFIG.ROWS);
        } while (gameState.map.getTile(startQ, startR).type === 'WATER');

        // Find a random valid end point (not water)
        let endQ, endR;
        do {
            endQ = Math.floor(Math.random() * MAP_CONFIG.COLS);
            endR = Math.floor(Math.random() * MAP_CONFIG.ROWS);
        } while (gameState.map.getTile(endQ, endR).type === 'WATER');

        // Generate the road between these points
        RoadSystem.generateRoad(startQ, startR, endQ, endR);
    }
}

function configureAmbientLight() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    return ambientLight;
}

function configureDirectionalLight() {
    // Add directional light for shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2); // Slightly increased intensity
    directionalLight.position.set(mapWidth / 2, mapHeight * 0.6, -mapHeight / 2); // Raised height to 60% of map height
    directionalLight.castShadow = true;

    // Configure shadow properties
    directionalLight.shadow.mapSize.width = 4096;
    directionalLight.shadow.mapSize.height = 4096;
    directionalLight.shadow.bias = -0.001;
    directionalLight.shadow.normalBias = 0.04;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 200;

    // Adjust shadow camera frustum to cover the entire map
    directionalLight.shadow.camera.left = -mapWidth * 1.2;
    directionalLight.shadow.camera.right = mapWidth * 1.2;
    directionalLight.shadow.camera.top = mapHeight * 1.2;
    directionalLight.shadow.camera.bottom = -mapHeight * 1.2;

    // Add light helpers for debugging
    const helper = new THREE.DirectionalLightHelper(directionalLight, 5);
    //scene.add(helper);
    const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
    //scene.add(shadowHelper);

    return directionalLight;
}

function initializeLighting() {
    const ambientLight = configureAmbientLight();
    const directionalLight = configureDirectionalLight();

    scene.add(ambientLight);
    scene.add(directionalLight);
}
