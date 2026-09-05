// Shared helper utilities for the hex engine.

function addColorVariation(
  color: number | string,
  variation: number = 0.05,
  random: () => number = Math.random
) {
  const baseColor = new THREE.Color(color);
  baseColor.r += (random() - 0.5) * variation;
  baseColor.g += (random() - 0.5) * variation;
  baseColor.b += (random() - 0.5) * variation;
  return baseColor;
}

function hash(seed: number): number {
  let h = seed;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return h;
}

function getVertexOffset(seed: number): number {
  const hashValue = hash(seed);
  // Battle Isle's original smoothing kept the top vertices aligned by
  // effectively disabling lateral offsets. Restoring that behavior prevents
  // roads from drifting after smoothing.
  return ((hashValue & 0xff) / 255.0 - 0.5) * 0.0;
}

function getVertexOffsets(seed: number): { x: number; z: number } {
  const hashValue = hash(seed);
  return {
    x: getVertexOffset(hashValue),
    z: getVertexOffset(hashValue >> 8),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export { addColorVariation, hash, getVertexOffset, getVertexOffsets, clamp };
