import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The tile objects remain the authoritative, editable representation. This
// class is only a disposable render cache over them: small groups of land
// tiles are copied into one geometry per terrain material and chunk.
//
// Five tile coordinates per side is deliberately conservative. It removes
// most terrain submissions on large maps while retaining useful frustum
// culling and keeping crater rebuilds local.
const CHUNK_TILES = 5;

type ChunkEntry = {
    mesh: any;
    material: any;
};

function terrainMeshOf(hex: any): any {
    return hex?.children?.find(
        (child: any) => child instanceof THREE.Mesh
            && !child.userData?.isBoundingMesh
            && child.userData?.isTerrainTile,
    );
}

function chunkCoordinate(value: number): number {
    return Math.floor(value / CHUNK_TILES);
}

function chunkId(q: number, r: number): string {
    return `${chunkCoordinate(q)}:${chunkCoordinate(r)}`;
}

export class TerrainChunkSystem {
    private static parent: any = null;
    private static grid: any[] = [];
    private static chunks = new Map<string, ChunkEntry[]>();
    private static dirty = new Set<string>();

    static rebuildAll(parent: any, grid: any[]): void {
        this.dispose();
        this.parent = parent;
        this.grid = grid;

        const ids = new Set<string>();
        for (const hex of grid) {
            if (hex.userData.type === 'water') continue;
            ids.add(chunkId(hex.userData.q, hex.userData.r));
        }
        for (const id of ids) this.rebuildChunk(id);
        this.syncSourceVisibility();
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
        this.syncSourceVisibility();
    }

    static dispose(): void {
        for (const entries of this.chunks.values()) {
            for (const entry of entries) {
                entry.mesh.parent?.remove(entry.mesh);
                entry.mesh.geometry?.dispose?.();
            }
        }
        this.chunks.clear();
        this.dirty.clear();
        this.parent = null;
        this.grid = [];
    }

    private static rebuildChunk(id: string): void {
        const oldEntries = this.chunks.get(id) ?? [];
        for (const entry of oldEntries) {
            entry.mesh.parent?.remove(entry.mesh);
            entry.mesh.geometry?.dispose?.();
        }

        const byMaterial = new Map<any, any[]>();
        for (const hex of this.grid) {
            if (chunkId(hex.userData.q, hex.userData.r) !== id) continue;
            if (hex.userData.type === 'water') continue;
            const source = terrainMeshOf(hex);
            if (!source) continue;
            const bucket = byMaterial.get(source.material);
            if (bucket) bucket.push(source);
            else byMaterial.set(source.material, [source]);
        }

        const entries: ChunkEntry[] = [];
        for (const [material, sources] of byMaterial) {
            const copies = sources.map((source) => {
                const geometry = source.geometry.clone();
                source.updateMatrix();
                geometry.applyMatrix4(source.matrix);
                return geometry;
            });
            const geometry = mergeGeometries(copies, false);
            for (const copy of copies) copy.dispose();
            if (!geometry) continue;
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `terrainChunk:${id}`;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.isTerrainChunk = true;
            this.parent.add(mesh);
            entries.push({ mesh, material });
        }
        this.chunks.set(id, entries);
    }

    private static syncSourceVisibility(): void {
        for (const hex of this.grid) {
            const source = terrainMeshOf(hex);
            if (source) source.visible = hex.userData.type === 'water';
        }
    }
}

export const terrainChunkMath = { chunkCoordinate, chunkId };
