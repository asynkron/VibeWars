// A deliberately local approximation of contact ambient occlusion.
//
// Full-screen SSAO/GTAO also shades terrain cavities, vegetation and every
// building, changing the whole image and adding another scene render each
// frame. At this camera distance the useful part is much smaller: the soft
// darkening immediately under a ground unit that makes its weight meet the
// surface. One feathered plane per unit gives that cue without recolouring
// the battlefield or touching the post-processing chain.
export class ContactShadowSystem {
    private static geometry: any = null;
    private static material: any = null;

    private static getMaterial(): any {
        if (this.material) return this.material;

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 62);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
        gradient.addColorStop(0.48, 'rgba(0, 0, 0, 0.42)');
        gradient.addColorStop(0.78, 'rgba(0, 0, 0, 0.13)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const map = new THREE.CanvasTexture(canvas);
        map.needsUpdate = true;
        this.material = new THREE.MeshBasicMaterial({
            map,
            color: 0x000000,
            transparent: true,
            opacity: 0.55,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        });
        return this.material;
    }

    static attach(model: any, bounds: any, groundSink = 0): void {
        const material = this.getMaterial();
        if (!material) return;
        if (!this.geometry) this.geometry = new THREE.PlaneGeometry(1, 1);

        const size = bounds.getSize(new THREE.Vector3());
        const shadow = new THREE.Mesh(this.geometry, material);
        shadow.name = 'contactShadow';
        // Slightly inside the model footprint: this reads as occlusion from
        // the chassis rather than a separate circular drop shadow.
        shadow.scale.set(
            Math.max(0.32, Math.min(1.45, size.x * 0.88)),
            Math.max(0.32, Math.min(1.45, size.z * 0.88)),
            1
        );
        shadow.rotation.x = -Math.PI / 2;
        // The model root may sit a hair below the terrain for vehicle
        // weight. Lift the decal by the same amount so it stays on top.
        shadow.position.y = 0.018 - groundSink;
        shadow.renderOrder = 2;
        shadow.castShadow = false;
        shadow.receiveShadow = false;
        model.add(shadow);
    }
}
