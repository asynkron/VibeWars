// The toolbar above the minimap: three toggles for how the world is drawn.
//
// Built here rather than in index.html because two of the three have to
// stay in step with things only the code knows -- the minimap's DOM click
// target has to disappear with the minimap it points at, and the button
// states have to reflect whatever was restored from storage rather than
// whatever the markup happened to say.

import { MAP_CONFIG, MAP_KEY } from '../constants';
import {
    getRuntimeMaterialCalibration,
    setRuntimeMaterialCalibration,
} from '../shared/hexengine/MaterialCalibration';
import { SunSystem } from '../shared/hexengine/SunSystem';
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
    fov: 70,
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
    fov: 70,
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
    window.dispatchEvent(new Event('vibewars-camera-view-changed'));
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

function createSceneControls(): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'sun-controls';
    controls.id = 'scene-controls';

    const angles = SunSystem.getAngles();
    const waterCalibration = getRuntimeMaterialCalibration('water');
    const makeRange = (
        label: string,
        min: number,
        max: number,
        value: number,
        format: (rangeValue: number) => string,
    ): { row: HTMLLabelElement; input: HTMLInputElement; output: HTMLOutputElement } => {
        const row = document.createElement('label');
        row.className = 'sun-control';

        const text = document.createElement('span');
        text.textContent = label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        input.value = String(value);

        const output = document.createElement('output');
        output.value = format(value);

        row.append(text, input, output);
        return { row, input, output };
    };

    const degrees = (value: number): string => `${Math.round(value)}°`;
    const percent = (value: number): string => `${Math.round(value)}%`;
    const azimuth = makeRange('Solrotation', 0, 360, angles.azimuth, degrees);
    const elevation = makeRange('Sol över plan', 0, 180, angles.elevation, degrees);
    const strength = makeRange('Solstyrka', 0, 300, SunSystem.getStrength() * 100, percent);
    const perspective = makeRange('Perspektiv', 20, 100, camera.fov, degrees);
    const waterSaturation = makeRange('Vattenmättnad', 0, 300, waterCalibration.saturation * 100, percent);
    const waterContrast = makeRange('Vattenkontrast', 0, 300, waterCalibration.contrast * 100, percent);
    const waterBrightness = makeRange('Vattenljushet', 0, 300, waterCalibration.exposure * 100, percent);
    azimuth.input.title = 'Rotate the directional light around the battlefield';
    elevation.input.title = 'Move the directional light over the battlefield';
    strength.input.title = 'Adjust the strength of the directional sunlight';
    perspective.input.title = 'Adjust camera lens: low is flatter telephoto, high is stronger wide-angle perspective';
    waterSaturation.input.title = 'Adjust saturation of the final rendered water colour';
    waterContrast.input.title = 'Adjust contrast of the final rendered water colour';
    waterBrightness.input.title = 'Adjust brightness of the final rendered water colour';

    const updateSun = (): void => {
        const azimuthDegrees = Number(azimuth.input.value);
        const elevationDegrees = Number(elevation.input.value);
        const strengthPercent = Number(strength.input.value);
        azimuth.output.value = degrees(azimuthDegrees);
        elevation.output.value = degrees(elevationDegrees);
        strength.output.value = percent(strengthPercent);
        SunSystem.setAngles(azimuthDegrees, elevationDegrees);
        SunSystem.setStrength(strengthPercent / 100);
    };
    const updatePerspective = (): void => {
        camera.fov = Number(perspective.input.value);
        perspective.output.value = degrees(camera.fov);
        camera.updateProjectionMatrix();
    };
    const syncPerspective = (): void => {
        perspective.input.value = String(camera.fov);
        perspective.output.value = degrees(camera.fov);
    };
    const updateWater = (): void => {
        waterCalibration.saturation = Number(waterSaturation.input.value) / 100;
        waterCalibration.contrast = Number(waterContrast.input.value) / 100;
        waterCalibration.exposure = Number(waterBrightness.input.value) / 100;
        waterSaturation.output.value = percent(waterCalibration.saturation * 100);
        waterContrast.output.value = percent(waterCalibration.contrast * 100);
        waterBrightness.output.value = percent(waterCalibration.exposure * 100);
        setRuntimeMaterialCalibration('water', waterCalibration);
    };
    azimuth.input.addEventListener('input', updateSun);
    elevation.input.addEventListener('input', updateSun);
    strength.input.addEventListener('input', updateSun);
    perspective.input.addEventListener('input', updatePerspective);
    waterSaturation.input.addEventListener('input', updateWater);
    waterContrast.input.addEventListener('input', updateWater);
    waterBrightness.input.addEventListener('input', updateWater);
    window.addEventListener('vibewars-camera-view-changed', syncPerspective);

    controls.append(
        azimuth.row,
        elevation.row,
        strength.row,
        perspective.row,
        waterSaturation.row,
        waterContrast.row,
        waterBrightness.row,
    );
    return controls;
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

    const sceneControls = createSceneControls();
    sceneControls.hidden = true;

    const sceneControlsButton = document.createElement('button');
    sceneControlsButton.className = 'view-toggle';
    sceneControlsButton.textContent = '…';
    sceneControlsButton.title = 'Show or hide scene controls';
    sceneControlsButton.setAttribute('aria-controls', sceneControls.id);
    sceneControlsButton.setAttribute('aria-expanded', 'false');
    sceneControlsButton.addEventListener('click', () => {
        sceneControls.hidden = !sceneControls.hidden;
        const open = !sceneControls.hidden;
        sceneControlsButton.classList.toggle('is-on', open);
        sceneControlsButton.setAttribute('aria-expanded', String(open));
    });
    toolbar.append(sceneControlsButton, sceneControls);

    document.body.appendChild(toolbar);
    syncMinimapOverlay(viewOptions);
    FrameStats.setEnabled(viewOptions.stats, renderer);
}
