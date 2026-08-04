// Guttering light on the models' energy panels.
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

// How far the level swings either side of that, and the two rates it beats
// at. The rates are deliberately not multiples of each other, so the sum
// never settles into a visible loop.
const FLICKER_DEPTH = 0.45;
const FLICKER_SLOW = 2.3;
const FLICKER_FAST = 7.1;

interface Glow {
    material: any;
    // The object the material belongs to, so a destroyed unit's glow can be
    // dropped rather than flickering on forever in an orphaned material.
    root: any;
    phase: number;
    base: number;
}

class GlowSystem {
    static glows: Glow[] = [];

    static isGlowMaterial(material: any): boolean {
        return !!material?.emissive && material.emissive.getHex() !== 0x000000;
    }

    // Claims every emissive material under `root` for animation.
    //
    // The materials are CLONED first. three shares materials across
    // Object3D.clone(), so without this every unit on the map would be
    // driving the same material and the whole army would gutter in
    // lockstep. Each clone gets its own phase instead.
    //
    // ONE CLONE PER (root, source material) -- not one per mesh. The
    // distinction is the whole behaviour. A model is many meshes sharing a
    // handful of materials, so cloning per mesh gives every individual
    // panel on the same machine its own phase: measured on a forge depot
    // piece, 19 panels held 19 different intensities at once, one at 1.65
    // while its neighbour on the same wall sat at 4.26. A machine has one
    // power plant, so its panels gutter together; separate machines differ.
    //
    // Keying the map on the SOURCE material is what collapses them: every
    // mesh in one model that uses "energy" points at the same material
    // object, because Object3D.clone() shares them and ModelSystem's
    // teamColorMaterial path only replaces the one slot it tints.
    static claim(root: any): void {
        if (!root) return;

        const ownedFor = new Map<any, any>();

        root.traverse((child: any) => {
            if (!child.isMesh || !child.material) return;

            const claimOne = (material: any) => {
                if (!this.isGlowMaterial(material)) return material;

                const already = ownedFor.get(material);
                if (already) return already;

                const owned = material.clone();
                ownedFor.set(material, owned);
                this.glows.push({
                    material: owned,
                    root,
                    phase: this.glows.length * 1.7,   // deterministic, no two alike
                    base: (owned.emissiveIntensity ?? 1) * GLOW_BOOST,
                });
                return owned;
            };

            child.material = Array.isArray(child.material)
                ? child.material.map(claimOne)
                : claimOne(child.material);
        });
    }

    // Driven from the render loop, `time` in seconds.
    static animate(time: number): void {
        for (let i = this.glows.length - 1; i >= 0; i--) {
            const glow = this.glows[i];

            // Dropped from the scene (a destroyed unit, a rebuilt
            // building): stop driving it and let it be collected.
            if (!glow.root.parent) {
                glow.material.dispose?.();
                this.glows.splice(i, 1);
                continue;
            }

            const slow = Math.sin(time * FLICKER_SLOW + glow.phase);
            const fast = Math.sin(time * FLICKER_FAST + glow.phase * 2.1);
            const swing = 0.65 * slow + 0.35 * fast;   // in [-1, 1]
            glow.material.emissiveIntensity = glow.base * (1 + FLICKER_DEPTH * swing);
        }
    }

    static clear(): void {
        this.glows.length = 0;
    }
}

export { GlowSystem };
