// Spinning rotors on the helicopters.
//
// The Nightjar is a COAXIAL design -- two rotor discs stacked on one mast,
// no tail rotor -- so the pair must turn in OPPOSITE directions. That is
// not decoration: a coaxial's whole point is that the counter-rotation
// cancels the torque, which is why it needs no tail rotor to hold heading.
// The ducted anti-torque fan in the tail fin turns much faster.
//
// The node names come from the model. WATCH OUT when re-exporting or
// re-compressing it: gltf-transform's `join`/`flatten` (and the `optimize`
// preset, which runs both) merge meshes by material and FLATTEN the node
// hierarchy away. The version that was deployed here had been through
// that -- 8 nodes, no rotors at all -- so nothing could be spun. Compress
// helicopters with dedup/weld/prune only.

// Axis is in the node's OWN local space. The main rotors sit on a vertical
// mast and turn about Y; the tail fan's blades are laid out in its local
// YZ plane, so it turns about X.
const ROTORS = [
    { name: 'rotor_upper', axis: 'y', speed: 9.0 },
    { name: 'rotor_lower', axis: 'y', speed: -9.0 },
    { name: 'anti_torque_fan', axis: 'x', speed: 22.0 },
];

interface Rotor {
    node: any;
    root: any;
    axis: any;
    speed: number;
    // The orientation the model was authored with. The spin is applied on
    // top of it rather than replacing it, or the blades would snap to a
    // different rest angle on the first frame.
    base: any;
}

class RotorSystem {
    static rotors: Rotor[] = [];

    static claim(root: any): void {
        if (!root) return;

        for (const spec of ROTORS) {
            const node = root.getObjectByName(spec.name);
            if (!node) continue;
            this.rotors.push({
                node,
                root,
                axis: spec.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0),
                speed: spec.speed,
                base: node.quaternion.clone(),
            });
        }
    }

    // Driven from the render loop, `time` in seconds.
    static animate(time: number): void {
        const spin = new THREE.Quaternion();
        for (let i = this.rotors.length - 1; i >= 0; i--) {
            const rotor = this.rotors[i];

            // Dropped from the scene (a destroyed helicopter).
            if (!rotor.root.parent) {
                this.rotors.splice(i, 1);
                continue;
            }

            spin.setFromAxisAngle(rotor.axis, time * rotor.speed);
            rotor.node.quaternion.copy(rotor.base).multiply(spin);
        }
    }

    static clear(): void {
        this.rotors.length = 0;
    }
}

export { RotorSystem };
