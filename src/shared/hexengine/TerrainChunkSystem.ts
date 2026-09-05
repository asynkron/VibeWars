import { chunkCoordinate, chunkId, indexChunkTiles, mergeLocalGeometries } from './geometryChunks';

// The tile objects remain the authoritative, editable representation. This
// class is only a disposable render cache over them: small groups of land
// tiles are copied into one geometry per terrain material and chunk.
//
function terrainMeshOf(hex: any): any {
    return hex?.children?.find(
        (child: any) => child instanceof THREE.Mesh
            && !child.userData?.isBoundingMesh
            && child.userData?.isTerrainTile,
    );
}

export class TerrainChunkSystem {
    private static parent: any = null;
    private static tiles = new Map<string, any[]>();
    private static chunks = new Map<string, any[]>();
    private static dirty = new Set<string>();

    static rebuildAll(parent: any, grid: any[]): void {
        this.dispose();
        this.parent = parent;
        this.tiles = indexChunkTiles(grid);
        for (const id of this.tiles.keys()) this.rebuildChunk(id);
    }

    // Geometry smoothing crosses tile boundaries. Rebuild the changed tile's
    // chunk and every chunk touched by one of its six neighbours.
    static markTileAndNeighborsDirty(hexes: any[]): void {
        if (!this.parent) return;
        for (const hex of hexes) {
            if (!hex?.userData) continue;
            this.dirty.add(chunkId(hex.userData.q, hex.userData.r));
        }
    }

    static flush(): void {
        if (!this.parent || !this.dirty.size) return;
        for (const id of this.dirty) this.rebuildChunk(id);
        this.dirty.clear();
    }

    static dispose(): void {
        for (const entries of this.chunks.values()) {
            for (const mesh of entries) {
                mesh.parent?.remove(mesh);
                mesh.geometry?.dispose?.();
            }
        }
        this.chunks.clear();
        this.dirty.clear();
        this.parent = null;
        this.tiles.clear();
    }

    private static rebuildChunk(id: string): void {
        const oldEntries = this.chunks.get(id) ?? [];
        for (const mesh of oldEntries) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose?.();
        }

        const byMaterial = new Map<any, any[]>();
        for (const hex of this.tiles.get(id) ?? []) {
            const source = terrainMeshOf(hex);
            if (!source) continue;
            source.visible = hex.userData.type === 'water';
            if (source.visible) continue;
            const bucket = byMaterial.get(source.material);
            if (bucket) bucket.push(source);
            else byMaterial.set(source.material, [source]);
        }

        const entries: any[] = [];
        for (const [material, sources] of byMaterial) {
            const geometry = mergeLocalGeometries(sources);
            if (!geometry) continue;

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `terrainChunk:${id}`;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.isTerrainChunk = true;
            this.parent.add(mesh);
            entries.push(mesh);
        }
        this.chunks.set(id, entries);
    }

}

export const terrainChunkMath = { chunkCoordinate, chunkId };
