#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const JSON_CHUNK_TYPE = 0x4E4F534A;
const GLB_MAGIC = 0x46546C67;
const [inputPath, outputPath, profile] = process.argv.slice(2);

if (!inputPath || !outputPath) {
    console.error('Usage: repair-non-uv-materials.mjs <input.glb> <output.glb>');
    process.exit(1);
}

const input = readFileSync(inputPath);
if (input.readUInt32LE(0) !== GLB_MAGIC || input.readUInt32LE(4) !== 2) {
    throw new Error(`${inputPath} is not a glTF 2.0 binary`);
}

const chunks = [];
for (let offset = 12; offset < input.length;) {
    const length = input.readUInt32LE(offset);
    const type = input.readUInt32LE(offset + 4);
    const data = input.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length;
}

const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK_TYPE);
if (!jsonChunk) {
    throw new Error(`${inputPath} has no JSON chunk`);
}

const document = JSON.parse(jsonChunk.data.toString('utf8').replace(/[\0 ]+$/, ''));
const authoredFallbackColors = {
    armorDark: [0.006512090790025684, 0.007499032040460618, 0.009134058699157796, 1],
    teamCarbon: [0.008568125615105716, 0.1878207722902346, 1, 1],
};
const mantaFallbackColors = {
    // The Manta export assigns these textured materials to five primitives
    // without UVs. Use the dark authored plate colours those textures show,
    // not Shrike's blue teamCarbon fallback or glTF's white default.
    teamCarbon: [0.0356, 0.0545, 0.0723, 1],
    armorDark: [0.006512090790025684, 0.007499032040460618, 0.009134058699157796, 1],
    armor: [0.028, 0.038, 0.052, 1],
};
const fallbackColors = profile === 'manta' ? mantaFallbackColors : authoredFallbackColors;
let repairedPrimitiveCount = 0;

for (let materialIndex = 0; materialIndex < document.materials.length; materialIndex++) {
    const material = document.materials[materialIndex];
    const usesTextures = Boolean(
        material.pbrMetallicRoughness?.baseColorTexture
        || material.pbrMetallicRoughness?.metallicRoughnessTexture
        || material.normalTexture
        || material.occlusionTexture
        || material.emissiveTexture,
    );
    if (!usesTextures) continue;

    const incompatiblePrimitives = document.meshes
        .flatMap((mesh) => mesh.primitives)
        .filter((primitive) => primitive.material === materialIndex && !primitive.attributes?.TEXCOORD_0);
    if (incompatiblePrimitives.length === 0) continue;

    const pbr = material.pbrMetallicRoughness ?? {};
    const untexturedMaterial = structuredClone(material);
    untexturedMaterial.pbrMetallicRoughness = {
        ...pbr,
        baseColorFactor: fallbackColors[material.name]
            ?? pbr.baseColorFactor
            ?? [1, 1, 1, 1],
    };
    delete untexturedMaterial.pbrMetallicRoughness.baseColorTexture;
    delete untexturedMaterial.pbrMetallicRoughness.metallicRoughnessTexture;
    delete untexturedMaterial.normalTexture;
    delete untexturedMaterial.occlusionTexture;
    delete untexturedMaterial.emissiveTexture;

    // Keep the authored name. Runtime team coloring is intentionally matched
    // by material name, including for an untextured fallback such as
    // Shrike's teamCarbon hull.
    const untexturedIndex = document.materials.push(untexturedMaterial) - 1;
    for (const primitive of incompatiblePrimitives) {
        primitive.material = untexturedIndex;
        repairedPrimitiveCount++;
    }
}

if (profile === 'nightjar') {
    const canopy = document.materials.find((material) => material.name === 'canopy');
    if (!canopy) {
        throw new Error(`${inputPath} has no canopy material`);
    }

    // This is an opaque cockpit cap, not transmissive glass. The authored
    // cyan emissive plus low roughness reflected the sky and made the canopy
    // read as glowing cyan. Keep it solid, dark and neutral.
    canopy.pbrMetallicRoughness = {
        ...(canopy.pbrMetallicRoughness ?? {}),
        baseColorFactor: [
            0.014443843592229466,
            0.019382360952473074,
            0.024157632443547246,
            1,
        ],
        metallicFactor: 0,
        roughnessFactor: 0.9,
    };
    delete canopy.pbrMetallicRoughness.baseColorTexture;
    delete canopy.pbrMetallicRoughness.metallicRoughnessTexture;
    canopy.emissiveFactor = [0, 0, 0];
}

const json = Buffer.from(JSON.stringify(document));
const paddedJsonLength = Math.ceil(json.length / 4) * 4;
const updatedChunks = chunks.map((chunk) => {
    if (chunk.type !== JSON_CHUNK_TYPE) {
        return chunk;
    }

    const data = Buffer.alloc(paddedJsonLength, 0x20);
    json.copy(data);
    return { type: chunk.type, data };
});

const totalLength = 12 + updatedChunks.reduce((length, chunk) => length + 8 + chunk.data.length, 0);
const output = Buffer.allocUnsafe(totalLength);
output.writeUInt32LE(GLB_MAGIC, 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(totalLength, 8);

let outputOffset = 12;
for (const chunk of updatedChunks) {
    output.writeUInt32LE(chunk.data.length, outputOffset);
    output.writeUInt32LE(chunk.type, outputOffset + 4);
    chunk.data.copy(output, outputOffset + 8);
    outputOffset += 8 + chunk.data.length;
}

writeFileSync(outputPath, output);
console.log(`Reassigned ${repairedPrimitiveCount} textured primitives without UVs.`);
