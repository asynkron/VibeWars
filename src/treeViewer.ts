import './threeGlobal';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    animateDecorationWind,
    createDeciduousTreeModel,
    setDecorationCanopyTexture,
    setDecorationCanopyTextureAlphaThreshold,
    setDecorationCanopyTextureEdgeFade,
    setDecorationCanopyColorAdjust,
    setDecorationCrownOpacity,
    setDecorationLeafGloss,
    setDecorationLeafScale,
    setDecorationWindStrength,
    type DeciduousCanopyTexture,
    type DeciduousCrownShape,
    type DeciduousTreeParameters,
    type DeciduousTreeParameterOverrides,
} from './shared/hexengine/ProceduralDecorations';
import { SunSystem } from './shared/hexengine/SunSystem';
import { TREE_PRESETS, type TreePreset } from './treePresets';

const host = document.querySelector<HTMLElement>('#viewer');
if (!host) throw new Error('Tree viewer host is missing');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x172019);
scene.fog = new THREE.FogExp2(0x172019, 0.055);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 100);
const defaultCameraPosition = new THREE.Vector3(4.4, 2.65, 5.2);
camera.position.copy(defaultCameraPosition);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
const defaultTarget = new THREE.Vector3(0, 1.05, 0);
controls.target.copy(defaultTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 2.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.94;
controls.zoomToCursor = true;
controls.update();

// Match the game renderer exactly: its assets were authored against the
// legacy r128 light equation, compensated by π in modern Three.js.
scene.add(new THREE.AmbientLight(0xffffff, 0.5 * Math.PI));

const sun = new THREE.DirectionalLight(0xffffff, 1.2 * Math.PI);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -2;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.001;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2.2;
sun.shadow.blurSamples = 8;
scene.add(sun);
SunSystem.init(scene, sun);
SunSystem.setCenter(0, 0, 0);

let tree: any = null;

function replaceTree(parameters: DeciduousTreeParameterOverrides = {}): void {
    const next = createDeciduousTreeModel(parameters);
    setDecorationWindStrength(next, Number(windStrength?.value ?? 100) / 100);
    const bounds = new THREE.Box3().setFromObject(next);
    const center = bounds.getCenter(new THREE.Vector3());
    next.position.set(-center.x, -bounds.min.y, -center.z);
    updateTreeStats(next, bounds);

    if (tree) {
        scene.remove(tree);
        tree.traverse((child: any) => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) material?.dispose?.();
            child.customDepthMaterial?.dispose?.();
        });
    }
    tree = next;
    scene.add(tree);
}

const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.25, 2.38, 0.16, 96),
    new THREE.MeshStandardMaterial({ color: 0x30382c, roughness: 0.96, metalness: 0 })
);
platform.position.y = -0.10;
platform.receiveShadow = true;
scene.add(platform);

const grid = new THREE.GridHelper(4.5, 18, 0x71805f, 0x3d493a);
grid.position.y = -0.012;
(grid.material as any).transparent = true;
(grid.material as any).opacity = 0.32;
scene.add(grid);

const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x121713, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.19;
ground.receiveShadow = true;
scene.add(ground);

const gridToggle = document.querySelector<HTMLButtonElement>('#grid-toggle');
const rotateToggle = document.querySelector<HTMLButtonElement>('#rotate-toggle');
const resetButton = document.querySelector<HTMLButtonElement>('#reset-view');
const presetCards = [...document.querySelectorAll<HTMLButtonElement>('[data-preset]')];
const presetCount = document.querySelector<HTMLElement>('#preset-count');
const presetVariant = document.querySelector<HTMLElement>('#preset-variant');
let activeBarkProfile = 0;

const canopyWidthScale = document.querySelector<HTMLInputElement>('#canopy-width-scale');
const canopyWidthRatioPerTrunkLevel = document.querySelector<HTMLInputElement>('#canopy-width-ratio-per-trunk-level');
const canopyHeightScale = document.querySelector<HTMLInputElement>('#canopy-height-scale');
const canopyShape = document.querySelector<HTMLSelectElement>('#canopy-shape');
const canopyTexture = document.querySelector<HTMLSelectElement>('#canopy-texture');
const canopyTextureAlphaThreshold = document.querySelector<HTMLInputElement>('#canopy-texture-alpha-threshold');
const canopyTextureEdgeFade = document.querySelector<HTMLInputElement>('#canopy-texture-edge-fade');
const canopyLeafScale = document.querySelector<HTMLInputElement>('#canopy-leaf-scale');
const canopyGloss = document.querySelector<HTMLInputElement>('#canopy-gloss');
const canopyInnerOpacity = document.querySelector<HTMLInputElement>('#canopy-inner-opacity');
const canopyBrightness = document.querySelector<HTMLInputElement>('#canopy-brightness');
const canopyContrast = document.querySelector<HTMLInputElement>('#canopy-contrast');
const canopySaturation = document.querySelector<HTMLInputElement>('#canopy-saturation');
const canopyHue = document.querySelector<HTMLInputElement>('#canopy-hue');
const branchGravityStrength = document.querySelector<HTMLInputElement>('#branch-gravity-strength');
const windStrength = document.querySelector<HTMLInputElement>('#wind-strength');
const branchCountPerFork = document.querySelector<HTMLInputElement>('#branch-count-per-fork');
const branchLevels = document.querySelector<HTMLInputElement>('#branch-levels');
const canopyDepth = document.querySelector<HTMLInputElement>('#canopy-depth');
const trunkLevels = document.querySelector<HTMLInputElement>('#trunk-levels');
const trunkBaseLengthRatio = document.querySelector<HTMLInputElement>('#trunk-base-length-ratio');
const branchStartLengthRatio = document.querySelector<HTMLInputElement>('#branch-start-length-ratio');
const branchLengthRatioPerTrunkLevel = document.querySelector<HTMLInputElement>('#branch-length-ratio-per-trunk-level');
const branchChildLengthRatio = document.querySelector<HTMLInputElement>('#branch-child-length-ratio');
const trunkChildLengthRatio = document.querySelector<HTMLInputElement>('#trunk-child-length-ratio');
const trunkBaseRadiusScale = document.querySelector<HTMLInputElement>('#trunk-base-radius-scale');
const branchChildRadiusRatio = document.querySelector<HTMLInputElement>('#branch-child-radius-ratio');
const trunkTipRadiusRatio = document.querySelector<HTMLInputElement>('#trunk-tip-radius-ratio');
const canopyWidthScaleValue = document.querySelector<HTMLOutputElement>('#canopy-width-scale-value');
const canopyWidthRatioPerTrunkLevelValue = document.querySelector<HTMLOutputElement>('#canopy-width-ratio-per-trunk-level-value');
const canopyHeightScaleValue = document.querySelector<HTMLOutputElement>('#canopy-height-scale-value');
const canopyLeafScaleValue = document.querySelector<HTMLOutputElement>('#canopy-leaf-scale-value');
const canopyGlossValue = document.querySelector<HTMLOutputElement>('#canopy-gloss-value');
const canopyInnerOpacityValue = document.querySelector<HTMLOutputElement>('#canopy-inner-opacity-value');
const canopyTextureAlphaThresholdValue = document.querySelector<HTMLOutputElement>('#canopy-texture-alpha-threshold-value');
const canopyTextureEdgeFadeValue = document.querySelector<HTMLOutputElement>('#canopy-texture-edge-fade-value');
const canopyBrightnessValue = document.querySelector<HTMLOutputElement>('#canopy-brightness-value');
const canopyContrastValue = document.querySelector<HTMLOutputElement>('#canopy-contrast-value');
const canopySaturationValue = document.querySelector<HTMLOutputElement>('#canopy-saturation-value');
const canopyHueValue = document.querySelector<HTMLOutputElement>('#canopy-hue-value');
const branchGravityStrengthValue = document.querySelector<HTMLOutputElement>('#branch-gravity-strength-value');
const windStrengthValue = document.querySelector<HTMLOutputElement>('#wind-strength-value');
const branchCountPerForkValue = document.querySelector<HTMLOutputElement>('#branch-count-per-fork-value');
const branchLevelsValue = document.querySelector<HTMLOutputElement>('#branch-levels-value');
const canopyDepthValue = document.querySelector<HTMLOutputElement>('#canopy-depth-value');
const trunkLevelsValue = document.querySelector<HTMLOutputElement>('#trunk-levels-value');
const trunkBaseLengthRatioValue = document.querySelector<HTMLOutputElement>('#trunk-base-length-ratio-value');
const branchStartLengthRatioValue = document.querySelector<HTMLOutputElement>('#branch-start-length-ratio-value');
const branchLengthRatioPerTrunkLevelValue = document.querySelector<HTMLOutputElement>('#branch-length-ratio-per-trunk-level-value');
const branchChildLengthRatioValue = document.querySelector<HTMLOutputElement>('#branch-child-length-ratio-value');
const trunkChildLengthRatioValue = document.querySelector<HTMLOutputElement>('#trunk-child-length-ratio-value');
const trunkBaseRadiusScaleValue = document.querySelector<HTMLOutputElement>('#trunk-base-radius-scale-value');
const branchChildRadiusRatioValue = document.querySelector<HTMLOutputElement>('#branch-child-radius-ratio-value');
const trunkTipRadiusRatioValue = document.querySelector<HTMLOutputElement>('#trunk-tip-radius-ratio-value');
const statTriangles = document.querySelector<HTMLElement>('#stat-triangles');
const statVertices = document.querySelector<HTMLElement>('#stat-vertices');
const statBranches = document.querySelector<HTMLElement>('#stat-branches');
const statForks = document.querySelector<HTMLElement>('#stat-forks');
const statCrowns = document.querySelector<HTMLElement>('#stat-crowns');
const statGenerations = document.querySelector<HTMLElement>('#stat-generations');
const statDrawCalls = document.querySelector<HTMLElement>('#stat-draw-calls');
const statSize = document.querySelector<HTMLElement>('#stat-size');
const numberFormat = new Intl.NumberFormat('sv-SE');

function updateTreeStats(model: any, bounds: any): void {
    let triangles = 0;
    let vertices = 0;
    let drawCalls = 0;
    model.traverse((child: any) => {
        if (!child.isMesh || !child.geometry) return;
        drawCalls++;
        const positionCount = child.geometry.attributes?.position?.count ?? 0;
        vertices += positionCount;
        triangles += (child.geometry.index?.count ?? positionCount) / 3;
    });

    const logical = model.userData.treeStats ?? {};
    const size = bounds.getSize(new THREE.Vector3());
    if (statTriangles) statTriangles.textContent = numberFormat.format(Math.round(triangles));
    if (statVertices) statVertices.textContent = numberFormat.format(vertices);
    if (statBranches) statBranches.textContent = numberFormat.format(logical.branches ?? 0);
    if (statForks) statForks.textContent = numberFormat.format(logical.forks ?? 0);
    if (statCrowns) statCrowns.textContent = numberFormat.format(logical.crownClusters ?? 0);
    if (statGenerations) statGenerations.textContent = numberFormat.format(logical.generations ?? 0);
    if (statDrawCalls) statDrawCalls.textContent = numberFormat.format(drawCalls);
    if (statSize) statSize.textContent = `${size.y.toFixed(2)} × ${Math.max(size.x, size.z).toFixed(2)} m`;
}

function readParameters(): DeciduousTreeParameters {
    return {
        branches: {
            countPerFork: Number(branchCountPerFork?.value ?? 3),
            levels: Number(branchLevels?.value ?? 2),
            startLengthRatio: Number(branchStartLengthRatio?.value ?? 38) / 100,
            lengthRatioPerTrunkLevel: Number(branchLengthRatioPerTrunkLevel?.value ?? 75) / 100,
            childLengthRatio: Number(branchChildLengthRatio?.value ?? 75) / 100,
            childRadiusRatio: Number(branchChildRadiusRatio?.value ?? 73) / 100,
            gravity: Number(branchGravityStrength?.value ?? 300) / 100,
        },
        trunk: {
            levels: Number(trunkLevels?.value ?? 3),
            baseLengthRatio: Number(trunkBaseLengthRatio?.value ?? 50) / 100,
            childLengthRatio: Number(trunkChildLengthRatio?.value ?? 75) / 100,
            baseRadiusScale: Number(trunkBaseRadiusScale?.value ?? 1.3),
            tipRadiusRatio: Number(trunkTipRadiusRatio?.value ?? 26) / 100,
        },
        canopy: {
            shape: (canopyShape?.value ?? 'dome') as DeciduousCrownShape,
            texture: (canopyTexture?.value ?? 'maple') as DeciduousCanopyTexture,
            textureAlphaThreshold: Number(canopyTextureAlphaThreshold?.value ?? 12) / 100,
            textureEdgeFade: Number(canopyTextureEdgeFade?.value ?? 38) / 100,
            widthScale: Number(canopyWidthScale?.value ?? 1.9),
            widthRatioPerTrunkLevel: Number(canopyWidthRatioPerTrunkLevel?.value ?? 100) / 100,
            heightScale: Number(canopyHeightScale?.value ?? 1.9),
            leafScale: Number(canopyLeafScale?.value ?? 0.65),
            gloss: Number(canopyGloss?.value ?? 60) / 100,
            innerOpacity: Number(canopyInnerOpacity?.value ?? 75) / 100,
            brightness: Number(canopyBrightness?.value ?? 100) / 100,
            contrast: Number(canopyContrast?.value ?? 100) / 100,
            saturation: Number(canopySaturation?.value ?? 100) / 100,
            hue: Number(canopyHue?.value ?? 0) * Math.PI / 180,
            depthFromTip: Number(canopyDepth?.value ?? 0),
            // The workbench drives color through live material uniforms.
            // Packed color profiles are only for batched in-game trees and
            // would override the sliders in the shader.
            colorProfile: 0,
            barkProfile: activeBarkProfile,
        },
    };
}

function setInputValue(input: HTMLInputElement | HTMLSelectElement | null, value: number | string): void {
    if (input) input.value = String(value);
}

function applyPreset(preset: TreePreset): void {
    const { branches, trunk, canopy } = preset.parameters;
    activeBarkProfile = canopy.barkProfile ?? 0;
    setInputValue(branchCountPerFork, branches.countPerFork);
    setInputValue(branchLevels, branches.levels);
    setInputValue(branchStartLengthRatio, branches.startLengthRatio * 100);
    setInputValue(branchLengthRatioPerTrunkLevel, branches.lengthRatioPerTrunkLevel * 100);
    setInputValue(branchChildLengthRatio, branches.childLengthRatio * 100);
    setInputValue(branchChildRadiusRatio, branches.childRadiusRatio * 100);
    setInputValue(branchGravityStrength, branches.gravity * 100);
    setInputValue(trunkLevels, trunk.levels);
    setInputValue(trunkBaseLengthRatio, trunk.baseLengthRatio * 100);
    setInputValue(trunkChildLengthRatio, trunk.childLengthRatio * 100);
    setInputValue(trunkBaseRadiusScale, trunk.baseRadiusScale);
    setInputValue(trunkTipRadiusRatio, trunk.tipRadiusRatio * 100);
    setInputValue(canopyShape, canopy.shape);
    setInputValue(canopyTexture, canopy.texture);
    setInputValue(canopyTextureAlphaThreshold, canopy.textureAlphaThreshold * 100);
    setInputValue(canopyTextureEdgeFade, canopy.textureEdgeFade * 100);
    setInputValue(canopyDepth, canopy.depthFromTip);
    setInputValue(canopyWidthScale, canopy.widthScale);
    setInputValue(canopyWidthRatioPerTrunkLevel, canopy.widthRatioPerTrunkLevel * 100);
    setInputValue(canopyHeightScale, canopy.heightScale);
    setInputValue(canopyLeafScale, canopy.leafScale);
    setInputValue(canopyGloss, canopy.gloss * 100);
    setInputValue(canopyInnerOpacity, canopy.innerOpacity * 100);
    setInputValue(canopyBrightness, canopy.brightness * 100);
    setInputValue(canopyContrast, canopy.contrast * 100);
    setInputValue(canopySaturation, canopy.saturation * 100);
    setInputValue(canopyHue, canopy.hue * 180 / Math.PI);
    setInputValue(windStrength, preset.windStrength * 100);

    for (const card of presetCards) {
        const selected = card.dataset.preset === preset.id;
        card.classList.toggle('is-active', selected);
        card.setAttribute('aria-pressed', String(selected));
    }
    if (presetCount) {
        const index = TREE_PRESETS.findIndex(candidate => candidate.id === preset.id);
        presetCount.textContent = `${String(index + 1).padStart(2, '0')} / ${String(TREE_PRESETS.length).padStart(2, '0')}`;
    }
    if (presetVariant) presetVariant.textContent = preset.variant;
    if (windStrengthValue) windStrengthValue.value = `${Math.round(preset.windStrength * 100)}%`;
    parametersChanged();
}

let rebuildTimer: number | undefined;
function parametersChanged(): void {
    const parameters = readParameters();
    if (branchCountPerForkValue) branchCountPerForkValue.value = String(parameters.branches.countPerFork);
    if (branchLevelsValue) branchLevelsValue.value = String(parameters.branches.levels);
    if (branchStartLengthRatioValue) branchStartLengthRatioValue.value = `${Math.round(parameters.branches.startLengthRatio * 100)}%`;
    if (branchLengthRatioPerTrunkLevelValue) branchLengthRatioPerTrunkLevelValue.value = `${Math.round(parameters.branches.lengthRatioPerTrunkLevel * 100)}%`;
    if (branchChildLengthRatioValue) branchChildLengthRatioValue.value = `${Math.round(parameters.branches.childLengthRatio * 100)}%`;
    if (branchChildRadiusRatioValue) branchChildRadiusRatioValue.value = `${Math.round(parameters.branches.childRadiusRatio * 100)}%`;
    if (branchGravityStrengthValue) branchGravityStrengthValue.value = `${Math.round(parameters.branches.gravity * 100)}%`;
    if (trunkLevelsValue) trunkLevelsValue.value = String(parameters.trunk.levels);
    if (trunkBaseLengthRatioValue) trunkBaseLengthRatioValue.value = `${Math.round(parameters.trunk.baseLengthRatio * 100)}%`;
    if (trunkChildLengthRatioValue) trunkChildLengthRatioValue.value = `${Math.round(parameters.trunk.childLengthRatio * 100)}%`;
    if (trunkBaseRadiusScaleValue) trunkBaseRadiusScaleValue.value = `${parameters.trunk.baseRadiusScale.toFixed(2)}×`;
    if (trunkTipRadiusRatioValue) trunkTipRadiusRatioValue.value = `${Math.round(parameters.trunk.tipRadiusRatio * 100)}%`;
    if (canopyDepthValue) canopyDepthValue.value = String(parameters.canopy.depthFromTip);
    if (canopyWidthScaleValue) canopyWidthScaleValue.value = `${parameters.canopy.widthScale.toFixed(2)}×`;
    if (canopyWidthRatioPerTrunkLevelValue) canopyWidthRatioPerTrunkLevelValue.value = `${Math.round(parameters.canopy.widthRatioPerTrunkLevel * 100)}%`;
    if (canopyHeightScaleValue) canopyHeightScaleValue.value = `${parameters.canopy.heightScale.toFixed(2)}×`;
    if (canopyLeafScaleValue) canopyLeafScaleValue.value = `${parameters.canopy.leafScale.toFixed(2)}×`;
    if (canopyGlossValue) canopyGlossValue.value = `${Math.round(parameters.canopy.gloss * 100)}%`;
    if (canopyInnerOpacityValue) canopyInnerOpacityValue.value = `${Math.round(parameters.canopy.innerOpacity * 100)}%`;
    if (canopyTextureAlphaThresholdValue) canopyTextureAlphaThresholdValue.value = `${Math.round(parameters.canopy.textureAlphaThreshold * 100)}%`;
    if (canopyTextureEdgeFadeValue) canopyTextureEdgeFadeValue.value = `${Math.round(parameters.canopy.textureEdgeFade * 100)}%`;
    if (canopyBrightnessValue) canopyBrightnessValue.value = `${Math.round(parameters.canopy.brightness * 100)}%`;
    if (canopyContrastValue) canopyContrastValue.value = `${Math.round(parameters.canopy.contrast * 100)}%`;
    if (canopySaturationValue) canopySaturationValue.value = `${Math.round(parameters.canopy.saturation * 100)}%`;
    if (canopyHueValue) canopyHueValue.value = `${Math.round(parameters.canopy.hue * 180 / Math.PI)}°`;

    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => replaceTree(parameters), 80);
}

for (const input of [canopyWidthScale, canopyWidthRatioPerTrunkLevel, canopyHeightScale, canopyTextureAlphaThreshold, canopyTextureEdgeFade, canopyBrightness, canopyContrast, canopySaturation, canopyHue, branchGravityStrength, branchCountPerFork, branchLevels, canopyDepth, trunkLevels, trunkBaseLengthRatio, branchStartLengthRatio, branchLengthRatioPerTrunkLevel, branchChildLengthRatio, trunkChildLengthRatio, trunkBaseRadiusScale, branchChildRadiusRatio, trunkTipRadiusRatio]) {
    input?.addEventListener('input', parametersChanged);
}
canopyShape?.addEventListener('change', parametersChanged);
canopyTexture?.addEventListener('change', parametersChanged);
for (const card of presetCards) {
    card.addEventListener('click', () => {
        const preset = TREE_PRESETS.find(candidate => candidate.id === card.dataset.preset);
        if (preset) applyPreset(preset);
    });
}
applyPreset(TREE_PRESETS[0]);

canopyLeafScale?.addEventListener('input', () => {
    const scale = Number(canopyLeafScale.value);
    if (canopyLeafScaleValue) canopyLeafScaleValue.value = `${scale.toFixed(2)}×`;
    setDecorationLeafScale(tree, scale);
});

canopyTexture?.addEventListener('change', () => {
    setDecorationCanopyTexture(tree, canopyTexture.value as DeciduousCanopyTexture);
});

canopyTextureAlphaThreshold?.addEventListener('input', () => {
    const threshold = Number(canopyTextureAlphaThreshold.value) / 100;
    if (canopyTextureAlphaThresholdValue) canopyTextureAlphaThresholdValue.value = `${Math.round(threshold * 100)}%`;
    setDecorationCanopyTextureAlphaThreshold(tree, threshold);
});

canopyTextureEdgeFade?.addEventListener('input', () => {
    const fade = Number(canopyTextureEdgeFade.value) / 100;
    if (canopyTextureEdgeFadeValue) canopyTextureEdgeFadeValue.value = `${Math.round(fade * 100)}%`;
    setDecorationCanopyTextureEdgeFade(tree, fade);
});

canopyGloss?.addEventListener('input', () => {
    const gloss = Number(canopyGloss.value) / 100;
    if (canopyGlossValue) canopyGlossValue.value = `${Math.round(gloss * 100)}%`;
    setDecorationLeafGloss(tree, gloss);
});

function canopyOpacityChanged(): void {
    const inner = Number(canopyInnerOpacity?.value ?? 100) / 100;
    if (canopyInnerOpacityValue) canopyInnerOpacityValue.value = `${Math.round(inner * 100)}%`;
    setDecorationCrownOpacity(tree, inner, 1);
}

canopyInnerOpacity?.addEventListener('input', canopyOpacityChanged);

windStrength?.addEventListener('input', () => {
    const strength = Number(windStrength.value) / 100;
    if (windStrengthValue) windStrengthValue.value = `${Math.round(strength * 100)}%`;
    setDecorationWindStrength(tree, strength);
});

function setPressed(button: HTMLButtonElement | null, pressed: boolean): void {
    button?.classList.toggle('is-on', pressed);
    button?.setAttribute('aria-pressed', String(pressed));
}

gridToggle?.addEventListener('click', () => {
    grid.visible = !grid.visible;
    setPressed(gridToggle, grid.visible);
});

rotateToggle?.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.8;
    setPressed(rotateToggle, controls.autoRotate);
});

resetButton?.addEventListener('click', () => {
    camera.position.copy(defaultCameraPosition);
    controls.target.copy(defaultTarget);
    controls.autoRotate = false;
    setPressed(rotateToggle, false);
    controls.update();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
    animateDecorationWind(performance.now() * 0.001);
    controls.update();
    renderer.render(scene, camera);
});
