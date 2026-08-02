// Scene Objects
const scene = new THREE.Scene();
// scene.background = new THREE.Color(0xffffff); // Remove white background
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000); // Increased far plane
camera.position.set(20, 20, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x000000, 0); // Set clear color to transparent black
const group = new THREE.Group();
const miniMapScene = new THREE.Scene();
let cameraHeight = MAP_CONFIG.CAMERA.INITIAL_HEIGHT;
let isRendererInitialized = false;
let cameraTarget = new THREE.Vector3();

// Calculate map dimensions for shadow camera
const mapWidth = MAP_CONFIG.COLS * MAP_CONFIG.HEX_RADIUS * 1.5;  // 75 units
const mapHeight = MAP_CONFIG.ROWS * MAP_CONFIG.HEX_RADIUS * Math.sqrt(3);  // ~86.6 units

// Renderer Initialization
function initRenderer() {
    if (isRendererInitialized) {
        console.log('Renderer already initialized, skipping...');
        return;
    }

    console.log('Initializing renderer...');
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;  // Enable shadow mapping
    renderer.shadowMap.type = THREE.VSMShadowMap;
    document.body.appendChild(renderer.domElement);
    scene.add(group);

    // Debug logging
    console.log('Scene children after initialization:', scene.children);

    isRendererInitialized = true;
}

// Make initRenderer available globally
window.initRenderer = initRenderer;

// Call initRenderer when the page loads
window.addEventListener('load', initRenderer);

// Camera Setup
function setupCamera(mapCenterX, mapCenterZ) {
    const localToWorldMatrix = new THREE.Matrix4();
    const worldToLocalMatrix = new THREE.Matrix4();
    let localCameraPos = new THREE.Vector3(mapCenterX, cameraHeight, mapCenterZ);
    let worldCameraPos = localCameraPos.clone().applyMatrix4(localToWorldMatrix);
    camera.position.copy(worldCameraPos);

    const localLookDirection = getLookDirection(cameraHeight);
    const worldLookDirection = localLookDirection.clone().applyMatrix4(localToWorldMatrix);
    camera.lookAt(worldCameraPos.clone().add(worldLookDirection.multiplyScalar(10)));

    return { localToWorldMatrix, worldToLocalMatrix, localCameraPos };
}

function getLookDirection(height) {
    const minDownwardTilt = -1;
    const maxDownwardTilt = -3;
    const tiltFactor = (height - MAP_CONFIG.CAMERA.MIN_HEIGHT) / (MAP_CONFIG.CAMERA.MAX_HEIGHT - MAP_CONFIG.CAMERA.MIN_HEIGHT);
    const downwardTilt = minDownwardTilt + tiltFactor * (maxDownwardTilt - minDownwardTilt);
    return new THREE.Vector3(0, downwardTilt, -1).normalize();
}

function setCameraPosition(worldX, worldZ, matrices) {
    // Get current look direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    // Calculate new position
    const localPos = new THREE.Vector3(worldX, cameraHeight, worldZ);
    const worldPos = localPos.clone().applyMatrix4(matrices.localToWorldMatrix);
    camera.position.copy(worldPos);

    // Look in the same direction as before
    camera.lookAt(worldPos.clone().add(cameraDirection.multiplyScalar(10)));
}

function updateCameraPosition(deltaX, deltaY, matrices) {
    // Get current look-at target before moving
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraTarget.copy(camera.position).add(cameraDirection.multiplyScalar(camera.position.length()));

    // Calculate movement direction relative to camera orientation
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    right.crossVectors(cameraDirection, up).normalize();
    const forward = new THREE.Vector3();
    forward.crossVectors(right, up).normalize();

    // Create movement vector in camera space
    const movement = new THREE.Vector3();
    movement.addScaledVector(right, deltaX);      // Left/Right movement (removed negative sign)
    movement.addScaledVector(forward, deltaY);     // Forward/Backward movement (removed negative sign)

    // Update camera position
    camera.position.add(movement);
    cameraTarget.add(movement);

    // Look at the updated target
    camera.lookAt(cameraTarget);
}

function updateCameraZoom(matrices) {
    // Get current look-at target before zooming
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraTarget.copy(camera.position).add(cameraDirection.multiplyScalar(camera.position.length()));

    // Update camera height
    const localCameraPos = camera.position.clone().applyMatrix4(matrices.worldToLocalMatrix);
    localCameraPos.y = cameraHeight;
    const worldCameraPos = localCameraPos.clone().applyMatrix4(matrices.localToWorldMatrix);
    camera.position.copy(worldCameraPos);

    // Look at the same target point
    camera.lookAt(cameraTarget);
}

// Minimap Setup
function setupMinimap(mapCenterX, mapCenterZ) {
    const mapWidth = MAP_CONFIG.COLS * MAP_CONFIG.HEX_RADIUS * 1.5;  // 75
    const mapHeight = MAP_CONFIG.ROWS * MAP_CONFIG.HEX_RADIUS * Math.sqrt(3);  // ~86.6

    const miniMapCamera = new THREE.OrthographicCamera(
        -mapWidth / 2, mapWidth / 2,    // x: -37.5 to 37.5
        mapHeight / 2, -mapHeight / 2,  // z: 43.3 to -43.3
        0.1, 1000
    );
    miniMapCamera.position.set(mapCenterX, 100, mapCenterZ);
    miniMapCamera.rotation.x = -Math.PI / 2;
    miniMapCamera.updateProjectionMatrix();
    console.log("miniMapCamera frustum:", -mapWidth / 2, mapWidth / 2, mapHeight / 2, -mapHeight / 2);

    // Centered border
    const borderMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
    const borderPoints = [
        new THREE.Vector3(-mapWidth / 2, 0.1, -mapHeight / 2), // Bottom-left
        new THREE.Vector3(mapWidth / 2, 0.1, -mapHeight / 2),  // Bottom-right
        new THREE.Vector3(mapWidth / 2, 0.1, mapHeight / 2),   // Top-right
        new THREE.Vector3(-mapWidth / 2, 0.1, mapHeight / 2),  // Top-left
        new THREE.Vector3(-mapWidth / 2, 0.1, -mapHeight / 2)  // Back to start
    ];
    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const border = new THREE.Line(borderGeometry, borderMaterial);
    border.position.set(mapCenterX, 0, mapCenterZ);
    miniMapScene.add(border);
    console.log("Border added with extents:", -mapWidth / 2, mapWidth / 2, -mapHeight / 2, mapHeight / 2);

    // Group for highlight hexes
    const highlightGroup = new THREE.Group();
    highlightGroup.name = "miniMapHighlights";
    miniMapScene.add(highlightGroup);

    console.log("miniMapScene children after setup:", miniMapScene.children.length);

    return { miniMapCamera, mapWidth, mapHeight, highlightGroup };
}

// Animation Loop
function animate(miniMapCamera, matrices, mapWidth, mapHeight, highlightGroup) {
    requestAnimationFrame(() => animate(miniMapCamera, matrices, mapWidth, mapHeight, highlightGroup));

    // Update path animation
    VisualizationSystem.updatePathAnimation();

    // Animate water tiles
    GridSystem.animateWater(performance.now() * 0.001); // Convert to seconds

    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 0); // Set clear color to transparent black
    renderer.render(scene, camera);

    const left = window.innerWidth - MAP_CONFIG.MINIMAP.WIDTH - 10;
    const bottom = window.innerHeight - MAP_CONFIG.MINIMAP.HEIGHT - 10;
    renderer.setViewport(left, bottom, MAP_CONFIG.MINIMAP.WIDTH, MAP_CONFIG.MINIMAP.HEIGHT);
    renderer.setScissor(left, bottom, MAP_CONFIG.MINIMAP.WIDTH, MAP_CONFIG.MINIMAP.HEIGHT);
    renderer.setClearColor(0x111111, 1);  // Much darker background for better glow effect

    updateMiniMapHighlights(highlightGroup, matrices);
    renderer.render(miniMapScene, miniMapCamera);

    renderer.setScissorTest(false);
}

// Update minimap highlights
function updateMiniMapHighlights(highlightGroup, matrices) {
    while (highlightGroup.children.length > 0) {
        highlightGroup.remove(highlightGroup.children[0]);
    }

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );

    const visibleHexes = hexGrid.filter(hex => {
        const localPos = new THREE.Vector3(hex.userData.x, 0, hex.userData.z);
        const worldPos = localPos.clone().applyMatrix4(matrices.localToWorldMatrix);
        return frustum.containsPoint(worldPos);
    });

    const highlightGeometry = new THREE.CircleGeometry(MAP_CONFIG.HEX_RADIUS * 1.5, 6);
    const highlightMaterial = new THREE.MeshBasicMaterial({
        color: HIGHLIGHT_COLORS.VISIBLE_AREA,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });

    visibleHexes.forEach(hex => {
        const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
        highlight.position.set(hex.userData.x, 0.6, hex.userData.z);
        highlight.rotation.x = -Math.PI / 2;
        highlightGroup.add(highlight);
    });

    console.log("Visible hexes in minimap:", visibleHexes.length);
}