// Test-only stand-in for the global `THREE` object that index.html normally
// loads from a CDN <script> tag. render.ts/GridSystem.ts touch THREE at
// module-evaluation time (e.g. `new THREE.Scene()`, `static textureLoader =
// new THREE.TextureLoader()`), so importing almost anything in this codebase
// transitively requires THREE to exist -- even when the code under test
// (HexCoord's hex math, gameStateStore, etc.) never touches it directly.
//
// This is an infinitely-permissive proxy, not a real three.js reimplementation:
// every property access/construction/call returns another proxy of the same
// kind, so chains like `camera.position.set(...)` or `new THREE.Scene()`
// never throw. It only exists to keep imports from crashing in Node --
// don't rely on it for numeric or rendering behavior.
function autoMock(): any {
    // Must be a plain function, not an arrow function: a Proxy only gets a
    // [[Construct]] internal method (i.e. supports `new`) when its target
    // does, regardless of whether handler.construct is defined.
    function target() {
        return autoMock();
    }
    return new Proxy(target, {
        get(_t, prop) {
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return autoMock();
        },
        construct() {
            return autoMock();
        },
        apply() {
            return autoMock();
        },
    });
}

(globalThis as any).THREE = new Proxy(
    {},
    {
        get() {
            return autoMock();
        },
    }
);
