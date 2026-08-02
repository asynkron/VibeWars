// UnitSystem.js

class UnitSystem {
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
            model: "assets/tank_2_green.fbx",  // Bones for the barbaric orc
            scale: 0.13,
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
            usePlayerColor: false,  // Keep original FBX materials
            replaceColor: 0x22380F,  // Dark green color to replace
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
            model: "assets/tank_3_green.fbx",  // Bones for the barbaric orc
            scale: 0.13,
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
            usePlayerColor: false,  // Keep original FBX materials
            replaceColor: 0x22380F,  // Dark green color to replace
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
            model: "assets/tank_4_green.fbx",  // Bones for the barbaric orc
            scale: 0.13,
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
            usePlayerColor: false,  // Keep original FBX materials
            replaceColor: 0x22380F,  // Dark green color to replace
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
        }
    };

    static getMovementCost(type, terrainType) {
        return this.unitTypes[type].terrainCosts[terrainType];
    }

    static async loadUnitModels() {
        await ModelSystem.loadModels(this.unitTypes);
    }

    static createUnitSprite(type, hp, maxHp, playerIndex) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

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
        const unitName = this.unitTypes[type].name;
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

    static createModelWithColor(model, playerColor, usePlayerColor = true, replaceColor = null) {
        const modelClone = model.clone();

        if (usePlayerColor) {
            modelClone.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(mat => {
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
            const isColorClose = (color1, color2) => {
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

            modelClone.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(mat => {
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

    static createUnit(type, q, r, playerIndex) {
        // Create sprite for UI elements (health bar, name, etc)
        const unitSprite = this.createUnitSprite(type, this.unitTypes[type].hp, this.unitTypes[type].maxHp, playerIndex);
        unitSprite.scale.set(1, 1, 1);
        unitSprite.rotation.x = 0;
        scene.add(unitSprite);  // Add sprite directly to scene

        // Add 3D model if available
        const unitType = this.unitTypes[type];
        if (unitType.model && ModelSystem.getModel(unitType.model)) {
            const modelClone = ModelSystem.createModelWithColor(
                ModelSystem.getModel(unitType.model),
                players[playerIndex].color,
                unitType.usePlayerColor,
                unitType.replaceColor
            );

            // Calculate bounding box for model height
            const bbox = new THREE.Box3().setFromObject(modelClone);
            const modelHeight = bbox.max.y - bbox.min.y;

            // Store references and data in model's userData
            modelClone.userData = {
                type,
                q,
                r,
                hp: this.unitTypes[type].hp,
                maxHp: this.unitTypes[type].maxHp,
                move: this.unitTypes[type].move,
                attack: this.unitTypes[type].attack,
                minRange: this.unitTypes[type].minRange,
                maxRange: this.unitTypes[type].maxRange,
                playerIndex,
                hasAttacked: false,
                sprite: unitSprite,  // Store reference to sprite
                modelHeight: modelHeight,  // Store model height for positioning
                terrainCosts: this.unitTypes[type].terrainCosts
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

    static setPosition(unit, coord, hex, rotation, customPosition = null) {
        // Get the old position's hex before updating
        const oldHex = HexCoord.findHex(unit.userData.q, unit.userData.r);

        // Use custom position if provided, otherwise calculate from coord
        const position = customPosition || coord.getWorldPosition();
        const height = customPosition ? customPosition.y : TerrainSystem.getHeight(hex);

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

        // Get the hex mesh to access its geometry
        const hexMesh = hex.children.find(child =>
            child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );

        // TODO: The following tilt code causes bad rotation logic when units move.
        // The issue is that it's trying to align the unit's up vector with the terrain normal,
        // but this conflicts with the movement rotation system. We need to find a better way
        // to handle terrain alignment that doesn't interfere with movement rotations.
        /*
        if (hexMesh) {
            // Get the center vertex normal (index 13)
            const normals = hexMesh.geometry.attributes.normal;
            const centerNormal = new THREE.Vector3(
                normals.getX(13),
                normals.getY(13),
                normals.getZ(13)
            );

            // For land tiles, negate the normal to point upward
            if (hex.userData.type !== 'water') {
                centerNormal.multiplyScalar(-1);
            }

            // Create a quaternion that aligns the unit's up vector with the terrain normal
            const up = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion();

            // Calculate the rotation to align with terrain normal
            const rotationAxis = new THREE.Vector3().crossVectors(up, centerNormal);
            const rotationAngle = Math.acos(up.dot(centerNormal));

            if (rotationAngle > 0) {
                quaternion.setFromAxisAngle(rotationAxis.normalize(), rotationAngle);
            }

            // Apply the terrain normal rotation
            unit.setRotationFromQuaternion(quaternion);

            // Apply any additional rotation if provided
            if (rotation !== undefined) {
                unit.rotateY(rotation);
            }
        } else {
            // Apply simple rotation if no hex mesh found
            if (rotation !== undefined) {
                unit.rotation.y = rotation;
            }
        }
        */

        // Apply provided rotation when available
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
        }
    }

    static getUnitStats(type) {
        return this.unitTypes[type];
    }

    static isHexOccupied(q, r, excludeUnit = null) {
        return gameState.units.some(u => u.q === q && u.r === r && u !== excludeUnit);
    }

    static getRotation(oldQ, oldR, newQ, newR) {
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

    static move(unit, path) {
        // Start engine sound when movement begins
        AudioSystem.playEngineSound(unit);

        // Clear highlights at the start of movement
        VisualizationSystem.clearHighlights();

        let delay = 0;
        const transitionDuration = 200; // Duration of transition between hexes
        const stepDuration = 250; // Total duration for each step (including transition)

        path.forEach((hex, index) => {
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

                // Adjust Y positions based on terrain height
                startPos.y = TerrainSystem.getHeight(startHex);
                endPos.y = TerrainSystem.getHeight(hex);

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
                const animate = (timestamp) => {
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
                            }, 50);
                        }
                    }
                };

                const startTime = performance.now();
                requestAnimationFrame(animate);
            }, delay);
            delay += stepDuration;
        });
    }

    static handleSelection(unit) {
        selectedUnit = unit;
        VisualizationSystem.clearPathLine();
        VisualizationSystem.clearHighlights();  // Clear existing highlights first

        if (unit) {
            this.highlightMoveRange(unit);
            this.highlightAttackRange(unit);
        }
    }

    static handleMovement(unit, targetHex) {
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

    static highlightMoveRange(unit) {
        console.log("highlightMoveRange!!!!!!!!!!!");
        console.log(unit);
        const unitCoord = new HexCoord(unit.q, unit.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        reachable.forEach(key => {
            const coord = HexCoord.fromKey(key);
            const hex = coord.getHex();
            if (hex && !this.isHexOccupied(coord.q, coord.r, unit)) {
                VisualizationSystem.highlightHex(hex, HIGHLIGHT_COLORS.MOVE_RANGE);
            }
        });
    }

    static offsetToCube(col, row) {
        // Convert from odd-q offset (flat-topped) to cube coordinates
        const x = col;
        const z = row - (col - (col & 1)) / 2;
        const y = -x - z;
        return { x, y, z };
    }

    static getHexDistance(q1, r1, q2, r2) {
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

    static highlightAttackRange(unit) {
        // Loop through all units and check enemy units
        gameState.units.forEach(targetUnit => {
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

    static isValidMove(unit, targetHex) {
        if (!targetHex) return false;
        console.log("is Valid move!!!!");

        const unitCoord = new HexCoord(unit.q, unit.r);
        const targetCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
        const { reachable } = PathfindingSystem.dijkstra(unitCoord.q, unitCoord.r, unit.move, unit);

        return reachable.has(targetCoord.getKey());
    }

    static setHasAttacked(unit, value) {
        unit.hasAttacked = value;
        unit.visualUnit.userData.hasAttacked = value;
    }

    static hasUnitAttacked(unit) {
        return unit.hasAttacked;  // We only need to check one since they're kept in sync
    }

    static calculateDamage(attackerStats, defender) {
        // Calculate base damage using attacker's min and max damage
        const baseDamage = Math.floor(Math.random() * (attackerStats.maxDamage - attackerStats.minDamage + 1)) + attackerStats.minDamage;

        // Log the damage calculation
        console.log(`${attackerStats.name} attacks ${this.unitTypes[defender.type].name}!`);
        console.log(`Damage roll: ${baseDamage}`);

        return baseDamage;
    }

    static applyDamage(unit, damage) {
        // Update HP in both the game state unit and the visual unit
        unit.hp -= damage;
        unit.visualUnit.userData.hp = unit.hp;  // Sync the HP values
        console.log(`${this.unitTypes[unit.type].name} takes ${damage} damage! HP: ${unit.hp}/${unit.maxHp}`);

        // Update the sprite to show new HP
        if (unit.visualUnit.userData.sprite) {
            const newSprite = this.createUnitSprite(unit.type, unit.hp, unit.maxHp, unit.playerIndex);
            unit.visualUnit.userData.sprite.material.map.dispose();
            unit.visualUnit.userData.sprite.material.map = newSprite.material.map;
            unit.visualUnit.userData.sprite.material.needsUpdate = true;
        }
    }

    static getAttackAngle(startHex, targetHex) {
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

    static async attack(attacker, defender) {
        if (this.hasUnitAttacked(attacker)) {
            console.log(`${this.unitTypes[attacker.type].name} has already attacked this turn!`);
            return;
        }

        // Check if target is within attack range
        const distance = this.getHexDistance(attacker.q, attacker.r, defender.q, defender.r);
        if (distance < attacker.minRange || distance > attacker.maxRange) {
            console.log(`${this.unitTypes[attacker.type].name} cannot attack target at this range!`);
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

        // Calculate damage
        const damage = this.calculateDamage(attackerStats, defender);

        // Show attack effect based on unit type
        if (attackerStats.attackEffect === 'projectile') {
            VisualizationSystem.showAttackEffect(attackerHex, defenderHex);
            // Wait for projectile animation
            await new Promise(resolve => setTimeout(resolve, 500));
            // Show damage number *after* effect
            VisualizationSystem.showDamageNumber(defender.visualUnit.position.clone(), damage);
            // Apply damage to original target
            this.applyDamage(defender, damage);
            // Check if defender is destroyed
            if (defender.hp <= 0) {
                this.removeUnit(defender);
            }
        } else if (attackerStats.attackEffect === 'rocketBarrage') {
            // Get all possible target hexes (original target + neighbors)
            const targetCoord = new HexCoord(defenderHex.userData.q, defenderHex.userData.r);
            const possibleTargets = [defenderHex];

            // Add all valid neighbors
            targetCoord.getNeighbors().forEach(neighbor => {
                const neighborHex = GridSystem.findHex(neighbor.q, neighbor.r);
                if (neighborHex) {
                    possibleTargets.push(neighborHex);
                }
            });

            // Show rocket barrage effect
            VisualizationSystem.showRocketBarrageEffect(attackerHex, defenderHex);

            // Wait for all rockets to finish
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Apply damage to each hex that was hit
            possibleTargets.forEach(targetHex => {
                const unitAtTarget = GridSystem.getUnitAtHex(targetHex);
                if (unitAtTarget) {
                    // Apply full damage to the original target, reduced damage to neighbors
                    const damageMultiplier = targetHex === defenderHex ? 1 : 0.5;
                    const currentDamage = Math.floor(damage * damageMultiplier); // Calculate damage for this target
                    // Show damage number *after* effect
                    VisualizationSystem.showDamageNumber(unitAtTarget.visualUnit.position.clone(), currentDamage);
                    // Apply damage
                    this.applyDamage(unitAtTarget, currentDamage);
                    // Check if unit is destroyed
                    if (unitAtTarget.hp <= 0) {
                        this.removeUnit(unitAtTarget);
                    }
                }
            });
        } else if (attackerStats.attackEffect === 'laser') {
            VisualizationSystem.showLaserAttackEffect(attackerHex, defenderHex);
            // Wait for laser animation
            await new Promise(resolve => setTimeout(resolve, 400));
            // Show damage number *after* effect
            VisualizationSystem.showDamageNumber(defender.visualUnit.position.clone(), damage);
            // Apply damage to original target
            this.applyDamage(defender, damage);
            // Check if defender is destroyed
            if (defender.hp <= 0) {
                this.removeUnit(defender);
            }
        }

        // Set the hasAttacked flag for the attacker
        this.setHasAttacked(attacker, true);

        selectedUnit = null;
        VisualizationSystem.clearHighlights();
    }

    static resetTurnFlags() {
        gameState.units.forEach(unit => {
            this.setHasAttacked(unit, false);
        });
    }

    static updateUnitVisuals(unit) {
        const sprite = unit.visualUnit.children.find(child => child instanceof THREE.Sprite);
        if (sprite) {
            sprite.material.map.dispose();
            const newSprite = this.createUnitSprite(unit.type, unit.hp, unit.maxHp, unit.playerIndex);
            sprite.material.map = newSprite.material.map;
        }
    }

    static removeUnit(unit) {
        // Get the hex before removing the unit
        const hex = HexCoord.findHex(unit.q, unit.r);

        // Remove the unit from the game state
        const index = gameState.units.indexOf(unit);
        if (index > -1) {
            gameState.units.splice(index, 1);
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
    }
}

window.UnitSystem = UnitSystem;
console.log('UnitSystem.js loaded');