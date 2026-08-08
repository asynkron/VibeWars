import { scene } from '../../render';

// The world the board sits in.
//
// A rolling green landscape under a clouded blue sky, from ./sky in the
// project root. Its DOWN face is forest canopy rather than the featureless
// haze an outdoor set usually puts there, which is what makes it usable
// here: this camera looks steeply down at a flat board, so the underside of
// the cube is most of what it ever frames.
//
// THE FACES ARE NAMED FOR THE DIRECTION YOU FACE, not for the axes, and
// pairing those to three's axes by hand got it wrong twice on the last set
// before the edges were measured to settle it. So they were measured here
// too, and the same convention came back.
//
// Sampling the border pixels and asking which of them actually continue
// into each other gives, against the top face:
//
//     up.top    <-> lf.top     mean error 2.0
//     up.bottom <-> rt.top                2.9
//     up.left   <-> bk.top                2.3
//     up.right  <-> ft.top                2.6
//
// ANCHOR ON THE TOP FACE. The horizon ring alone only fixes the cyclic
// order of the four sides -- which one starts at +X and which way it runs
// are eight more possibilities it cannot tell apart. The top face pins it
// outright, because a cube map's +Y adjoins -Z along its top edge, +Z along
// its bottom, -X on the left and +X on the right. Read against the
// measurements above: ft on +X, bk on -X, rt on +Z, lf on -Z. Mirrored on
// both axes from the obvious reading, which is exactly why guessing failed.
const FACES = [
    'ft.jpg', // +X
    'bk.jpg', // -X
    'up.jpg', // +Y
    'dn.jpg', // -Y
    'rt.jpg', // +Z
    'lf.jpg', // -Z
];

class SkyboxSystem {
    static skybox: any = null;
    static textureLoader = new THREE.CubeTextureLoader();

    static init() {
        this.textureLoader.setPath('skybox/meadow/');
        this.skybox = this.textureLoader.load(
            FACES,
            undefined,
            undefined,
            (error: any) => console.error('Error loading skybox:', error)
        );
        // No encoding override: the renderer leaves outputEncoding at its
        // linear default, so a cube texture flagged sRGB here would come out
        // washed against everything else in the scene.
        scene.background = this.skybox;
    }
}

export { SkyboxSystem };
