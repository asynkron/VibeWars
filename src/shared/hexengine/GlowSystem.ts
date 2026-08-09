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

interface Glow {
    material: any;
    base: number;
}

class GlowSystem {
    static glows: Glow[] = [];
    private static sharedMaterial: any = null;

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
    }

    static clear(): void {
        this.sharedMaterial?.dispose?.();
        this.sharedMaterial = null;
        this.glows.length = 0;
    }
}

export { GlowSystem };
