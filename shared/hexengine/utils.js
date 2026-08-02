// Shared helper utilities for the hex engine.
function addColorVariation(color, variation = 0.05) {
  const baseColor = new THREE.Color(color);
  baseColor.r += (Math.random() - 0.5) * variation;
  baseColor.g += (Math.random() - 0.5) * variation;
  baseColor.b += (Math.random() - 0.5) * variation;
  return baseColor;
}

function hash(seed) {
  let h = seed;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return h;
}

function getVertexOffset(seed) {
  const hashValue = hash(seed);
  // Battle Isle's original smoothing kept the top vertices aligned by
  // effectively disabling lateral offsets. Restoring that behavior prevents
  // roads from drifting after smoothing.
  return ((hashValue & 0xff) / 255.0 - 0.5) * 0.0;
}

function getVertexOffsets(seed) {
  const hashValue = hash(seed);
  return {
    x: getVertexOffset(hashValue),
    z: getVertexOffset(hashValue >> 8),
  };
}

function getHexIntersects(raycaster) {
  return GridSystem.getHexIntersects(raycaster);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

if (typeof window !== 'undefined') {
  window.addColorVariation = addColorVariation;
  window.getVertexOffsets = getVertexOffsets;
  window.getHexIntersects = getHexIntersects;
  window.clamp = clamp;
}
