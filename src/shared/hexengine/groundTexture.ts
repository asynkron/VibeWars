// The ground image, and the one scale everything that draws ground has to
// agree on.
//
// It lives in its own module because two things need it and they must not
// reach each other: GroundSystem draws the plane, GridSystem draws the
// border ring that rises off it, and GridSystem is imported by render.ts,
// which GroundSystem imports in turn. Sharing it through either of them
// would close that loop. This file imports nothing.
//
// The image is the DOWN face of the skybox set in sky/ -- forest canopy
// seen from above. Using it for the plane and the ring both is the whole
// trick: where the ring meets the plane there is no seam to hide, because
// it is the same ground continuing.
export const GROUND_TEXTURE = 'skybox/meadow/dn.jpg';

// One tile of canopy per this many world units, in WORLD space rather than
// per mesh. Two surfaces only read as one ground if their texture runs at
// the same size across both, so this number belongs to neither of them.
export const GROUND_TILE_WORLD = 60;

let shared: any = null;

// One texture object for every surface that draws ground. Loading it twice
// would cost two decodes and two uploads of the same megabyte.
export function groundTexture(anisotropy: number = 1): any {
    if (!shared) {
        shared = new THREE.TextureLoader().load(GROUND_TEXTURE);
        shared.wrapS = THREE.RepeatWrapping;
        shared.wrapT = THREE.RepeatWrapping;
        shared.anisotropy = anisotropy;
    }
    return shared;
}
