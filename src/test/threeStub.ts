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

// The one exception to "everything is a proxy". THREE.Color is the only
// THREE type whose NUMERIC behaviour non-rendering code depends on:
// TerrainSystem.getLerpedTerrainColor blends two palette entries by doing
// real arithmetic on .r/.g/.b, and a proxy has no arithmetic -- it throws
// "Cannot convert object to primitive value". That is why the random maps
// could not be generated inside a test at all, and therefore why they had
// no coverage while the authored ones had plenty.
class StubColor {
    r = 1;
    g = 1;
    b = 1;

    constructor(value?: number | string | StubColor) {
        if (value !== undefined) this.set(value);
    }

    set(value: number | string | StubColor): StubColor {
        if (typeof value === 'number') return this.setHex(value);
        if (value instanceof StubColor) return this.copy(value);
        if (typeof value === 'string') return this.setHex(parseInt(value.replace('#', ''), 16) || 0);
        return this;
    }

    setHex(hex: number): StubColor {
        this.r = ((hex >> 16) & 255) / 255;
        this.g = ((hex >> 8) & 255) / 255;
        this.b = (hex & 255) / 255;
        return this;
    }

    getHex(): number {
        const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
        return (channel(this.r) << 16) | (channel(this.g) << 8) | channel(this.b);
    }

    copy(other: StubColor): StubColor {
        this.r = other.r;
        this.g = other.g;
        this.b = other.b;
        return this;
    }

    clone(): StubColor {
        return new StubColor(this);
    }
}

(globalThis as any).THREE = new Proxy(
    { Color: StubColor },
    {
        get(target: any, prop) {
            if (prop in target) return target[prop];
            return autoMock();
        },
    }
);
