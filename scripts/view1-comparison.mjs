import { PNG } from 'pngjs';
import { readFile, writeFile } from 'node:fs/promises';

export const VIEWPORT = { width: 1440, height: 900 };
export const SCORE_CROP = { left: 0, top: 70, right: 1440, bottom: 845 };
export const VIEW1_REGIONS = Object.freeze({
    water: Object.freeze({ left: 430, top: 285, right: 730, bottom: 425 }),
    grass: Object.freeze({ left: 860, top: 710, right: 1000, bottom: 750 }),
    forest: Object.freeze({ left: 1190, top: 165, right: 1375, bottom: 500 }),
    beach: Object.freeze({ left: 980, top: 390, right: 1080, bottom: 480 }),
});

export async function readPng(path) {
    return PNG.sync.read(await readFile(path));
}

function perceptualChannels(data, offset) {
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [luma, r - g, b - g];
}

export function cropImage(image, bounds) {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const output = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = ((bounds.top + y) * image.width + bounds.left + x) * 4;
            const target = (y * width + x) * 4;
            output.data[target] = image.data[source];
            output.data[target + 1] = image.data[source + 1];
            output.data[target + 2] = image.data[source + 2];
            output.data[target + 3] = image.data[source + 3];
        }
    }
    return output;
}

export function downsampleImage(image, factor = 1) {
    const blockSize = Math.max(1, Math.floor(Number(factor) || 1));
    if (blockSize === 1) return image;
    const width = Math.ceil(image.width / blockSize);
    const height = Math.ceil(image.height / blockSize);
    const output = new PNG({ width, height });
    for (let targetY = 0; targetY < height; targetY++) {
        for (let targetX = 0; targetX < width; targetX++) {
            const sums = [0, 0, 0, 0];
            let count = 0;
            const sourceTop = targetY * blockSize;
            const sourceLeft = targetX * blockSize;
            for (let sourceY = sourceTop; sourceY < Math.min(sourceTop + blockSize, image.height); sourceY++) {
                for (let sourceX = sourceLeft; sourceX < Math.min(sourceLeft + blockSize, image.width); sourceX++) {
                    const source = (sourceY * image.width + sourceX) * 4;
                    for (let channel = 0; channel < 4; channel++) sums[channel] += image.data[source + channel];
                    count++;
                }
            }
            const target = (targetY * width + targetX) * 4;
            for (let channel = 0; channel < 4; channel++) {
                output.data[target + channel] = Math.round(sums[channel] / count);
            }
        }
    }
    return output;
}

export function exactRegionScore(actual, expected) {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        throw new Error(`Image size mismatch: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`);
    }
    let rgbMae = 0;
    let perceptualError = 0;
    const pixels = actual.width * actual.height;
    for (let offset = 0; offset < actual.data.length; offset += 4) {
        rgbMae += (
            Math.abs(actual.data[offset] - expected.data[offset])
            + Math.abs(actual.data[offset + 1] - expected.data[offset + 1])
            + Math.abs(actual.data[offset + 2] - expected.data[offset + 2])
        ) / (255 * 3);
        const a = perceptualChannels(actual.data, offset);
        const b = perceptualChannels(expected.data, offset);
        const dl = a[0] - b[0];
        const drg = a[1] - b[1];
        const dbg = a[2] - b[2];
        perceptualError += Math.sqrt(
            dl * dl * 0.68 + drg * drg * 0.16 + dbg * dbg * 0.16
        );
    }
    rgbMae /= pixels;
    perceptualError /= pixels;
    const error = rgbMae * 0.45 + perceptualError * 0.55;
    return {
        score: Math.max(0, 100 * (1 - error)),
        error,
        rgbMae,
        perceptualError,
    };
}

function sortedPerceptualPixels(image) {
    const pixels = [];
    for (let offset = 0; offset < image.data.length; offset += 4) {
        pixels.push(perceptualChannels(image.data, offset));
    }
    pixels.sort((left, right) => left[0] - right[0]);
    return pixels;
}

// Material regions in the photorealistic reference preserve the scene area,
// not exact wave crests, leaf tips or individual stones. Compare the full
// aligned rectangles, but pair their pixels by luminance percentile. This
// scores palette, contrast and highlight population without rewarding a
// tree merely because one branch happens to occupy another branch's pixel.
export function materialRegionScore(actual, expected, downsampleFactor = 1) {
    const rawExact = exactRegionScore(actual, expected);
    const scoredActual = downsampleImage(actual, downsampleFactor);
    const scoredExpected = downsampleImage(expected, downsampleFactor);
    const exact = exactRegionScore(scoredActual, scoredExpected);
    const a = sortedPerceptualPixels(scoredActual);
    const b = sortedPerceptualPixels(scoredExpected);
    const samples = Math.min(4096, a.length, b.length);
    let distributionError = 0;
    for (let index = 0; index < samples; index++) {
        const quantile = samples === 1 ? 0 : index / (samples - 1);
        const left = a[Math.round(quantile * (a.length - 1))];
        const right = b[Math.round(quantile * (b.length - 1))];
        const dl = left[0] - right[0];
        const drg = left[1] - right[1];
        const dbg = left[2] - right[2];
        distributionError += Math.sqrt(
            dl * dl * 0.68 + drg * drg * 0.16 + dbg * dbg * 0.16
        );
    }
    distributionError /= samples;
    // Exact alignment remains a guardrail and its visual diff is always
    // written, but material calibration is primarily a distribution task.
    const error = distributionError * 0.82 + exact.error * 0.18;
    return {
        score: Math.max(0, 100 * (1 - error)),
        error,
        distributionError,
        exact,
        rawExact,
        downsampleFactor: Math.max(1, Math.floor(Number(downsampleFactor) || 1)),
        comparisonSize: {
            width: scoredActual.width,
            height: scoredActual.height,
        },
    };
}

export function imageStatistics(image) {
    const channels = [[], [], []];
    const luminance = [];
    let saturation = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const rgb = [
            image.data[offset] / 255,
            image.data[offset + 1] / 255,
            image.data[offset + 2] / 255,
        ];
        channels[0].push(rgb[0]);
        channels[1].push(rgb[1]);
        channels[2].push(rgb[2]);
        luminance.push(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
        const high = Math.max(...rgb);
        saturation += high === 0 ? 0 : (high - Math.min(...rgb)) / high;
    }
    for (const values of [...channels, luminance]) values.sort((a, b) => a - b);
    const quantile = (values, q) => values[Math.round((values.length - 1) * q)];
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        meanRgb: channels.map(mean),
        meanSaturation: saturation / luminance.length,
        luminance: {
            mean: mean(luminance),
            p10: quantile(luminance, 0.10),
            p50: quantile(luminance, 0.50),
            p90: quantile(luminance, 0.90),
            p99: quantile(luminance, 0.99),
        },
    };
}

export function sideBySide(left, right) {
    if (left.height !== right.height) throw new Error('Side-by-side images must have equal height');
    const output = new PNG({ width: left.width + right.width, height: left.height });
    for (let y = 0; y < output.height; y++) {
        for (let x = 0; x < output.width; x++) {
            const sourceImage = x < left.width ? left : right;
            const sourceX = x < left.width ? x : x - left.width;
            const source = (y * sourceImage.width + sourceX) * 4;
            const target = (y * output.width + x) * 4;
            output.data[target] = sourceImage.data[source];
            output.data[target + 1] = sourceImage.data[source + 1];
            output.data[target + 2] = sourceImage.data[source + 2];
            output.data[target + 3] = 255;
        }
    }
    return output;
}

export async function writePng(image, path) {
    await writeFile(path, PNG.sync.write(image));
}

export function scoreImages(actual, expected, crop = SCORE_CROP) {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        throw new Error(`Image size mismatch: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`);
    }
    // Eight-pixel cells absorb leaf tips, thin branches and wave crests
    // moving a few pixels while preserving the scene's regional palette.
    const cell = 8;
    const search = 1;
    const vectors = (image) => {
        const rows = [];
        for (let y = crop.top; y < crop.bottom; y += cell) {
            const row = [];
            for (let x = crop.left; x < crop.right; x += cell) {
                let l = 0, rg = 0, bg = 0, count = 0;
                for (let yy = y; yy < Math.min(y + cell, crop.bottom); yy += 2) {
                    for (let xx = x; xx < Math.min(x + cell, crop.right); xx += 2) {
                        const p = (yy * image.width + xx) * 4;
                        const c = perceptualChannels(image.data, p);
                        l += c[0]; rg += c[1]; bg += c[2]; count++;
                    }
                }
                row.push([l / count, rg / count, bg / count]);
            }
            rows.push(row);
        }
        return rows;
    };
    const a = vectors(actual);
    const b = vectors(expected);
    const directionalError = (from, to) => {
        let error = 0;
        let count = 0;
        for (let y = 0; y < from.length; y++) {
            for (let x = 0; x < from[y].length; x++) {
            let best = Infinity;
            for (let dy = -search; dy <= search; dy++) {
                for (let dx = -search; dx <= search; dx++) {
                    const target = to[y + dy]?.[x + dx];
                    if (!target) continue;
                    const dl = from[y][x][0] - target[0];
                    const drg = from[y][x][1] - target[1];
                    const dbg = from[y][x][2] - target[2];
                    // Luminance leads; opponent channels score hue without
                    // making saturated foliage dominate the complete image.
                    const d = dl * dl * 0.68 + drg * drg * 0.16 + dbg * dbg * 0.16;
                    if (d < best) best = d;
                }
            }
            error += Math.sqrt(best);
            count++;
            }
        }
        return error / count;
    };
    // Symmetric chamfer-style comparison. Both images must find a nearby
    // counterpart, so flattening several distinct reference tones into one
    // dark colour cannot improve the score merely by finding one neighbour.
    const meanError = (directionalError(a, b) + directionalError(b, a)) * 0.5;

    let rawPixelError = 0;
    let rawCount = 0;
    for (let y = crop.top; y < crop.bottom; y += 2) {
        for (let x = crop.left; x < crop.right; x += 2) {
            const p = (y * actual.width + x) * 4;
            rawPixelError += (
                Math.abs(actual.data[p] - expected.data[p])
                + Math.abs(actual.data[p + 1] - expected.data[p + 1])
                + Math.abs(actual.data[p + 2] - expected.data[p + 2])
            ) / (255 * 3);
            rawCount++;
        }
    }
    const rawPixelMae = rawPixelError / rawCount;
    // Local tolerance handles small geometry/animation offsets; raw MAE
    // keeps the optimizer honest about the full aligned composition. A
    // candidate has to improve their weighted total to be accepted.
    const combinedError = meanError * 0.72 + rawPixelMae * 0.28;
    return {
        error: combinedError,
        score: Math.max(0, 100 * (1 - combinedError)),
        localPerceptualError: meanError,
        rawPixelMae,
    };
}

export async function writeDiff(actual, expected, path) {
    const output = new PNG({ width: actual.width, height: actual.height });
    for (let i = 0; i < output.data.length; i += 4) {
        output.data[i] = Math.min(255, Math.abs(actual.data[i] - expected.data[i]) * 3);
        output.data[i + 1] = Math.min(255, Math.abs(actual.data[i + 1] - expected.data[i + 1]) * 3);
        output.data[i + 2] = Math.min(255, Math.abs(actual.data[i + 2] - expected.data[i + 2]) * 3);
        output.data[i + 3] = 255;
    }
    await writeFile(path, PNG.sync.write(output));
}
