// UnitSystem.js
import { scene, miniMapScene } from '../../render';
import { FootprintSystem } from './FootprintSystem';
import { VisualizationSystem } from './VisualizationSystem';
import { PathfindingSystem } from './PathfindingSystem';
import { setSelectedUnit } from '../../game';
import { AudioSystem } from './AudioSystem';
import { ModelSystem } from './ModelSystem';
import { GridSystem } from './GridSystem';
import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { players, HIGHLIGHT_COLORS } from '../../constants';
import { getGameState } from '../../systems/gameStateStore';
import type { UnitTypeConfig, GameUnit, ResolvedAttackOutcome } from '../../types';

class UnitSystem {
    static get unitTypesRecord(): Record<string, UnitTypeConfig> {
        return this.unitTypes as unknown as Record<string, UnitTypeConfig>;
    }

    static unitTypes = {
        "Road": {
            symbol: "E",
            name: "Road",
            maxHp: 2,
            hp: 2,
            move: 3,
            minRange: 1,
            maxRange: 2,
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/droid.obj",
            scale: 0.3,
            attackEffect: 'laser',  // laser beam attack
            footprintTexture: null,  // No footprints for droids
            terrainCosts: {
                WATER: null,
                SAND: 4,
                GRASS: 2,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: true,  // Use player color for this model
            sounds: {
                movement: 'step1',
                attack: 'laser'
            }
        },
        "Boat1": {
            symbol: "O",
            name: "Boat1",
            maxHp: 10,
            hp: 10,
            move: 2,
            minRange: 2,
            maxRange: 6,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/boat1.obj",  // Bones for the barbaric orc
            scale: 0.2,
            rotation: 0,
            attackEffect: 'projectile',  // default projectile attack
            footprintTexture: 'assets/textures/tracks3.png',  // Boat tracks
            terrainCosts: {
                WATER: 1,
                SAND: null,
                GRASS: null,
                FOREST: null,
                MOUNTAIN: null
            },
            usePlayerColor: true,
            replaceColor: 0x22380F,  // Use player color for this model
            sounds: {
                movement: 'battleship_movement',
                attack: 'rlauncher1'
            }
        },
        "Tank1": {
            symbol: "O",
            name: "Tank1",
            maxHp: 10,
            hp: 10,
            move: 2,
            minRange: 1,
            maxRange: 1,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/bulwark-heavy-tank.glb",  // new-models test swap (was tank_2_green.fbx)
            scale: 0.2,
            rotation: 0,
            attackEffect: 'projectile',  // default projectile attack
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',  // tint only the model's teamCamo material slot
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher2'
            }
        },
        "Tank2": {
            symbol: "O",
            name: "Tank2",
            maxHp: 7,
            hp: 7,
            move: 2,
            minRange: 3,
            maxRange: 5,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/kestrel-missile-carrier.glb",  // new-models test swap (was tank_3_green.fbx); fits rocketBarrage thematically
            scale: 0.16,
            rotation: 0,
            attackEffect: 'rocketBarrage',  // Changed from 'projectile' to 'rocketBarrage'
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,  // Keep the model's original authored materials/textures
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher2'
            }
        },
        "Tank3": {
            symbol: "O",
            name: "Tank3",
            maxHp: 5,
            hp: 5,
            move: 2,
            minRange: 1,
            maxRange: 1,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/sabre-medium-tank.glb",  // new-models test swap (was tank_4_green.fbx)
            scale: 0.18,
            rotation: 0,
            attackEffect: 'projectile',  // default projectile attack
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,  // Keep the model's original authored materials/textures
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher2'
            }
        },
        "Droid": {
            symbol: "E",
            name: "Droid",
            maxHp: 2,
            hp: 2,
            move: 3,
            minRange: 1,
            maxRange: 2,
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/droid.obj",
            scale: 0.3,
            attackEffect: 'laser',  // laser beam attack
            footprintTexture: null,  // No footprints for droids
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: true,  // Use player color for this model
            sounds: {
                movement: 'step1',
                attack: 'laser'
            }
        },
        "Artillery": {
            symbol: "T",
            name: "Artillery",
            maxHp: 3,
            hp: 3,
            move: 2,
            minRange: 2,
            maxRange: 4,
            minDamage: 5,
            maxDamage: 7,
            attack: 6,
            model: "assets/tank_1_green.fbx",  // Big bridge for the big troll
            scale: 0.13,
            attackEffect: 'projectile',  // default projectile attack
            footprintTexture: 'assets/textures/tracks2.png',  // Tank tracks
            terrainCosts: {
                WATER: null,
                SAND: 2,
                GRASS: 1,
                FOREST: 3,
                MOUNTAIN: null
            },
            usePlayerColor: false,  // Keep original FBX materials
            replaceColor: 0x22380F,  // Dark green color to replace
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher3'
            }
        },
        "Catapult": {
            symbol: "C",
            name: "Catapult",
            maxHp: 10,
            hp: 10,
            move: 1,
            minRange: 3,
            maxRange: 4,
            minDamage: 6,
            maxDamage: 8,
            attack: 15,
            model: "assets/3d/decorator_object_catapult.obj",  // Keep existing catapult
            scale: 0.8,
            footprintTexture: null,  // No footprints for catapults
            terrainCosts: {
                WATER: null,
                SAND: 2,
                GRASS: 1.5,
                FOREST: 3,
                MOUNTAIN: null
            },
            usePlayerColor: true,  // Use player color for this model
            sounds: {
                movement: null,  // No movement sound for catapults
                attack: 'rlauncher3'
            }
        },
        "DroverAPC": {
            symbol: "A",
            name: "Drover APC",
            maxHp: 6,
            hp: 6,
            move: 3,
            minRange: 1,
            maxRange: 2,
            minDamage: 3,
            maxDamage: 5,
            attack: 4,
            model: "assets/units/drover-apc.glb",
            scale: 0.22,
            rotation: 0,
            attackEffect: 'projectile',
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 1.5,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher1'
            }
        },
        "HalberdAA": {
            symbol: "H",
            name: "Halberd AA",
            maxHp: 8,
            hp: 8,
            move: 2,
            minRange: 2,
            maxRange: 5,  // long reach, reflecting its anti-air role
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/halberd-aa-tank.glb",
            scale: 0.2,
            rotation: 0,
            attackEffect: 'projectile',
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 2,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_heavy',
                attack: 'rlauncher3'
            }
        },
        "LynxIFV": {
            symbol: "L",
            name: "Lynx IFV",
            maxHp: 5,
            hp: 5,
            move: 4,  // fast scout/skirmisher
            minRange: 1,
            maxRange: 2,
            minDamage: 2,
            maxDamage: 4,
            attack: 3,
            model: "assets/units/lynx-light-ifv.glb",
            scale: 0.22,
            rotation: 0,
            attackEffect: 'projectile',
            footprintTexture: 'assets/textures/tracks2.png',
            terrainCosts: {
                WATER: null,
                SAND: 1,
                GRASS: 1,
                FOREST: 1.5,
                MOUNTAIN: null
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'engine_light',
                attack: 'rlauncher1'
            }
        },
        "NightjarHelo": {
            symbol: "N",
            name: "Nightjar Helo",
            maxHp: 6,
            hp: 6,
            move: 5,  // flight
            minRange: 1,
            maxRange: 3,
            minDamage: 4,
            maxDamage: 6,
            attack: 5,
            model: "assets/units/nightjar-attack-helo.glb",
            scale: 0.11,
            rotation: 0,
            flightAltitude: 1.2,  // hovers above terrain/units
            attackEffect: 'rocketBarrage',
            footprintTexture: null,  // Flies -- leaves no tracks
            terrainCosts: {
                // Flies over everything at a uniform cost, unlike ground units
                WATER: 1,
                SAND: 1,
                GRASS: 1,
                FOREST: 1,
                MOUNTAIN: 1
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: null,  // No helicopter rotor sound available
                attack: 'rlauncher2'
            }
        },
        "ShrikeJet": {
            symbol: "S",
            name: "Shrike Jet",
            maxHp: 4,  // fragile, hit-and-run
            hp: 4,
            move: 7,  // very fast
            minRange: 2,
            maxRange: 4,
            minDamage: 6,
            maxDamage: 9,
            attack: 7,
            model: "assets/units/shrike-attack-jet.glb",
            scale: 0.12,
            rotation: 0,
            flightAltitude: 2.5,  // cruises higher than the helicopter
            attackEffect: 'projectile',
            footprintTexture: null,  // Flies -- leaves no tracks
            terrainCosts: {
                WATER: 1,
                SAND: 1,
                GRASS: 1,
                FOREST: 1,
                MOUNTAIN: 1
            },
            usePlayerColor: false,
            teamColorMaterial: 'teamCamo',
            sounds: {
                movement: 'jet',
                attack: 'rlauncher3'
            }
        }
    };

    static getMovementCost(type: string, terrainType: string): number | null | undefined {
        return this.unitTypesRecord[type].terrainCosts[terrainType];
    }

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
            : TerrainSystem.getHeight(hex) + (unit.userData.flightAltitude || 0);

        // Transform position in world space
        const finalPosition = new THREE.Vector3(
            position.x,
            height,
            position.z
        );

        // Set model position
        unit.position.copy(finalPosition);
        unit.userData.q = coord.q;
        unit.userData.r = coord.r;

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

        // Only create footprints if we're not in a transition (no customPosition)
        if (!customPosition) {
            // Create footprint at the old position
            FootprintSystem.createFootprint(oldHex, rotation, unit.userData.type);
            // Create footprint at the new position
            FootprintSystem.createFootprint(hex, rotation, unit.userData.type);

            // Keep the "which ground tile is my unit on" markers in sync --
            // see VisualizationSystem.updateOwnUnitMarkers.
            if (unit.userData.playerIndex === 0) {
                VisualizationSystem.updateOwnUnitMarkers(getGameState().units, 0);
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
                const flightAltitude = unit.visualUnit.userData.flightAltitude || 0;
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

                // Animation function
                const animate = (timestamp: number) => {
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
                        // After transition completes, ensure final position and rotation are exact and create footprints
                        this.setPosition(unit.visualUnit, coord, hex, targetRotation);

                        // After the last movement step, recalculate highlights with a small delay
                        if (index === path.length - 1) {
                            setTimeout(() => {
                                VisualizationSystem.clearHighlights();
                                this.highlightMoveRange(unit);
                                this.highlightAttackRange(unit);
                                // Stop engine sound when movement is complete
                                AudioSystem.stopEngineSound(unit);
                                movementDone();
                            }, 50);
                        }
                    }
                };

                const startTime = performance.now();
                requestAnimationFrame(animate);
            }, delay);
            delay += stepDuration;
        });

        return donePromise;
    }

    static handleSelection(unit: GameUnit | null) {
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

    static calculateDamage(attackerStats: UnitTypeConfig, defender: GameUnit): number {
        // Calculate base damage using attacker's min and max damage
        const baseDamage = Math.floor(Math.random() * (attackerStats.maxDamage - attackerStats.minDamage + 1)) + attackerStats.minDamage;

        return baseDamage;
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

    static async attack(attacker: GameUnit, defender: GameUnit, resolved?: ResolvedAttackOutcome): Promise<void> {
        if (this.hasUnitAttacked(attacker)) {
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

        // Resolve-first: every random decision (damage roll, rocket landing
        // hexes) is made up front. Player attacks resolve here and now; AI
        // replay passes in the outcome its simulation already committed to,
        // so the executed reality matches the searched plan exactly.
        const outcome = resolved ?? this.resolveLiveAttack(attacker, defender, attackerStats);

        // Show attack effect based on unit type, then execute the outcome.
        if (attackerStats.attackEffect === 'projectile') {
            VisualizationSystem.showAttackEffect(attackerHex, defenderHex);
            await new Promise(resolve => setTimeout(resolve, 500));
            this.applyResolvedOutcome(outcome);
        } else if (attackerStats.attackEffect === 'rocketBarrage') {
            // Rockets fly to the exact resolved impact hexes.
            VisualizationSystem.showRocketBarrageEffect(attackerHex, defenderHex, { impacts: outcome.impacts });
            // Wait for all rockets to finish
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.applyResolvedOutcome(outcome);
        } else if (attackerStats.attackEffect === 'laser') {
            VisualizationSystem.showLaserAttackEffect(attackerHex, defenderHex);
            await new Promise(resolve => setTimeout(resolve, 400));
            this.applyResolvedOutcome(outcome);
        }

        // Set the hasAttacked flag for the attacker
        this.setHasAttacked(attacker, true);

        setSelectedUnit(null);
        VisualizationSystem.clearHighlights();
    }

    // Live-side resolver mirroring src/systems/sim/resolveAttack.ts, but
    // rolling real dice (uniform damage, Math.random scatter) since player
    // attacks don't need cross-candidate determinism -- only resolve-before-
    // execute. Splash and crater rules are identical to the sim version.
    static resolveLiveAttack(attacker: GameUnit, defender: GameUnit, attackerStats: UnitTypeConfig): ResolvedAttackOutcome {
        const damage = this.calculateDamage(attackerStats, defender);
        const damages: ResolvedAttackOutcome['damages'] = [];
        const impacts: ResolvedAttackOutcome['impacts'] = [];

        if (attackerStats.attackEffect === 'rocketBarrage') {
            // Splash hexes: the defender's hex + all in-bounds neighbors.
            const splashHexes = [{ q: defender.q, r: defender.r }];
            HexCoord.getNeighbors(defender.q, defender.r).forEach((n) => {
                if (HexCoord.isWithinMapBounds(n.q, n.r)) splashHexes.push({ q: n.q, r: n.r });
            });

            for (const hex of splashHexes) {
                const unitAtHex = getGameState().getUnitAt(hex.q, hex.r);
                if (!unitAtHex) continue;
                const isPrimary = hex.q === defender.q && hex.r === defender.r;
                damages.push({ unit: unitAtHex, damage: isPrimary ? damage : Math.floor(damage * 0.5) });
            }

            const rocketCount = 6;
            const craterDelta = -0.5;
            for (let i = 0; i < rocketCount; i++) {
                const target = splashHexes[Math.floor(Math.random() * splashHexes.length)];
                impacts.push({ q: target.q, r: target.r, craterDelta });
            }
        } else {
            // projectile/laser (and any future single-target effect)
            damages.push({ unit: defender, damage });
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
            GridSystem.modifyHexHeight(new HexCoord(impact.q, impact.r), impact.craterDelta);
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
        VisualizationSystem.updateOwnUnitMarkers(getGameState().units, 0);
    }
}

export { UnitSystem };