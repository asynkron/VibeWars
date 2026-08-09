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
                // ?? not ||: a scale of 0 is a legitimate value and `||` turned it
        // silently into 1.0 -- a piece meant to be invisible came back at
        // full size instead.
        const modelScale = config.scale ?? 1.0;
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
                // per model so a machine's panels share one steady glow --
                // with the source already split per mesh there was nothing
                // left to share.
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

    // teamColorMaterial takes one material name or several. Several,
    // because a building carries its side in more than one place: the roof
    // camo AND the lit strips along its eaves, which the art shows cyan for
    // one player and orange for the other.
    // The model exactly as it was authored: a clone and nothing else.
    //
    // createModelWithColor below is the war-machine path, and it does a lot
    // more than its name says -- besides the team tint it runs
    // applyDirtyPlateToModel, which REPLACES THE MAP ON EVERY MATERIAL with
    // a grimed version. That is right for a tank; on a building it repaints
    // the concrete, the trim and the armour panels the artist textured, and
    // the result is nothing like the reference render.
    static cloneUntouched(model: any): any {
        const clone = model.clone();
        this.useAuthoredModelColorEncoding(clone);
        return clone;
    }

    // The procedural battlefield intentionally keeps its old linear-output
    // renderer, but GLBs are authored for the standard sRGB output pipeline.
    // Decode their tagged colour textures normally, light them in linear
    // space, then encode only these imported materials for display. This
    // matches the editor without changing terrain, water, waves or overlays.
    private static useAuthoredModelColorEncoding(model: any): void {
        const materials = new Map<any, any>();
        const convertMaterial = (material: any) => {
            if (!material) return material;
            const existing = materials.get(material);
            if (existing) return existing;
            const converted = material.clone();
            const previousCompile = converted.onBeforeCompile;
            const previousKey = typeof converted.customProgramCacheKey === 'function'
                ? converted.customProgramCacheKey.bind(converted)
                : null;
            converted.onBeforeCompile = (shader: any, renderer: any) => {
                previousCompile?.(shader, renderer);
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <colorspace_fragment>',
                    'gl_FragColor = sRGBTransferOETF( gl_FragColor );'
                );
            };
            converted.customProgramCacheKey = () =>
                `authored-model-srgb|${previousKey ? previousKey() : ''}`;
            converted.needsUpdate = true;
            materials.set(material, converted);
            return converted;
        };
        model.traverse((child: any) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.material = Array.isArray(child.material)
                ? child.material.map(convertMaterial)
                : convertMaterial(child.material);
        });
    }

    // The model as authored, with the team's colour on NAMED MATERIALS ONLY.
    //
    // The difference from createModelWithColor is what it does NOT do: no
    // applyDirtyPlateToModel, which replaces the map on every material in
    // the model with a grimed version. That is the war-machine treatment and
    // it repaints a building's concrete, trim and armour panels along with
    // everything else. Here the concrete stays concrete.
    // The camo pattern REPAINTED IN THE TEAM'S COLOUR, pixel by pixel.
    //
    // Not a tint. `material.color` multiplies the map, and multiplication
    // can only take light away or clip: the authored camo averages luma 82
    // of 255, so the team blue landed at RGB(6, 24, 64), and scaling the
    // colour up to compensate clipped green and blue together and turned
    // the roof cyan -- measured RGB(43, 180, 215) at x4. A saturated blue
    // is dark by construction; there is no multiplier that makes it bright
    // and keeps it blue.
    //
    // Rotate the authored team hue while preserving every pixel's own
    // saturation and lightness. The old recolour flattened the source into
    // a narrow brightness band, destroying the blue/grey camouflage and
    // making textured models look like a different asset than the editor.
    private static camoMaps = new Map<string, any>();
    private static teamCamoMap(map: any, playerColor: number): any {
        if (!map?.image) return map;
        const key = `${map.uuid}:${playerColor}`;
        const cached = this.camoMaps.get(key);
        if (cached) return cached;

        const sourceTeam = new THREE.Color(0x1778ff);
        const targetTeam = new THREE.Color(playerColor);
        const sourceHsl = { h: 0, s: 0, l: 0 };
        const targetHsl = { h: 0, s: 0, l: 0 };
        sourceTeam.getHSL(sourceHsl);
        targetTeam.getHSL(targetHsl);
        const hueShift = targetHsl.h - sourceHsl.h;

        const image = map.image;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, image.width, image.height);
        const pixels = data.data;
        const pixel = new THREE.Color();
        const pixelHsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < pixels.length; i += 4) {
            pixel.setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255);
            pixel.getHSL(pixelHsl);
            // Neutral steel and black shapes are part of the texture, not
            // team paint; leave them neutral.
            if (pixelHsl.s < 0.08) continue;
            pixel.setHSL((pixelHsl.h + hueShift + 1) % 1, pixelHsl.s, pixelHsl.l);
            pixels[i] = Math.round(pixel.r * 255);
            pixels[i + 1] = Math.round(pixel.g * 255);
            pixels[i + 2] = Math.round(pixel.b * 255);
        }
        ctx.putImageData(data, 0, 0);

        const painted = new THREE.CanvasTexture(canvas);
        painted.wrapS = map.wrapS;
        painted.wrapT = map.wrapT;
        painted.repeat.copy(map.repeat);
        painted.offset.copy(map.offset);
        painted.colorSpace = map.colorSpace;
        // The source came out of a GLB, which is already the right way up;
        // CanvasTexture flips by default and would turn the camo over.
        painted.flipY = false;
        painted.needsUpdate = true;
        this.camoMaps.set(key, painted);
        return painted;
    }

    // `lighten` mixes the tinted slots towards white, 0 = the team colour
    // as chosen, 1 = white. The colour is a multiplier
    // on the texture and three does not clamp it to 1, so a value above one
    // brightens the map without touching the map -- which is what the camo
    // needs: its texture averages 82 of 255, dark enough that the team's
    // colour barely showed through it. Nothing else in the model is
    // touched.
    static cloneWithTeamTint(
        model: any,
        playerColor: number,
        materialNames: string[],
        lighten: number = 0
    ): any {
        const clone = model.clone();
        const names = new Set(materialNames);
        // ONE CLONE PER SOURCE MATERIAL, not per mesh: Object3D.clone()
        // shares materials, so every mesh using a slot must end up on the
        // same tinted instance -- the same reason GlowSystem keys its map
        // on the source material rather than on the mesh.
        const tinted = new Map<any, any>();
        const tint = (mat: any) => {
            if (!mat?.name || !names.has(mat.name)) return mat;
            const already = tinted.get(mat);
            if (already) return already;
            const owned = mat.clone();
            // WHITE, so the map is what is seen and nothing multiplies it.
            owned.color.setHex(0xffffff);
            owned.map = ModelSystem.teamCamoMap(owned.map, playerColor);
            tinted.set(mat, owned);
            return owned;
        };

        clone.traverse((child: any) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.material = Array.isArray(child.material)
                ? child.material.map(tint)
                : tint(child.material);
        });
        // The lit strips still have to gutter. claim() takes every material
        // with a non-black emissive; the painted roof itself remains ordinary
        // PBR paint.
        GlowSystem.claim(clone);
        ModelSystem.useAuthoredModelColorEncoding(clone);
        return clone;
    }

    static createModelWithColor(model: any, playerColor: number, usePlayerColor: boolean = true, replaceColor: number | null = null, teamColorMaterial: string | string[] | null = null) {
        const modelClone = model.clone();

        if (teamColorMaterial) {
            const teamNames = new Set(
                Array.isArray(teamColorMaterial) ? teamColorMaterial : [teamColorMaterial]
            );
            // Tint only the mesh(es) using a specifically-named material
            // (e.g. a "teamCamo" slot the model was authored with), leaving
            // every other material's texture/color untouched. Unlike
            // usePlayerColor/replaceColor below, this doesn't guess based on
            // the material's current color.
            const tintIfMatch = (mat: any) => {
                if (mat?.name && teamNames.has(mat.name)) {
                    const clonedMat = mat.clone();
                    clonedMat.color.setHex(playerColor);
                    // A glowing slot has to have its GLOW recoloured too --
                    // the emissive is what is actually seen on a lit strip,
                    // and leaving it authored-cyan on an orange building is
                    // the one part that would still read as the wrong side.
                    // Set before GlowSystem.claim below, which clones these
                    // and drives intensity only, so the hue survives.
                    if (GlowSystem.isGlowMaterial(clonedMat)) {
                        clonedMat.emissive.setHex(playerColor);
                    }
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
