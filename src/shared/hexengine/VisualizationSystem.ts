// VisualizationSystem.js
import { scene, group } from '../../render';
import { PathIndicatorSystem } from './PathIndicatorSystem';
import { AudioSystem } from './AudioSystem';
import { GridSystem } from './GridSystem';
import { HexCoord } from './HexCoord';
import { TerrainSystem } from './TerrainSystem';
import { LightPool } from './LightPool';
import { MAP_CONFIG, HIGHLIGHT_COLORS, VISUAL_OFFSETS } from '../../constants';
import { getGameStateOrNull } from '../../systems/gameStateStore';

/*
Render Order Hierarchy (from top to bottom):
999: Damage numbers (always on top)
100: Units (should be above path and highlights)
50:  Movement path (should be above highlights but below units)
-1:  Hex highlights (should be above terrain but below everything else)
0:   Terrain (base layer)
*/

class VisualizationSystem {
    static pathLine: any = null;
    static highlightGroup: any = null;
    static highlightMeshes = new Map();
    static highlightMaterials = new Map();
    static highlightGeometries = new Map();
    static highlightGroups = new Map();
    static initialized = false;
    static initializationPromise: any = null;
    // Smoke and explosion sprites, keyed by path. createParticleEffect used
    // to build a TextureLoader and load all four PNGs on EVERY call, and it
    // is called from both createSmokeParticles and createExplosionParticles
    // -- so every explosion in the game re-fetched and re-decoded the same
    // four images. Loaded once here, and warmed at start-up by
    // preloadParticleTextures so the first explosion does not stutter.
    static particleTextures = new Map<string, any>();
    static particleTextureLoader: any = null;

    static particleTexture(path: string) {
        let texture = this.particleTextures.get(path);
        if (!texture) {
            this.particleTextureLoader ??= new THREE.TextureLoader();
            texture = this.particleTextureLoader.load(path);
            this.particleTextures.set(path, texture);
        }
        return texture;
    }

    // Every sprite any particle effect can ask for. Kept beside the two
    // callers' defaults on purpose: a path added there and forgotten here
    // still works, it just loads on first use like it used to.
    static readonly PARTICLE_TEXTURE_PATHS = [
        'assets/textures/smoke1.png', 'assets/textures/smoke2.png',
        'assets/textures/smoke3.png', 'assets/textures/smoke4.png',
        'assets/textures/explosion1.png', 'assets/textures/explosion2.png',
        'assets/textures/explosion3.png', 'assets/textures/explosion4.png',
    ];

    static preloadParticleTextures() {
        for (const path of this.PARTICLE_TEXTURE_PATHS) this.particleTexture(path);
    }

    static cachedRocketModel: any = null;  // Cache for the rocket model
    static rocketModelPromise: any = null;  // Promise for loading the rocket model
    static dashOffset: any;  // pre-existing: never initialized before use in updatePathAnimation

    static disposeObject(object: any) {
        if (!object) return;

        if (object instanceof THREE.Group) {
            // Over a COPY: disposing a child removes it from this array, and
            // releasing a pooled light re-parents it out, so iterating the
            // live array would skip every other entry.
            [...object.children].forEach((child: any) => this.disposeObject(child));
            // Remove from parent if it has one
            if (object.parent) {
                object.parent.remove(object);
            }
            return;
        }

        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
            // Dispose geometry
            if (object.geometry) {
                object.geometry.dispose();
            }

            // Dispose material
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach((material: any) => this.disposeMaterial(material));
                } else {
                    this.disposeMaterial(object.material);
                }
            }

            // Remove from parent if it has one
            if (object.parent) {
                object.parent.remove(object);
            }
            return;
        }

        // Handle lights. A POOLED one is lent, not owned: removing it from
        // the scene would change the light count and trigger the very
        // multi-second recompile the pool exists to avoid.
        if (object instanceof THREE.Light) {
            if (LightPool.owns(object)) {
                LightPool.release(object);
                return;
            }
            if (object.parent) {
                object.parent.remove(object);
            }
            return;
        }
    }

    static disposeMaterial(material: any) {
        if (!material) return;

        // Dispose all textures
        if (material.map) material.map.dispose();
        if (material.normalMap) material.normalMap.dispose();
        if (material.roughnessMap) material.roughnessMap.dispose();
        if (material.metalnessMap) material.metalnessMap.dispose();
        if (material.aoMap) material.aoMap.dispose();
        if (material.emissiveMap) material.emissiveMap.dispose();
        if (material.bumpMap) material.bumpMap.dispose();
        if (material.displacementMap) material.displacementMap.dispose();
        if (material.alphaMap) material.alphaMap.dispose();
        if (material.envMap) material.envMap.dispose();

        // Dispose the material itself
        material.dispose();
    }

    static async initialize() {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            // Initialize PathIndicatorSystem
            await PathIndicatorSystem.initialize();
            // Preload the rocket model
            await this.loadRocketModel();
            this.initialized = true;
        })();

        return this.initializationPromise;
    }

    static async loadRocketModel() {
        if (this.rocketModelPromise) {
            return this.rocketModelPromise;
        }

        this.rocketModelPromise = new Promise((resolve, reject) => {
            const fbxLoader = new THREE.FBXLoader();
            fbxLoader.load(
                'assets/bullet_1_bw.fbx',
                (object: any) => {
                    this.cachedRocketModel = object;
                    resolve(object);
                },
                undefined,
                (error: any) => {
                    console.error('Error loading rocket model:', error);
                    reject(error);
                }
            );
        });

        return this.rocketModelPromise;
    }

    static async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    static async clearPathLine() {
        await this.ensureInitialized();
        PathIndicatorSystem.clearPathIndicators();
    }

    static async drawPath(unit: any, path: any[]) {

        await this.ensureInitialized();
        PathIndicatorSystem.showPath(path, unit);
    }

    static clearHighlights() {
        const highlights = group.getObjectByName("highlights");
        if (highlights) {
            group.remove(highlights);
        }
    }

    // Ground-tile markers for the player's own units, kept separate from
    // "highlights" (move/attack range, cursor hover) so the frequent
    // clearHighlights() calls elsewhere don't wipe them. Flying units
    // (helicopters/jets) render well above their actual hex due to
    // flightAltitude, and the camera's angle then visually shifts them away
    // from the tile they're really parked on -- these markers show which
    // ground tile to click.
    static clearOwnUnitMarkers() {
        const markers = group.getObjectByName("ownUnitMarkers");
        if (markers) {
            group.remove(markers);
        }
    }

    // Rule: only a HUMAN player gets their own units marked, only during
    // their own turn, and in their own player color. AI sides never show
    // markers (in AI vs AI there is no "own" side to assist).
    static updateOwnUnitMarkers(units: any[]) {
        this.clearOwnUnitMarkers();
        const gameState = getGameStateOrNull();
        if (!gameState) return;
        const current = gameState.getCurrentPlayer();
        if (current.controller !== 'human') return;
        units
            .filter((unit) => unit.playerIndex === current.id)
            .forEach((unit) => {
                const hex = HexCoord.findHex(unit.q, unit.r);
                if (hex) {
                    this.highlightHex(hex, current.color, true, "ownUnitMarkers");
                }
            });
    }

    static highlightHex(hex: any, color: number = HIGHLIGHT_COLORS.MOVE_RANGE, showOutline: boolean = false, groupName: string = "highlights") {
        const highlights = group.getObjectByName(groupName) || new THREE.Group();
        highlights.name = groupName;

        // Create geometry using the shared helper
        const highlightGeometry = this.createHexTopGeometry(hex, VISUAL_OFFSETS.HIGHLIGHT_OFFSET);
        if (!highlightGeometry) return null;

        // Create the filled highlight
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform vec3 color;
            varying vec2 vUv;

            // Function to calculate hex-shaped distance
            float hexDistance(vec2 p) {
                p = p * 2.0 - 1.0;  // Convert UV to -1 to 1 range
                
                // Convert to hex coordinates
                vec2 q = abs(p);
                float d = max(
                    q.x * 0.866025 + q.y * 0.5,
                    q.y
                );
                
                return d;
            }

            void main() {
                // Calculate hex-shaped distance from center
                float dist = hexDistance(vUv);
                
                // Create main hex gradient from center outward
                float mainGradient = smoothstep(0.4, 0.7, dist);
                
                // Create sharp falloff at the edges
                float edgeFade = 1.0 - smoothstep(0.80, 0.81, dist);
                
                // Create black outline gradient
                float outlineGradient = smoothstep(0.78, 0.79, dist) * (1.0 - smoothstep(0.81, 0.82, dist));
                
                // Combine the gradients and apply opacity
                float mainOpacity = mainGradient * edgeFade * 0.7;
                
                // Final color and opacity based on showOutline parameter
                vec3 finalColor = ${showOutline ? 'mix(color, vec3(0.0), outlineGradient)' : 'color'};
                float finalOpacity = ${showOutline ? 'max(mainOpacity, outlineGradient)' : 'mainOpacity'};
                
                gl_FragColor = vec4(finalColor, finalOpacity);
            }
        `;

        const highlightFill = new THREE.Mesh(
            highlightGeometry,
            new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: new THREE.Color(color) }
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: THREE.DoubleSide,
                transparent: true,
                depthTest: true,
                depthWrite: false
            })
        );

        // Create a group for this highlight
        const highlightGroup = new THREE.Group();
        highlightGroup.add(highlightFill);

        // Position the highlight group at the hex's world position
        const worldPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);
        highlightGroup.position.copy(worldPos);

        highlights.add(highlightGroup);

        // Check if the group needs to be added to main group
        if (!group.getObjectByName(groupName)) {
            group.add(highlights);
        }

        return highlightGroup;
    }

    static updatePathAnimation() {
        if (this.pathLine && this.pathLine.material) {
            this.dashOffset -= 0.1;
            if (this.pathLine.material instanceof THREE.LineDashedMaterial) {
                this.pathLine.material.scale = 2 + Math.sin(this.dashOffset) * 0.5; // Animate the dash scale
                this.pathLine.material.needsUpdate = true;
            }
        }
    }

    static createHexGeometry(radius = 1) {
        const geometry = new THREE.BufferGeometry();
        const vertices: any[] = [];
        const indices: any[] = [];
        const uvs: any[] = [];

        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            vertices.push(
                radius * Math.cos(angle),
                0,
                radius * Math.sin(angle)
            );
            uvs.push(
                (Math.cos(angle) + 1) / 2,
                (Math.sin(angle) + 1) / 2
            );
        }

        // Add center vertex
        vertices.push(0, 0, 0);
        uvs.push(0.5, 0.5);

        // Create triangles
        for (let i = 0; i < 6; i++) {
            indices.push(6, i, (i + 1) % 6);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    static createHexMaterial(color = 0x00ff00) {
        return new THREE.MeshStandardMaterial({
            color: color,
            side: THREE.DoubleSide
        });
    }

    static createHexMesh(geometry: any, material: any) {
        return new THREE.Mesh(geometry, material);
    }

    static createHexHighlight(color = 0xffff00) {
        const geometry = this.createHexGeometry(1.1); // Slightly larger than regular hex
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        });
        return this.createHexMesh(geometry, material);
    }

    static createHexOutline(color = 0x000000) {
        const geometry = new THREE.BufferGeometry();
        const vertices: any[] = [];
        const indices: any[] = [];

        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            vertices.push(
                Math.cos(angle),
                0,
                Math.sin(angle)
            );
        }

        // Create outline indices
        for (let i = 0; i < 6; i++) {
            indices.push(i, (i + 1) % 6);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);

        const material = new THREE.LineBasicMaterial({ color: color });
        return new THREE.LineSegments(geometry, material);
    }

    static showDamageNumber(position: any, damage: number) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;

        // Draw damage number
        ctx.font = 'bold 96px Arial';
        ctx.fillStyle = '#ff0000';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(damage.toString(), 128, 64);
        ctx.fillText(damage.toString(), 128, 64);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 1,
            depthTest: true,
            depthWrite: true
        });

        const sprite = new THREE.Sprite(material);

        // Position is already in world space, use it directly
        sprite.position.copy(position);
        sprite.scale.set(3, 1.5, 1);  // Wider and shorter to match the text aspect ratio
        sprite.position.set(position.x, position.y + 1, position.z);
        sprite.renderOrder = 999;  // Always on top

        // Add directly to scene since position is already transformed
        scene.add(sprite);

        // Animation with faster timing and higher rise
        const startTime = Date.now();
        const duration = 800;
        const startY = sprite.position.y;
        const riseHeight = 3; // Increased from 1.5 to 3 for more dramatic rise

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Rise up with easing
            const easedProgress = 1 - Math.pow(1 - progress, 2); // Ease out quad
            sprite.position.y = startY + (riseHeight * easedProgress);

            // Fade out in the last 40% of animation
            if (progress > 0.6) {
                material.opacity = 1 - ((progress - 0.6) / 0.4);
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                scene.remove(sprite);
                material.dispose();
                texture.dispose();
            }
        }

        requestAnimationFrame(animate);
    }

    static createExplosion(position: any, options: any = {}) {
        const {
            particleCount = 100,
            size = 3.0,
            duration = 1500,
            particleTexturePaths = [
                'assets/textures/smoke1.png',
                'assets/textures/smoke2.png',
                'assets/textures/smoke3.png',
                'assets/textures/smoke4.png'
            ],
            particleBaseSize = 0.5,
            particleMaxSizeFactor = 1.5,
            particleColor = 0xaaaaaa,
            particleOpacity = 0.9
        } = options;

        // Create both smoke and explosion effects
        this.createSmokeParticles(position, options);
        this.createExplosionParticles(position, {
            particleCount: particleCount * 0.5, // Fewer explosion particles
            size: size * 0.4, // Smaller spread for explosion
            duration: duration * 0.6, // Shorter duration for explosion
            particleTexturePaths: [
                'assets/textures/explosion1.png',
                'assets/textures/explosion2.png',
                'assets/textures/explosion3.png',
                'assets/textures/explosion4.png'
            ],
            particleBaseSize: particleBaseSize * 1.2,
            particleMaxSizeFactor: particleMaxSizeFactor * 1.2,
            particleColor: 0xff6600, // Orange tint for explosion
            particleOpacity: 0.8
        });
    }

    static createParticleEffect(position: any, options: any = {}) {
        const {
            particleCount = 100,
            size = 3.0,
            duration = 1500,
            particleTexturePaths = [
                'assets/textures/smoke1.png',
                'assets/textures/smoke2.png',
                'assets/textures/smoke3.png',
                'assets/textures/smoke4.png'
            ],
            particleBaseSize = 0.5,
            particleMaxSizeFactor = 1.5,
            particleColor = 0xaaaaaa,
            particleOpacity = 0.9,
            gravityFactor = 1.8,
            upwardBias = 1.5
        } = options;

        const particleGeometry = new THREE.BufferGeometry();
        const vertices: any[] = [];
        const velocities: any[] = [];
        const startTimes: any[] = [];
        const startSizes: any[] = [];
        const textureIndices: any[] = [];

        const particleTextures = particleTexturePaths.map((path: string) => this.particleTexture(path));

        for (let i = 0; i < particleCount; i++) {
            vertices.push(position.x, position.y, position.z);

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            const speed = Math.random() * size * 0.5 + size * 0.2;
            velocities.push(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.cos(phi) * speed * upwardBias,
                Math.sin(phi) * Math.sin(theta) * speed
            );

            startTimes.push(performance.now() + Math.random() * 200);
            startSizes.push(particleBaseSize + Math.random() * particleBaseSize * particleMaxSizeFactor);
            textureIndices.push(Math.floor(Math.random() * particleTextures.length));
        }

        particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        particleGeometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
        particleGeometry.setAttribute('startTime', new THREE.Float32BufferAttribute(startTimes, 1));
        particleGeometry.setAttribute('startSize', new THREE.Float32BufferAttribute(startSizes, 1));
        particleGeometry.setAttribute('textureIndex', new THREE.Float32BufferAttribute(textureIndices, 1));

        const particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: performance.now() },
                duration: { value: duration },
                pointTextures: { value: particleTextures },
                baseColor: { value: new THREE.Color(particleColor) },
                baseOpacity: { value: particleOpacity },
                gravityFactor: { value: gravityFactor }
            },
            vertexShader: `
                attribute vec3 velocity;
                attribute float startTime;
                attribute float startSize;
                attribute float textureIndex;
                uniform float time;
                uniform float duration;
                uniform float gravityFactor;
                varying float vProgress;
                varying float vOpacity;
                varying float vTextureIndex;

                void main() {
                    float elapsed = max(0.0, time - startTime);
                    vProgress = clamp(elapsed / duration, 0.0, 1.0);
                    vTextureIndex = textureIndex;

                    if (vProgress >= 1.0) {
                         gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
                         gl_PointSize = 0.0;
                         vOpacity = 0.0;
                         return;
                    }
                    
                    float timeSinceStart = elapsed / 1000.0;
                    vec3 gravity = vec3(0.0, -gravityFactor * timeSinceStart * timeSinceStart, 0.0);
                    vec3 currentPos = position + velocity * timeSinceStart + gravity;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(currentPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    float sizeFactor = sin(vProgress * 3.14159) * 1.5;
                    gl_PointSize = startSize * sizeFactor * (300.0 / -mvPosition.z);

                    vOpacity = (1.0 - vProgress); 
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTextures[4];
                uniform vec3 baseColor;
                uniform float baseOpacity;
                varying float vProgress;
                varying float vOpacity;
                varying float vTextureIndex;

                void main() {
                    if (vOpacity <= 0.01) discard;
                    
                    vec4 texColor;
                    if (vTextureIndex < 0.5) texColor = texture2D(pointTextures[0], gl_PointCoord);
                    else if (vTextureIndex < 1.5) texColor = texture2D(pointTextures[1], gl_PointCoord);
                    else if (vTextureIndex < 2.5) texColor = texture2D(pointTextures[2], gl_PointCoord);
                    else texColor = texture2D(pointTextures[3], gl_PointCoord);
                    
                    gl_FragColor = vec4(baseColor * texColor.rgb, texColor.a * baseOpacity * vOpacity);
                }
            `,
            blending: THREE.NormalBlending,
            transparent: true,
            depthTest: true,
            depthWrite: false
        });

        const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
        particleSystem.renderOrder = 100;
        scene.add(particleSystem);

        let animationStartTime = performance.now();
        function animateParticles(timestamp: number) {
            const elapsed = timestamp - animationStartTime;

            particleMaterial.uniforms.time.value = timestamp;

            if (elapsed < duration + 200) {
                requestAnimationFrame(animateParticles);
            } else {
                scene.remove(particleSystem);
                particleGeometry.dispose();
                particleMaterial.dispose();
                particleTextures.forEach((texture: any) => texture.dispose());
            }
        }
        requestAnimationFrame(animateParticles);
    }

    static createSmokeParticles(position: any, options: any = {}) {
        this.createParticleEffect(position, {
            ...options,
            particleTexturePaths: options.particleTexturePaths || [
                'assets/textures/smoke1.png',
                'assets/textures/smoke2.png',
                'assets/textures/smoke3.png',
                'assets/textures/smoke4.png'
            ],
            particleColor: options.particleColor || 0xaaaaaa,
            particleOpacity: options.particleOpacity || 0.9,
            gravityFactor: 1.8,
            upwardBias: 1.5
        });
    }

    static createExplosionParticles(position: any, options: any = {}) {
        this.createParticleEffect(position, {
            ...options,
            particleTexturePaths: options.particleTexturePaths || [
                'assets/textures/explosion1.png',
                'assets/textures/explosion2.png',
                'assets/textures/explosion3.png',
                'assets/textures/explosion4.png'
            ],
            particleColor: options.particleColor || 0xff6600,
            particleOpacity: options.particleOpacity || 0.8,
            gravityFactor: 0.9,
            upwardBias: 2.0
        });
    }

    static showDeathEffect(position: any) {
        // Create both the explosion and debris effects
        this.createExplosion(position, {
            particleCount: 300,  // Reduced from 500
            size: 2.0,          // Reduced from 4.0
            duration: 1500,
            particleBaseSize: 0.4,  // Reduced from 0.7
            particleMaxSizeFactor: 1.5,  // Reduced from 2.0
            particleColor: 0xff6600,
            particleOpacity: 0.9
        });

        // Add debris effect
        this.createDebrisEffect(position);
    }

    static createDebrisEffect(position: any) {
        const debrisCount = 24;
        const duration = 2000;
        const gravity = 0.01;
        const initialVelocity = 0.15;

        // Create debris pieces
        for (let i = 0; i < debrisCount; i++) {
            let geometry: any;
            let scale = 1.0;

            // Randomly choose a debris type
            const debrisType = Math.random();

            if (debrisType < 0.3) {
                // Thin rectangular plate
                geometry = new THREE.BoxGeometry(0.4, 0.08, 0.2); // Increased from 0.3, 0.05, 0.15
                scale = 0.8 + Math.random() * 0.4;
            } else if (debrisType < 0.5) {
                // Small mechanical part (cylinder)
                geometry = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 8); // Increased from 0.05, 0.05, 0.1
                scale = 0.6 + Math.random() * 0.4;
            } else if (debrisType < 0.7) {
                // Gear-like piece (torus)
                geometry = new THREE.TorusGeometry(0.12, 0.03, 8, 16); // Increased from 0.08, 0.02, 8, 16
                scale = 0.7 + Math.random() * 0.3;
            } else if (debrisType < 0.85) {
                // Small lever/rod
                geometry = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8); // Increased from 0.02, 0.02, 0.15
                scale = 0.8 + Math.random() * 0.4;
            } else {
                // Small bracket/angle piece
                geometry = new THREE.BoxGeometry(0.15, 0.15, 0.08); // Increased from 0.1, 0.1, 0.05
                scale = 0.6 + Math.random() * 0.3;
            }

            const material = new THREE.MeshStandardMaterial({
                color: 0x222222,
                transparent: false,
                opacity: 1.0,
                emissive: 0x111111,
                emissiveIntensity: 0.2,
                metalness: 0.8,
                roughness: 0.2
            });
            const debris = new THREE.Mesh(geometry, material);
            debris.castShadow = true;
            debris.receiveShadow = true;

            // Apply random scale
            debris.scale.set(scale, scale, scale);

            // Random initial rotation
            debris.rotation.x = Math.random() * Math.PI;
            debris.rotation.y = Math.random() * Math.PI;
            debris.rotation.z = Math.random() * Math.PI;

            // Random initial position with reduced spread
            debris.position.copy(position);
            debris.position.x += (Math.random() - 0.5) * 0.3;
            debris.position.z += (Math.random() - 0.5) * 0.3;

            // Random rotation velocity with more variation
            const rotationSpeed = {
                x: (Math.random() - 0.5) * 0.3,
                y: (Math.random() - 0.5) * 0.3,
                z: (Math.random() - 0.5) * 0.3
            };

            // Random direction for horizontal movement with reduced spread
            const horizontalVelocity = {
                x: (Math.random() - 0.5) * 0.1,
                z: (Math.random() - 0.5) * 0.1
            };

            scene.add(debris);

            // Animation
            let startTime = performance.now();
            let velocity = initialVelocity;

            function animate(timestamp: number) {
                const elapsed = timestamp - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Update position
                debris.position.y += velocity;
                debris.position.x += horizontalVelocity.x;
                debris.position.z += horizontalVelocity.z;

                // Apply gravity
                velocity -= gravity;

                // Update rotation with easing
                const rotationEase = Math.sin(progress * Math.PI); // Ease out rotation
                debris.rotation.x += rotationSpeed.x * rotationEase;
                debris.rotation.y += rotationSpeed.y * rotationEase;
                debris.rotation.z += rotationSpeed.z * rotationEase;

                // Fade out near the end
                if (progress > 0.7) {
                    material.opacity = 1.0 * (1 - ((progress - 0.7) / 0.3));
                }

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    scene.remove(debris);
                    geometry.dispose();
                    material.dispose();
                }
            }

            requestAnimationFrame(animate);
        }
    }

    static showAttackEffect(startHex: any, targetHex: any) {
        // Play random rocket launcher sound
        // Play jet sound for missile movement with duration matching flight time
        AudioSystem.playSound('jet', 0.5, 500); // 500ms matches the missile flight duration

        // The projectile model is loaded ONCE, at start-up, and cloned per
        // shot. It used to build a new FBXLoader and re-fetch the file on
        // every single attack -- with THREE.Cache off that was a real
        // request and a full FBX re-parse each time a Halberd, Gunboat or
        // Shrike fired, which on this map is constantly. The cache it
        // should have been using was already sitting there, filled by
        // VisualizationSystem.initialize; showRocketBarrageEffect had been
        // cloning from it correctly the whole time.
        if (!this.cachedRocketModel) {
            this.showAttackEffectFallback(startHex, targetHex);
            return;
        }
        {
            const object = this.cachedRocketModel.clone();
                // Scale the model appropriately (5 times smaller than before)
                object.scale.set(0.02, 0.02, 0.02);

                // Create a group to hold the model and lights
                const projectile = new THREE.Group();
                projectile.add(object);

                // Main intense light for sharp shadows
                // Borrowed, not created -- see LightPool. It no longer casts:
                // a shadow-casting POINT light renders the whole scene six
                // times for its cube map, every frame the explosion lives.
                const mainLight = LightPool.claim(0xff0000, 10, 8);
                if (mainLight) projectile.add(mainLight);

                // Calculate start and end positions
                const startCoord = new HexCoord(startHex.userData.q, startHex.userData.r);
                const endCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
                const startPos = startCoord.getWorldPosition();
                const endPos = endCoord.getWorldPosition();

                // Adjust Y positions based on terrain height
                startPos.y = TerrainSystem.getHeight(startHex) + 1;
                endPos.y = TerrainSystem.getHeight(targetHex) + 1;

                // Add projectile to scene at start position
                projectile.position.copy(startPos);
                scene.add(projectile);

                // Animation parameters
                const duration = 500; // milliseconds
                const arcHeight = 2; // maximum height of the arc
                let startTime: any = null;

                // Animate the projectile
                const animate = (timestamp: number) => {
                    if (!startTime) startTime = timestamp;
                    const elapsed = timestamp - startTime;
                    const rawProgress = Math.min(elapsed / duration, 1);

                    // Apply quadratic easing for acceleration
                    const progress = rawProgress * rawProgress;  // Quadratic easing

                    // Calculate current position
                    const x = startPos.x + (endPos.x - startPos.x) * progress;
                    const z = startPos.z + (endPos.z - startPos.z) * progress;

                    // Calculate y using a parabolic arc
                    const y = startPos.y + (endPos.y - startPos.y) * progress +
                        Math.sin(progress * Math.PI) * arcHeight;

                    // Store previous position for direction calculation
                    const prevPos = projectile.position.clone();

                    // Update projectile position
                    projectile.position.set(x, y, z);

                    // Calculate the direction from start to end for Y rotation (heading)
                    const direction = new THREE.Vector3(
                        endPos.x - startPos.x,
                        0, // Ignore vertical difference for initial rotation
                        endPos.z - startPos.z
                    ).normalize();

                    // Calculate the angle between the direction and the forward axis
                    const forward = new THREE.Vector3(0, 0, 1); // Forward axis
                    const angle = Math.atan2(direction.x, direction.z);

                    // Calculate pitch based on actual movement direction
                    const movementDirection = new THREE.Vector3().subVectors(projectile.position, prevPos);
                    const pitch = Math.atan2(
                        movementDirection.y,
                        Math.sqrt(movementDirection.x * movementDirection.x + movementDirection.z * movementDirection.z)
                    );

                    // Create quaternions for pitch and heading
                    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
                    const headingQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

                    // Combine quaternions (heading first, then pitch)
                    const finalQuat = headingQuat.multiply(pitchQuat);

                    // Apply the combined rotation
                    projectile.setRotationFromQuaternion(finalQuat);

                    // More dramatic pulsing effect
                    const mainPulse = 10 + Math.sin(elapsed * 0.02) * 4;
                    mainLight.intensity = mainPulse;

                    // Fade out near the end
                    if (progress > 0.8) {
                        const fadeOut = 1 - ((progress - 0.8) * 5);
                        object.traverse((child: any) => {
                            if (child.isMesh) {
                                child.material.transparent = true;
                                child.material.opacity = fadeOut;
                            }
                        });
                        mainLight.intensity = fadeOut * mainPulse;
                    }

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        // Play explosion sound when missile hits
                        AudioSystem.playSound('explosion', 0.8);
                        // Create explosion visual effect
                        this.createExplosion(endPos);

                        // Clean up
                        this.disposeObject(projectile);
                    }
                };

                requestAnimationFrame(animate);
        }
    }

    // Fallback method using sphere if FBX fails to load
    static showAttackEffectFallback(startHex: any, targetHex: any) {
        // Create a glowing sphere for the projectile
        const projectileGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const projectileMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.8,
            emissive: 0xff0000,
            emissiveIntensity: 2
        });
        const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
        projectile.castShadow = true;

        // Main intense light for sharp shadows
        // Borrowed, not created -- see LightPool. It no longer casts:
        // a shadow-casting POINT light renders the whole scene six
        // times for its cube map, every frame the explosion lives.
        const mainLight = LightPool.claim(0xff0000, 10, 8);
        if (mainLight) projectile.add(mainLight);

        // Calculate start and end positions
        const startCoord = new HexCoord(startHex.userData.q, startHex.userData.r);
        const endCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
        const startPos = startCoord.getWorldPosition();
        const endPos = endCoord.getWorldPosition();

        // Adjust Y positions based on terrain height
        startPos.y = TerrainSystem.getHeight(startHex) + 1;
        endPos.y = TerrainSystem.getHeight(targetHex) + 1;

        // Add projectile to scene at start position
        projectile.position.copy(startPos);
        scene.add(projectile);

        // Animation parameters
        const duration = 500; // milliseconds
        const arcHeight = 2; // maximum height of the arc
        let startTime: any = null;

        // Animate the projectile
        const animate = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const rawProgress = Math.min(elapsed / duration, 1);

            // Apply quadratic easing for acceleration
            const progress = rawProgress * rawProgress;  // Quadratic easing

            // Calculate current position
            const x = startPos.x + (endPos.x - startPos.x) * progress;
            const z = startPos.z + (endPos.z - startPos.z) * progress;

            // Calculate y using a parabolic arc
            const y = startPos.y + (endPos.y - startPos.y) * progress +
                Math.sin(progress * Math.PI) * arcHeight;

            // Store previous position for direction calculation
            const prevPos = projectile.position.clone();

            // Update projectile position
            projectile.position.set(x, y, z);

            // Calculate the direction from start to end for Y rotation (heading)
            const direction = new THREE.Vector3(
                endPos.x - startPos.x,
                0, // Ignore vertical difference for initial rotation
                endPos.z - startPos.z
            ).normalize();

            // Calculate the angle between the direction and the forward axis
            const forward = new THREE.Vector3(0, 0, 1); // Forward axis
            const angle = Math.atan2(direction.x, direction.z);

            // Calculate pitch based on actual movement direction
            const movementDirection = new THREE.Vector3().subVectors(projectile.position, prevPos);
            const pitch = Math.atan2(
                movementDirection.y,
                Math.sqrt(movementDirection.x * movementDirection.x + movementDirection.z * movementDirection.z)
            );

            // Create quaternions for pitch and heading
            const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
            const headingQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

            // Combine quaternions (heading first, then pitch)
            const finalQuat = headingQuat.multiply(pitchQuat);

            // Apply the combined rotation
            projectile.setRotationFromQuaternion(finalQuat);

            // More dramatic pulsing effect
            const mainPulse = 10 + Math.sin(elapsed * 0.02) * 4;
            mainLight.intensity = mainPulse;

            // Fade out near the end
            if (progress > 0.8) {
                const fadeOut = 1 - ((progress - 0.8) * 5);
                projectileMaterial.opacity = fadeOut;
                mainLight.intensity = fadeOut * mainPulse;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Play explosion sound when missile hits
                AudioSystem.playSound('explosion', 0.8);
                // Create explosion visual effect
                this.createExplosion(endPos);

                // Clean up
                this.disposeObject(projectile);
            }
        };

        requestAnimationFrame(animate);
    }

    // `options.impacts` ({q, r}[]) predetermines each rocket's landing hex --
    // the resolve-first attack flow passes the already-decided impact list so
    // the visuals land exactly where the game rules said they would. Without
    // it (legacy fallback) each rocket scatters randomly like before. This
    // effect no longer applies craters; that's game logic, executed by
    // UnitSystem.attack from the same resolved impacts.
    // WHERE THE ROCKETS LEAVE FROM IS THE CALLER'S BUSINESS, because this
    // function cannot know it. It used to put every launch a flat metre over
    // the terrain of the firing hex -- fine for artillery, which is parked on
    // the ground, and wrong for the attack helicopter, whose rockets left
    // from under its own belly and climbed to it. A unit that flies has to
    // hand in the position it is actually flying at; see UnitSystem.attack.
    //
    // The arc is the caller's too, for the same reason. A howitzer lobs. A
    // helicopter fires straight at what it can see, and an arc on a
    // direct-fire weapon reads as the rocket losing its way.
    static showRocketBarrageEffect(startHex: any, targetHex: any, options: any = {}) {
        const {
            impacts = null,
            delayBetweenShots = 100, // milliseconds
            projectileScale = 0.4, // Smaller than regular projectile
            maxInFlight = 3, // Maximum number of rockets in flight at once
            arcHeight = 2, // 0 for direct fire
            launchPos = null, // world position to fire from; terrain if absent
            impactPos = null // world position to hit; terrain if absent
        } = options;
        const projectileCount = impacts ? impacts.length : (options.projectileCount ?? 6);

        // Get all possible target hexes (original target + neighbors)
        const targetCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
        const possibleTargets = [targetHex];

        // Add all valid neighbors
        targetCoord.getNeighbors().forEach(neighbor => {
            const neighborHex = GridSystem.findHex(neighbor.q, neighbor.r);
            if (neighborHex) {
                possibleTargets.push(neighborHex);
            }
        });

        // Keep track of rockets in flight
        let rocketsInFlight = 0;
        let nextRocketIndex = 0;

        // Function to fire a single projectile
        const fireProjectile = (index: number) => {
            if (index >= projectileCount) return;

            // Play jet sound for this rocket with duration matching flight time
            AudioSystem.playSound('jet', 0.4, 500); // 500ms matches the rocket flight duration

            // Fly to the predetermined impact hex when one is given,
            // otherwise scatter randomly (legacy behavior).
            const randomTarget = impacts
                ? (GridSystem.findHex(impacts[index % impacts.length].q, impacts[index % impacts.length].r) ?? targetHex)
                : possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

            // Clone the cached model
            const object = this.cachedRocketModel.clone();

            // Scale the model appropriately
            object.scale.set(0.02 * projectileScale, 0.02 * projectileScale, 0.02 * projectileScale);

            // Create a group to hold the model
            const projectile = new THREE.Group();
            projectile.add(object);

            // Calculate start and end positions
            const startCoord = new HexCoord(startHex.userData.q, startHex.userData.r);
            const endCoord = new HexCoord(randomTarget.userData.q, randomTarget.userData.r);
            const startPos = launchPos ? launchPos.clone() : startCoord.getWorldPosition();
            const endPos = impactPos ? impactPos.clone() : endCoord.getWorldPosition();

            // Only fall back to the terrain when the caller did not say. A
            // barrage scatters across several hexes, so its impacts have to
            // follow the ground; a volley all lands on one unit and the
            // caller passes that unit's position instead.
            if (!launchPos) startPos.y = TerrainSystem.getHeight(startHex) + 1;
            if (!impactPos) endPos.y = TerrainSystem.getHeight(randomTarget) + 1;

            // Add projectile to scene at start position
            projectile.position.copy(startPos);
            scene.add(projectile);

            // Animation parameters
            const duration = 500; // milliseconds
            let startTime: any = null;

            // Animate the projectile
            const animate = (timestamp: number) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const rawProgress = Math.min(elapsed / duration, 1);

                // Apply quadratic easing for acceleration
                const progress = rawProgress * rawProgress;  // Quadratic easing

                // Calculate current position
                const x = startPos.x + (endPos.x - startPos.x) * progress;
                const z = startPos.z + (endPos.z - startPos.z) * progress;

                // Calculate y using a parabolic arc
                const y = startPos.y + (endPos.y - startPos.y) * progress +
                    Math.sin(progress * Math.PI) * arcHeight;

                // Store previous position for direction calculation
                const prevPos = projectile.position.clone();

                // Update projectile position
                projectile.position.set(x, y, z);

                // Calculate the direction from start to end for Y rotation (heading)
                const direction = new THREE.Vector3(
                    endPos.x - startPos.x,
                    0, // Ignore vertical difference for initial rotation
                    endPos.z - startPos.z
                ).normalize();

                // Calculate the angle between the direction and the forward axis
                const angle = Math.atan2(direction.x, direction.z);

                // Calculate pitch based on actual movement direction
                const movementDirection = new THREE.Vector3().subVectors(projectile.position, prevPos);
                const pitch = Math.atan2(
                    movementDirection.y,
                    Math.sqrt(movementDirection.x * movementDirection.x + movementDirection.z * movementDirection.z)
                );

                // Create quaternions for pitch and heading
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
                const headingQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

                // Combine quaternions (heading first, then pitch)
                const finalQuat = headingQuat.multiply(pitchQuat);

                // Apply the combined rotation
                projectile.setRotationFromQuaternion(finalQuat);

                // Fade out near the end
                if (progress > 0.8) {
                    const fadeOut = 1 - ((progress - 0.8) * 5);
                    object.traverse((child: any) => {
                        if (child.isMesh) {
                            child.material.transparent = true;
                            child.material.opacity = fadeOut;
                        }
                    });
                }

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Play explosion sound when missile hits
                    AudioSystem.playSound('explosion', 0.8);
                    // Create explosion visual effect at the rocket's impact point
                    this.createExplosion(endPos, {
                        size: 1.5,
                    });

                    // Clean up projectile
                    this.disposeObject(projectile);

                    // Decrement rockets in flight
                    rocketsInFlight--;

                    // Fire next rocket if we haven't fired all of them
                    if (nextRocketIndex < projectileCount) {
                        setTimeout(() => {
                            fireProjectile(nextRocketIndex++);
                        }, delayBetweenShots);
                    }
                }
            };

            requestAnimationFrame(animate);
        };

        // Start firing projectiles with a maximum number in flight
        const startNextRocket = () => {
            if (nextRocketIndex < projectileCount && rocketsInFlight < maxInFlight) {
                rocketsInFlight++;
                fireProjectile(nextRocketIndex++);
                setTimeout(startNextRocket, delayBetweenShots);
            }
        };

        // Start the barrage
        startNextRocket();
    }

    static showLaserAttackEffect(startHex: any, targetHex: any) {
        // Calculate start and end positions
        const startCoord = new HexCoord(startHex.userData.q, startHex.userData.r);
        const endCoord = new HexCoord(targetHex.userData.q, targetHex.userData.r);
        const startPos = startCoord.getWorldPosition();
        const endPos = endCoord.getWorldPosition();

        // Adjust Y positions based on terrain height
        startPos.y = TerrainSystem.getHeight(startHex) + 1;
        endPos.y = TerrainSystem.getHeight(targetHex) + 1;

        // Calculate direction and length
        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();

        // Create the laser beam geometry
        const laserGeometry = new THREE.CylinderGeometry(0.1, 0.1, length, 8, 1);

        // Create the laser material with emissive properties
        const laserMaterial = new THREE.MeshBasicMaterial({
            color: 0x4444ff,
            transparent: true,
            opacity: 0.8,
            emissive: 0xffffff,
            emissiveIntensity: 2
        });

        const laser = new THREE.Mesh(laserGeometry, laserMaterial);

        // Position the laser at the midpoint between start and end
        const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        laser.position.copy(midPoint);

        // Orient the laser to point from start to end
        // By default, cylinder is aligned with Y-axis, so we need to rotate it
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        quaternion.setFromUnitVectors(up, direction.normalize());
        laser.setRotationFromQuaternion(quaternion);

        // Add intense white light along the beam
        const mainLight = LightPool.claim(0xffffff, 15, 6);
        if (mainLight) laser.add(mainLight);

        // Add blue tinted light for effect
        const blueLight = LightPool.claim(0x4444ff, 8, 8);
        if (blueLight) laser.add(blueLight);

        scene.add(laser);

        // Animation parameters
        const duration = 400; // milliseconds
        let startTime: any = null;

        // Animate the laser beam
        function animate(timestamp: number) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Flash intensity effect
            const flashIntensity = Math.sin(elapsed * 0.1) * 0.5 + 0.5;
            laserMaterial.opacity = 0.8 * flashIntensity;
            mainLight.intensity = 15 * flashIntensity;
            blueLight.intensity = 8 * flashIntensity;

            // Scale effect (beam appears to charge up and then dissipate)
            if (progress < 0.2) {
                // Beam charging up
                const scaleUp = progress * 5; // 0 to 1 over first 20%
                laser.scale.setX(scaleUp);
                laser.scale.setZ(scaleUp);
            } else if (progress > 0.8) {
                // Beam dissipating
                const scaleDown = (1 - progress) * 5; // 1 to 0 over last 20%
                laser.scale.setX(scaleDown);
                laser.scale.setZ(scaleDown);
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Clean up. The lights are BORROWED: hand them back before
                // the laser goes, or they leave the scene with it and the
                // light count changes -- which is the multi-second recompile
                // the pool exists to prevent. This path does not go through
                // disposeObject, so it has to say so itself.
                LightPool.release(mainLight);
                LightPool.release(blueLight);
                scene.remove(laser);
                laserGeometry.dispose();
                laserMaterial.dispose();
            }
        }

        requestAnimationFrame(animate);
    }

    // A tank's main gun: muzzle flash, a tracer that streaks flat and fast
    // to the target, and an impact flash. Deliberately NOT showAttackEffect,
    // which loads a missile model and lobs it along a parabola with a jet
    // whoosh -- that is a rocket, and armour does not fire rockets.
    // Anti-air fire: a burst from an autocannon, bursting in the air.
    //
    // NOT A ROCKET, which is what the Halberd used to throw. A missile is
    // one object that flies to one point; flak is a stream of rounds and a
    // cloud of small detonations around the aircraft, and the difference is
    // most of what makes an AA gun read as an AA gun.
    //
    // THE BURSTS GO OFF AT THE TARGET'S OWN ALTITUDE, which is why the
    // caller passes impactPos rather than letting this derive a point from
    // the terrain. A helicopter hovers 4.3 above its hex -- see
    // unitStats -- and flak that detonates on the ground under it is just
    // a firework.
    //
    // TWO LIGHTS FOR THE WHOLE BURST, not one per round: LightPool holds
    // four, and a fourteen-round burst claiming one each would starve every
    // other effect on the board. One sits at the muzzle, one jumps to the
    // newest detonation.
    static showFlakEffect(startHex: any, targetHex: any, options: any = {}) {
        const {
            rounds = 14,
            interval = 60,       // ms between rounds -- the dakka rate
            flightDuration = 120, // ms muzzle to target: flat and fast
            burstDuration = 240,  // ms for one airburst to bloom and fade
            // MOST OF IT MISSES, and that is the point of the weapon.
            // Everything used to burst within 0.42 of the hull, which is a
            // gun that cannot miss firing fourteen point-blank hits -- the
            // damage number says one attack, and the screen said sixty.
            // About a fifth burst on the aircraft; the rest are strung out
            // around it.
            closeFraction = 0.22,
            closeSpread = 0.4,   // how tight the ones that find it are
            missLateral = 1.1,   // sideways and vertical wander of the rest
            missRange = 2.6,     // short and long -- fuze error, the big one
            missMin = 1.0,       // and never nearer than this, see below
            launchPos = null,
            impactPos = null,
        } = options;

        const startPos = launchPos ? launchPos.clone()
            : new HexCoord(startHex.userData.q, startHex.userData.r).getWorldPosition();
        if (!launchPos) startPos.y = TerrainSystem.getHeight(startHex) + 0.9;
        const aimPos = impactPos ? impactPos.clone()
            : new HexCoord(targetHex.userData.q, targetHex.userData.r).getWorldPosition();
        if (!impactPos) aimPos.y = TerrainSystem.getHeight(targetHex) + 0.7;

        const heading = new THREE.Vector3().subVectors(aimPos, startPos).normalize();
        const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading);

        const group = new THREE.Group();
        scene.add(group);

        // Muzzle flash, re-punched on every round rather than one per shot.
        const flashGeometry = new THREE.ConeGeometry(0.16, 0.5, 8, 1, true);
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xffe0a0, transparent: true, opacity: 0, depthWrite: false,
        });
        const flash = new THREE.Mesh(flashGeometry, flashMaterial);
        flash.position.copy(startPos).addScaledVector(heading, 0.3);
        flash.setRotationFromQuaternion(aim);
        group.add(flash);

        // Shared by every round: they are identical streaks and none of
        // them outlives its own flight.
        const tracerGeometry = new THREE.CylinderGeometry(0.028, 0.012, 0.55, 5, 1);
        const tracerMaterial = new THREE.MeshBasicMaterial({
            color: 0xfff4c8, transparent: true, opacity: 1, depthWrite: false,
        });

        // Dim and short-reach on purpose: the muzzle sits a third of a unit
        // off the ground, so anything brighter floodlights the grass around
        // the gun and the burst itself disappears into the glare.
        const muzzleLight = LightPool.claim(0xffc070, 4, 3.2);
        if (muzzleLight) { muzzleLight.position.copy(flash.position); group.add(muzzleLight); }
        const burstLight = LightPool.claim(0xffa848, 12, 7);
        if (burstLight) { burstLight.intensity = 0; group.add(burstLight); }

        // Sideways and along the line of fire, so the scatter can be shaped
        // the way a real one is: much looser in range than in bearing.
        const lateral = new THREE.Vector3(-heading.z, 0, heading.x).normalize();
        const UP = new THREE.Vector3(0, 1, 0);
        // Three uniforms summed: near enough to a bell curve to keep the
        // bulk of the misses close and the odd one wide, which is what
        // scatter looks like. A flat random spreads them evenly and reads
        // as a grid.
        const bell = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

        // Every round gets its own point, drawn up front so the animation
        // loop does no allocation.
        const shots = Array.from({ length: rounds }, (_, i) => {
            const close = Math.random() < closeFraction;
            const to = aimPos.clone();
            if (close) {
                to.add(new THREE.Vector3(bell() * closeSpread, bell() * closeSpread * 0.7, bell() * closeSpread));
            } else {
                const off = new THREE.Vector3()
                    .addScaledVector(heading, bell() * missRange)
                    .addScaledVector(lateral, bell() * missLateral)
                    .addScaledVector(UP, bell() * missLateral * 0.8);
                // PUSHED OFF THE HULL. A bell curve is centred on the thing
                // it is scattering around, so drawing misses from one put
                // nearly forty percent of them inside half a unit of the
                // aircraft -- misses that land on the target are just hits
                // with extra steps. The shape stays; the middle is vacated.
                if (off.length() < missMin) off.setLength(missMin + Math.random() * 0.6);
                to.add(off);
            }
            // Never in the dirt: a shell fused for an aircraft does not go
            // off underfoot, and a burst inside the terrain is invisible
            // anyway.
            to.y = Math.max(to.y, startPos.y + 0.4);
            const tracer = new THREE.Mesh(tracerGeometry, tracerMaterial);
            tracer.setRotationFromQuaternion(
                new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    new THREE.Vector3().subVectors(to, startPos).normalize()));
            tracer.visible = false;
            group.add(tracer);
            return { at: i * interval, to, tracer, burst: false, burstAt: 0 };
        });

        const total = (rounds - 1) * interval + flightDuration + burstDuration;
        let startTime: any = null;
        let lastSounded = -1;

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;

            let muzzle = 0;
            let brightest = 0;

            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                const since = elapsed - shot.at;
                if (since < 0) continue;

                // The bark, every other round -- one per shot at this rate
                // is mud rather than rhythm.
                if (i > lastSounded && i % 2 === 0) {
                    lastSounded = i;
                    AudioSystem.playSound('cannon', 0.22);
                }

                const flight = Math.min(since / flightDuration, 1);
                if (flight < 1) {
                    shot.tracer.visible = true;
                    shot.tracer.position.copy(startPos).lerp(shot.to, flight);
                    muzzle = Math.max(muzzle, 1 - since / (flightDuration * 0.5));
                    continue;
                }
                shot.tracer.visible = false;

                if (!shot.burst) {
                    shot.burst = true;
                    // THE GAME'S OWN EXPLOSION, cut down to a flak puff. Its
                    // defaults are a hundred smoke sprites over a second and
                    // a half -- a vehicle brewing up. Fourteen of those in
                    // one burst is two thousand sprites alive at once, and
                    // each one reads far too big for a shell going off
                    // beside an aircraft.
                    this.createExplosion(shot.to, {
                        particleCount: 14,
                        size: 0.5,
                        duration: 600,
                        particleBaseSize: 0.22,
                        particleMaxSizeFactor: 1.3,
                    });
                    AudioSystem.playSound('explosion', 0.16);
                }
                const bloom = Math.min((since - flightDuration) / burstDuration, 1);
                if (bloom < 1) {
                    brightest = Math.max(brightest, 1 - bloom);
                    if (burstLight) burstLight.position.copy(shot.to);
                }
            }

            flashMaterial.opacity = Math.max(0, muzzle);
            flash.scale.setScalar(1 + Math.max(0, muzzle) * 0.6);
            if (muzzleLight) muzzleLight.intensity = 4 * Math.max(0, muzzle);
            if (burstLight) burstLight.intensity = 12 * brightest;

            if (elapsed < total) {
                requestAnimationFrame(step);
                return;
            }

            LightPool.release(muzzleLight);
            LightPool.release(burstLight);
            scene.remove(group);
            flashGeometry.dispose();
            flashMaterial.dispose();
            tracerGeometry.dispose();
            tracerMaterial.dispose();

        };

        requestAnimationFrame(step);
    }

    static showCannonShotEffect(startHex: any, targetHex: any) {
        AudioSystem.playSound('cannon', 0.5);

        const startPos = new HexCoord(startHex.userData.q, startHex.userData.r).getWorldPosition();
        const endPos = new HexCoord(targetHex.userData.q, targetHex.userData.r).getWorldPosition();
        // Barrel height, and a touch lower at the target so the round comes
        // down into the hull rather than sailing over it.
        startPos.y = TerrainSystem.getHeight(startHex) + 0.9;
        endPos.y = TerrainSystem.getHeight(targetHex) + 0.7;

        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const distance = direction.length();
        const heading = direction.clone().normalize();
        const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading);

        const group = new THREE.Group();
        scene.add(group);

        // Muzzle flash: a short cone at the barrel, pointing down-range.
        const flashGeometry = new THREE.ConeGeometry(0.22, 0.7, 10, 1, true);
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xffd08a, transparent: true, opacity: 1, depthWrite: false,
        });
        const flash = new THREE.Mesh(flashGeometry, flashMaterial);
        flash.position.copy(startPos).addScaledVector(heading, 0.35);
        flash.setRotationFromQuaternion(aim);
        group.add(flash);

        const flashLight = LightPool.claim(0xffc070, 14, 7);
        if (flashLight) { flashLight.position.copy(flash.position); group.add(flashLight); }

        // The round itself: a short stretched streak, not a missile.
        const tracerLength = Math.min(1.1, distance * 0.35);
        const tracerGeometry = new THREE.CylinderGeometry(0.05, 0.02, tracerLength, 6, 1);
        const tracerMaterial = new THREE.MeshBasicMaterial({
            color: 0xfff0c0, transparent: true, opacity: 1, depthWrite: false,
        });
        const tracer = new THREE.Mesh(tracerGeometry, tracerMaterial);
        tracer.setRotationFromQuaternion(aim);
        group.add(tracer);

        const tracerLight = LightPool.claim(0xffb050, 6, 4);
        if (tracerLight) group.add(tracerLight);

        // Flat and fast: no arc, and gone in a quarter second.
        const flightDuration = 260;
        const flashDuration = 90;
        const impactDuration = 180;
        let startTime: any = null;
        let impact: any = null;
        let impactMaterial: any = null;
        let impactLight: any = null;

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;

            // Muzzle flash punches out and dies immediately.
            const flashProgress = Math.min(elapsed / flashDuration, 1);
            flashMaterial.opacity = 1 - flashProgress;
            flash.scale.setScalar(1 + flashProgress * 0.8);
            flashLight.intensity = 14 * (1 - flashProgress);

            const flight = Math.min(elapsed / flightDuration, 1);
            const along = startPos.clone().lerp(endPos, flight);
            tracer.position.copy(along);
            tracerLight.position.copy(along);
            tracerMaterial.opacity = flight < 1 ? 1 : 0;
            tracerLight.intensity = flight < 1 ? 6 : 0;

            // Impact, spawned once the round lands.
            if (flight >= 1 && !impact) {
                const impactGeometry = new THREE.SphereGeometry(0.28, 10, 8);
                impactMaterial = new THREE.MeshBasicMaterial({
                    color: 0xffd9a0, transparent: true, opacity: 1, depthWrite: false,
                });
                impact = new THREE.Mesh(impactGeometry, impactMaterial);
                impact.position.copy(endPos);
                group.add(impact);

                impactLight = LightPool.claim(0xffa040, 16, 8);
                if (impactLight) { impactLight.position.copy(endPos); group.add(impactLight); }
            }

            if (impact) {
                const burst = Math.min((elapsed - flightDuration) / impactDuration, 1);
                impact.scale.setScalar(1 + burst * 2.2);
                impactMaterial.opacity = 1 - burst;
                impactLight.intensity = 16 * (1 - burst);
            }

            if (elapsed < flightDuration + impactDuration) {
                requestAnimationFrame(step);
                return;
            }

            // Borrowed lights back first -- see the laser teardown above.
            LightPool.release(flashLight);
            LightPool.release(tracerLight);
            LightPool.release(impactLight);
            scene.remove(group);
            flashGeometry.dispose();
            flashMaterial.dispose();
            tracerGeometry.dispose();
            tracerMaterial.dispose();
            impact?.geometry.dispose();
            impactMaterial?.dispose();
        };

        requestAnimationFrame(step);
    }

    static createTexturedHexGeometry(hex: any, texture: any, options: any = {}) {
        const {
            radius = MAP_CONFIG.HEX_RADIUS * 0.8,
            heightOffset = 0,
            color = '#ffffff',
            opacity = 0.8,
            renderOrder = 50,
            textureRotation = 0,
            baseScale = 1.3,
            depthWrite = false,
            materialType = 'MeshBasicMaterial',
            receiveShadow = false,
            castShadow = false,
            metalness = 0.1,
            roughness = 0.5,
            flatShading = true,
            dithering = false,
        } = options;

        // Create geometry using the shared helper
        const geometry = this.createHexTopGeometry(hex, heightOffset);
        if (!geometry) return null;

        // Create material with the texture
        const materialOptions: any = {
            color: color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: opacity,
            depthTest: true,
            depthWrite: depthWrite,
            metalness: metalness,
            roughness: roughness,
            flatShading: flatShading,
            dithering: dithering,
        };

        if (texture) {
            // Clone the texture so each instance can have its own rotation
            const clonedTexture = texture.clone();
            clonedTexture.center.set(0.5, 0.5);
            clonedTexture.rotation = textureRotation;
            clonedTexture.needsUpdate = true;
            materialOptions.map = clonedTexture;
        }

        // Create the appropriate material type
        let material;
        switch (materialType) {
            case 'MeshStandardMaterial':
                material = new THREE.MeshStandardMaterial(materialOptions);
                break;
            case 'MeshPhongMaterial':
                material = new THREE.MeshPhongMaterial(materialOptions);
                break;
            default:
                material = new THREE.MeshBasicMaterial(materialOptions);
        }

        // Create the mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Set render order and shadow properties
        mesh.renderOrder = renderOrder;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;

        return mesh;
    }

    static createHexTopGeometry(hex: any, heightOffset = 0) {
        // Find the actual hex mesh (not the bounding mesh)
        const hexMesh = hex.children.find((child: any) =>
            child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (!hexMesh) return null;

        // Get the vertex positions from the hex geometry
        const hexGeometry = hexMesh.geometry;
        const hexPositions = hexGeometry.attributes.position;

        // Create geometry for the hex top face
        const geometry = new THREE.BufferGeometry();
        const vertices: any[] = [];
        const uvs: any[] = [];
        const indices: any[] = [];

        // Get the top vertices (indices 6-11) and top center (index 13) from the hex
        const topVertices: any[] = [];
        for (let i = 6; i < 12; i++) {
            topVertices.push(new THREE.Vector3(
                hexPositions.getX(i),
                hexPositions.getY(i),
                hexPositions.getZ(i)
            ));
        }
        const centerVertex = new THREE.Vector3(
            hexPositions.getX(13),
            hexPositions.getY(13),
            hexPositions.getZ(13)
        );

        // Create vertices array (center + 6 outer vertices)
        vertices.push(
            centerVertex.x,
            centerVertex.y + heightOffset,
            centerVertex.z
        );
        topVertices.forEach(v => {
            vertices.push(
                v.x,
                v.y + heightOffset,
                v.z
            );
        });

        // Calculate UV coordinates
        uvs.push(0.5, 0.5);  // Center UV

        // Calculate UVs for outer vertices using fixed hex coordinates
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            const u = 0.5 + Math.cos(angle) * 0.5;
            const v = 0.5 + Math.sin(angle) * 0.5;
            uvs.push(u, v);
        }

        // Create triangles
        for (let i = 0; i < 6; i++) {
            indices.push(
                0,              // center vertex
                i + 1,         // current outer vertex
                ((i + 1) % 6) + 1  // next outer vertex
            );
        }

        // Set up the geometry
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // Normals: COPY the tile's own smoothed vertex normals (center 13,
        // rim 6-11) so the decal catches the light exactly like the ground
        // it lies on. The old per-triangle computation wrote each face's
        // normal over the SHARED vertices of an indexed fan -- last
        // triangle won, most normals ended up near straight-up, and a road
        // shaded like a flat sticker however the terrain under it sloped.
        const normals = new Float32Array(vertices.length);
        const hexNormals = hexGeometry.attributes.normal;
        if (hexNormals && hexNormals.count >= 14) {
            normals[0] = hexNormals.getX(13);
            normals[1] = hexNormals.getY(13);
            normals[2] = hexNormals.getZ(13);
            for (let i = 0; i < 6; i++) {
                normals[(i + 1) * 3] = hexNormals.getX(6 + i);
                normals[(i + 1) * 3 + 1] = hexNormals.getY(6 + i);
                normals[(i + 1) * 3 + 2] = hexNormals.getZ(6 + i);
            }
        } else {
            for (let i = 0; i < vertices.length; i += 3) {
                normals[i + 1] = 1;
            }
        }
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }
}

export { VisualizationSystem };