class SkyboxSystem {
    static skybox = null;
    static textureLoader = new THREE.TextureLoader();

    static init() {
        console.log('Initializing skybox...');
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

        console.log('Loading skybox textures...');
        const materials = textureFiles.map(file => {
            const texture = this.textureLoader.load(file,
                () => console.log(`Loaded texture: ${file}`),
                undefined,
                (error) => console.error(`Error loading texture ${file}:`, error)
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
        console.log('Skybox added to scene');

        // Debug: Log scene contents
        console.log('Scene children:', scene.children);
        console.log('Camera position:', camera.position);
        console.log('Camera target:', cameraTarget);
    }
} 