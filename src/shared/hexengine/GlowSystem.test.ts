// GlowSystem's contract is about WHICH materials share a phase, so the
// tests are about sharing rather than about the maths of the flicker.
//
// Built from plain objects rather than the THREE stub on purpose: the stub
// is an infinitely-permissive proxy, so every property access returns a
// truthy proxy and isGlowMaterial would answer "yes" to everything --
// exactly the question these tests need answered honestly.

import { describe, it, expect, beforeEach } from 'vitest';
import { GlowSystem } from './GlowSystem';

let nextId = 0;

function material(emissiveHex: number, name = 'mat') {
    const self: any = {
        name,
        id: nextId++,
        emissive: { getHex: () => emissiveHex },
        emissiveIntensity: 1,
        disposed: false,
        dispose() { self.disposed = true; },
        clone() {
            const c = material(emissiveHex, name);
            c.clonedFrom = self;
            return c;
        },
    };
    return self;
}

function mesh(mat: any) {
    return { isMesh: true, material: mat };
}

// A model: one root whose meshes share material objects, the way
// Object3D.clone() leaves them.
function model(meshes: any[]) {
    const root: any = { parent: { name: 'scene' }, children: meshes };
    root.traverse = (fn: (o: any) => void) => { fn(root); for (const m of meshes) fn(m); };
    return root;
}

describe('GlowSystem.claim', () => {
    beforeEach(() => GlowSystem.clear());

    it('gives one model ONE clone per source material, however many meshes use it', () => {
        // The regression this file exists for. Cloning per mesh gave every
        // panel on the same machine its own phase; measured on a real depot
        // piece, 19 panels sat at 19 different intensities at once.
        const energy = material(0x13a4ff, 'energy');
        const root = model([mesh(energy), mesh(energy), mesh(energy), mesh(energy), mesh(energy)]);

        GlowSystem.claim(root);

        expect(GlowSystem.glows).toHaveLength(1);
        const materials = new Set(root.children.map((m: any) => m.material));
        expect(materials.size).toBe(1);
    });

    it('still separates two materials within the same model', () => {
        // One power plant per machine, but a red warning strip and a cyan
        // panel are two different lights and may differ.
        const energy = material(0x13a4ff, 'energy');
        const warning = material(0xff3300, 'warning');
        GlowSystem.claim(model([mesh(energy), mesh(energy), mesh(warning)]));
        expect(GlowSystem.glows).toHaveLength(2);
    });

    it('separates two instances that share a source material', () => {
        // The original point of cloning: two depots must not gutter in
        // lockstep just because they came from the same loaded GLB.
        const energy = material(0x13a4ff, 'energy');
        const a = model([mesh(energy), mesh(energy)]);
        const b = model([mesh(energy), mesh(energy)]);

        GlowSystem.claim(a);
        GlowSystem.claim(b);

        expect(GlowSystem.glows).toHaveLength(2);
        expect(GlowSystem.glows[0].phase).not.toBe(GlowSystem.glows[1].phase);
        expect(a.children[0].material).not.toBe(b.children[0].material);
    });

    it('leaves non-emissive materials alone entirely', () => {
        const armor = material(0x000000, 'armor');
        const root = model([mesh(armor)]);
        GlowSystem.claim(root);
        expect(GlowSystem.glows).toHaveLength(0);
        // Not even cloned: an untouched material must stay shared, or the
        // whole point of sharing is lost for every non-glowing slot.
        expect(root.children[0].material).toBe(armor);
    });

    it('handles a mesh with an array of materials', () => {
        const energy = material(0x13a4ff, 'energy');
        const armor = material(0x000000, 'armor');
        const root: any = { parent: {}, children: [] };
        const m = { isMesh: true, material: [energy, armor, energy] };
        root.children = [m];
        root.traverse = (fn: any) => { fn(root); fn(m); };

        GlowSystem.claim(root);

        expect(GlowSystem.glows).toHaveLength(1);
        expect(m.material[0]).toBe(m.material[2]);  // same clone reused
        expect(m.material[1]).toBe(armor);          // untouched
    });

    it('ignores a null root rather than throwing', () => {
        expect(() => GlowSystem.claim(null)).not.toThrow();
    });
});

describe('GlowSystem.animate', () => {
    beforeEach(() => GlowSystem.clear());

    it('drives every panel of one model to the SAME intensity', () => {
        const energy = material(0x13a4ff, 'energy');
        const root = model([mesh(energy), mesh(energy), mesh(energy)]);
        GlowSystem.claim(root);

        GlowSystem.animate(1.234);

        const values = root.children.map((m: any) => m.material.emissiveIntensity);
        expect(new Set(values).size).toBe(1);
    });

    it('drops and disposes a model that left the scene', () => {
        const energy = material(0x13a4ff, 'energy');
        const root = model([mesh(energy)]);
        GlowSystem.claim(root);
        const owned = GlowSystem.glows[0].material;

        root.parent = null;      // destroyed unit / rebuilt building
        GlowSystem.animate(0.5);

        expect(GlowSystem.glows).toHaveLength(0);
        expect(owned.disposed).toBe(true);
    });

    it('stays inside the depth it advertises', () => {
        // base * (1 +/- FLICKER_DEPTH). Drifting outside would let a panel
        // go black or blow past the bloom threshold permanently.
        const energy = material(0x13a4ff, 'energy');
        GlowSystem.claim(model([mesh(energy)]));
        const base = GlowSystem.glows[0].base;

        for (let t = 0; t < 200; t++) {
            GlowSystem.animate(t * 0.037);
            const v = GlowSystem.glows[0].material.emissiveIntensity;
            expect(v).toBeGreaterThanOrEqual(base * 0.55 - 1e-9);
            expect(v).toBeLessThanOrEqual(base * 1.45 + 1e-9);
        }
    });
});
