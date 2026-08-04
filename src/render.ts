import { VisualizationSystem } from './shared/hexengine/VisualizationSystem';
import { GridSystem } from './shared/hexengine/GridSystem';
import { GlowSystem } from './shared/hexengine/GlowSystem';
import { RotorSystem } from './shared/hexengine/RotorSystem';
import { viewOptions } from './shared/hexengine/ViewOptions';
import { consumeShadowsDirty, markShadowsDirty } from './shared/hexengine/ShadowBudget';
import { FrameStats } from './systems/frameStats';
import { MAP_CONFIG, HIGHLIGHT_COLORS } from './constants';
import type { CameraMatrices } from './types';

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

// cameraHeight is mutated by game.ts's wheel handler; expose it through
// accessors instead of a raw exported binding so both files always read
// and write the same live value (module scope doesn't share a mutable
// `let` across files the way classic scripts used to).
function getCameraHeight() {
    return cameraHeight;
}

function setCameraHeight(height: number) {
    cameraHeight = height;
}

// Calculate map dimensions for shadow camera
const mapWidth = MAP_CONFIG.COLS * MAP_CONFIG.HEX_RADIUS * 1.5;  // 75 units
const mapHeight = MAP_CONFIG.ROWS * MAP_CONFIG.HEX_RADIUS * Math.sqrt(3);  // ~86.6 units

// Renderer Initialization
// Post-processing chain for the bloom. Built lazily in initRenderer.
let composer: any = null;
let bloomPass: any = null;

// Only the emissive energy panels should bloom -- not the snow caps, not
// the white shore foam. Luminance alone cannot separate them in an 8-bit
// buffer: everything bright clamps to 1.0 before the bloom pass ever sees
// it. So the composer renders into a HALF-FLOAT target, where the panels'
// emissive (up to ~3.0 once GlowSystem drives it) survives above 1 while
// snow and foam stay at or below it, and the threshold sits just above 1.
const BLOOM_STRENGTH = 0.9;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1.02;

function buildComposer() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
    });

    composer = new THREE.EffectComposer(renderer, target);
    composer.setSize(size.x, size.y);
    composer.addPass(new THREE.RenderPass(scene, camera));

    bloomPass = new THREE.UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    composer.addPass(bloomPass);
}

// The composer owns its own render targets, so resizing the renderer alone
// leaves the bloom rendering at the old resolution. EffectComposer.setSize
// forwards to every pass, so the bloom pass does not need resizing too.
function resizeComposer(width: number, height: number) {
    composer?.setSize(width, height);
}

// The shadow map is the single most expensive thing in the frame. Measured
// on the shipped map: shadows off runs at the 60 Hz vsync cap (16.7 ms,
// 1294 draws); on at 4096 it is 22.0 ms and 2614 draws. So the shadow pass
// is roughly HALF of every draw call and about 5.3 ms.
//
// Almost all of that is wasted. This is a turn-based game whose camera is
// usually parked, so the same shadow map is regenerated from an unchanged
// scene sixty times a second. autoUpdate off plus an explicit refresh
// spends it only when something actually moved.
//
// The interval is a SAFETY NET, not the mechanism: markShadowsDirty() is
// the mechanism, and the interval means a missed call site shows up as a
// shadow one or two frames stale rather than as a shadow frozen forever.
// Cheap insurance against a bug class that is invisible until someone
// notices a dead unit's shadow still lying on the grass.
const SHADOW_REFRESH_INTERVAL = 3;
let framesSinceShadowRefresh = 0;

function initRenderer() {
    if (isRendererInitialized) {
        return;
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;  // Enable shadow mapping
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // Regenerated on demand -- see SHADOW_REFRESH_INTERVAL above.
    renderer.shadowMap.autoUpdate = false;
    document.body.appendChild(renderer.domElement);
    scene.add(group);

    buildComposer();

    isRendererInitialized = true;
}

// Call initRenderer when the page loads
window.addEventListener('load', initRenderer);

// Camera Setup
function setupCamera(mapCenterX: number, mapCenterZ: number): CameraMatrices {
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

function getLookDirection(height: number) {
    const minDownwardTilt = -1;
    const maxDownwardTilt = -3;
    const tiltFactor = (height - MAP_CONFIG.CAMERA.MIN_HEIGHT) / (MAP_CONFIG.CAMERA.MAX_HEIGHT - MAP_CONFIG.CAMERA.MIN_HEIGHT);
    const downwardTilt = minDownwardTilt + tiltFactor * (maxDownwardTilt - minDownwardTilt);
    return new THREE.Vector3(0, downwardTilt, -1).normalize();
}

function setCameraPosition(worldX: number, worldZ: number, matrices: CameraMatrices) {
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

function updateCameraPosition(deltaX: number, deltaY: number, matrices: CameraMatrices) {
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

function updateCameraZoom(matrices: CameraMatrices) {
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
function setupMinimap(mapCenterX: number, mapCenterZ: number) {
    const miniMapCamera = new THREE.OrthographicCamera(
        -mapWidth / 2, mapWidth / 2,    // x: -37.5 to 37.5
        mapHeight / 2, -mapHeight / 2,  // z: 43.3 to -43.3
        0.1, 1000
    );
    miniMapCamera.position.set(mapCenterX, 100, mapCenterZ);
    miniMapCamera.rotation.x = -Math.PI / 2;
    miniMapCamera.updateProjectionMatrix();

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

    // Group for highlight hexes
    const highlightGroup = new THREE.Group();
    highlightGroup.name = "miniMapHighlights";
    miniMapScene.add(highlightGroup);

    return { miniMapCamera, mapWidth, mapHeight, highlightGroup };
}

// Animation Loop
function animate(miniMapCamera: any, matrices: CameraMatrices, mapWidth: number, mapHeight: number, highlightGroup: any) {
    requestAnimationFrame(() => animate(miniMapCamera, matrices, mapWidth, mapHeight, highlightGroup));

    // Before any rendering, so the counters cover the whole frame rather
    // than only the last render() call.
    FrameStats.beginFrame(renderer);

    // Update path animation
    VisualizationSystem.updatePathAnimation();

    // Animate water tiles
    const seconds = performance.now() * 0.001;
    GridSystem.animateWater(seconds);

    // Gutter the models' energy panels on the same clock.
    GlowSystem.animate(seconds);

    // Spin the helicopters' rotors. Blades move every frame, so their
    // shadow is stale every frame -- but only while a helicopter is alive.
    if (RotorSystem.animate(seconds)) markShadowsDirty();

    // Refresh the shadow map only when the scene it depicts has changed.
    framesSinceShadowRefresh++;
    const refreshShadows = consumeShadowsDirty() || framesSinceShadowRefresh >= SHADOW_REFRESH_INTERVAL;
    renderer.shadowMap.needsUpdate = refreshShadows;
    if (refreshShadows) framesSinceShadowRefresh = 0;

    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 0); // Set clear color to transparent black
    // Through the bloom chain rather than straight to the canvas. The
    // composer leaves the renderer's viewport and scissor alone, so the
    // minimap below still draws into its own corner afterwards.
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }

    // Skipping the minimap leaves nothing behind: the pass above covers the
    // whole viewport every frame, so its corner is simply drawn over.
    if (!viewOptions.minimap) {
        renderer.setScissorTest(false);
        FrameStats.endFrame(performance.now(), renderer);
        return;
    }

    // The minimap draws a second scene into the same framebuffer and relies
    // on autoClear to clear inside its scissor rect. The bloom chain's
    // passes set autoClear false and restore it -- but NOT in a finally, so
    // a pass that throws would leave it false and the minimap would ghost
    // over the scene from then on. Assert it rather than inherit it.
    renderer.autoClear = true;

    const left = window.innerWidth - MAP_CONFIG.MINIMAP.WIDTH - 10;
    // Cleared from the top by the toolbar that sits above it.
    const bottom = window.innerHeight - MAP_CONFIG.MINIMAP.HEIGHT - MAP_CONFIG.MINIMAP.TOP;
    renderer.setViewport(left, bottom, MAP_CONFIG.MINIMAP.WIDTH, MAP_CONFIG.MINIMAP.HEIGHT);
    renderer.setScissor(left, bottom, MAP_CONFIG.MINIMAP.WIDTH, MAP_CONFIG.MINIMAP.HEIGHT);
    renderer.setClearColor(0x111111, 1);  // Much darker background for better glow effect

    updateMiniMapHighlights(highlightGroup, matrices);
    renderer.render(miniMapScene, miniMapCamera);

    renderer.setScissorTest(false);
    FrameStats.endFrame(performance.now(), renderer);
}

// Update minimap highlights
function updateMiniMapHighlights(highlightGroup: any, matrices: CameraMatrices) {
    while (highlightGroup.children.length > 0) {
        highlightGroup.remove(highlightGroup.children[0]);
    }

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );

    const visibleHexes = GridSystem.hexGrid.filter((hex: any) => {
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

    visibleHexes.forEach((hex: any) => {
        const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
        highlight.position.set(hex.userData.x, 0.6, hex.userData.z);
        highlight.rotation.x = -Math.PI / 2;
        highlightGroup.add(highlight);
    });
}

export {
    scene, camera, renderer, group, miniMapScene, mapWidth, mapHeight, cameraTarget,
    initRenderer, setupCamera, getLookDirection, setCameraPosition, updateCameraPosition,
    updateCameraZoom, setupMinimap, animate, updateMiniMapHighlights,
    getCameraHeight, setCameraHeight, resizeComposer, markShadowsDirty,
};