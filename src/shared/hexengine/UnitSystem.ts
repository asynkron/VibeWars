// UnitSystem.js
import { scene, miniMapScene } from '../../render';
import { markShadowsDirty } from './ShadowBudget';
import { FootprintSystem } from './FootprintSystem';
import { VisualizationSystem } from './VisualizationSystem';
import { PathfindingSystem } from './PathfindingSystem';
import { setSelectedUnit } from '../../game';
import { AudioSystem } from './AudioSystem';
import { BuildingSystem } from './BuildingSystem';
import { ModelSystem } from './ModelSystem';
import { GridSystem } from './GridSystem';
import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { players, HIGHLIGHT_COLORS } from '../../constants';
import { getGameState } from '../../systems/gameStateStore';
// THE COMBAT NUMBERS COME FROM THE SIMULATION, not from copies kept here.
// resolveAttack.ts's header says its rules "mirror UnitSystem.attack
// exactly", and the two had already drifted: splash was 0.5 here against
// SPLASH_FACTOR 0.25 there, while the crater depth and rocket count sat as
// literals under a comment asking the next reader to keep them in sync by
// hand. A comment is not a mechanism. Importing them makes the sim the one
// source and deletes the whole class of drift.
//
// The direction is safe: resolveAttack reaches only unitStats and SimState,
// never this file, so there is no cycle -- and workerSafety.test.ts keeps
// it that way.
import { SPLASH_FACTOR, CRATER_DELTA, ROCKET_COUNT } from '../../systems/sim/resolveAttack';
import type { UnitTypeConfig, GameUnit, ResolvedAttackOutcome } from '../../types';
import { skillCost, PIKE_REPAIR, DROVER_LOAD, DROVER_UNLOAD, type SkillDef } from './skills';
import { showSkillsFor } from '../../systems/skillBar';
import { skillById, primarySkill, UNIT_TYPES, unitTypesRecord, CLASS_COUNTERS, canTarget, getClassModifier, getMovementCost } from './unitStats';

class UnitSystem {
    // The roster and the combat rules live in unitStats.ts, which imports
    // nothing that renders -- see that file. Re-exported here so every
    // existing UnitSystem.* caller keeps working unchanged.
    static unitTypes = UNIT_TYPES;

    static get unitTypesRecord(): Record<string, UnitTypeConfig> {
        return unitTypesRecord;
    }

    static readonly CLASS_COUNTERS = CLASS_COUNTERS;
    static canTarget = canTarget;
    static getClassModifier = getClassModifier;
    static getMovementCost = getMovementCost;


    static async loadUnitModels() {
        await ModelSystem.loadModels(this.unitTypes);
    }

    static createUnitSprite(type: string, hp: number, maxHp: number, playerIndex: number) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;

        // Draw HP bar background (black)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 128, 24); // Reduced height from 32 to 24

        // Calculate segment width (total width divided by max HP)
        const segmentWidth = 128 / maxHp;
        const segmentHeight = 24; // Reduced height from 32 to 24
        const borderWidth = 2; // Thicker border for more visible 3D effect

        // Draw each HP segment
        for (let i = 0; i < maxHp; i++) {
            const x = i * segmentWidth;

            // Draw black outline for each segment
            ctx.fillStyle = '#000000';
            ctx.fillRect(x, 0, segmentWidth, segmentHeight);

            // Draw segment background (dark gray for missing HP)
            ctx.fillStyle = '#333333'; // Changed from white to dark gray
            ctx.fillRect(x + borderWidth, borderWidth, segmentWidth - borderWidth * 2, segmentHeight - borderWidth * 2);

            // If this segment represents HP, fill it with color and 3D effect
            if (i < hp) {
                const baseColor = hp < maxHp * 0.33 ? '#ff0000' : '#00ff00';
                const lightColor = hp < maxHp * 0.33 ? '#ff9999' : '#99ff99';
                const darkColor = hp < maxHp * 0.33 ? '#990000' : '#006600';

                // Draw main segment color
                ctx.fillStyle = baseColor;
                ctx.fillRect(x + borderWidth, borderWidth, segmentWidth - borderWidth * 2, segmentHeight - borderWidth * 2);

                // Draw light borders (top and left)
                ctx.fillStyle = lightColor;
                ctx.fillRect(x + borderWidth, borderWidth, segmentWidth - borderWidth * 2, borderWidth); // Top border
                ctx.fillRect(x + borderWidth, borderWidth, borderWidth, segmentHeight - borderWidth * 2); // Left border

                // Draw dark borders (bottom and right)
                ctx.fillStyle = darkColor;
                ctx.fillRect(x + borderWidth, segmentHeight - borderWidth * 2, segmentWidth - borderWidth * 2, borderWidth); // Bottom border
                ctx.fillRect(x + segmentWidth - borderWidth * 2, borderWidth, borderWidth, segmentHeight - borderWidth * 2); // Right border
            } else {
                // Add 3D effect to missing HP segments too
                const lightColor = '#444444';
                const darkColor = '#222222';

                // Draw light borders (top and left)
                ctx.fillStyle = lightColor;
                ctx.fillRect(x + borderWidth, borderWidth, segmentWidth - borderWidth * 2, borderWidth); // Top border
                ctx.fillRect(x + borderWidth, borderWidth, borderWidth, segmentHeight - borderWidth * 2); // Left border

                // Draw dark borders (bottom and right)
                ctx.fillStyle = darkColor;
                ctx.fillRect(x + borderWidth, segmentHeight - borderWidth * 2, segmentWidth - borderWidth * 2, borderWidth); // Bottom border
                ctx.fillRect(x + segmentWidth - borderWidth * 2, borderWidth, borderWidth, segmentHeight - borderWidth * 2); // Right border
            }
        }

        // Dynamic font sizing for unit name
        const unitName = this.unitTypesRecord[type].name;
        let fontSize = 24; // Start with large font
        ctx.font = `${fontSize}px Arial`;
        let textWidth = ctx.measureText(unitName).width;

        // Reduce font size if text is too wide
        while (textWidth > 120 && fontSize > 16) { // Leave 4px margin on each side
            fontSize--;
            ctx.font = `${fontSize}px Arial`;
            textWidth = ctx.measureText(unitName).width;
        }

        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(unitName, 64, 64);

        return new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            depthWrite: false
        }));
    }

    static createModelWithColor(model: any, playerColor: number, usePlayerColor: boolean = true, replaceColor: number | null = null) {
        const modelClone = model.clone();

        if (usePlayerColor) {
            modelClone.traverse((child: any) => {
                if (child instanceof THREE.Mesh) {
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map((mat: any) => {
                            const clonedMat = mat.clone();
                            clonedMat.color.setHex(playerColor);
                            return clonedMat;
                        });
                    } else {
                        child.material = child.material.clone();
                        child.material.color.setHex(playerColor);
                    }
                }
            });
        } else if (replaceColor !== null) {
            // Function to check if a color is close to the target color using Euclidean distance in RGB space
            const isColorClose = (color1: number, color2: number): boolean => {
                const r1 = (color1 >> 16) & 0xFF;
                const g1 = (color1 >> 8) & 0xFF;
                const b1 = color1 & 0xFF;
                const r2 = (color2 >> 16) & 0xFF;
                const g2 = (color2 >> 8) & 0xFF;
                const b2 = color2 & 0xFF;

                // Calculate Euclidean distance in RGB space
                const distance = Math.sqrt(
                    Math.pow(r1 - r2, 2) +
                    Math.pow(g1 - g2, 2) +
                    Math.pow(b1 - b2, 2)
                );

                // Allow for a maximum distance of 50 units in RGB space
                return distance < 50;
            };

            modelClone.traverse((child: any) => {
                if (child instanceof THREE.Mesh) {
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map((mat: any) => {
                            const clonedMat = mat.clone();
                            if (isColorClose(clonedMat.color.getHex(), replaceColor)) {
                                clonedMat.color.setHex(playerColor);
                            }
                            return clonedMat;
                        });
                    } else {
                        child.material = child.material.clone();
                        if (isColorClose(child.material.color.getHex(), replaceColor)) {
                            child.material.color.setHex(playerColor);
                        }
                    }
                }
            });
        }

        return modelClone;
    }

    static createUnit(type: string, q: number, r: number, playerIndex: number) {
        // Create sprite for UI elements (health bar, name, etc)
        const unitSprite = this.createUnitSprite(type, this.unitTypesRecord[type].hp, this.unitTypesRecord[type].maxHp, playerIndex);
        unitSprite.scale.set(1, 1, 1);
        unitSprite.rotation.x = 0;
        scene.add(unitSprite);  // Add sprite directly to scene

        // Add 3D model if available
        const unitType = this.unitTypesRecord[type];
        if (unitType.model && ModelSystem.getModel(unitType.model)) {
            const modelClone = ModelSystem.createModelWithColor(
                ModelSystem.getModel(unitType.model),
                players[playerIndex].color,
                unitType.usePlayerColor,
                unitType.replaceColor,
                unitType.teamColorMaterial
            );

            // Calculate bounding box for model height
            const bbox = new THREE.Box3().setFromObject(modelClone);
            const modelHeight = bbox.max.y - bbox.min.y;

            // Store references and data in model's userData
            modelClone.userData = {
                type,
                q,
                r,
                hp: this.unitTypesRecord[type].hp,
                maxHp: this.unitTypesRecord[type].maxHp,
                move: this.unitTypesRecord[type].move,
                attack: this.unitTypesRecord[type].attack,
                minRange: this.unitTypesRecord[type].minRange,
                maxRange: this.unitTypesRecord[type].maxRange,
                playerIndex,
                hasAttacked: false,
                sprite: unitSprite,  // Store reference to sprite
                modelHeight: modelHeight,  // Store model height for positioning
                flightAltitude: this.unitTypesRecord[type].flightAltitude || 0,
                yOffset: this.unitTypesRecord[type].yOffset || 0,
                terrainCosts: this.unitTypesRecord[type].terrainCosts
            };

            const miniUnit = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial({ color: players[playerIndex].color })
            );
            miniUnit.scale.set(0.5, 0.5, 0.5);
            miniUnit.position.y = 0.5;
            miniMapScene.add(miniUnit);
            modelClone.userData.miniUnit = miniUnit;

            const hex = HexCoord.findHex(q, r);
            if (hex) {
                const coord = new HexCoord(q, r);
                this.setPosition(modelClone, coord, hex);
            }

            // Add the model to the main scene
            scene.add(modelClone);
            return modelClone;
        }
        return null;
    }

    static setPosition(unit: any, coord: any, hex: any, rotation?: number, customPosition: any = null) {
        // Get the old position's hex before updating
        const oldHex = HexCoord.findHex(unit.userData.q, unit.userData.r);

        // Use custom position if provided, otherwise calculate from coord
        const position = customPosition || coord.getWorldPosition();
        // customPosition (mid-movement interpolation) already has flightAltitude
        // baked in by move(), which builds it from the same terrain height plus
        // this unit's flightAltitude -- see move()'s startPos.y/endPos.y.
        const height = customPosition
            ? customPosition.y
            : TerrainSystem.getHeight(hex) + (unit.userData.flightAltitude || 0) + (unit.userData.yOffset || 0);

        // Transform position in world space
        const finalPosition = new THREE.Vector3(
            position.x,
            height,
            position.z
        );

        // Set model position
        unit.position.copy(finalPosition);
        // The one write path for a unit's transform, interpolation frames
        // included -- so hooking it here catches every way a shadow caster
        // can move without chasing individual animation call sites.
        markShadowsDirty();
        // Only once the unit has actually ARRIVED. The interpolation frames
        // call this many times per step with a customPosition; letting them
        // move the tile too meant oldHex above was already the destination
        // by the time the step was finalized -- so the print meant for the
        // tile being left landed on the tile being entered instead.
        if (!customPosition) {
            unit.userData.q = coord.q;
            unit.userData.r = coord.r;
        }

        // Terrain-normal alignment (tilting the unit to match the hex's
        // surface normal) was attempted here and abandoned: it fought with
        // the movement-rotation system below, producing bad rotations while
        // units were moving. Units are kept upright with a plain Y rotation
        // instead -- see git history (UnitSystem.ts, this function) for the
        // removed quaternion-based attempt if terrain alignment is revisited.
        if (rotation !== undefined) {
            unit.rotation.y = rotation;
        }

        // Set sprite position - above the model using actual bounding box
        if (unit.userData.sprite) {
            const spritePos = new THREE.Vector3(
                position.x,
                height + 1.5,
                position.z
            );
            unit.userData.sprite.position.copy(spritePos);
        }

        // Set minimap unit position
        if (unit.userData.miniUnit) {
            unit.userData.miniUnit.position.set(position.x, 0.5, position.z);
        }

        // Update decorator transparency for both old and new positions
        if (oldHex) {
            GridSystem.updateDecoratorTransparency(oldHex);
        }
        if (hex) {
            GridSystem.updateDecoratorTransparency(hex);
        }

        // Only create footprints if we're not in a transition (no
        // customPosition) AND this was a move rather than initial placement.
        // Placement passes no rotation, so there is no direction for a track
        // to run along; stamping anyway put a pair of opposing halves on an
        // arbitrary axis onto every spawn tile -- tracks belonging to no
        // journey at all.
        const moved = rotation !== undefined && !!oldHex && !!hex;
        if (!customPosition) {
            if (moved) {
                // Two halves per step. Leaving: centre -> the edge crossed,
                // so the heading. Arriving: centre -> the edge come in
                // through, which is the reverse of the heading.
                FootprintSystem.createFootprint(oldHex, rotation, unit.userData.type);
                FootprintSystem.createFootprint(hex, rotation + Math.PI, unit.userData.type);
            }

            // Keep the "which ground tile is my unit on" markers in sync --
            // see VisualizationSystem.updateOwnUnitMarkers. Runs on initial
            // placement too, so it stays outside the moved guard.
            if (unit.userData.playerIndex === 0) {
                VisualizationSystem.updateOwnUnitMarkers(getGameState().units);
            }
        }
    }

    static getUnitStats(type: string) {
        return this.unitTypesRecord[type];
    }

    static isHexOccupied(q: number, r: number, excludeUnit: any = null): boolean {
        return getGameState().units.some((u: any) => u.q === q && u.r === r && u !== excludeUnit);
    }

    static getRotation(oldQ: number, oldR: number, newQ: number, newR: number): number {
        // Calculate the direction based on coordinate changes
        const dq = newQ - oldQ;
        const dr = newR - oldR;

        // Check if we're starting from an odd column
        const isOddColumn = oldQ % 2 === 1;

        // Convert to angle in radians based on flat-top hex grid
        // Note: In Three.js, 0 radians points to +Z (South) for our models

        // North/South are the same for both odd and even columns
        if (dq === 0 && dr === 1) return 0;        // S
        if (dq === 0 && dr === -1) return Math.PI; // N

        if (isOddColumn) {
            // Odd column rules:
            //   NW: (q-1, r)      N: (q, r-1)     NE: (q+1, r)
            //   SW: (q-1, r+1)    S: (q, r+1)     SE: (q+1, r+1)
            if (dq === 1 && dr === 0) return 2 * Math.PI / 3;  // NE
            if (dq === 1 && dr === 1) return Math.PI / 3;      // SE
            if (dq === -1 && dr === 0) return -2 * Math.PI / 3; // NW
            if (dq === -1 && dr === 1) return -Math.PI / 3;    // SW
        } else {
            // Even column rules:
            //   NW: (q-1, r-1)    N: (q, r-1)     NE: (q+1, r-1)
            //   SW: (q-1, r)      S: (q, r+1)     SE: (q+1, r)
            if (dq === 1 && dr === -1) return 2 * Math.PI / 3; // NE
            if (dq === 1 && dr === 0) return Math.PI / 3;      // SE
            if (dq === -1 && dr === -1) return -2 * Math.PI / 3; // NW
            if (dq === -1 && dr === 0) return -Math.PI / 3;    // SW
        }

        return 0; // Default to South if no direction found
    }

    // Resolves when the whole animated move (every step + the trailing
    // highlight refresh) has completed -- the AI replay awaits this to
    // sequence its actions. Fire-and-forget callers can ignore the promise.
    static move(unit: GameUnit, path: any[]): Promise<void> {
        if (path.length === 0) return Promise.resolve();

        let movementDone!: () => void;
        const donePromise = new Promise<void>((resolve) => { movementDone = resolve; });

        // Start engine sound when movement begins
        AudioSystem.playEngineSound(unit);

        // Clear highlights at the start of movement
        VisualizationSystem.clearHighlights();

        let delay = 0;
        const transitionDuration = 200; // Duration of transition between hexes
        const stepDuration = 250; // Total duration for each step (including transition)

        path.forEach((hex: any, index: number) => {
            setTimeout(() => {
                // Store previous position
                const oldQ = unit.q;
                const oldR = unit.r;

                // Update to new position
                const newQ = hex.userData.q;
                const newR = hex.userData.r;

                unit.q = newQ;
                unit.r = newR;
                const coord = new HexCoord(newQ, newR);
                const targetRotation = this.getRotation(oldQ, oldR, newQ, newR);

                // Get start and end positions
                const startHex = HexCoord.findHex(oldQ, oldR);
                const startPos = new HexCoord(oldQ, oldR).getWorldPosition();
                const endPos = coord.getWorldPosition();

                // Adjust Y positions based on terrain height plus this unit's
                // flightAltitude, so mid-flight interpolation (below) doesn't
                // dip back down to ground level for helicopters/jets.
                const flightAltitude = (unit.visualUnit.userData.flightAltitude || 0) + (unit.visualUnit.userData.yOffset || 0);
                startPos.y = TerrainSystem.getHeight(startHex) + flightAltitude;
                endPos.y = TerrainSystem.getHeight(hex) + flightAltitude;

                // Create a temporary position vector for interpolation
                const currentPos = new THREE.Vector3();

                // Get current rotation
                const startRotation = unit.visualUnit.rotation.y;

                // Calculate shortest rotation path
                let rotationDiff = targetRotation - startRotation;
                // Normalize to [-PI, PI]
                while (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
                while (rotationDiff < -Math.PI) rotationDiff += 2 * Math.PI;

                // Finalize the step exactly once: snap to the final
                // position/rotation (creating footprints), and on the last
                // step refresh highlights and resolve the move promise.
                // Reached from the rAF animation completing normally, OR
                // from the setTimeout backstop below -- browsers freeze
                // requestAnimationFrame entirely in hidden tabs, and
                // without the backstop an AI turn awaiting this move would
                // hang until the tab becomes visible again.
                let stepFinalized = false;
                const finalizeStep = () => {
                    if (stepFinalized) return;
                    stepFinalized = true;
                    // Ensure final position and rotation are exact and create footprints
                    this.setPosition(unit.visualUnit, coord, hex, targetRotation);

                    // CARGO RIDES ALONG. SimState.apply does this for the
                    // simulation's unitMoved; without the same loop here, a
                    // PLAYER driving a loaded transport left the passenger's
                    // coordinates at the hex it boarded on. Everything then
                    // reads a lie -- who is standing where, how far it is
                    // from a depot, where it can be dropped -- and the two
                    // sides of the resolve-first design disagree about the
                    // board, which is the failure that leaves no trace.
                    for (const rider of getGameState().units) {
                        if (rider.carriedBy !== unit) continue;
                        rider.q = unit.q;
                        rider.r = unit.r;
                    }

                    // After the last movement step, recalculate highlights with a small delay
                    if (index === path.length - 1) {
                        // Capture check at the final resting tile: every
                        // persistent move (player or AI replay) ends here,
                        // so this one hook covers all captures.
                        BuildingSystem.tryCapture(unit);
                        setTimeout(() => {
                            VisualizationSystem.clearHighlights();
                            this.highlightMoveRange(unit);
                            this.highlightAttackRange(unit);
                            // Stop engine sound when movement is complete
                            AudioSystem.stopEngineSound(unit);
                            movementDone();
                        }, 50);
                    }
                };

                // Animation function (visuals only -- completion is
                // finalizeStep's job)
                const animate = (timestamp: number) => {
                    if (stepFinalized) return;
                    const elapsed = timestamp - startTime;
                    const progress = Math.min(elapsed / transitionDuration, 1);

                    // Use quadratic easing for smooth acceleration/deceleration
                    const easedProgress = progress * progress;

                    // Interpolate position
                    currentPos.lerpVectors(startPos, endPos, easedProgress);

                    // Interpolate rotation using the shortest path
                    const currentRotation = startRotation + rotationDiff * easedProgress;

                    // Update unit position and rotation with customPosition to prevent footprint creation during transition
                    this.setPosition(unit.visualUnit, coord, hex, currentRotation, currentPos);

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        finalizeStep();
                    }
                };

                const startTime = performance.now();
                requestAnimationFrame(animate);
                setTimeout(finalizeStep, transitionDuration + 50);
            }, delay);
            delay += stepDuration;
        });

        return donePromise;
    }

    static handleSelection(unit: GameUnit | null) {
        // The bar follows the selection, and resets to the unit's attack --
        // so a player who never touches it plays exactly the game they
        // played before it existed.
        showSkillsFor(unit);
        setSelectedUnit(unit);
        VisualizationSystem.clearPathLine();
        VisualizationSystem.clearHighlights();  // Clear existing highlights first

        if (unit) {
            this.highlightMoveRange(unit);
            this.highlightAttackRange(unit);
        }
    }

    static handleMovement(unit: GameUnit, targetHex: any): boolean {
        const path = PathfindingSystem.getPath(unit.q, unit.r, targetHex.userData.q, targetHex.userData.r, unit.move, unit);

        if (path.length > 0) {
            // Calculate total movement cost based on terrain costs
            let totalCost = 0;
            for (const hex of path) {
                const cost = TerrainSystem.getMoveCost(hex, unit);
                if (cost) {
                    totalCost += cost;
                }
            }

            // Only move if we have enough movement points
            if (totalCost <= unit.move) {
                unit.move -= totalCost;
                this.move(unit, path);
                VisualizationSystem.clearPathLine();
                return true;
            }
        }
        return false;
    }

    static highlightMoveRange(unit: GameUnit) {
        const unitCoord = new HexCoord(unit.q, unit.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        reachable.forEach((key: string) => {
            const coord = HexCoord.fromKey(key);
            const hex = coord.getHex();
            if (hex && !this.isHexOccupied(coord.q, coord.r, unit)) {
                VisualizationSystem.highlightHex(hex, HIGHLIGHT_COLORS.MOVE_RANGE);
            }
        });
    }

    static offsetToCube(col: number, row: number): { x: number; y: number; z: number } {
        // Convert from odd-q offset (flat-topped) to cube coordinates
        const x = col;
        const z = row - (col - (col & 1)) / 2;
        const y = -x - z;
        return { x, y, z };
    }

    static getHexDistance(q1: number, r1: number, q2: number, r2: number): number {
        // Convert from offset coordinates to cube coordinates
        const cube1 = this.offsetToCube(q1, r1);
        const cube2 = this.offsetToCube(q2, r2);

        // Calculate distance using cube coordinates
        return Math.max(
            Math.abs(cube1.x - cube2.x),
            Math.abs(cube1.y - cube2.y),
            Math.abs(cube1.z - cube2.z)
        );
    }

    static highlightAttackRange(unit: GameUnit) {
        // Loop through all units and check enemy units
        getGameState().units.forEach((targetUnit: GameUnit) => {
            // Skip if it's our own unit
            if (targetUnit.playerIndex === unit.playerIndex) return;

            // Skip targets this unit class can't touch (artillery/infantry vs air).
            if (!this.canTarget(unit.type, targetUnit.type)) return;

            // Calculate distance to this enemy unit
            const distance = this.getHexDistance(unit.q, unit.r, targetUnit.q, targetUnit.r);

            // Check if enemy is within our attack range
            if (distance >= unit.minRange && distance <= unit.maxRange) {
                const targetHex = HexCoord.findHex(targetUnit.q, targetUnit.r);
                if (targetHex) {
                    const highlightColor = this.hasUnitAttacked(unit) ?
                        HIGHLIGHT_COLORS.CANT_ATTACK :
                        HIGHLIGHT_COLORS.ATTACK_RANGE;
                    VisualizationSystem.highlightHex(targetHex, highlightColor);
                }
            }
        });
    }

    static isValidMove(unit: GameUnit, targetHex: any): boolean {
        if (!targetHex) return false;

        const unitCoord = new HexCoord(unit.q, unit.r);
        const targetCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        return reachable.has(targetCoord.getKey());
    }

    static setHasAttacked(unit: GameUnit, value: boolean): void {
        unit.hasAttacked = value;
        unit.visualUnit.userData.hasAttacked = value;
    }

    static hasUnitAttacked(unit: GameUnit): boolean {
        return unit.hasAttacked;  // We only need to check one since they're kept in sync
    }

    // The player's damage roll. Reads the SKILL's range when one is given,
    // falling back to the unit table -- which for today's roster is the
    // same pair of numbers, since every unit's slot-0 skill is derived from
    // exactly those fields. That equality is the point: it makes routing
    // the live path through skills a change of source, not of behaviour.
    static calculateDamage(attackerStats: UnitTypeConfig, defender: GameUnit, skill?: SkillDef): number {
        const range = skill?.effect.kind === 'attack'
            ? { min: skill.effect.minDamage, max: skill.effect.maxDamage }
            : { min: attackerStats.minDamage, max: attackerStats.maxDamage };
        return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    }

    // Patch an ally up. Deliberately NOT routed through applyDamage with a
    // negative number: applyDamage has no maxHp clamp and the outcome path
    // treats hp <= 0 as death, so a heal shaped as damage would need both
    // audited. A separate two-line path cannot overflow or underflow.
    static repair(target: GameUnit, hp: number, healer?: GameUnit): void {
        // The cooldown is charged HERE, in the executor both the player and
        // the AI's replay go through -- one place, so the two cannot drift.
        // The reference has two casting implementations and they already
        // have.
        if (healer) this.chargeFor(healer, skillById(healer.type, PIKE_REPAIR.id));
        const restored = Math.min(hp, target.maxHp - target.hp);
        if (restored <= 0) return;
        target.hp += restored;
        if (healer) AudioSystem.playSound('step1', 0.4);
        // Same floating number the damage path uses, read off the unit's
        // own visual, which is where every other caller in this file gets
        // the position from.
        VisualizationSystem.showDamageNumber(target.visualUnit.position.clone(), restored);
        this.updateUnitVisuals(target);
    }

    // Put a passenger aboard. The visual is hidden rather than removed:
    // the unit is still in gameState.units -- cargo is alive, just not on
    // the board -- and re-adding a removed model would mean rebuilding it.
    static loadPassenger(carrier: GameUnit, passenger: GameUnit): void {
        passenger.carriedBy = carrier;
        passenger.q = carrier.q;
        passenger.r = carrier.r;
        passenger.move = 0;
        if (passenger.visualUnit) (passenger.visualUnit as any).visible = false;
        this.chargeFor(carrier, skillById(carrier.type, DROVER_LOAD.id));
    }

    static unloadPassenger(carrier: GameUnit, passenger: GameUnit, q: number, r: number): void {
        passenger.carriedBy = null;
        // PLACED, NOT MOVED. UnitSystem.move's finalizeStep is what fires
        // the capture hook, so routing a drop through move() would capture
        // a depot the simulation never captured -- and AIController's
        // replay check only validates range and hasAttacked, so nothing
        // would notice. The rule is that you walk in the door.
        passenger.q = q;
        passenger.r = r;
        const hex = HexCoord.findHex(q, r);
        if (hex && passenger.visualUnit) {
            this.setPosition(passenger.visualUnit, new HexCoord(q, r), hex);
        }
        passenger.move = 0;
        if (passenger.visualUnit) (passenger.visualUnit as any).visible = true;
        this.chargeFor(carrier, skillById(carrier.type, DROVER_UNLOAD.id));
    }

    // Bill a unit for using a skill: the action, the movement and the
    // cooldown, from the SAME function SimState.apply uses. That is the
    // point -- the three were set in four separate places and had already
    // drifted, letting a player Repair and then still shoot while the
    // simulation believed the turn was spent.
    private static chargeFor(caster: GameUnit, skill: SkillDef | undefined): void {
        if (!skill) return;
        const cost = skillCost(caster, skill);
        caster.cooldowns = cost.cooldowns;
        caster.move = cost.move;
        // Through setHasAttacked, so visualUnit.userData stays in step --
        // a bare assignment leaves the dimming stale.
        if (cost.hasAttacked !== caster.hasAttacked) this.setHasAttacked(caster, cost.hasAttacked);
    }

    static applyDamage(unit: GameUnit, damage: number): void {
        // Update HP in both the game state unit and the visual unit
        unit.hp -= damage;
        unit.visualUnit.userData.hp = unit.hp;  // Sync the HP values

        // Update the sprite to show new HP
        if (unit.visualUnit.userData.sprite) {
            const newSprite = this.createUnitSprite(unit.type, unit.hp, unit.maxHp, unit.playerIndex);
            unit.visualUnit.userData.sprite.material.map.dispose();
            unit.visualUnit.userData.sprite.material.map = newSprite.material.map;
            unit.visualUnit.userData.sprite.material.needsUpdate = true;
        }
    }

    static getAttackAngle(startHex: any, targetHex: any): number {
        // Get world positions
        const startPos = new HexCoord(startHex.userData.q, startHex.userData.r).getWorldPosition();
        const targetPos = new HexCoord(targetHex.userData.q, targetHex.userData.r).getWorldPosition();

        // Calculate differences
        const dx = targetPos.x - startPos.x;
        const dz = targetPos.z - startPos.z;

        // Swap the parameters: this gives an angle where 0° points down (south)
        let angle = Math.atan2(dx, dz);

        // Convert to degrees and normalize to 0-360 range
        let degrees = (angle * 180 / Math.PI + 360) % 360;

        // Define the six hex directions (in degrees)
        // 0°: South, 60°: Southeast, 120°: Northeast, 180°: North, 240°: Northwest, 300°: Southwest
        const hexAngles = [0, 60, 120, 180, 240, 300];

        // Snap to the closest hex direction
        let closestAngle = hexAngles.reduce((prev, curr) => {
            let diffPrev = Math.abs(degrees - prev);
            let diffCurr = Math.abs(degrees - curr);
            // Handle wraparound (e.g., comparing 350° and 0°)
            if (diffPrev > 180) diffPrev = 360 - diffPrev;
            if (diffCurr > 180) diffCurr = 360 - diffCurr;
            return diffPrev < diffCurr ? prev : curr;
        });

        // Return the snapped angle in radians
        return closestAngle * Math.PI / 180;
    }

    // `skillId` names which of the attacker's skills is firing. Trailing
    // and optional, so every existing call site keeps meaning what it
    // meant: the unit's primary attack.
    static async attack(
        attacker: GameUnit, defender: GameUnit, resolved?: ResolvedAttackOutcome, skillId?: string
    ): Promise<void> {
        if (this.hasUnitAttacked(attacker)) {
            return;
        }

        // Class targeting rule: artillery/infantry can't attack air at all.
        if (!this.canTarget(attacker.type, defender.type)) {
            return;
        }

        // Check if target is within attack range
        const distance = this.getHexDistance(attacker.q, attacker.r, defender.q, defender.r);
        if (distance < attacker.minRange || distance > attacker.maxRange) {
            return;
        }

        const attackerHex = GridSystem.findHex(attacker.q, attacker.r);
        const defenderHex = GridSystem.findHex(defender.q, defender.r);

        if (!attackerHex || !defenderHex) {
            console.error('Invalid hex coordinates for attack');
            return;
        }

        // Get attacker's stats
        const attackerStats = this.getUnitStats(attacker.type);
        if (!attackerStats) {
            console.error('Invalid attacker unit type:', attacker.type);
            return;
        }

        // The action is spent HERE, before the first await, not after the
        // visuals finish. Everything below yields to the event loop for up
        // to a second, and the player's clicks keep arriving during it --
        // so a unit that had fired still read as hasAttacked: false, and a
        // second attack or a skill cast launched inside its own explosion.
        // hasUnitAttacked at the top of this function is the guard; it only
        // works if the flag is already set.
        this.setHasAttacked(attacker, true);

        // Resolve-first: every random decision (damage roll, rocket landing
        // hexes) is made up front. Player attacks resolve here and now; AI
        // replay passes in the outcome its simulation already committed to,
        // so the executed reality matches the searched plan exactly.
        // Which skill is firing. The AI's replay names it on the event
        // when it is not the primary; a player's click will name it from
        // the sidebar. Resolved ONCE here so the visual branch below and
        // the damage resolver cannot disagree about which skill this is --
        // the reference has two casting implementations and they have
        // already drifted apart on exactly that kind of detail.
        const skill = (skillId ? skillById(attacker.type, skillId) : undefined)
            ?? primarySkill(attacker.type);
        const effect = skill?.effect.kind === 'attack' ? skill.effect.attackEffect : attackerStats.attackEffect;

        const outcome = resolved ?? this.resolveLiveAttack(attacker, defender, attackerStats, skill);

        // Show attack effect based on unit type, then execute the outcome.
        if (effect === 'projectile') {
            VisualizationSystem.showAttackEffect(attackerHex, defenderHex);
            await new Promise(resolve => setTimeout(resolve, 500));
            this.applyResolvedOutcome(outcome);
        } else if (effect === 'cannon') {
            VisualizationSystem.showCannonShotEffect(attackerHex, defenderHex);
            await new Promise(resolve => setTimeout(resolve, 300));
            this.applyResolvedOutcome(outcome);
        } else if (effect === 'rocketBarrage' || effect === 'rocketVolley') {
            // Rockets fly to the exact resolved impact hexes (a volley's
            // impacts all point at the defender's hex). A replayed volley
            // arrives without impacts -- the sim drops craterDelta-0
            // events -- so rebuild the purely-visual ones here.
            let vfxImpacts = outcome.impacts;
            if (effect === 'rocketVolley' && vfxImpacts.length === 0) {
                vfxImpacts = Array.from({ length: 4 }, () => ({ q: defender.q, r: defender.r, craterDelta: 0 }));
            }
            VisualizationSystem.showRocketBarrageEffect(attackerHex, defenderHex, { impacts: vfxImpacts });
            // Wait for all rockets to finish
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.applyResolvedOutcome(outcome);
        } else if (effect === 'laser') {
            VisualizationSystem.showLaserAttackEffect(attackerHex, defenderHex);
            await new Promise(resolve => setTimeout(resolve, 400));
            this.applyResolvedOutcome(outcome);
        }

        // The selection goes, and the bar goes with it. showSkillsFor holds
        // its own copy of the selected unit and the armed skill; clearing
        // only setSelectedUnit left a live bar belonging to a unit that was
        // no longer selected, still arming casts against it.
        setSelectedUnit(null);
        showSkillsFor(null);
        VisualizationSystem.clearHighlights();
    }

    // Live-side resolver mirroring src/systems/sim/resolveAttack.ts, but
    // rolling real dice (uniform damage, Math.random scatter) since player
    // attacks don't need cross-candidate determinism -- only resolve-before-
    // execute. Splash and crater rules are identical to the sim version.
    static resolveLiveAttack(
        attacker: GameUnit, defender: GameUnit, attackerStats: UnitTypeConfig, skill?: SkillDef
    ): ResolvedAttackOutcome {
        const damage = this.calculateDamage(attackerStats, defender, skill);
        const effect = skill?.effect.kind === 'attack' ? skill.effect.attackEffect : attackerStats.attackEffect;
        const damages: ResolvedAttackOutcome['damages'] = [];
        const impacts: ResolvedAttackOutcome['impacts'] = [];

        if (effect === 'rocketBarrage') {
            // Splash hexes: the defender's hex + all in-bounds neighbors.
            const splashHexes = [{ q: defender.q, r: defender.r }];
            HexCoord.getNeighbors(defender.q, defender.r).forEach((n) => {
                if (HexCoord.isWithinMapBounds(n.q, n.r)) splashHexes.push({ q: n.q, r: n.r });
            });

            for (const hex of splashHexes) {
                const unitAtHex = getGameState().getUnitAt(hex.q, hex.r);
                if (!unitAtHex) continue;
                // Shells can't touch air units hovering over the splash zone.
                if (!this.canTarget(attacker.type, unitAtHex.type)) continue;
                const isPrimary = hex.q === defender.q && hex.r === defender.r;
                const classModifier = this.getClassModifier(attacker.type, unitAtHex.type);
                damages.push({
                    unit: unitAtHex,
                    damage: Math.floor(damage * (isPrimary ? 1 : SPLASH_FACTOR) * classModifier),
                });
            }

            for (let i = 0; i < ROCKET_COUNT; i++) {
                const target = splashHexes[Math.floor(Math.random() * splashHexes.length)];
                impacts.push({ q: target.q, r: target.r, craterDelta: CRATER_DELTA });
            }
        } else if (effect === 'rocketVolley') {
            // Several small rockets, all at the target hex -- per-rocket
            // damages sum to the single-shot total; no splash, no craters.
            const classModifier = this.getClassModifier(attacker.type, defender.type);
            const total = Math.floor(damage * classModifier);
            const volleyCount = 4; // keep in sync with sim VOLLEY_COUNT
            const base = Math.floor(total / volleyCount);
            let remainder = total - base * volleyCount;
            for (let i = 0; i < volleyCount; i++) {
                const rocketDamage = base + (remainder-- > 0 ? 1 : 0);
                if (rocketDamage > 0) damages.push({ unit: defender, damage: rocketDamage });
                impacts.push({ q: defender.q, r: defender.r, craterDelta: 0 });
            }
        } else {
            // projectile/laser (and any future single-target effect)
            const classModifier = this.getClassModifier(attacker.type, defender.type);
            damages.push({ unit: defender, damage: Math.floor(damage * classModifier) });
        }

        return { damages, impacts };
    }

    // Execute an already-resolved outcome: damage numbers, hp, deaths, and
    // craters. Order matches the old inline logic (damage first, then
    // terrain).
    static applyResolvedOutcome(outcome: ResolvedAttackOutcome): void {
        for (const { unit, damage } of outcome.damages) {
            // Skip units that already died earlier in this outcome (or
            // otherwise left the game before execution).
            if (!getGameState().units.includes(unit)) continue;
            VisualizationSystem.showDamageNumber(unit.visualUnit.position.clone(), damage);
            this.applyDamage(unit, damage);
            if (unit.hp <= 0) {
                this.removeUnit(unit);
            }
        }
        for (const impact of outcome.impacts) {
            if (impact.craterDelta === 0) continue; // volley rockets: visual only
            const tileBefore = getGameState().map.getTile(impact.q, impact.r);
            const wasLand = tileBefore && tileBefore.type !== 'WATER';
            GridSystem.modifyHexHeight(new HexCoord(impact.q, impact.r), impact.craterDelta);
            const tileAfter = getGameState().map.getTile(impact.q, impact.r);
            // Drowning: the tile just sank into water -- any land unit
            // standing on it goes down with it. Plums. (Mirrors the sim's
            // rule in SimCommands, so replayed AI turns stay in sync.)
            if (wasLand && tileAfter && tileAfter.type === 'WATER') {
                const standing = getGameState().getUnitAt(impact.q, impact.r);
                if (standing && this.unitTypesRecord[standing.type].terrainCosts.WATER == null) {
                    VisualizationSystem.showDamageNumber(standing.visualUnit.position.clone(), standing.hp);
                    this.removeUnit(standing);
                }
            }
        }
    }

    static resetTurnFlags(): void {
        getGameState().units.forEach((unit: GameUnit) => {
            this.setHasAttacked(unit, false);
        });
    }

    static updateUnitVisuals(unit: GameUnit): void {
        const sprite = unit.visualUnit.children.find((child: any) => child instanceof THREE.Sprite);
        if (sprite) {
            sprite.material.map.dispose();
            const newSprite = this.createUnitSprite(unit.type, unit.hp, unit.maxHp, unit.playerIndex);
            sprite.material.map = newSprite.material.map;
        }
    }

    static removeUnit(unit: GameUnit): void {
        // A destroyed transport takes its passengers down with it, exactly
        // as the attack gene does in the simulation.
        //
        // Without it a loaded APC is an invulnerable warehouse: cargo is
        // hidden from getUnitAt, so nothing can shoot it, and the carrier
        // dying would leave it alive, invisible, and pointing at a unit
        // that is no longer on the board -- still counted by the score,
        // never able to act, never able to die. Removing the ride is what
        // makes carrying a RISK the search can weigh.
        //
        // Collected first: removeUnit splices gameState.units, so iterating
        // it while recursing would skip entries.
        const riders = getGameState().units.filter((u) => u.carriedBy === unit);
        for (const rider of riders) {
            rider.carriedBy = null;
            this.removeUnit(rider);
        }

        // Get the hex before removing the unit
        const hex = HexCoord.findHex(unit.q, unit.r);

        // Remove the unit from the game state
        const index = getGameState().units.indexOf(unit);
        if (index > -1) {
            getGameState().units.splice(index, 1);
        }

        // Remove the sprite if it exists
        if (unit.visualUnit.userData.sprite) {
            scene.remove(unit.visualUnit.userData.sprite);
            unit.visualUnit.userData.sprite.material.map.dispose();
            unit.visualUnit.userData.sprite.material.dispose();
        }

        // Remove the minimap unit if it exists
        if (unit.visualUnit.userData.miniUnit) {
            scene.remove(unit.visualUnit.userData.miniUnit);
        }

        // Remove the visual unit from the scene
        scene.remove(unit.visualUnit);

        // Update decorator transparency at the unit's last position
        if (hex) {
            GridSystem.updateDecoratorTransparency(hex);
        }

        // Show death effect at unit's last position
        VisualizationSystem.showDeathEffect(unit.visualUnit.position);

        // Keep the own-unit ground markers in sync now that this unit is gone
        VisualizationSystem.updateOwnUnitMarkers(getGameState().units);
    }
}

export { UnitSystem };