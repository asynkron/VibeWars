import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Five tiles per side keeps rebuilds local while retaining frustum culling.
export const chunkCoordinate = (value: number): number => Math.floor(value / 5);
export const chunkId = (q: number, r: number): string => `${chunkCoordinate(q)}:${chunkCoordinate(r)}`;

export function indexChunkTiles(tiles: any[]): Map<string, any[]> {
    const chunks = new Map<string, any[]>();
    for (const tile of tiles) {
        const id = chunkId(tile.userData.q, tile.userData.r);
        const bucket = chunks.get(id);
        if (bucket) bucket.push(tile);
        else chunks.set(id, [tile]);
    }
    return chunks;
}

// Sources retain ownership of their geometry. Only temporary transformed
// copies and the merged cache are disposable.
export function mergeLocalGeometries(sources: any[]) {
    const copies = sources.map((source) => {
        const geometry = source.geometry.clone();
        source.updateMatrix();
        geometry.applyMatrix4(source.matrix);
        return geometry;
    });
    const geometry = mergeGeometries(copies, false);
    for (const copy of copies) copy.dispose();
    geometry?.computeBoundingBox();
    geometry?.computeBoundingSphere();
    return geometry;
}
