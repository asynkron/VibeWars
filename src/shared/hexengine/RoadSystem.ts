// RoadSystem.js - Handles road generation and management
import { group } from '../../render';
import { VisualizationSystem } from './VisualizationSystem';
import { PathfindingSystem } from './PathfindingSystem';
import { UnitSystem } from './UnitSystem';
import { GridSystem } from './GridSystem';
import { applyRoadSurface } from './DecalShaders';
import { VISUAL_OFFSETS } from '../../constants';
import { getGameState } from '../../systems/gameStateStore';

class RoadSystem {
    static roads: any[] = [];
    static roadTextures: Record<string, any> = {};
    static roadTexturePromises: Record<string, any> = {};
    static terrainCosts = {
        'SAND': 1,
        'GRASS': 1,
        'FOREST': 2,
        'MOUNTAIN': Infinity,
        'WATER': Infinity
    };

    // Nothing to load any more: the road surface is generated in the
    // fragment shader (DecalShaders.applyRoadSurface) instead of being
    // sampled from road.png. Kept so game.ts's start-up sequence is
    // unchanged.
    static async initialize() {}

    static generateRoad(startQ: number, startR: number, endQ: number, endR: number): boolean {
        // Create a temporary unit using the Droid type
        const roadUnit = {
            type: 'Road',
            move: Infinity,  // Unlimited movement range
            q: startQ,      // Current position
            r: startR,      // Current position
            playerIndex: 0  // Required for some pathfinding checks
        };

        // Get the path using the pathfinding system
        const path = PathfindingSystem.getPath(startQ, startR, endQ, endR, Infinity, roadUnit);

        if (path.length === 0) {
            console.warn('No valid path found for road construction');
            return false;
        }
        else {

        }

        // Mark each tile in the path as having a road
        path.forEach((hex: any) => {
            const tile = getGameState().map.getTile(hex.userData.q, hex.userData.r);
            if (tile) {
                tile.hasRoad = true;

                // Trigger terrain smoothing to update the visual representation
                GridSystem.smoothHexTile(hex);
            }
        });

        return true;
    }

    static getRoadCost(terrainType: string): number {
        return (this.terrainCosts as Record<string, number>)[terrainType] || Infinity;
    }

    static createRoad(hex: any) {

        const roads = group.getObjectByName("roads") || new THREE.Group();
        roads.name = "roads";

        // Get all neighbor coordinates
        const neighborCoords = GridSystem.getHexNeighborsCoords(hex.userData.q, hex.userData.r);

        // Create a group for this road
        const roadGroup = new THREE.Group();

        // Get the world position of the current hex
        const currentPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);

        // Check each neighbor for roads
        for (let i = 0; i < 6; i++) {
            const [nq, nr] = neighborCoords[i];
            // Get the tile data for this neighbor
            const tile = getGameState().map.getTile(nq, nr);
            if (tile?.hasRoad) {
                // Get rotation using UnitSystem helper
                const rotation = UnitSystem.getRotation(hex.userData.q, hex.userData.r, nq, nr);

                // Create road mesh for this direction. No texture: the
                // half-road road.png used to draw is generated in the
                // fragment shader from this direction instead.
                const roadMesh = VisualizationSystem.createTexturedHexGeometry(
                    hex,
                    null,
                    {
                        heightOffset: (VISUAL_OFFSETS as any).ROAD_OFFSET, // pre-existing: never defined, always undefined
                        color: '#ffffff',
                        opacity: 1.0,
                        renderOrder: 0,  // Same as terrain
                        depthWrite: true,
                        materialType: 'MeshStandardMaterial',  // Use standard material for lighting
                        receiveShadow: true,  // Enable shadow receiving
                        castShadow: true,  // Enable shadow casting
                        metalness: 0.0,
                        // Grit, not moulded plastic -- and the shader
                        // varies it per fragment on top of this.
                        roughness: 0.95,
                        // Smooth, not flat: the decal carries the TILE's
                        // smoothed vertex normals (createHexTopGeometry),
                        // so it shades continuously with the ground under
                        // it instead of breaking into six lit wedges.
                        flatShading: false,
                        dithering: false,
                    }
                );
                if (roadMesh) {
                    applyRoadSurface(roadMesh.material, rotation);
                    // Ensure shadows are enabled on the mesh itself
                    roadMesh.castShadow = true;
                    roadMesh.receiveShadow = true;
                    roadGroup.add(roadMesh);
                }
            }
        }

        // Position the road group at the hex's world position
        roadGroup.position.copy(currentPos);

        roads.add(roadGroup);

        // Add the roads group to the scene if it's not already there
        if (!group.getObjectByName("roads")) {
            group.add(roads);
        }

        // Add to roads array
        this.roads.push(roadGroup);

        return roadGroup;
    }

    static removeRoad(road: any) {
        const index = this.roads.indexOf(road);
        if (index > -1) {
            this.roads.splice(index, 1);
        }

        // Remove from roads group
        const roadsGroup = group.getObjectByName("roads");
        if (roadsGroup) {
            roadsGroup.remove(road);
        }

        // And free it. Roads are re-laid on every terrain deformation, so
        // dropping the reference without disposing leaves the geometry and
        // material on the GPU for the rest of the session. Both are built
        // per decal today; if road materials are ever cached by direction,
        // this must stop disposing them.
        road.traverse((child: any) => {
            if (!child.isMesh) return;
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) material?.dispose?.();
        });
    }

    static removeRoadsAt(q: number, r: number) {
        // Find all roads at the given coordinates
        const roadsToRemove = this.roads.filter((road: any) => {
            const roadPos = road.position;
            const hexPos = GridSystem.getWorldCoordinates(q, r);
            return roadPos.distanceTo(hexPos) < 0.1; // Small threshold for position comparison
        });

        // Remove each road found
        roadsToRemove.forEach((road: any) => this.removeRoad(road));
    }
}

export { RoadSystem };