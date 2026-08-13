// The engine predates ES-module Three.js and still accesses its API through
// the global THREE namespace. Keep that surface while sourcing everything
// from the current npm package; individual engine modules can migrate to
// direct imports independently later.
import * as Core from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// The existing battlefield palette was authored against Three r128's
// unmanaged linear-output pipeline. Keep that visual contract while moving
// the engine itself to current Three; imported GLBs opt into their matching
// compatibility handling in ModelSystem.
Core.ColorManagement.enabled = false;

// Vitest installs a deliberately permissive THREE stub before importing game
// modules. Respect any host-provided namespace; browsers no longer load the
// old CDN scripts, so production always takes this branch.
if (!(globalThis as any).THREE) {
    (globalThis as any).THREE = {
        ...Core,
        FBXLoader,
        GLTFLoader,
        MTLLoader,
        OBJLoader,
        RoomEnvironment,
        Line2,
        LineGeometry,
        LineMaterial,
        LineSegments2,
        LineSegmentsGeometry,
        EffectComposer,
        OutputPass,
        RenderPass,
        ShaderPass,
        UnrealBloomPass,
    };
}
