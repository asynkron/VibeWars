// game.js

// Side-effect only: sets window.HEX_ENGINE from window.HEX_ENGINE_OPTIONS
// (see index.html's inline script). GridSystem.getOption()/HexCoord read it
// at runtime, so it must run before initGame(), but nothing imports its
// exports (it has none) -- hence the bare import.
import './shared/hexengine/options';
import {
    scene, camera, renderer, group, mapWidth, mapHeight,
    initRenderer, setupCamera, setCameraPosition, updateCameraPosition,
    updateCameraZoom, setupMinimap, animate, getCameraHeight, setCameraHeight,
    resizeComposer,
} from './render';
import { SkyboxSystem } from './shared/hexengine/SkyboxSystem';
import { GameState } from './systems/GameState';
import { RoadSystem } from './shared/hexengine/RoadSystem';
import { VisualizationSystem } from './shared/hexengine/VisualizationSystem';
import { PathIndicatorSystem } from './shared/hexengine/PathIndicatorSystem';
import { FootprintSystem } from './shared/hexengine/FootprintSystem';
import { PathfindingSystem } from './shared/hexengine/PathfindingSystem';
import { UnitSystem } from './shared/hexengine/UnitSystem';
import { BuildingSystem } from './shared/hexengine/BuildingSystem';
import { AudioSystem } from './shared/hexengine/AudioSystem';
import { GridSystem } from './shared/hexengine/GridSystem';
import { HexCoord } from './shared/hexengine/HexCoord';
import { TerrainSystem } from './shared/hexengine/TerrainSystem';
import { getHexIntersects } from './shared/hexengine/utils';
import { MAP_CONFIG, MAP_KEY, START_MODE } from './constants';
import { initViewToolbar } from './systems/viewToolbar';
import { renderFrame } from './render';
import { LightPool } from './shared/hexengine/LightPool';
import { setGameState, getGameState } from './systems/gameStateStore';
import { AUTHORED_PROVIDERS, RANDOM_PROVIDERS, selectedMapProvider } from './systems/maps/mapRegistry';
import type { CameraMatrices, GameUnit, PlayerController } from './types';

// Game Data
let selectedUnit: any = null;
let pathLine: any = null;
let isDragging = false;

// Exposed so UnitSystem (attack/handleSelection) can read and clear the
// selection -- same reasoning as render.ts's getCameraHeight/setCameraHeight:
// module scope doesn't share a mutable `let` across files.
function getSelectedUnit() {
    return selectedUnit;
}

function setSelectedUnit(unit: any) {
    selectedUnit = unit;
}
let isDraggingMinimap = false;
let isRotating = false;
let previousMousePosition = { x: 0, y: 0 };
let currentUnitIndex = -1;
let currentHighlightedHex: any = null;  // Track currently highlighted hex

// Event Listeners
function setupEventListeners(matrices: CameraMatrices) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    // Before anything reads the overlay's geometry: this sizes and places
    // it from MAP_CONFIG, and hides it outright if the minimap is toggled off.
    initViewToolbar();

    const minimapOverlay = document.getElementById('minimap-overlay') as HTMLElement;
    const endTurnButton = document.getElementById('end-turn-button') as HTMLButtonElement;

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

    function isMinimapPosition(x: number, y: number): boolean {
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

            // Handle path visualization if we have a selected unit
            if (selectedUnit) {
                await VisualizationSystem.clearPathLine();
                const path = PathfindingSystem.getPath(selectedUnit.q, selectedUnit.r, hexGroup.userData.q, hexGroup.userData.r, selectedUnit.move, selectedUnit);
                if (path.length > 0 && UnitSystem.isValidMove(selectedUnit, hexGroup)) {
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
        setCameraHeight(Math.max(MAP_CONFIG.CAMERA.MIN_HEIGHT, Math.min(MAP_CONFIG.CAMERA.MAX_HEIGHT, getCameraHeight() + deltaHeight)));
        updateCameraZoom(matrices);
    }, { passive: false });

    // True when the player whose turn it is takes input from a human.
    function isHumanTurn(): boolean {
        return getGameState().getCurrentPlayer().controller === 'human';
    }

    // Function to handle unit selection -- the current (human) player's own
    // units only, so hotseat human-vs-human works too.
    function selectUnit(unit: GameUnit | null): boolean {
        if (unit && isHumanTurn() && getGameState().isPlayerTurn(unit.playerIndex)) {
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
            const unitOnHex = getGameState().getUnitAt(hexGroup.userData.q, hexGroup.userData.r);

            // Check if we're attacking a highlighted enemy unit
            if (selectedUnit && unitOnHex && unitOnHex.playerIndex !== selectedUnit.playerIndex) {
                const highlights = group.getObjectByName("highlights");
                if (highlights) {
                    // Check if this hex is highlighted by comparing q,r coordinates
                    const isHighlighted = highlights.children.some((highlight: any) => {
                        const highlightCoord = new HexCoord(hexGroup.userData.q, hexGroup.userData.r);
                        const highlightPos = highlightCoord.getWorldPosition();
                        const highlightX = Math.round(highlightPos.x * 10) / 10;
                        const highlightZ = Math.round(highlightPos.z * 10) / 10;
                        const meshX = Math.round(highlight.position.x * 10) / 10;
                        const meshZ = Math.round(highlight.position.z * 10) / 10;
                        return highlightX === meshX && highlightZ === meshZ;
                    });

                    if (isHighlighted) {
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
            } else if (selectedUnit && UnitSystem.isValidMove(selectedUnit, hexGroup)) {
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
        if (isHumanTurn()) {  // Only a human may end their own turn
            selectedUnit = null;
            VisualizationSystem.clearPathLine();
            VisualizationSystem.clearHighlights();
            getGameState().nextTurn();
            FootprintSystem.update();  // Update footprints when turn ends
        }
    });

    // Update end turn button state when turn changes
    const updateEndTurnButton = () => {
        if (isHumanTurn()) {
            endTurnButton.disabled = false;
            endTurnButton.textContent = "End Turn";
        } else {
            endTurnButton.disabled = true;
            endTurnButton.textContent = "AI Turn";
        }
    };

    // Initial button state
    updateEndTurnButton();

    // Add turn change observer
    const observedGameState = getGameState();
    const originalNextTurn = observedGameState.nextTurn;
    observedGameState.nextTurn = function () {
        originalNextTurn.call(this);
        updateEndTurnButton();
        updateNextUnitButton();  // Update next unit button state
        currentUnitIndex = -1;   // Reset unit index on turn change
        // Markers follow the turn: shown only for a human player's own
        // units during their turn (hotseat swaps sides; AI turns show none).
        VisualizationSystem.updateOwnUnitMarkers(this.units);
    };

    // Next Unit button handler
    nextUnitButton.addEventListener('click', () => {
        if (!isHumanTurn()) return; // Only during a human player's turn

        const currentPlayer = getGameState().currentTurn;
        const playerUnits = getGameState().units.filter((unit: GameUnit) => unit.playerIndex === currentPlayer);
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
        if (isHumanTurn()) {
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
        // The bloom chain has its own render targets to keep in step.
        resizeComposer(window.innerWidth, window.innerHeight);
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

async function initGame(controllers: [PlayerController, PlayerController]) {
    // Initialize renderer first
    initRenderer();  // This sets up the renderer and adds it to the document

    // Initialize game state
    const gameState = new GameState(controllers);
    setGameState(gameState);

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


    // Load unit + building models before initializing units/buildings
    await Promise.all([UnitSystem.loadUnitModels(), BuildingSystem.loadBuildingModels()]);

    // Initialize units using gameState
    gameState.initializeUnits();

    // Place the map's buildings (factories) once the map + models exist
    BuildingSystem.initializeBuildings(gameState);

    // Full resync: UnitSystem.setPosition() updates the own-unit markers as
    // each unit is created, but GameState.initializeUnits() only pushes a
    // unit into gameState.units *after* creating it, so the very last unit
    // created is missing from that list during its own update -- this catches it.
    VisualizationSystem.updateOwnUnitMarkers(gameState.units);

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
    // BEFORE the first frame. The pool's lights have to be present for the
    // initial shader compile, or adding them later costs the very stall
    // they exist to remove.
    LightPool.init(group);

    animate(miniMapCamera, matrices, mapWidth, mapHeight, highlightGroup);

    // A hook for driving single frames by hand, so the renderer stays
    // measurable when requestAnimationFrame is throttled -- which a
    // backgrounded tab always does, and which is exactly when you want to
    // A/B two settings. Same passes, same order, no scheduler.
    // Returns the frame's own draw counts. Draw calls are deterministic for
    // a given scene, so they are the honest way to show a rendering change
    // worked -- frame time on a loaded machine is not.
    (window as any).renderFrameNow = () => {
        renderer.info.reset();
        renderFrame(miniMapCamera, matrices, highlightGroup);
        const r = renderer.info.render;
        return { calls: r.calls, triangles: r.triangles };
    };

    // Kick off the first turn (starts the AI immediately in AI-vs-AI mode)
    gameState.start();
}

// The three ways a match can be driven, keyed by the string that rides in
// the URL. Same set the menu offers and the boot path reads.
const MATCH_MODES: Record<string, { label: string; controllers: [PlayerController, PlayerController] }> = {
    'human-cpu': { label: 'Human vs AI', controllers: ['human', 'cpu'] },
    'cpu-cpu': { label: 'AI vs AI', controllers: ['cpu', 'cpu'] },
    'human-human': { label: 'Human vs Human', controllers: ['human', 'human'] },
};

// Pre-game start menu: pick a map and who controls each side.
//
// Picking a map RELOADS THE PAGE rather than rebuilding the scene in place.
// That is not laziness: MAP_CONFIG.ROWS/COLS are read at module scope by
// render.ts and half the engine while modules are still evaluating, so the
// grid size is fixed before any menu can run. Choosing the map and the mode
// in one click, and carrying both in the URL, makes that exactly one reload
// -- and leaves every match linkable, which is how ?map= was already used.
function showStartMenu() {
    const overlay = document.createElement('div');
    overlay.id = 'start-menu';
    overlay.style.cssText =
        'position:absolute;inset:0;background:#0a0f1e;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;gap:14px;z-index:100;font-family:Arial,sans-serif;' +
        'overflow-y:auto;padding:40px 20px;box-sizing:border-box;';

    const title = document.createElement('h1');
    title.textContent = 'VibeWars';
    title.style.cssText = 'color:#fff;font-size:44px;margin:0 0 4px 0;';
    overlay.appendChild(title);

    const heading = (text: string) => {
        const element = document.createElement('div');
        element.textContent = text;
        element.style.cssText =
            'color:#8fa3c8;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;margin:14px 0 2px 0;';
        overlay.appendChild(element);
    };

    // --- Map ---------------------------------------------------------
    heading('Map');

    let chosenMap = MAP_KEY;

    const mapGrid = document.createElement('div');
    mapGrid.style.cssText =
        'display:grid;grid-template-columns:repeat(2, minmax(0, 210px));gap:8px;justify-content:center;';
    overlay.appendChild(mapGrid);

    const mapButtons: Array<{ key: string; element: HTMLButtonElement }> = [];
    const paintMapButtons = () => {
        for (const { key, element } of mapButtons) {
            const chosen = key === chosenMap;
            element.style.borderColor = chosen ? '#4CAF50' : '#2b3a55';
            element.style.background = chosen ? '#1b3a24' : '#141c30';
            element.style.color = chosen ? '#dff5e3' : '#9fb2d0';
        }
    };

    // Authored maps first, numbered the way they get talked about, then the
    // random ones. Every number in the notes is read off the provider --
    // size from rows/cols, roster from the spawn list -- rather than parsed
    // back out of its display name, so the menu cannot drift from the map.
    const sideNote = (provider: { rows: number; cols: number; spawns: { cpu: unknown[] } }) =>
        `${provider.cols}×${provider.rows} · ${provider.spawns.cpu.length} a side`;

    const entries: Array<{ key: string; label: string; note: string }> = [
        ...AUTHORED_PROVIDERS.map((provider, index) => ({
            key: provider.key,
            label: `Mirror ${index + 1} — ${provider.name}`,
            note: sideNote(provider),
        })),
        ...RANDOM_PROVIDERS.map((provider) => ({
            key: provider.key,
            label: provider.name,
            note: sideNote(provider),
        })),
    ];

    for (const entry of entries) {
        const button = document.createElement('button');
        button.style.cssText =
            'padding:10px 12px;font-size:15px;border:2px solid #2b3a55;border-radius:6px;cursor:pointer;' +
            'background:#141c30;color:#9fb2d0;text-align:left;line-height:1.35;font-family:inherit;';
        const name = document.createElement('div');
        name.textContent = entry.label;
        name.style.cssText = 'font-weight:bold;';
        const note = document.createElement('div');
        note.textContent = entry.note;
        note.style.cssText = 'font-size:12px;opacity:0.75;';
        button.appendChild(name);
        button.appendChild(note);
        button.addEventListener('click', () => {
            chosenMap = entry.key;
            paintMapButtons();
        });
        mapGrid.appendChild(button);
        mapButtons.push({ key: entry.key, element: button });
    }
    paintMapButtons();

    // --- Mode --------------------------------------------------------
    heading('Match type');

    for (const [mode, { label }] of Object.entries(MATCH_MODES)) {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText =
            'padding:14px 40px;font-size:20px;background-color:#4CAF50;color:white;border:none;' +
            'border-radius:6px;cursor:pointer;min-width:280px;font-family:inherit;';
        button.addEventListener('click', () => {
            if (chosenMap === MAP_KEY) {
                // Already on the right map, so no reload is needed and the
                // menu can hand straight over. This is the common path:
                // start, pick a mode, play.
                overlay.remove();
                initGame(MATCH_MODES[mode].controllers).catch(error => {
                    console.error("Error initializing game:", error);
                });
                return;
            }
            window.location.search = `?map=${encodeURIComponent(chosenMap)}&mode=${encodeURIComponent(mode)}`;
        });
        overlay.appendChild(button);
    }

    document.body.appendChild(overlay);
}

// Boot straight into a match when the URL already names one -- which is what
// the menu's own map buttons navigate to, and what makes a match linkable.
function bootFromUrlOrShowMenu() {
    const mode = START_MODE && MATCH_MODES[START_MODE];
    if (mode) {
        initGame(mode.controllers).catch(error => {
            console.error("Error initializing game:", error);
        });
        return;
    }
    showStartMenu();
}

// Small "AI thinking" panel with a progress bar, driven by the search's
// progress ticks (AIController dispatches vibewars:aiprogress). Shown
// while done < total, hidden when the search completes.
function ensureAiThinkingPanel(): { panel: HTMLDivElement; bar: HTMLDivElement; label: HTMLDivElement } {
    let panel = document.getElementById('ai-thinking-panel') as HTMLDivElement | null;
    if (panel) {
        return {
            panel,
            bar: document.getElementById('ai-thinking-bar') as HTMLDivElement,
            label: document.getElementById('ai-thinking-label') as HTMLDivElement,
        };
    }
    panel = document.createElement('div');
    panel.id = 'ai-thinking-panel';
    panel.style.cssText =
        'position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:90;display:none;' +
        'padding:10px 18px;font-family:Arial,sans-serif;color:#fff;text-align:center;' +
        'background:rgba(10,15,30,0.85);border:1px solid #4CAF50;border-radius:8px;min-width:220px;';
    const label = document.createElement('div');
    label.id = 'ai-thinking-label';
    label.style.cssText = 'font-size:13px;margin-bottom:6px;letter-spacing:0.5px;';
    label.textContent = 'AI thinking…';
    const track = document.createElement('div');
    track.style.cssText = 'height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;';
    const bar = document.createElement('div');
    bar.id = 'ai-thinking-bar';
    bar.style.cssText = 'height:100%;width:0%;background:#4CAF50;transition:width 0.15s;';
    track.appendChild(bar);
    panel.appendChild(label);
    panel.appendChild(track);
    document.body.appendChild(panel);
    return { panel, bar, label };
}

window.addEventListener('vibewars:aiprogress', ((event: CustomEvent) => {
    const { done, total, playerIndex } = event.detail ?? {};
    const { panel, bar, label } = ensureAiThinkingPanel();
    if (typeof done !== 'number' || typeof total !== 'number' || done >= total) {
        panel.style.display = 'none';
        bar.style.width = '0%';
        return;
    }
    label.textContent = `AI ${typeof playerIndex === 'number' ? playerIndex + 1 : ''} thinking…`;
    bar.style.width = `${Math.round((done / total) * 100)}%`;
    panel.style.display = 'block';
}) as EventListener);

// Victory banner, raised by GameState when one side runs out of units.
window.addEventListener('vibewars:gameover', ((event: CustomEvent) => {
    const banner = document.createElement('div');
    banner.id = 'game-over-banner';
    const headline = event.detail?.name ? `${event.detail.name} wins!` : 'Draw';
    banner.textContent = event.detail?.reason ? `${headline} (${event.detail.reason})` : headline;
    banner.style.cssText =
        'position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);z-index:100;' +
        'padding:24px 60px;font-family:Arial,sans-serif;font-size:36px;font-weight:bold;color:#fff;' +
        'background:rgba(10,15,30,0.92);border:2px solid #4CAF50;border-radius:10px;';
    document.body.appendChild(banner);
}) as EventListener);

window.onload = () => {
    bootFromUrlOrShowMenu();
};

// Dev-only debug handle: the codebase deliberately keeps modules off
// window, but probing live state from the console (unit heights, tiles,
// pathfinding) needs an entry point. Stripped from production builds.
if ((import.meta as any).env?.DEV) {
    (window as any).__vibewars = { getGameState, GridSystem, TerrainSystem, UnitSystem, HexCoord };
}

function createRoads(gameState: GameState) {
    // Authored maps bake their roads as tile.hasRoad and set randomRoads
    // to 0; the random wilderness sprinkles this many on top.
    const roadCount = selectedMapProvider().randomRoads;
    for (let i = 0; i < roadCount; i++) {
        // Find a random valid start point (not water)
        let startQ, startR;
        do {
            startQ = Math.floor(Math.random() * MAP_CONFIG.COLS);
            startR = Math.floor(Math.random() * MAP_CONFIG.ROWS);
        } while (gameState.map.getTile(startQ, startR)!.type === 'WATER');

        // Find a random valid end point (not water)
        let endQ, endR;
        do {
            endQ = Math.floor(Math.random() * MAP_CONFIG.COLS);
            endR = Math.floor(Math.random() * MAP_CONFIG.ROWS);
        } while (gameState.map.getTile(endQ, endR)!.type === 'WATER');

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

    // Configure shadow properties.
    //
    // 2048, not 4096. Measured on the shipped map: 4096 renders at 22.0 ms
    // median, 2048 at 19.1 -- about 3 ms, for a difference in edge softness
    // not visible at this camera height over hexes this size.
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
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

export { getSelectedUnit, setSelectedUnit };
