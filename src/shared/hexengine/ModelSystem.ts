// ModelSystem.js

class ModelSystem {
    static models: Record<string, any> = {};  // Cache for loaded 3D models

    static async loadModels(modelConfigs: Record<string, any>) {
        const mtlLoader = new THREE.MTLLoader();
        const objLoader = new THREE.OBJLoader();
        const gltfLoader = new THREE.GLTFLoader();
        const fbxLoader = new THREE.FBXLoader();

        // Get all unique model paths from model configs
        const modelPaths = new Set<any>();
        Object.values(modelConfigs).forEach((config: any) => {
            if (config.model) {
                modelPaths.add(config.model);
            }
        });

        // Load each unique model
        for (const filepath of modelPaths) {
            try {
                const config: any = Object.values(modelConfigs).find((cfg: any) => cfg.model === filepath);
                let loadedModel: any;

                // Step 1: Load the raw model based on file type
                const extension: string = filepath.split('.').pop().toLowerCase();
                switch (extension) {
                    case 'fbx':
                        loadedModel = await new Promise((resolve, reject) => {
                            fbxLoader.load(
                                filepath,
                                (object: any) => resolve(object),
                                undefined,
                                reject
                            );
                        });
                        break;

                    case 'gltf':
                    case 'glb':
                        loadedModel = await new Promise((resolve, reject) => {
                            gltfLoader.load(filepath,
                                (gltf: any) => resolve(gltf.scene),
                                undefined,
                                reject
                            );
                        });
                        break;

                    case 'obj':
                        if (config.material) {
                            const materials = await new Promise((resolve, reject) => {
                                mtlLoader.load(config.material,
                                    (materials: any) => {
                                        materials.preload();
                                        resolve(materials);
                                    },
                                    undefined,
                                    reject
                                );
                            });
                            objLoader.setMaterials(materials);
                        }
                        loadedModel = await new Promise((resolve, reject) => {
                            objLoader.load(filepath,
                                (object: any) => resolve(object),
                                undefined,
                                reject
                            );
                        });
                        break;

                    default:
                        throw new Error(`Unsupported file format: ${extension}`);
                }

                // Step 2: Prepare the model (scale, materials, position)
                const modelGroup = new THREE.Group();

                // Apply scaling
                const baseScale = extension === 'fbx' ? 0.05 : 1.0;
                const modelScale = config.scale || 1.0;
                const finalScale = baseScale * modelScale;
                loadedModel.scale.set(finalScale, finalScale, finalScale);

                const rotation = config.rotation || 0;
                loadedModel.rotation.y = (rotation * Math.PI) / 180;

                // Initialize materials and shadows
                loadedModel.traverse((child: any) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Initialize null materials with defaults
                        if (!child.material) {
                            child.material = new THREE.MeshStandardMaterial();
                        }

                        // Handle both single materials and arrays
                        if (Array.isArray(child.material)) {
                            child.material = child.material.map((mat: any) => {
                                if (!mat) mat = new THREE.MeshStandardMaterial();
                                const clonedMat = mat.clone();
                                clonedMat.transparent = true;
                                clonedMat.depthTest = true;
                                clonedMat.depthWrite = true;
                                return clonedMat;
                            });
                        } else {
                            child.material = child.material.clone();
                            child.material.transparent = true;
                            child.material.depthTest = true;
                            child.material.depthWrite = true;
                        }
                    }
                });

                // Calculate bounding box
                const bbox = new THREE.Box3().setFromObject(loadedModel);

                // Calculate center for X and Z only, keeping Y at bottom
                const centerX = (bbox.max.x + bbox.min.x) / 2;
                const centerZ = (bbox.max.z + bbox.min.z) / 2;

                // Create offset to move model:
                // - Center it in X and Z
                // - Move bottom to Y=0
                const offset = new THREE.Vector3(
                    -centerX,
                    -bbox.min.y,  // Move up by the minimum Y value
                    -centerZ
                );

                // Create a centered group
                modelGroup.add(loadedModel);

                // Apply the offset to move the model
                loadedModel.position.add(offset);

                this.models[filepath] = modelGroup;
            } catch (error) {
                console.error(`Failed to load model ${filepath}:`, error);
            }
        }
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
        }

        if (replaceColor !== null) {
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

    static getModel(filepath: string) {
        return this.models[filepath];
    }
}

export { ModelSystem };