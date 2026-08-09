import { Reflector } from 'three/addons/objects/Reflector.js';
import { getShadowRevision } from './ShadowBudget';

// One planar reflection for every water hex. All water sits at the same
// world-space height, so rendering one mirrored camera and projecting that
// texture onto a disconnected mesh is both exact and dramatically cheaper
// than one Reflector per tile.
//
// The mirrored battlefield is cached. A turn-based board normally stands
// still; rebuilding it every frame would double draw-call submission for an
// identical image. Camera motion and the same scene changes that invalidate
// the shadow map invalidate this texture too.

const CLOUD_TEXTURE = 'assets/textures/sky/clouds.webp';
const REFLECTION_SIZE = 512;
const SURFACE_LIFT = 0.018;
const SKY_PLANE_HEIGHT = 80;
const SKY_PLANE_WIDTH = 800;
const SKY_PLANE_DEPTH = 535;

const WATER_REFLECTION_SHADER: any = {
    name: 'VibeWarsWaterReflection',
    uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
    },
    vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vReflectionCoord;
        varying vec3 vWaterWorldPos;

        void main() {
            vec4 localPosition = vec4(position, 1.0);
            vReflectionCoord = textureMatrix * localPosition;
            vWaterWorldPos = (modelMatrix * localPosition).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * localPosition;
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        varying vec4 vReflectionCoord;
        varying vec3 vWaterWorldPos;

        void main() {
            vec3 waterNormal = vec3(0.0, 1.0, 0.0);
            vec3 toCamera = normalize(cameraPosition - vWaterWorldPos);

            vec2 reflectionUv = vReflectionCoord.xy / vReflectionCoord.w;
            bool inReflection =
                reflectionUv.x >= 0.0 && reflectionUv.x <= 1.0
                && reflectionUv.y >= 0.0 && reflectionUv.y <= 1.0;
            vec3 reflected = vec3(0.25, 0.40, 0.65);
            float reflectionCoverage = 0.0;
            if (inReflection) {
                // The render target already contains the giant cloud plane,
                // terrain objects and units in one physically consistent
                // perspective. A small blur keeps it lake-like.
                vec2 blur = vec2(1.1 / 512.0);
                vec4 mirrored =
                    texture2D(tDiffuse, reflectionUv) * 0.44
                    + texture2D(tDiffuse, reflectionUv + vec2( blur.x, 0.0)) * 0.14
                    + texture2D(tDiffuse, reflectionUv + vec2(-blur.x, 0.0)) * 0.14
                    + texture2D(tDiffuse, reflectionUv + vec2(0.0,  blur.y)) * 0.14
                    + texture2D(tDiffuse, reflectionUv + vec2(0.0, -blur.y)) * 0.14;
                reflected = mirrored.rgb;
                reflectionCoverage = mirrored.a;
            }

            float facing = clamp(dot(waterNormal, toCamera), 0.0, 1.0);
            float fresnel = pow(1.0 - facing, 2.6);
            // Strategy camera angles look steeply down, so unlike a physical
            // lake this keeps a useful reflection floor at normal incidence.
            float alpha = mix(0.48, 0.64, fresnel);
            alpha *= smoothstep(0.02, 0.90, reflectionCoverage);
            gl_FragColor = vec4(reflected, alpha);
        }
    `,
};

export class WaterReflectionSystem {
    private static reflector: any = null;
    private static scene: any = null;
    private static grid: any[] = [];
    private static waterCount = -1;
    private static lastCameraState: number[] = [];
    private static lastSceneRevision = -1;
    private static reflectionMaterials = new Map<any, any>();
    private static skyPlane: any = null;

    static async init(scene: any, renderer: any, grid: any[]): Promise<void> {
        this.dispose();
        this.scene = scene;
        this.grid = grid;

        this.skyPlane = await this.createSkyPlane(renderer);
        scene.add(this.skyPlane);
        const geometry = this.buildSurfaceGeometry();
        const reflector: any = new Reflector(geometry, {
            clipBias: 0.001,
            textureWidth: REFLECTION_SIZE,
            textureHeight: REFLECTION_SIZE,
            multisample: 0,
            shader: WATER_REFLECTION_SHADER as any,
        });
        reflector.name = 'waterReflectionSurface';
        reflector.position.y = SURFACE_LIFT;
        // Reflector defines its mirror normal as local +Z. Author the merged
        // water in local XY, then rotate it onto world XZ. Drawing XZ
        // vertices directly made the surface look horizontal while its
        // reflection camera mirrored against a vertical plane.
        reflector.rotation.x = -Math.PI / 2;
        reflector.renderOrder = 4;
        reflector.castShadow = false;
        reflector.receiveShadow = false;
        reflector.material.transparent = true;
        reflector.material.depthWrite = false;
        reflector.material.side = THREE.DoubleSide;
        reflector.material.toneMapped = false;
        reflector.userData.excludeFromWaterReflection = true;

        this.installCachedRender(reflector, renderer);
        this.reflector = reflector;
        scene.add(reflector);
    }

    static animate(_seconds: number): void {
        if (!this.reflector) return;

        const count = this.grid.reduce(
            (sum: number, hex: any) => sum + (hex.userData.type === 'water' ? 1 : 0),
            0,
        );
        if (count === this.waterCount) return;

        const old = this.reflector.geometry;
        this.reflector.geometry = this.buildSurfaceGeometry();
        old?.dispose?.();
        this.reflector.forceUpdate = true;
        this.lastCameraState = [];
    }

    static dispose(): void {
        if (this.reflector) {
            this.reflector.parent?.remove(this.reflector);
            this.reflector.geometry?.dispose?.();
            this.reflector.dispose?.();
        }
        if (this.skyPlane) {
            this.skyPlane.parent?.remove(this.skyPlane);
            this.skyPlane.material?.map?.dispose?.();
            this.skyPlane.material?.dispose?.();
            this.skyPlane.geometry?.dispose?.();
        }
        for (const material of this.reflectionMaterials.values()) material.dispose?.();
        this.reflectionMaterials.clear();
        this.reflector = null;
        this.skyPlane = null;
        this.waterCount = -1;
        this.lastCameraState = [];
        this.lastSceneRevision = -1;
    }

    private static async createSkyPlane(renderer: any): Promise<any> {
        const texture = await new THREE.TextureLoader().loadAsync(CLOUD_TEXTURE);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(SKY_PLANE_WIDTH, SKY_PLANE_DEPTH),
            material,
        );
        const bounds = this.getGridBounds();
        plane.name = 'waterReflectionSkyPlane';
        plane.position.set(bounds.x, SKY_PLANE_HEIGHT, bounds.z);
        plane.rotation.x = -Math.PI / 2;
        plane.renderOrder = -100;
        plane.castShadow = false;
        plane.receiveShadow = false;
        // It exists only inside the mirrored render. The normal camera never
        // sees a literal ceiling above the board.
        plane.visible = false;
        return plane;
    }

    private static getGridBounds(): { x: number; z: number } {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const hex of this.grid) {
            const mesh = hex.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh,
            );
            if (!mesh) continue;
            minX = Math.min(minX, mesh.position.x);
            maxX = Math.max(maxX, mesh.position.x);
            minZ = Math.min(minZ, mesh.position.z);
            maxZ = Math.max(maxZ, mesh.position.z);
        }
        return {
            x: Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0,
            z: Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : 0,
        };
    }

    private static buildSurfaceGeometry(): any {
        const positions: number[] = [];
        let count = 0;

        for (const hex of this.grid) {
            if (hex.userData.type !== 'water') continue;
            const mesh = hex.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh,
            );
            const source = mesh?.geometry?.attributes?.position;
            if (!source || source.count < 14) continue;

            const px = mesh.position.x;
            const pz = mesh.position.z;
            const pushVertex = (index: number) => positions.push(
                source.getX(index) + px,
                -(source.getZ(index) + pz),
                0,
            );

            for (let i = 0; i < 6; i++) {
                pushVertex(13);
                pushVertex(6 + ((i + 1) % 6));
                pushVertex(6 + i);
            }
            count++;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.waterCount = count;
        return geometry;
    }

    private static installCachedRender(reflector: any, renderer: any): void {
        const renderReflection = reflector.onBeforeRender.bind(reflector);

        reflector.onBeforeRender = (activeRenderer: any, scene: any, camera: any) => {
            const cameraState = [
                ...camera.matrixWorld.elements,
                ...camera.projectionMatrix.elements,
            ];
            const cameraChanged = this.matrixChanged(cameraState);
            const sceneRevision = getShadowRevision();
            const sceneChanged = sceneRevision !== this.lastSceneRevision;
            if (!reflector.forceUpdate && !cameraChanged && !sceneChanged) return;

            if (this.skyPlane) this.skyPlane.visible = true;
            const hidden: any[] = [];
            const reflectedMeshes: Array<[any, any]> = [];
            scene.traverse((object: any) => {
                if (object === reflector || !object.visible) return;
                const name = String(object.name ?? '').toLowerCase();
                const isWaterBase = object.parent?.userData?.type === 'water';
                const excluded =
                    object.userData?.excludeFromWaterReflection
                    || object.userData?.isBoundingMesh
                    || object.isSprite
                    || object.isPoints
                    || object.isLine
                    || name.includes('highlight')
                    || name.includes('pathindicator')
                    || name.includes('marker');
                if (!isWaterBase && !excluded) return;
                hidden.push(object);
                object.visible = false;
            });

            // The mirrored camera is below the water plane, where normal PBR
            // materials receive virtually no direct light. Preserve their
            // albedo maps, alpha masks and team colours in an unlit material
            // instead. That makes a tree reflection green rather than a
            // shadow-black silhouette, without compiling a second complete
            // family of lit material programs.
            scene.traverse((object: any) => {
                if (!object.visible || !object.isMesh) return;
                const original = object.material;
                reflectedMeshes.push([object, original]);
                object.material = Array.isArray(original)
                    ? original.map((material: any) => this.getReflectionMaterial(material))
                    : this.getReflectionMaterial(original);
            });

            const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
            const previousBackground = scene.background;
            const previousClearAlpha = activeRenderer.getClearAlpha();
            renderer.shadowMap.needsUpdate = false;
            scene.background = null;
            activeRenderer.setClearAlpha(0);
            try {
                renderReflection(activeRenderer, scene, camera);
                this.lastCameraState = cameraState;
                this.lastSceneRevision = sceneRevision;
            } finally {
                scene.background = previousBackground;
                activeRenderer.setClearAlpha(previousClearAlpha);
                renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
                for (const [object, material] of reflectedMeshes) object.material = material;
                for (const object of hidden) object.visible = true;
                if (this.skyPlane) this.skyPlane.visible = false;
            }
        };
    }

    private static getReflectionMaterial(source: any): any {
        if (!source) return source;
        let material = this.reflectionMaterials.get(source);
        const created = !material;
        if (!material) {
            material = new THREE.MeshBasicMaterial();
            material.name = `${source.name || source.type || 'material'}WaterReflection`;
            this.reflectionMaterials.set(source, material);
        }

        if (source.color) material.color.copy(source.color);
        else material.color.set(0xffffff);
        material.map = source.map ?? null;
        material.alphaMap = source.alphaMap ?? null;
        material.alphaTest = source.alphaTest ?? 0;
        material.opacity = source.opacity ?? 1;
        material.transparent = source.transparent ?? false;
        material.vertexColors = source.vertexColors ?? false;
        material.side = source.side === THREE.DoubleSide
            ? THREE.DoubleSide
            : THREE.BackSide;
        material.depthTest = source.depthTest ?? true;
        material.depthWrite = source.depthWrite ?? true;
        material.toneMapped = false;
        if (created) material.needsUpdate = true;
        return material;
    }

    private static matrixChanged(next: number[]): boolean {
        if (next.length !== this.lastCameraState.length) return true;
        for (let i = 0; i < next.length; i++) {
            if (Math.abs(next[i] - this.lastCameraState[i]) > 1e-7) return true;
        }
        return false;
    }
}
