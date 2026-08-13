// The toolbar above the minimap: three toggles for how the world is drawn.
//
// Built here rather than in index.html because two of the three have to
// stay in step with things only the code knows -- the minimap's DOM click
// target has to disappear with the minimap it points at, and the button
// states have to reflect whatever was restored from storage rather than
// whatever the markup happened to say.

import { MAP_CONFIG, MAP_KEY } from '../constants';
import { viewOptions, toggleViewOption, ViewOptions } from '../shared/hexengine/ViewOptions';
import { FrameStats } from './frameStats';
import {
    camera,
    cameraTarget,
    getCameraHeight,
    renderer,
    setBloomEnabled,
    setCameraHeight,
} from '../render';

interface ToggleSpec {
    key: keyof ViewOptions;
    label: string;
    title: string;
}

const TOGGLES: ToggleSpec[] = [
    { key: 'grid', label: 'Grid', title: 'Hex grid lines over the terrain' },
    { key: 'textures', label: 'Textures', title: 'Procedural ground detail, roads and tracks' },
    { key: 'minimap', label: 'Minimap', title: 'The overview map below' },
    { key: 'bloom', label: 'Bloom', title: 'Experimental glow around emissive effects -- expensive and off by default' },
    { key: 'grass', label: 'Grass', title: 'Real grass blades on turf tiles, drawn when the camera is close' },
    { key: 'stats', label: 'Stats', title: 'Frame time, draw calls and triangles' },
];

interface SavedCameraView {
    map: string;
    label: string;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    groundLookAt: [number, number, number];
    up: [number, number, number];
    scale: [number, number, number];
    cameraHeight: number;
    zoom: number;
    fov: number;
    aspect: number;
    near: number;
    far: number;
    focus: number;
    filmGauge: number;
    filmOffset: number;
}

const SAVED_CAMERA_VIEWS: SavedCameraView[] = [{
    map: 'random30fixed',
    label: 'View 1',
    position: [33.01423490563091, 26, 47.958068764895366],
    quaternion: [-0.4478282350657019, 0.2854377067551525, 0.15339230689209105, 0.8333342592421247],
    groundLookAt: [22.465720933342098, 0, 34.366460468487574],
    up: [0, 1, 0],
    scale: [1, 1, 1],
    cameraHeight: 26,
    zoom: 1,
    fov: 45,
    aspect: 1.6,
    near: 1,
    far: 10000,
    focus: 10,
    filmGauge: 35,
    filmOffset: 0,
}, {
    map: 'random30fixed',
    label: 'View 2',
    position: [-3.0336095764246966, 15, 49.17129314655757],
    quaternion: [-0.3833340669417683, -0.39358168809929583, -0.1851714628596237, 0.8147760288921241],
    groundLookAt: [6.689557743838813, -1.7763568394002505e-15, 41.45546255889942],
    up: [0, 1, 0],
    scale: [1, 1, 1],
    cameraHeight: 15,
    zoom: 1,
    fov: 45,
    aspect: 1.6,
    near: 1,
    far: 10000,
    focus: 10,
    filmGauge: 35,
    filmOffset: 0,
}];

function applySavedCameraView(view: SavedCameraView): void {
    camera.position.fromArray(view.position);
    camera.up.fromArray(view.up);
    camera.quaternion.fromArray(view.quaternion).normalize();
    camera.scale.fromArray(view.scale);
    cameraTarget.fromArray(view.groundLookAt);
    setCameraHeight(view.cameraHeight);

    camera.zoom = view.zoom;
    camera.fov = view.fov;
    camera.aspect = view.aspect;
    camera.near = view.near;
    camera.far = view.far;
    camera.focus = view.focus;
    camera.filmGauge = view.filmGauge;
    camera.filmOffset = view.filmOffset;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
}

function xyz(vector: { x: number; y: number; z: number }) {
    return { x: vector.x, y: vector.y, z: vector.z };
}

function cameraViewJson(): string {
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // The camera stores orientation, not a persistent lookAt point. Give the
    // copied data both the authoritative direction/quaternion and the useful
    // point where that ray meets the battlefield's y=0 plane.
    const groundDistance = Math.abs(direction.y) > 1e-8
        ? -camera.position.y / direction.y
        : null;
    const groundLookAt = groundDistance !== null && groundDistance >= 0
        ? camera.position.clone().addScaledVector(direction, groundDistance)
        : null;

    return JSON.stringify({
        schema: 'vibewars-camera-v1',
        map: MAP_KEY,
        projection: 'perspective',
        position: xyz(camera.position),
        direction: xyz(direction),
        groundLookAt: groundLookAt ? xyz(groundLookAt) : null,
        up: xyz(camera.up),
        rotation: {
            x: camera.rotation.x,
            y: camera.rotation.y,
            z: camera.rotation.z,
            order: camera.rotation.order,
        },
        quaternion: {
            x: camera.quaternion.x,
            y: camera.quaternion.y,
            z: camera.quaternion.z,
            w: camera.quaternion.w,
        },
        scale: xyz(camera.scale),
        cameraHeight: getCameraHeight(),
        zoom: camera.zoom,
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        focus: camera.focus,
        filmGauge: camera.filmGauge,
        filmOffset: camera.filmOffset,
        viewOffset: camera.view ?? null,
        projectionMatrix: [...camera.projectionMatrix.elements],
        matrixWorld: [...camera.matrixWorld.elements],
        matrixWorldInverse: [...camera.matrixWorldInverse.elements],
        viewport: {
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            pixelRatio: renderer.getPixelRatio(),
        },
    }, null, 2);
}

async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    // Clipboard API can be unavailable outside localhost/HTTPS. Keep the
    // button useful on a plain LAN dev URL as well.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Browser refused clipboard access');
}

// The minimap's DOM overlay is only a click target -- the map itself is
// drawn into the WebGL canvas by render.ts. Hiding one without the other
// leaves either an invisible click trap or a map that ignores clicks.
function syncMinimapOverlay(options: ViewOptions): void {
    const overlay = document.getElementById('minimap-overlay');
    if (!overlay) return;
    overlay.style.display = options.minimap ? 'block' : 'none';
}

export function initViewToolbar(): void {
    if (document.getElementById('view-toolbar')) return;

    const overlay = document.getElementById('minimap-overlay');
    if (overlay) {
        // One source of truth for where the minimap sits: render.ts places
        // the drawn map from the same constant.
        overlay.style.top = `${MAP_CONFIG.MINIMAP.TOP}px`;
        overlay.style.width = `${MAP_CONFIG.MINIMAP.WIDTH}px`;
        overlay.style.height = `${MAP_CONFIG.MINIMAP.HEIGHT}px`;
    }

    const toolbar = document.createElement('div');
    toolbar.id = 'view-toolbar';

    for (const spec of TOGGLES) {
        const button = document.createElement('button');
        button.className = 'view-toggle';
        button.textContent = spec.label;
        button.title = spec.title;
        button.dataset.key = spec.key;

        const paint = () => {
            const on = viewOptions[spec.key];
            button.classList.toggle('is-on', on);
            // Announced as well as coloured -- these are toggles, and a
            // pressed state is the standard way to say so.
            button.setAttribute('aria-pressed', String(on));
        };
        paint();

        button.addEventListener('click', () => {
            toggleViewOption(spec.key);
            paint();
            if (spec.key === 'minimap') syncMinimapOverlay(viewOptions);
            if (spec.key === 'bloom') setBloomEnabled(viewOptions.bloom);
            if (spec.key === 'stats') FrameStats.setEnabled(viewOptions.stats, renderer);
        });

        toolbar.appendChild(button);
    }

    const copyCameraButton = document.createElement('button');
    copyCameraButton.className = 'view-toggle';
    copyCameraButton.textContent = 'Copy camera';
    copyCameraButton.title = 'Copy the complete camera view as JSON';
    copyCameraButton.addEventListener('click', async () => {
        const originalLabel = 'Copy camera';
        try {
            await copyText(cameraViewJson());
            copyCameraButton.textContent = 'Copied';
        } catch (error) {
            console.error('Could not copy camera JSON', error);
            copyCameraButton.textContent = 'Copy failed';
        }
        window.setTimeout(() => {
            copyCameraButton.textContent = originalLabel;
        }, 1400);
    });
    toolbar.appendChild(copyCameraButton);

    for (const view of SAVED_CAMERA_VIEWS.filter((candidate) => candidate.map === MAP_KEY)) {
        const viewButton = document.createElement('button');
        viewButton.className = 'view-toggle';
        viewButton.textContent = view.label;
        viewButton.title = `Restore ${view.label} for this map`;
        viewButton.addEventListener('click', () => applySavedCameraView(view));
        toolbar.appendChild(viewButton);
    }

    document.body.appendChild(toolbar);
    syncMinimapOverlay(viewOptions);
    FrameStats.setEnabled(viewOptions.stats, renderer);
}
