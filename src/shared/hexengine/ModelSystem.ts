// ModelSystem.js
import { GlowSystem } from './GlowSystem';
import { RotorSystem } from './RotorSystem';
import { applyDirtyPlateToModel } from './UnitShader';

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

                // Step 1: Load the raw model based on file type.
                // 'primitive:<shape>' skips the loaders entirely -- the
                // scenario units (Boll, Kloss, Pyramid) ARE their shapes,
                // and a sphere needs no asset pipeline. The result flows
                // through the same material/normalize steps as any loaded
                // model, so team tinting and grounding just work.
                const extension: string = filepath.startsWith('primitive:')
                    ? 'primitive'
                    : filepath.split('.').pop().toLowerCase();
                switch (extension) {
                    case 'primitive':
                        loadedModel = this.buildPrimitive(filepath.slice('primitive:'.length));
                        break;

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

                // Initialize materials and shadows.
                //
                // The clone below exists only to set three flags without
                // mutating the loader's material. It is cached PER SOURCE
                // MATERIAL, not per mesh: a GLB gives every primitive that
                // uses "armorDark" the same material object, and cloning
                // inside the loop broke that apart in the CACHED BASE
                // MODEL, so every instance inherited the split. Measured on
                // forge-depot-tile-e: 34 meshes over 6 authored materials
                // became 34 materials, and the two depots on the map turned
                // 8 pieces into 263 materials and 386 draw calls.
                //
                // It also defeated GlowSystem, which clones one material
                // per model so a machine's panels gutter together -- with
                // the source already split per mesh there was nothing left
                // to share, and each panel flickered on its own phase.
                const prepared = new Map<any, any>();
                const prepare = (mat: any) => {
                    if (!mat) mat = new THREE.MeshStandardMaterial();
                    const cached = prepared.get(mat);
                    if (cached) return cached;
                    const clonedMat = mat.clone();
                    clonedMat.transparent = true;
                    clonedMat.depthTest = true;
                    clonedMat.depthWrite = true;
                    prepared.set(mat, clonedMat);
                    return clonedMat;
                };

                loadedModel.traverse((child: any) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        // Initialize null materials with defaults
                        if (!child.material) {
                            child.material = new THREE.MeshStandardMaterial();
                        }

                        child.material = Array.isArray(child.material)
                            ? child.material.map(prepare)
                            : prepare(child.material);
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
                //
                // keepOrigin opts out of both. Models that are pieces of a
                // larger assembly are authored around a COMMON origin, and
                // re-centring each piece on its own bounds pulls them apart:
                // every piece's superstructure leans a different way, so each
                // gets a different sideways shift, and their differing lowest
                // vertices put them at different heights. They must keep the
                // origin they were authored with.
                const offset = config.keepOrigin
                    ? new THREE.Vector3(0, 0, 0)
                    : new THREE.Vector3(
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

    // The scenario units' bodies. MeshStandardMaterial so lighting, shadows
    // and usePlayerColor tinting behave exactly as for authored models.
    // Sized against HEX_RADIUS 1: a hex is ~1.73 across flats, so these sit
    // at roughly two thirds of a tile, like the vehicles do.
    static buildPrimitive(shape: string): any {
        const material = new THREE.MeshStandardMaterial({ color: 0xbfc6d4, roughness: 0.55, metalness: 0.15 });
        let geometry: any;
        switch (shape) {
            case 'sphere': geometry = new THREE.SphereGeometry(0.5, 24, 16); break;
            case 'box': geometry = new THREE.BoxGeometry(0.95, 0.8, 0.95); break;
            case 'pyramid': geometry = new THREE.ConeGeometry(0.68, 1.05, 4); break;
            default: throw new Error(`Unknown primitive shape "${shape}"`);
        }
        const mesh = new THREE.Mesh(geometry, material);
        const group = new THREE.Group();
        group.add(mesh);
        return group;
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
            RotorSystem.claim(modelClone);
            // After the claims, so the grime lands on the materials that
            // actually render. Team color stays the base; this lays
            // weathering over it -- see UnitShader.
            applyDirtyPlateToModel(modelClone);
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
        RotorSystem.claim(modelClone);
        applyDirtyPlateToModel(modelClone);
        return modelClone;
    }

    static getModel(filepath: string) {
        return this.models[filepath];
    }
}

export { ModelSystem };