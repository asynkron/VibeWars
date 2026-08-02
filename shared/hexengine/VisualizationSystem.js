// VisualizationSystem.js

/*
Render Order Hierarchy (from top to bottom):
999: Damage numbers (always on top)
100: Units (should be above path and highlights)
50:  Movement path (should be above highlights but below units)
-1:  Hex highlights (should be above terrain but below everything else)
0:   Terrain (base layer)
*/

class VisualizationSystem {
    static pathLine = null;
    static highlightGroup = null;
    static highlightMeshes = new Map();
    static highlightMaterials = new Map();
    static highlightGeometries = new Map();
    static highlightGroups = new Map();
    static initialized = false;
    static initializationPromise = null;
    static cachedRocketModel = null;  // Cache for the rocket model
    static rocketModelPromise = null;  // Promise for loading the rocket model

    static disposeObject(object) {
        if (!object) return;

        if (object instanceof THREE.Group) {
            // Dispose all children first
            object.children.forEach(child => this.disposeObject(child));
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
                    object.material.forEach(material => this.disposeMaterial(material));
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

        // Handle lights
        if (object instanceof THREE.Light) {
            if (object.parent) {
                object.parent.remove(object);
            }
            return;
        }
    }

    static disposeMaterial(material) {
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
            console.log('VisualizationSystem initialized');
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
                (object) => {
                    this.cachedRocketModel = object;
                    resolve(object);
                },
                (xhr) => {
                    console.log((xhr.loaded / xhr.total * 100) + '% loaded');
                },
                (error) => {
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

    static async drawPath(unit, path) {

        await this.ensureInitialized();
        PathIndicatorSystem.showPath(path, unit);
    }

    static clearHighlights() {
        const highlights = group.getObjectByName("highlights");
        if (highlights) {
            group.remove(highlights);
        }
    }

    static highlightHex(hex, color = HIGHLIGHT_COLORS.MOVE_RANGE, showOutline = false) {
        const highlights = group.getObjectByName("highlights") || new THREE.Group();
        highlights.name = "highlights";

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

        // Check if highlights group needs to be added to main group
        if (!group.getObjectByName("highlights")) {
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
        const vertices = [];
        const indices = [];
        const uvs = [];

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

    static createHexMesh(geometry, material) {
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
        const vertices = [];
        const indices = [];

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

    static showDamageNumber(position, damage) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

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

    static createExplosion(position, options = {}) {
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

    static createParticleEffect(position, options = {}) {
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
        const vertices = [];
        const velocities = [];
        const startTimes = [];
        const startSizes = [];
        const textureIndices = [];

        const textureLoader = new THREE.TextureLoader();
        const particleTextures = particleTexturePaths.map(path => textureLoader.load(path));

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
        function animateParticles(timestamp) {
            const elapsed = timestamp - animationStartTime;

            particleMaterial.uniforms.time.value = timestamp;

            if (elapsed < duration + 200) {
                requestAnimationFrame(animateParticles);
            } else {
                scene.remove(particleSystem);
                particleGeometry.dispose();
                particleMaterial.dispose();
                particleTextures.forEach(texture => texture.dispose());
            }
        }
        requestAnimationFrame(animateParticles);
    }

    static createSmokeParticles(position, options = {}) {
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

    static createExplosionParticles(position, options = {}) {
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

    static showDeathEffect(position) {
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

    static createDebrisEffect(position) {
        const debrisCount = 24;
        const duration = 2000;
        const gravity = 0.01;
        const initialVelocity = 0.15;

        // Create debris pieces
        for (let i = 0; i < debrisCount; i++) {
            let geometry;
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

            function animate(timestamp) {
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

    static showAttackEffect(startHex, targetHex) {
        // Play random rocket launcher sound
        // Play jet sound for missile movement with duration matching flight time
        AudioSystem.playSound('jet', 0.5, 500); // 500ms matches the missile flight duration

        // Load the FBX model for the projectile
        const fbxLoader = new THREE.FBXLoader();
        fbxLoader.load(
            'assets/bullet_1_bw.fbx',
            (object) => {
                // Scale the model appropriately (5 times smaller than before)
                object.scale.set(0.02, 0.02, 0.02);

                // Create a group to hold the model and lights
                const projectile = new THREE.Group();
                projectile.add(object);

                // Main intense light for sharp shadows
                const mainLight = new THREE.PointLight(0xff0000, 10, 8);
                mainLight.castShadow = true;
                mainLight.shadow.mapSize.width = 512;
                mainLight.shadow.mapSize.height = 512;
                mainLight.shadow.camera.near = 0.1;
                mainLight.shadow.camera.far = 10;
                projectile.add(mainLight);

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
                let startTime = null;

                // Animate the projectile
                const animate = (timestamp) => {
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
                        object.traverse((child) => {
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
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            (error) => {
                console.error('Error loading projectile model:', error);
                // Fallback to sphere if model fails to load
                this.showAttackEffectFallback(startHex, targetHex);
            }
        );
    }

    // Fallback method using sphere if FBX fails to load
    static showAttackEffectFallback(startHex, targetHex) {
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
        const mainLight = new THREE.PointLight(0xff0000, 10, 8);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 512;
        mainLight.shadow.mapSize.height = 512;
        mainLight.shadow.camera.near = 0.1;
        mainLight.shadow.camera.far = 10;
        projectile.add(mainLight);

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
        let startTime = null;

        // Animate the projectile
        const animate = (timestamp) => {
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

    static showRocketBarrageEffect(startHex, targetHex, options = {}) {
        const {
            projectileCount = 6,
            delayBetweenShots = 100, // milliseconds
            projectileScale = 0.4, // Smaller than regular projectile
            maxInFlight = 3 // Maximum number of rockets in flight at once
        } = options;

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
        const fireProjectile = (index) => {
            if (index >= projectileCount) return;

            // Play jet sound for this rocket with duration matching flight time
            AudioSystem.playSound('jet', 0.4, 500); // 500ms matches the rocket flight duration

            // Randomly select a target from possible targets
            const randomTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

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
            const startPos = startCoord.getWorldPosition();
            const endPos = endCoord.getWorldPosition();

            // Adjust Y positions based on terrain height
            startPos.y = TerrainSystem.getHeight(startHex) + 1;
            endPos.y = TerrainSystem.getHeight(randomTarget) + 1;

            // Add projectile to scene at start position
            projectile.position.copy(startPos);
            scene.add(projectile);

            // Animation parameters
            const duration = 500; // milliseconds
            const arcHeight = 2; // maximum height of the arc
            let startTime = null;

            // Animate the projectile
            const animate = (timestamp) => {
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
                    object.traverse((child) => {
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

                    // Create crater effect by modifying the hex height
                    const craterDepth = -0.5; // Depth of the crater
                    GridSystem.modifyHexHeight(new HexCoord(randomTarget.userData.q, randomTarget.userData.r), craterDepth);

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

    static showLaserAttackEffect(startHex, targetHex) {
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
        const mainLight = new THREE.PointLight(0xffffff, 15, 6);
        mainLight.castShadow = true;
        laser.add(mainLight);

        // Add blue tinted light for effect
        const blueLight = new THREE.PointLight(0x4444ff, 8, 8);
        laser.add(blueLight);

        scene.add(laser);

        // Animation parameters
        const duration = 400; // milliseconds
        let startTime = null;

        // Animate the laser beam
        function animate(timestamp) {
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
                // Clean up
                scene.remove(laser);
                laserGeometry.dispose();
                laserMaterial.dispose();
            }
        }

        requestAnimationFrame(animate);
    }

    static createTexturedHexGeometry(hex, texture, options = {}) {
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
        const materialOptions = {
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

    static createHexTopGeometry(hex, heightOffset = 0) {
        // Find the actual hex mesh (not the bounding mesh)
        const hexMesh = hex.children.find(child =>
            child instanceof THREE.Mesh && !child.userData.isBoundingMesh
        );
        if (!hexMesh) return null;

        // Get the vertex positions from the hex geometry
        const hexGeometry = hexMesh.geometry;
        const hexPositions = hexGeometry.attributes.position;

        // Create geometry for the hex top face
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const uvs = [];
        const indices = [];

        // Get the top vertices (indices 6-11) and top center (index 13) from the hex
        const topVertices = [];
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

        // Create flat normals for each triangle
        const normals = new Float32Array(vertices.length);
        for (let i = 0; i < indices.length; i += 3) {
            const v1 = new THREE.Vector3(
                vertices[indices[i] * 3],
                vertices[indices[i] * 3 + 1],
                vertices[indices[i] * 3 + 2]
            );
            const v2 = new THREE.Vector3(
                vertices[indices[i + 1] * 3],
                vertices[indices[i + 1] * 3 + 1],
                vertices[indices[i + 1] * 3 + 2]
            );
            const v3 = new THREE.Vector3(
                vertices[indices[i + 2] * 3],
                vertices[indices[i + 2] * 3 + 1],
                vertices[indices[i + 2] * 3 + 2]
            );

            const normal = new THREE.Vector3()
                .crossVectors(
                    new THREE.Vector3().subVectors(v2, v1),
                    new THREE.Vector3().subVectors(v3, v1)
                )
                .normalize();

            // Apply the same normal to all three vertices of the triangle
            for (let j = 0; j < 3; j++) {
                normals[indices[i + j] * 3] = normal.x;
                normals[indices[i + j] * 3 + 1] = normal.y;
                normals[indices[i + j] * 3 + 2] = normal.z;
            }
        }
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }
}

console.log('VisualizationSystem.js loaded');

// Export for use in other files
window.VisualizationSystem = VisualizationSystem; 