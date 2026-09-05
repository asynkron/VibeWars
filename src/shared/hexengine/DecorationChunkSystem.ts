import { chunkId, indexChunkTiles, mergeLocalGeometries } from './geometryChunks';

function isProceduralDecoration(decorator: any): boolean {
    const materials = Array.isArray(decorator?.material)
        ? decorator.material
        : [decorator?.material];
    return !!decorator?.isMesh
        && materials.some((material: any) => material?.userData?.burnUniform);
}

export class DecorationChunkSystem {
    private static parent: any = null;
    private static tiles = new Map<string, any[]>();
    private static chunks = new Map<string, any>();

    static rebuildAll(parent: any, grid: any[]): void {
        this.dispose();
        this.parent = parent;
        this.tiles = indexChunkTiles(grid);
        for (const id of this.tiles.keys()) this.rebuildChunk(id);
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
    }

    static tileGeometryChanged(hex: any): void {
        if (!this.parent || !hex?.userData) return;
        this.rebuildChunk(chunkId(hex.userData.q, hex.userData.r));
    }

    static dispose(): void {
        for (const mesh of this.chunks.values()) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose?.();
        }
        this.chunks.clear();
        this.parent = null;
        this.tiles.clear();
    }

    private static rebuildChunk(id: string): void {
        const old = this.chunks.get(id);
        if (old) {
            old.parent?.remove(old);
            old.geometry?.dispose?.();
            this.chunks.delete(id);
        }

        const sources = [];
        for (const hex of this.tiles.get(id) ?? []) {
            const decorator = hex.userData.decorator;
            if (!isProceduralDecoration(decorator)) continue;
            decorator.visible = !!hex.userData.decorationChunkDynamic;
            if (!decorator.visible) sources.push(decorator);
        }
        if (!sources.length) return;
        const geometry = mergeLocalGeometries(sources);
        if (!geometry) return;

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

}
