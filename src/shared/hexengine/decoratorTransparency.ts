// Temporary visibility for scenery hidden behind a unit.
//
// Decorations are not uniformly opaque. Procedural foliage deliberately
// starts with transparent=true so its shader's alpha can cut a ragged leaf
// fringe out of the oversized crown shell. Restoring every material to
// "opaque, opacity 1" after a unit leaves turns that discarded fringe into
// a pale solid halo. Preserve each material's actual authored state instead.

interface MaterialVisibility {
    transparent: boolean;
    opacity: number;
    depthWrite: boolean;
}

const originalVisibility = new WeakMap<object, MaterialVisibility>();

function materialsOf(child: any): any[] {
    if (!child?.material) return [];
    return Array.isArray(child.material) ? child.material : [child.material];
}

export function setDecoratorObscured(decorator: any, obscured: boolean): void {
    decorator?.traverse?.((child: any) => {
        if (!child.isMesh) return;
        for (const material of materialsOf(child)) {
            if (!material) continue;
            if (obscured) {
                let original = originalVisibility.get(material);
                if (!original) {
                    original = {
                        transparent: !!material.transparent,
                        opacity: material.opacity ?? 1,
                        depthWrite: material.depthWrite ?? true,
                    };
                    originalVisibility.set(material, original);
                }
                material.transparent = true;
                material.opacity = original.opacity * 0.3;
                material.depthWrite = false;
                material.needsUpdate = true;
                continue;
            }

            const original = originalVisibility.get(material);
            if (!original) continue;
            material.transparent = original.transparent;
            material.opacity = original.opacity;
            material.depthWrite = original.depthWrite;
            material.needsUpdate = true;
            originalVisibility.delete(material);
        }
    });
}
