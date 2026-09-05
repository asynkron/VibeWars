import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Three from 'three';

vi.mock('../../render', async () => {
    const { Scene, Group } = await import('three');
    return { scene: new Scene(), group: new Group() };
});
vi.mock('./AudioSystem', () => ({ AudioSystem: { playSound: vi.fn() } }));
vi.mock('./PathIndicatorSystem', () => ({ PathIndicatorSystem: {} }));
vi.mock('./GridSystem', () => ({ GridSystem: { findHex: () => null } }));
vi.mock('./TerrainSystem', () => ({ TerrainSystem: { getHeight: () => 0 } }));
vi.mock('./HexCoord', async () => {
    const { Vector3 } = await import('three');
    return { HexCoord: class {
        constructor(public q: number, public r: number) {}
        getWorldPosition() { return new Vector3(this.q, 0, this.r); }
        getNeighbors() { return []; }
    } };
});

import { scene } from '../../render';
import { VisualizationSystem as Effects } from './VisualizationSystem';
import { LightPool } from './LightPool';

const start = { userData: { q: 0, r: 0 } };
const end = { userData: { q: 4, r: 0 } };
let frames: FrameRequestCallback[];
function frame(time: number) {
    const pending = frames.splice(0);
    for (const callback of pending) callback(time);
}

beforeEach(() => {
    vi.stubGlobal('THREE', Three);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    scene.clear();
    LightPool.init(scene);
    LightPool.releaseAll();
    Effects.cachedRocketModel = null;
    vi.spyOn(Effects, 'createExplosion').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('projectile lifecycle', () => {
    it.each(['showAttackEffect', 'showLaserAttackEffect'] as const)(
        '%s finishes even when every effect light is already borrowed', (method) => {
            while (LightPool.claim(0xffffff, 1, 8)) { /* exhaust the fixed pool */ }
            Effects[method](start, end);
            frame(1);
            frame(501);
            expect(frames).toHaveLength(0);
            expect(scene.children.filter((child: any) => !child.isLight)).toHaveLength(0);
        },
    );

    it('returns lights parented to a fallback mesh to the scene after impact', () => {
        Effects.showAttackEffect(start, end);
        frame(1);
        frame(501);
        const lights = Array.from({ length: 4 }, () => LightPool.claim(0xffffff, 1, 8));
        expect(lights.every(Boolean)).toBe(true);
        expect(scene.children.every((child: any) => child.isLight)).toBe(true);
    });

    it('keeps the cached rocket and simultaneous shots independent during fade and disposal', () => {
        const texture = new Three.Texture();
        const geometry = new Three.BoxGeometry();
        const material = new Three.MeshBasicMaterial({ map: texture });
        const source = new Three.Mesh(geometry, [material, material]);
        Effects.cachedRocketModel = new Three.Group().add(source);
        const disposeGeometry = vi.spyOn(geometry, 'dispose');
        const disposeTexture = vi.spyOn(texture, 'dispose');
        const disposeMaterial = vi.spyOn(material, 'dispose');
        Effects.showAttackEffect(start, end);
        const first = scene.children.find((child: any) => !child.isLight) as Three.Group;
        const firstMesh = first.children[0].children[0] as Three.Mesh;
        const ownMaterial = (firstMesh.material as Three.Material[])[0];
        const disposeOwned = vi.spyOn(ownMaterial, 'dispose');
        frame(0);
        frame(250);
        expect(first.position.x).toBe(1);
        expect(first.position.y).toBeCloseTo(1 + Math.sin(Math.PI / 4) * 2);
        Effects.showAttackEffect(start, end);
        frame(475);
        expect(material.opacity).toBe(1);
        expect(ownMaterial.opacity).toBeCloseTo(0.4875);
        frame(500);
        expect(disposeOwned).toHaveBeenCalledOnce();
        expect(disposeGeometry).not.toHaveBeenCalled();
        expect(disposeTexture).not.toHaveBeenCalled();
        expect(disposeMaterial).not.toHaveBeenCalled();
        frame(975);
        expect(frames).toHaveLength(0);
        expect(scene.children.every((child: any) => child.isLight)).toBe(true);
    });
});
