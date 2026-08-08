import { scene, renderer } from '../../render';
import { MAP_CONFIG } from '../../constants';
import { groundTexture, GROUND_TILE_WORLD } from './groundTexture';

// The ground the board stands on.
//
// This is the thing a skybox cannot be. scene.background follows the
// camera's rotation and never its position, so the forest behind the map
// was painted at infinity: it did not move when you panned, and there was
// no surface at any coordinate for the board to rest on. A plane has a
// place in the world, so it parallaxes as the camera moves and the map's
// own shadow falls on it -- which is what actually reads as "standing on
// the ground" rather than "floating just above it".
//
// It uses the SAME IMAGE the skybox already puts there: dn.jpg, the down
// face of the set in sky/, which is forest canopy seen from above. Nothing
// new is downloaded and nothing looks different in kind -- the difference
// is that this one is somewhere.
// Wide enough to run out of frame at the highest the camera goes. That is
// 50 units up with a 45-degree field of view, so a little over 40 units of
// ground fill the screen vertically; several hundred is far past what any
// zoom or pan can reach, and it costs one quad either way.
const EXTENT = 800 * MAP_CONFIG.HEX_RADIUS;

// Just under the tiles, which are built from y = 0 upward. Flush at exactly
// 0 would z-fight with every tile bottom on the map.
const GROUND_Y = -0.05 * MAP_CONFIG.HEX_RADIUS;

class GroundSystem {
    static ground: any = null;

    static init() {
        // The ground runs to the horizon, so most of it is seen at a hard
        // grazing angle -- exactly where a plain mip chain blurs to mush.
        const texture = groundTexture(renderer.capabilities.getMaxAnisotropy());

        // The plane carries the repeat; the border ring instead writes
        // world-space UVs onto its own vertices. Both come out at
        // GROUND_TILE_WORLD across, which is what makes them one surface.
        const geometry = new THREE.PlaneGeometry(EXTENT, EXTENT);
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, uv.getX(i) * (EXTENT / GROUND_TILE_WORLD), uv.getY(i) * (EXTENT / GROUND_TILE_WORLD));
        }

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.0,
            roughness: 0.95,
        });

        this.ground = new THREE.Mesh(geometry, material);
        // PlaneGeometry stands up in xy; lay it flat.
        this.ground.rotation.x = -Math.PI / 2;
        // Centred on the board, so the tiling is symmetric about it rather
        // than running off from a corner.
        this.ground.position.set(
            1.5 * MAP_CONFIG.HEX_RADIUS * (MAP_CONFIG.COLS - 1) / 2,
            GROUND_Y,
            Math.sqrt(3) * MAP_CONFIG.HEX_RADIUS * (MAP_CONFIG.ROWS - 1 + 0.5) / 2
        );
        // The whole point: it takes the board's shadow. It casts none of its
        // own, which would only ever fall away into nothing.
        this.ground.receiveShadow = true;
        this.ground.castShadow = false;
        scene.add(this.ground);
    }
}

export { GroundSystem };
