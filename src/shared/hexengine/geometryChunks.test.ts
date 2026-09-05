import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Three from 'three';
import { TerrainChunkSystem as Terrain } from './TerrainChunkSystem';
import { DecorationChunkSystem as Decorations } from './DecorationChunkSystem';
import { RoadChunkSystem as Roads } from './RoadChunkSystem';

beforeEach(() => vi.stubGlobal('THREE', Three));
afterEach(() => {
    Terrain.dispose(); Decorations.dispose(); Roads.dispose();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function tile(q: number, r: number, material: Three.Material) {
    const hex = new Three.Group();
    hex.userData = { q, r, type: 'grass' };
    const terrain = new Three.Mesh(new Three.BoxGeometry(), material);
    terrain.userData.isTerrainTile = true;
    terrain.position.set(q, 2, r);
    hex.add(terrain);
    const decorator = new Three.Mesh(new Three.BoxGeometry(), material);
    decorator.position.set(q, 3, r);
    hex.userData.decorator = decorator;
    return hex;
}

describe('geometry chunk lifecycle', () => {
    it('merges transformed terrain without taking ownership of its source assets', () => {
        const parent = new Three.Group();
        const material = new Three.MeshBasicMaterial();
        const a = tile(0, 0, material), b = tile(4, 4, material);
        const source = a.children[0] as Three.Mesh;
        const disposeSource = vi.spyOn(source.geometry, 'dispose');
        const disposeMaterial = vi.spyOn(material, 'dispose');
        Terrain.rebuildAll(parent, [a, b]);
        const cache = parent.children[0] as Three.Mesh;
        expect(parent.children).toHaveLength(1);
        expect(cache.geometry.boundingBox?.max.toArray()).toEqual([4.5, 2.5, 4.5]);
        expect(source.visible).toBe(false);
        const disposeCache = vi.spyOn(cache.geometry, 'dispose');
        Terrain.dispose();
        expect(disposeCache).toHaveBeenCalledOnce();
        expect(disposeSource).not.toHaveBeenCalled();
        expect(disposeMaterial).not.toHaveBeenCalled();
        expect(parent.children).toHaveLength(0);
    });

    it('rebuilds only dirty chunks and restores a flooded tile to the water renderer', () => {
        const parent = new Three.Group();
        const material = new Three.MeshBasicMaterial();
        const a = tile(0, 0, material), distant = tile(49, 49, material);
        Terrain.rebuildAll(parent, [a, distant]);
        const old = parent.children[0] as Three.Mesh;
        const disposed = vi.spyOn(old.geometry, 'dispose');
        const farData = distant.userData;
        const readFar = vi.fn(() => farData);
        Object.defineProperty(distant, 'userData', { get: readFar, configurable: true });
        a.userData.type = 'water';
        Terrain.markTileAndNeighborsDirty([a]);
        Terrain.flush();
        expect(readFar).not.toHaveBeenCalled();
        expect(a.children[0].visible).toBe(true);
        expect(disposed).toHaveBeenCalledOnce();
        expect(parent.children.map((child) => child.name)).toEqual(['terrainChunk:9:9']);
    });

    it('moves occupied vegetation out of its chunk and restores it without visiting distant tiles', () => {
        const parent = new Three.Group();
        const material = new Three.MeshBasicMaterial();
        material.userData.burnUniform = { value: 0 };
        const a = tile(0, 0, material), distant = tile(49, 49, material);
        Decorations.rebuildAll(parent, [a, distant]);
        expect(a.userData.decorator.visible).toBe(false);
        const farData = distant.userData;
        const readFar = vi.fn(() => farData);
        Object.defineProperty(distant, 'userData', { get: readFar, configurable: true });
        Decorations.setTileDynamic(a, true);
        expect(a.userData.decorator.visible).toBe(true);
        expect(parent.children.map((child) => child.name)).toEqual(['decorationChunk:9:9']);
        Decorations.setTileDynamic(a, false);
        expect(a.userData.decorator.visible).toBe(false);
        expect(parent.children).toHaveLength(2);
        expect(readFar).not.toHaveBeenCalled();
        const disposeMaterial = vi.spyOn(material, 'dispose');
        Decorations.dispose();
        expect(disposeMaterial).not.toHaveBeenCalled();
    });

    it('refreshes replaced road sources and frees only the cache geometry and material', () => {
        const parent = new Three.Group();
        parent.position.set(10, 0, 20);
        const material = new Three.MeshBasicMaterial();
        function road(x: number) {
            const source = new Three.Group();
            source.userData = { isRoadSource: true, q: 0, r: 0 };
            source.position.x = x;
            const mesh = new Three.Mesh(new Three.PlaneGeometry(), material);
            mesh.userData.roadDirection = 2;
            source.add(mesh);
            parent.add(source);
            return source;
        }
        const original = road(2);
        Roads.rebuildAll(parent);
        const old = parent.children.find((child) => child.userData.isRoadChunk) as Three.Mesh;
        expect(old.geometry.boundingBox?.min.x).toBe(1.5);
        expect(original.visible).toBe(false);
        const disposeOld = vi.spyOn(old.geometry, 'dispose');
        parent.remove(original);
        const replacement = road(4);
        Roads.tileGeometryChanged(0, 0);
        const cache = parent.children.find((child) => child.userData.isRoadChunk) as Three.Mesh;
        expect(cache.geometry.boundingBox?.min.x).toBe(3.5);
        expect(disposeOld).toHaveBeenCalledOnce();
        expect(replacement.visible).toBe(false);
        const disposeSource = vi.spyOn(material, 'dispose');
        const disposeCache = vi.spyOn(cache.material as Three.Material, 'dispose');
        Roads.dispose();
        expect(disposeCache).toHaveBeenCalledOnce();
        expect(disposeSource).not.toHaveBeenCalled();
    });
});
