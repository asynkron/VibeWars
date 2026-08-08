import { scene } from '../../render';

class SkyboxSystem {
    static skybox: any = null;
    static textureLoader = new THREE.TextureLoader();

    static init() {
        // Create skybox geometry with a smaller size
        const geometry = new THREE.BoxGeometry(5000, 5000, 5000);

        // Load skybox textures - Nature themed
        const textureFiles = [
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_px.jpg', // right
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_nx.jpg', // left
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_py.jpg', // top
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_ny.jpg', // bottom
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_pz.jpg', // front
            'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/cube/MilkyWay/dark-s_nz.jpg'  // back
        ];

        const materials = textureFiles.map(file => {
            const texture = this.textureLoader.load(file,
                undefined,
                undefined,
                (error: any) => console.error(`Error loading texture ${file}:`, error)
            );
            return new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.BackSide,
                depthWrite: false // Add this to ensure skybox renders behind everything
            });
        });

        // Create skybox mesh
        this.skybox = new THREE.Mesh(geometry, materials);
        this.skybox.renderOrder = -1; // Ensure skybox renders first
        scene.add(this.skybox);
    }
}

export { SkyboxSystem };