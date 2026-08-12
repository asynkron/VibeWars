import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CHUNK_TILES = 5;

function chunkId(q: number, r: number): string {
    return `${Math.floor(q / CHUNK_TILES)}:${Math.floor(r / CHUNK_TILES)}`;
}

function isProceduralDecoration(decorator: any): boolean {
    const materials = Array.isArray(decorator?.material)
        ? decorator.material
        : [decorator?.material];
    return !!decorator?.isMesh
        && materials.some((material: any) => material?.userData?.burnUniform);
}

export class DecorationChunkSystem {
    private static parent: any = null;
    private static grid: any[] = [];
    private static chunks = new Map<string, any>();

    static rebuildAll(parent: any, grid: any[]): void {
        this.dispose();
        this.parent = parent;
        this.grid = grid;
        const ids = new Set<string>();
        for (const hex of grid) {
            if (isProceduralDecoration(hex.userData?.decorator)) {
                ids.add(chunkId(hex.userData.q, hex.userData.r));
            }
        }
        for (const id of ids) this.rebuildChunk(id);
        this.syncVisibility();
    }

    // Occupied and burnt tiles leave the cache and render from their original
    // per-tile mesh. Its own opacity/burn uniforms can then change without
    // forcing those states onto every tree in the chunk.
    static setTileDynamic(hex: any, dynamic: boolean): void {
        const decorator = hex?.userData?.decorator;
        if (!this.parent || !isProceduralDecoration(decorator)) return;
        if (!!hex.userData.decorationChunkDynamic === dynamic) return;
        hex.userData.decorationChunkDynamic = dynamic;
        this.rebuildChunk(chunkId(hex.userData.q, hex.userData.r));
        this.syncVisibility();
    }

    static tileGeometryChanged(hex: any): void {
        if (!this.parent || !hex?.userData) return;
        this.rebuildChunk(chunkId(hex.userData.q, hex.userData.r));
        this.syncVisibility();
    }

    static dispose(): void {
        for (const mesh of this.chunks.values()) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose?.();
        }
        this.chunks.clear();
        this.parent = null;
        this.grid = [];
    }

    private static rebuildChunk(id: string): void {
        const old = this.chunks.get(id);
        if (old) {
            old.parent?.remove(old);
            old.geometry?.dispose?.();
            this.chunks.delete(id);
        }

        const sources = this.grid
            .filter((hex) => chunkId(hex.userData.q, hex.userData.r) === id)
            .filter((hex) => !hex.userData.decorationChunkDynamic)
            .map((hex) => hex.userData.decorator)
            .filter(isProceduralDecoration);
        if (!sources.length) return;

        const copies = sources.map((source) => {
            const geometry = source.geometry.clone();
            source.updateMatrix();
            geometry.applyMatrix4(source.matrix);
            return geometry;
        });
        const geometry = mergeGeometries(copies, false);
        for (const copy of copies) copy.dispose();
        if (!geometry) return;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const source = sources[0];
        const mesh = new THREE.Mesh(geometry, source.material);
        mesh.name = `decorationChunk:${id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = source.customDepthMaterial;
        mesh.userData.isDecorationChunk = true;
        this.parent.add(mesh);
        this.chunks.set(id, mesh);
    }

    private static syncVisibility(): void {
        for (const hex of this.grid) {
            const decorator = hex.userData?.decorator;
            if (!isProceduralDecoration(decorator)) continue;
            decorator.visible = !!hex.userData.decorationChunkDynamic;
        }
    }
}
