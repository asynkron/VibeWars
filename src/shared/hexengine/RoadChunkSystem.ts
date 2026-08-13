import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyChunkedRoadSurface } from './DecalShaders';

const CHUNK_TILES = 5;

function chunkId(q: number, r: number): string {
    return `${Math.floor(q / CHUNK_TILES)}:${Math.floor(r / CHUNK_TILES)}`;
}

export class RoadChunkSystem {
    private static parent: any = null;
    private static chunks = new Map<string, any>();

    static rebuildAll(parent: any): void {
        this.dispose();
        this.parent = parent;
        const ids = new Set<string>();
        for (const road of parent.children) {
            if (road.userData?.isRoadSource) {
                ids.add(chunkId(road.userData.q, road.userData.r));
            }
        }
        for (const id of ids) this.rebuildChunk(id);
        this.syncVisibility();
    }

    static tileGeometryChanged(q: number, r: number): void {
        if (!this.parent) return;
        this.rebuildChunk(chunkId(q, r));
        this.syncVisibility();
    }

    static dispose(): void {
        for (const mesh of this.chunks.values()) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose?.();
            mesh.material?.dispose?.();
        }
        this.chunks.clear();
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

        this.parent.updateWorldMatrix(true, true);
        const parentInverse = new THREE.Matrix4().copy(this.parent.matrixWorld).invert();
        const sources: any[] = [];
        for (const road of this.parent.children) {
            if (!road.userData?.isRoadSource) continue;
            if (chunkId(road.userData.q, road.userData.r) !== id) continue;
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

    private static syncVisibility(): void {
        for (const child of this.parent.children) {
            if (child.userData?.isRoadSource) child.visible = false;
        }
    }
}

export const roadChunkMath = { chunkId };
