// Whether the shadow map still matches the scene.
//
// The shadow pass is the most expensive thing in the frame -- measured on
// the shipped map, shadows off runs at the 60 Hz vsync cap (16.7 ms, 1294
// draws) against 22.0 ms and 2614 draws with them on, so it is about half
// of every draw call. This is a turn-based game whose camera is usually
// parked, so nearly all of that regenerates an identical map from an
// unchanged scene. render.ts refreshes it only when this says to.
//
// A MODULE OF ITS OWN, with no imports, on purpose. The things that dirty
// shadows are the terrain and unit systems, and render.ts already imports
// both -- so putting the flag there would make them import it back. That
// cycle is not theoretical in this codebase: AIController resolving its
// engines at module scope crashed the game at startup the moment the
// module graph shifted. A leaf module cannot do that to anyone.

let dirty = true;

// Something moved, spawned, died or deformed.
export function markShadowsDirty(): void {
    dirty = true;
}

// Called by the render loop; clears the flag.
export function consumeShadowsDirty(): boolean {
    const was = dirty;
    dirty = false;
    return was;
}
