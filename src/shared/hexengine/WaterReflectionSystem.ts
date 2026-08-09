import { Reflector } from 'three/addons/objects/Reflector.js';
import { MAP_CONFIG } from '../../constants';
import { getShadowRevision } from './ShadowBudget';
import { SunSystem } from './SunSystem';
import { getTerrainColor } from './terrainStats';
import { VIEW_UNIFORMS } from './ViewOptions';
import {
    createGerstnerUniforms,
    GERSTNER_NORMAL_GLSL,
    GERSTNER_WAVE_GLSL,
    getWaterNormalTexture,
    WATER_NORMAL_GLSL,
    WATER_TIME_SCALE,
} from './WaterWaveShader';

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
const LANDSCAPE_REFLECTION_EXPOSURE = 0.32;

const WATER_REFLECTION_SHADER: any = {
    name: 'VibeWarsWaterReflection',
    uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        ...createGerstnerUniforms(),
        alpha: { value: 1 },
        size: { value: 1 },
        uHexRadius: { value: MAP_CONFIG.HEX_RADIUS },
        uShowGrid: { value: 1 },
        distortionScale: { value: 0.9 },
        normalSampler: { value: getWaterNormalTexture() },
        sunColor: { value: new THREE.Color(0xffffff) },
        sunDirection: { value: new THREE.Vector3(0.70707, 0.70707, 0) },
        eye: { value: new THREE.Vector3() },
        waterColor: { value: new THREE.Color(getTerrainColor('WATER')) },
    },
    vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        attribute float aWaterPin;
        attribute vec2 aTileLocal;
        varying vec4 vReflectionCoord;
        varying vec3 vWaterWorldPos;
        varying vec3 vWaterLocalPos;
        varying vec2 vTileLocal;
        varying float vWaterPin;

        #include <common>
        ${GERSTNER_WAVE_GLSL}

        void main() {
            vec4 localPosition = vec4(position, 1.0);
            vReflectionCoord = textureMatrix * localPosition;
            vWaterWorldPos = (modelMatrix * localPosition).xyz;
            vWaterLocalPos = position.xyz;
            vTileLocal = aTileLocal;
            vWaterPin = aWaterPin;

            vec3 p = position.xyz;
            vec3 gerstnerOffset = vec3(0.0);
            gerstnerOffset += GerstnerWave(waveA, position.xyz);
            gerstnerOffset += GerstnerWave(waveB, position.xyz);
            gerstnerOffset += GerstnerWave(waveC, position.xyz);
            p += gerstnerOffset * 0.035 * (1.0 - aWaterPin);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, p.y, p.z, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float alpha;
        uniform float distortionScale;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform vec3 eye;
        uniform vec3 waterColor;
        uniform vec4 waveA;
        uniform vec4 waveB;
        uniform vec4 waveC;
        uniform float uHexRadius;
        uniform float uShowGrid;
        varying vec4 vReflectionCoord;
        varying vec3 vWaterWorldPos;
        varying vec3 vWaterLocalPos;
        varying vec2 vTileLocal;
        varying float vWaterPin;

        #include <common>
        ${WATER_NORMAL_GLSL}
        ${GERSTNER_NORMAL_GLSL}

        float hexEdgeDistance(vec2 local) {
            float d = 10.0;
            for (int i = 0; i < 6; i++) {
                float th = (float(i) + 0.5) * 1.0471975512;
                d = min(d, 0.8660254 - dot(local, vec2(cos(th), sin(th))));
            }
            return d;
        }

        float hexGridLine(vec2 local) {
            if (uShowGrid < 0.5) return 0.0;
            return 1.0 - smoothstep(0.0, 0.05, hexEdgeDistance(local));
        }

        void sunLight(
            const vec3 surfaceNormal,
            const vec3 eyeDirection,
            float shiny,
            float spec,
            float diffuse,
            inout vec3 diffuseColor,
            inout vec3 specularColor
        ) {
            vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));
            float direction = max(0.0, dot(eyeDirection, reflection));
            specularColor += pow(direction, shiny) * sunColor * spec;
            diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;
        }

        void main() {
            vec4 noise = getNoise(vWaterWorldPos.xz * size);
            vec3 surfaceNormal = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));

            vec3 diffuseLight = vec3(0.0);
            vec3 specularLight = vec3(0.0);
            vec3 worldToEye = eye - vWaterWorldPos;
            vec3 eyeDirection = normalize(worldToEye);
            sunLight(surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight);

            float distance = length(worldToEye);
            vec2 distortion = surfaceNormal.xz * (0.001 + 1.0 / distance) * distortionScale;

            vec2 reflectionUv = vReflectionCoord.xy / vReflectionCoord.w;
            reflectionUv += distortion;
            bool inReflection =
                reflectionUv.x >= 0.0 && reflectionUv.x <= 1.0
                && reflectionUv.y >= 0.0 && reflectionUv.y <= 1.0;
            vec3 reflectionSample = waterColor;
            if (inReflection) {
                vec4 mirrored = texture2D(tDiffuse, reflectionUv);
                reflectionSample = mirrored.rgb;
            }

            // Sean Bradley reference shading: sun diffuse/specular, Fresnel
            // reflectance and water-colour scatter. The reference multiplies
            // the diffuse branch by getShadowMask(); this custom Reflector is
            // not a shadow receiver, so that factor is exactly 1.0 here.
            float theta = max(dot(eyeDirection, surfaceNormal), 0.0);
            float rf0 = 0.3;
            float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 5.0);
            vec3 scatter = max(0.0, dot(surfaceNormal, eyeDirection)) * waterColor;
            const vec3 luminanceWeights = vec3(0.2126, 0.7152, 0.0722);
            float reflectionLuminance = dot(reflectionSample, luminanceWeights);
            vec3 albedo = mix(
                sunColor * diffuseLight * 0.3 + scatter,
                vec3(0.1) + reflectionSample * 0.9
                    + specularLight * reflectionLuminance,
                reflectance
            );

            // Keep the reflected image as the neutral exposure. The actual
            // Gerstner face normal then redistributes brightness symmetrically:
            // a face turned away from the sun loses the same amount that the
            // corresponding sun-facing face gains.
            vec3 localFaceNormal = GerstnerNormal(vWaterLocalPos, 0.035);
            vec3 faceNormal = normalize(vec3(
                localFaceNormal.x,
                localFaceNormal.z,
                -localFaceNormal.y
            ));
            faceNormal = normalize(mix(
                vec3(0.0, 1.0, 0.0),
                faceNormal,
                1.0 - vWaterPin
            ));
            float flatSun = dot(vec3(0.0, 1.0, 0.0), sunDirection);
            float faceSun = dot(faceNormal, sunDirection);
            float faceDelta = clamp((faceSun - flatSun) * 8.0, -0.45, 0.45);
            float baseLuminance = dot(albedo, luminanceWeights);

            // Dark faces retain the reflected hue. Lit faces receive the
            // matching luminance in the white sun's colour instead of scaling
            // blue reflection channels into cyan clipping.
            albedo *= 1.0 + min(faceDelta, 0.0);
            albedo += sunColor * baseLuminance * max(faceDelta, 0.0);

            albedo = mix(
                albedo,
                vec3(0.04, 0.05, 0.07),
                hexGridLine(vTileLocal / uHexRadius) * 0.8
            );
            gl_FragColor = vec4(albedo, alpha);
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
    private static reflectionColorTextures = new Map<any, any>();
    private static skyPlane: any = null;
    private static sunDisc: any = null;

    static async init(scene: any, renderer: any, grid: any[]): Promise<void> {
        this.dispose();
        this.scene = scene;
        this.grid = grid;

        this.skyPlane = await this.createSkyPlane(renderer);
        scene.add(this.skyPlane);
        this.sunDisc = this.createSunDisc();
        scene.add(this.sunDisc);
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
        reflector.material.transparent = false;
        reflector.material.depthWrite = true;
        reflector.material.uniforms.uShowGrid = VIEW_UNIFORMS.showGrid;
        reflector.material.side = THREE.DoubleSide;
        reflector.material.toneMapped = false;
        reflector.userData.excludeFromWaterReflection = true;

        this.installCachedRender(reflector, renderer);
        this.reflector = reflector;
        scene.add(reflector);
    }

    static animate(seconds: number): void {
        if (!this.reflector) return;

        const uniforms = this.reflector.material.uniforms;
        uniforms.time.value = seconds * WATER_TIME_SCALE;
        SunSystem.getDirection(uniforms.sunDirection.value);
        SunSystem.getColor(uniforms.sunColor.value);
        this.positionSkyPlane();
        this.positionSunDisc();

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
        if (this.sunDisc) {
            this.sunDisc.parent?.remove(this.sunDisc);
            this.sunDisc.material?.map?.dispose?.();
            this.sunDisc.material?.dispose?.();
            this.sunDisc.geometry?.dispose?.();
        }
        for (const material of this.reflectionMaterials.values()) material.dispose?.();
        this.reflectionMaterials.clear();
        for (const texture of this.reflectionColorTextures.values()) texture.dispose?.();
        this.reflectionColorTextures.clear();
        this.reflector = null;
        this.skyPlane = null;
        this.sunDisc = null;
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

    private static createSunDisc(): any {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d')!;
        const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        glow.addColorStop(0, 'rgba(255, 252, 224, 1)');
        glow.addColorStop(0.24, 'rgba(255, 244, 184, 1)');
        glow.addColorStop(0.42, 'rgba(255, 226, 128, 0.55)');
        glow.addColorStop(1, 'rgba(255, 220, 112, 0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        const disc = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), material);
        disc.name = 'waterReflectionSunDisc';
        disc.rotation.x = -Math.PI / 2;
        disc.renderOrder = -99;
        disc.castShadow = false;
        disc.receiveShadow = false;
        disc.visible = false;
        this.positionSunDisc(disc);
        return disc;
    }

    private static positionSkyPlane(): void {
        if (!this.skyPlane) return;
        const bounds = this.getGridBounds();
        this.skyPlane.position.set(bounds.x, SKY_PLANE_HEIGHT, bounds.z);
    }

    private static positionSunDisc(disc = this.sunDisc): void {
        if (!disc) return;
        SunSystem.getSkyPosition(SKY_PLANE_HEIGHT - 0.1, disc.position);
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
        const waterPins: number[] = [];
        const tileLocals: number[] = [];
        let count = 0;

        for (const hex of this.grid) {
            if (hex.userData.type !== 'water') continue;
            const mesh = hex.children.find(
                (child: any) => child instanceof THREE.Mesh && !child.userData.isBoundingMesh,
            );
            const source = mesh?.geometry?.attributes?.position;
            const sourcePins = mesh?.geometry?.attributes?.aWaterPin;
            if (!source || source.count < 14) continue;

            const px = mesh.position.x;
            const pz = mesh.position.z;
            const pushVertex = (index: number) => {
                positions.push(
                    source.getX(index) + px,
                    -(source.getZ(index) + pz),
                    0,
                );
                waterPins.push(sourcePins?.getX(index) ?? 0);
                tileLocals.push(source.getX(index), source.getZ(index));
            };

            for (let i = 0; i < 6; i++) {
                pushVertex(13);
                pushVertex(6 + ((i + 1) % 6));
                pushVertex(6 + i);
            }
            count++;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('aWaterPin', new THREE.Float32BufferAttribute(waterPins, 1));
        geometry.setAttribute('aTileLocal', new THREE.Float32BufferAttribute(tileLocals, 2));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.waterCount = count;
        return geometry;
    }

    private static installCachedRender(reflector: any, renderer: any): void {
        const renderReflection = reflector.onBeforeRender.bind(reflector);

        reflector.onBeforeRender = (activeRenderer: any, scene: any, camera: any) => {
            reflector.material.uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);
            const cameraState = [
                ...camera.matrixWorld.elements,
                ...camera.projectionMatrix.elements,
            ];
            const cameraChanged = this.matrixChanged(cameraState);
            const sceneRevision = getShadowRevision();
            const sceneChanged = sceneRevision !== this.lastSceneRevision;
            if (!reflector.forceUpdate && !cameraChanged && !sceneChanged) return;

            if (this.skyPlane) this.skyPlane.visible = true;
            if (this.sunDisc) this.sunDisc.visible = true;
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
                const isReflectedLandscape = object !== this.skyPlane && object !== this.sunDisc;
                reflectedMeshes.push([object, original]);
                object.material = Array.isArray(original)
                    ? original.map((material: any) => this.getReflectionMaterial(material, isReflectedLandscape))
                    : this.getReflectionMaterial(original, isReflectedLandscape);
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
                if (this.sunDisc) this.sunDisc.visible = false;
            }
        };
    }

    private static getReflectionMaterial(source: any, isReflectedLandscape: boolean): any {
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
        if (isReflectedLandscape) material.color.multiplyScalar(LANDSCAPE_REFLECTION_EXPOSURE);
        material.map = isReflectedLandscape
            ? this.getReflectionColorTexture(source.map)
            : source.map ?? null;
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

    // The main renderer has a legacy linear-output contract. An sRGB map in
    // the mirrored pass is otherwise decoded to tiny linear values before
    // LANDSCAPE_REFLECTION_EXPOSURE is applied; the water's neutral base then
    // overwhelms its chroma and the result is a grey-black silhouette. Use a
    // lightweight texture clone so only the reflection samples authored
    // colour values directly. The source texture used by the real object is
    // never modified.
    private static getReflectionColorTexture(source: any): any {
        if (!source || source.colorSpace !== THREE.SRGBColorSpace) return source ?? null;
        let texture = this.reflectionColorTextures.get(source);
        if (texture) return texture;
        texture = source.clone();
        texture.colorSpace = THREE.NoColorSpace;
        texture.needsUpdate = true;
        this.reflectionColorTextures.set(source, texture);
        return texture;
    }

    private static matrixChanged(next: number[]): boolean {
        if (next.length !== this.lastCameraState.length) return true;
        for (let i = 0; i < next.length; i++) {
            if (Math.abs(next[i] - this.lastCameraState[i]) > 1e-7) return true;
        }
        return false;
    }
}
