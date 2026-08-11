import './threeGlobal';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
    animateDecorationWind,
    createDeciduousTreeModel,
    type DeciduousTreeParameters,
} from './shared/hexengine/ProceduralDecorations';

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
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
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

scene.add(new THREE.HemisphereLight(0xc9d5bf, 0x252018, 1.65));

const sun = new THREE.DirectionalLight(0xffe5be, 3.6);
sun.position.set(-3.5, 6, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -2;
sun.shadow.bias = -0.0004;
scene.add(sun);

const rim = new THREE.DirectionalLight(0x93b9b0, 1.1);
rim.position.set(4, 2.5, -5);
scene.add(rim);

let tree: any = null;

function replaceTree(parameters: Partial<DeciduousTreeParameters> = {}): void {
    const next = createDeciduousTreeModel(parameters);
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

const crownSize = document.querySelector<HTMLInputElement>('#crown-size');
const branchCount = document.querySelector<HTMLInputElement>('#branch-count');
const recursion = document.querySelector<HTMLInputElement>('#recursion');
const branchLength = document.querySelector<HTMLInputElement>('#branch-length');
const trunkSize = document.querySelector<HTMLInputElement>('#trunk-size');
const crownSizeValue = document.querySelector<HTMLOutputElement>('#crown-size-value');
const branchCountValue = document.querySelector<HTMLOutputElement>('#branch-count-value');
const recursionValue = document.querySelector<HTMLOutputElement>('#recursion-value');
const branchLengthValue = document.querySelector<HTMLOutputElement>('#branch-length-value');
const trunkSizeValue = document.querySelector<HTMLOutputElement>('#trunk-size-value');
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
        crownScale: Number(crownSize?.value ?? 1),
        maxBranchesPerFork: Number(branchCount?.value ?? 4),
        recursionDepth: Number(recursion?.value ?? 2),
        branchLengthRatio: Number(branchLength?.value ?? 65) / 100,
        trunkScale: Number(trunkSize?.value ?? 1),
    };
}

let rebuildTimer: number | undefined;
function parametersChanged(): void {
    const parameters = readParameters();
    if (crownSizeValue) crownSizeValue.value = `${parameters.crownScale.toFixed(2)}×`;
    if (branchCountValue) branchCountValue.value = String(parameters.maxBranchesPerFork);
    if (recursionValue) recursionValue.value = String(parameters.recursionDepth);
    if (branchLengthValue) branchLengthValue.value = `${Math.round(parameters.branchLengthRatio * 100)}%`;
    if (trunkSizeValue) trunkSizeValue.value = `${parameters.trunkScale.toFixed(2)}×`;

    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => replaceTree(parameters), 80);
}

for (const input of [crownSize, branchCount, recursion, branchLength, trunkSize]) {
    input?.addEventListener('input', parametersChanged);
}
parametersChanged();

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
