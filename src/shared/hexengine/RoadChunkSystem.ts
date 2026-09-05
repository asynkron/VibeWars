import { chunkId, indexChunkTiles } from './geometryChunks';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyChunkedRoadSurface } from './DecalShaders';

export class RoadChunkSystem {
    private static parent: any = null;
    private static chunks = new Map<string, any>();
    private static roads = new Map<string, any[]>();

    static rebuildAll(parent: any): void {
        this.dispose();
        this.parent = parent;
        this.roads = indexChunkTiles(parent.children.filter((child: any) => child.userData?.isRoadSource));
        for (const id of this.roads.keys()) this.rebuildChunk(id);
    }

    static tileGeometryChanged(q: number, r: number): void {
        if (!this.parent) return;
        const id = chunkId(q, r);
        // RoadSystem replaces source objects after smoothing, so refresh the
        // changed bucket from the current children before merging it.
        this.roads.set(id, this.parent.children.filter((child: any) =>
            child.userData?.isRoadSource && chunkId(child.userData.q, child.userData.r) === id));
        this.rebuildChunk(id);
    }

    static dispose(): void {
        for (const mesh of this.chunks.values()) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose?.();
            mesh.material?.dispose?.();
        }
        this.chunks.clear();
        this.roads.clear();
        this.parent = null;
    }

    private static rebuildChunk(id: string): void {
        const old = this.chunks.get(id);
        if (old) {
            old.parent?.remove(old);
            old.geometry?.dispose?.();
            old.material?.dispose?.();
            this.chunks.delete(id);
        }

        this.parent.updateWorldMatrix(true, false);
        const parentInverse = new THREE.Matrix4().copy(this.parent.matrixWorld).invert();
        const sources: any[] = [];
        for (const road of this.roads.get(id) ?? []) {
            road.visible = false;
            road.traverse((child: any) => {
                if (child.isMesh && child.userData?.roadDirection !== undefined) sources.push(child);
            });
        }
        if (!sources.length) return;

        const copies = sources.map((source) => {
            source.updateWorldMatrix(true, false);
            const geometry = source.geometry.clone();
            const positions = geometry.getAttribute('position');
            const count = positions.count;
            const localPositions = new Float32Array(count * 2);
            for (let i = 0; i < count; i++) {
                localPositions[i * 2] = positions.getX(i);
                localPositions[i * 2 + 1] = positions.getZ(i);
            }
            geometry.setAttribute(
                'aRoadDirection',
                new THREE.Float32BufferAttribute(
                    new Float32Array(count).fill(source.userData.roadDirection),
                    1,
                ),
            );
            geometry.setAttribute(
                'aRoadLocal',
                new THREE.Float32BufferAttribute(localPositions, 2),
            );
            geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(parentInverse, source.matrixWorld));
            return geometry;
        });
        const geometry = mergeGeometries(copies, false);
        for (const copy of copies) copy.dispose();
        if (!geometry) return;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const material = sources[0].material.clone();
        applyChunkedRoadSurface(material);
        material.needsUpdate = true;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `roadChunk:${id}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.isRoadChunk = true;
        this.parent.add(mesh);
        this.chunks.set(id, mesh);
    }

}

export const roadChunkMath = { chunkId };
