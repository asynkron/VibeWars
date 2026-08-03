// ModelSystem.js
import { GlowSystem } from './GlowSystem';

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

                // Ground-normalize by scanning the ACTUAL geometry: find
                // the model's lowest vertex (and X/Z extents) across every
                // mesh, with world matrices explicitly refreshed first --
                // Box3.setFromObject computed against stale pre-render
                // matrices and left models hovering above their origin.
                loadedModel.updateMatrixWorld(true);
                const vMin = new THREE.Vector3(Infinity, Infinity, Infinity);
                const vMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
                const vertex = new THREE.Vector3();
                loadedModel.traverse((child: any) => {
                    const pos = child.isMesh ? child.geometry?.attributes?.position : null;
                    if (!pos) return;
                    for (let i = 0; i < pos.count; i++) {
                        vertex.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
                        vMin.min(vertex);
                        vMax.max(vertex);
                    }
                });

                // Create offset to move model:
                // - Center it in X and Z
                // - Put the LOWEST VERTEX exactly at Y=0
                const offset = new THREE.Vector3(
                    -(vMax.x + vMin.x) / 2,
                    -vMin.y,
                    -(vMax.z + vMin.z) / 2
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

    static createModelWithColor(model: any, playerColor: number, usePlayerColor: boolean = true, replaceColor: number | null = null, teamColorMaterial: string | null = null) {
        const modelClone = model.clone();

        if (teamColorMaterial) {
            // Tint only the mesh(es) using a specifically-named material
            // (e.g. a "teamCamo" slot the model was authored with), leaving
            // every other material's texture/color untouched. Unlike
            // usePlayerColor/replaceColor below, this doesn't guess based on
            // the material's current color.
            const tintIfMatch = (mat: any) => {
                if (mat?.name === teamColorMaterial) {
                    const clonedMat = mat.clone();
                    clonedMat.color.setHex(playerColor);
                    return clonedMat;
                }
                return mat;
            };
            modelClone.traverse((child: any) => {
                if (child instanceof THREE.Mesh) {
                    child.material = Array.isArray(child.material)
                        ? child.material.map(tintIfMatch)
                        : tintIfMatch(child.material);
                }
            });
            GlowSystem.claim(modelClone);
            return modelClone;
        }

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

        // After every material swap above, so the glow claims the materials
        // that actually end up in the scene rather than ones replaced later.
        GlowSystem.claim(modelClone);
        return modelClone;
    }

    static getModel(filepath: string) {
        return this.models[filepath];
    }
}

export { ModelSystem };