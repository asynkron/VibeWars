import { group } from '../../render';
import { VisualizationSystem } from './VisualizationSystem';
import { UnitSystem } from './UnitSystem';
import { GridSystem } from './GridSystem';
import { applyTrackSurface } from './DecalShaders';
import { VISUAL_OFFSETS } from '../../constants';
import { getGameState } from '../../systems/gameStateStore';

class FootprintSystem {
    static footprints: any[] = [];
    static trackTextures: Record<string, any> = {};
    static trackTexturePromises: Record<string, any> = {};

    // Nothing to load any more: the track is generated in the fragment
    // shader (DecalShaders.applyTrackSurface) instead of being sampled
    // from tracksN.png. Kept so game.ts's start-up sequence is unchanged.
    static async initialize() {}

    // Still the switch for whether a unit leaves tracks at all -- only the
    // configured path is no longer loaded as an image.
    static getFootprintTexture(unitType: string) {
        return (UnitSystem.unitTypes as any)[unitType]?.footprintTexture ?? null;
    }

    static createFootprint(hex: any, direction: number = 0, unitType: string | null = null) {
        // Early exit if the tile has a road
        const tile = getGameState().map.getTile(hex.userData.q, hex.userData.r);
        if (tile?.hasRoad) {
            return null;
        }

        // Early exit if no unit type or no texture for the unit type
        if (!unitType || !this.getFootprintTexture(unitType)) {
            return null;
        }

        const footprints = group.getObjectByName("footprints") || new THREE.Group();
        footprints.name = "footprints";

        // Create the footprint mesh using the shared helper. No texture:
        // the track is generated in the fragment shader from the heading.
        const footprintMesh = VisualizationSystem.createTexturedHexGeometry(
            hex,
            null,
            {
                heightOffset: VISUAL_OFFSETS.FOOTPRINT_OFFSET,
                color: '#ffffff',
                opacity: 0.4,
                renderOrder: 25,  // Between highlights (-1) and paths (50)
                materialType: 'MeshStandardMaterial',  // Use standard material for lighting
                receiveShadow: true,  // Enable shadow receiving
                castShadow: false,  // Enable shadow casting
                metalness: 0.1,
                roughness: 0.3,
                flatShading: true,
                dithering: false,
            }
        );

        if (!footprintMesh) return null;

        applyTrackSurface(footprintMesh.material, direction);

        // Create a group for this footprint
        const footprintGroup = new THREE.Group();
        footprintGroup.add(footprintMesh);

        // Position the footprint group at the hex's world position
        const worldPos = GridSystem.getWorldCoordinates(hex.userData.q, hex.userData.r);
        footprintGroup.position.copy(worldPos);

        footprints.add(footprintGroup);

        // Add footprints group to main group if not already added
        if (!group.getObjectByName("footprints")) {
            group.add(footprints);
        }

        // Initialize the lifespan and add to footprints array so it can be updated later
        footprintGroup.userData.turnsLeftToLive = 3;
        this.footprints.push(footprintGroup);

        return footprintGroup;
    }

    static removeFootprint(footprint: any) {
        const index = this.footprints.indexOf(footprint);
        if (index > -1) {
            this.footprints.splice(index, 1);
        }

        // Remove from footprints group
        const footprintsGroup = group.getObjectByName("footprints");
        if (footprintsGroup) {
            footprintsGroup.remove(footprint);
        }
    }

    static removeFootprintsAt(q: number, r: number) {
        // Find all footprints at the given coordinates
        const footprintsToRemove = this.footprints.filter((footprint: any) => {
            const footprintPos = footprint.position;
            const hexPos = GridSystem.getWorldCoordinates(q, r);
            return footprintPos.distanceTo(hexPos) < 0.1; // Small threshold for position comparison
        });

        // Remove each footprint found
        footprintsToRemove.forEach((footprint: any) => this.removeFootprint(footprint));
    }

    static update() {
        // Use a reverse for loop to safely remove elements while iterating
        for (let i = this.footprints.length - 1; i >= 0; i--) {
            const footprint = this.footprints[i];
            footprint.userData.turnsLeftToLive--;

            // Update opacity based on remaining turns
            const maxTurns = 3; // Initial lifespan
            const currentTurns = footprint.userData.turnsLeftToLive;
            const opacity = (currentTurns / maxTurns) * 0.4; // Start at 0.4 opacity

            // Update opacity for all meshes in the footprint group
            footprint.traverse((child: any) => {
                if (child.isMesh) {
                    child.material.opacity = opacity;
                }
            });

            if (footprint.userData.turnsLeftToLive <= 0) {
                this.removeFootprint(footprint);
            }
        }
    }
}

export { FootprintSystem };
