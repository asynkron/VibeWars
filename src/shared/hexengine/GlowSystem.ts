// Steady light on the models' energy panels.
//
// WHICH materials glow is decided by the models themselves: the GLBs give
// exactly one material a non-zero emissiveFactor -- "energy", the cyan
// strips, vents and screens -- and leave every other slot at black. That
// declaration is what is followed here.
//
// Colour is deliberately NOT the test. The tanks' teamCamo is authored at
// hue 0.62 against energy's 0.564, close enough that no hue band separates
// them, and it is then tinted to the player's colour on top; a colour test
// lit whole vehicles instead of their details.

// Emissive only brightens the surface it is on -- it casts no light. The
// bloom pass in render.ts spreads a halo from it, but only above its
// threshold, so the panels still have to be driven well past the
// material's authored strength to reach that and to read as lit rather
// than merely painted.
const GLOW_BOOST = 3.0;
// The panels stay authored cyan, but their bounced environmental light is
// heavily desaturated. A saturated cyan wash made grass and concrete look
// painted rather than illuminated.
const LOCAL_LIGHT_COLOR = 0xe1edf0;
const LOCAL_LIGHT_INTENSITY = 32;
const LOCAL_LIGHT_DISTANCE = 6;

interface Glow {
    material: any;
    base: number;
}

interface LocalGlowSource {
    root: any;
    position: any;
}

class GlowSystem {
    static glows: Glow[] = [];
    private static sharedMaterial: any = null;
    private static localLights: any[] = [];
    private static localSources: LocalGlowSource[] = [];

    // Keep the exact building-light count in the scene from the first frame.
    // BuildingSystem has already placed every renderable structure before
    // this runs, so there is no reason to guess or cap the number.
    // Adding or removing Three lights later changes shader defines and forces
    // every material to recompile; changing intensity and position does not.
    static initLocalLights(home: any): void {
        if (!home || this.localLights.length > 0) return;
        for (let i = 0; i < this.localSources.length; i++) {
            const light = new THREE.PointLight(
                LOCAL_LIGHT_COLOR,
                0,
                LOCAL_LIGHT_DISTANCE,
                2,
            );
            light.castShadow = false;
            light.userData.glowEnvironmentLight = true;
            home.add(light);
            this.localLights.push(light);
        }
        this.syncLocalLights();
    }

    // A building calls this after it has reached its final world transform.
    // The source stays static, so calculate its useful light origin once
    // instead of rescanning every mesh in every animation frame.
    static illuminateSurroundings(root: any): void {
        if (!root || this.localSources.some((source) => source.root === root)) return;
        root.updateWorldMatrix?.(true, true);
        const bounds = new THREE.Box3().setFromObject(root);
        const position = new THREE.Vector3();
        const size = new THREE.Vector3();
        if (bounds.isEmpty()) {
            root.getWorldPosition?.(position);
            position.y += 0.35;
        } else {
            bounds.getCenter(position);
            bounds.getSize(size);
            // Low inside the structure: close enough to wash the ground,
            // but above it so the radial falloff does not collapse to a dot.
            position.y = bounds.min.y + THREE.MathUtils.clamp(
                size.y * 0.24,
                0.30,
                0.72,
            );
        }
        this.localSources.push({ root, position });
        this.syncLocalLights();
    }

    static stopIlluminatingSurroundings(root: any): void {
        const index = this.localSources.findIndex((source) => source.root === root);
        if (index < 0) return;
        this.localSources.splice(index, 1);
        this.syncLocalLights();
    }

    static isGlowMaterial(material: any): boolean {
        return !!material?.emissive && material.emissive.getHex() !== 0x000000;
    }

    // Every emissive mesh in the scene receives this ONE canonical material.
    // There is no per-model state left now that glow is steady: no phase, no
    // timer, no team variant and no authored texture variant.
    static claim(root: any): void {
        if (!root) return;

        root.traverse((child: any) => {
            if (!child.isMesh || !child.material) return;

            const claimOne = (material: any) => {
                if (!this.isGlowMaterial(material)) return material;
                if (!this.sharedMaterial) {
                    const shared = material.clone();
                    shared.name = 'globalGlow';
                    shared.color?.setHex?.(0x13a4ff);
                    shared.emissive?.setHex?.(0x13a4ff);
                    shared.map = null;
                    shared.emissiveMap = null;
                    shared.alphaMap = null;
                    shared.transparent = false;
                    shared.opacity = 1;
                    shared.alphaTest = 0;
                    shared.depthWrite = true;
                    shared.userData = {
                        ...shared.userData,
                        sharedGlowMaterial: true,
                    };
                    const base = GLOW_BOOST;
                    shared.emissiveIntensity = base;
                    this.sharedMaterial = shared;
                    this.glows.push({ material: shared, base });
                }
                return this.sharedMaterial;
            };

            child.material = Array.isArray(child.material)
                ? child.material.map(claimOne)
                : claimOne(child.material);
        });
    }

    // Kept as the render-loop hook so callers do not need a special case.
    // The one global material has no time-dependent or per-object state.
    static animate(_time: number): void {
        if (this.sharedMaterial) this.sharedMaterial.emissiveIntensity = GLOW_BOOST;
        // A destroyed or replaced building may leave through a terrain path
        // before its bookkeeping callback. Parentless roots cannot emit.
        let removed = false;
        for (let i = this.localSources.length - 1; i >= 0; i--) {
            if (this.localSources[i].root?.parent) continue;
            this.localSources.splice(i, 1);
            removed = true;
        }
        if (removed) this.syncLocalLights();
    }

    private static syncLocalLights(): void {
        for (let i = 0; i < this.localLights.length; i++) {
            const light = this.localLights[i];
            const source = this.localSources[i];
            if (!source || !source.root?.parent) {
                light.intensity = 0;
                continue;
            }
            light.color.setHex(LOCAL_LIGHT_COLOR);
            light.position.copy(source.position);
            light.distance = LOCAL_LIGHT_DISTANCE;
            light.decay = 2;
            light.intensity = LOCAL_LIGHT_INTENSITY;
        }
    }

    static clear(): void {
        this.sharedMaterial?.dispose?.();
        this.sharedMaterial = null;
        this.glows.length = 0;
        this.localSources.length = 0;
        for (const light of this.localLights) light.intensity = 0;
    }
}

export { GlowSystem };
