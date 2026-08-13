import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import {
    VIEW1_REGIONS,
    cropImage,
    materialRegionScore,
    imageStatistics,
    readPng,
    sideBySide,
    writeDiff,
    writePng,
} from './view1-comparison.mjs';

const ROOT = resolve('output/view1-comparison');
const OUTPUT = resolve(ROOT, 'regions');
const reference = await readPng(resolve(ROOT, 'reference-view1x-stretched-1440x900.png'));
const game = await readPng(resolve(ROOT, 'game-view1-1440x900.png'));
const selected = process.argv.find((value) => value.startsWith('--target='))?.split('=')[1];
const downsampleFactor = Math.max(1, Math.floor(Number(
    process.argv.find((value) => value.startsWith('--downsample='))?.split('=')[1] ?? 4,
)));
const targets = selected ? [selected] : Object.keys(VIEW1_REGIONS);
for (const target of targets) {
    if (!VIEW1_REGIONS[target]) throw new Error(`Unknown region: ${target}`);
}

function transformImage(source, grade) {
    const output = new PNG({ width: source.width, height: source.height });
    for (let offset = 0; offset < source.data.length; offset += 4) {
        let color = [0, 1, 2].map((channel) =>
            Math.max(0, source.data[offset + channel] / 255
                * grade.exposure * grade.balance[channel])
        );
        color = color.map((value) => Math.pow(value, grade.gamma));
        const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
        color = color.map((value) => luminance + (value - luminance) * grade.saturation);
        color = color.map((value) => Math.min(1, Math.max(0,
            (value - 0.5) * grade.contrast + 0.5
        )));
        output.data[offset] = Math.round(color[0] * 255);
        output.data[offset + 1] = Math.round(color[1] * 255);
        output.data[offset + 2] = Math.round(color[2] * 255);
        output.data[offset + 3] = source.data[offset + 3];
    }
    return output;
}

const dimensions = [
    ['exposure', 0.16, 0.35, 2.20],
    ['contrast', 0.16, 0.35, 2.40],
    ['saturation', 0.14, 0.20, 1.80],
    ['gamma', 0.12, 0.45, 1.80],
    ['balance.0', 0.08, 0.55, 1.55],
    ['balance.1', 0.08, 0.55, 1.55],
    ['balance.2', 0.08, 0.55, 1.55],
];
const read = (grade, key) => key.startsWith('balance.')
    ? grade.balance[Number(key.at(-1))]
    : grade[key];
const write = (grade, key, value) => {
    const next = structuredClone(grade);
    if (key.startsWith('balance.')) next.balance[Number(key.at(-1))] = value;
    else next[key] = value;
    return next;
};

await mkdir(OUTPUT, { recursive: true });
const report = {};
for (const target of targets) {
    const bounds = VIEW1_REGIONS[target];
    const actual = cropImage(game, bounds);
    const expected = cropImage(reference, bounds);
    let grade = {
        exposure: 1,
        contrast: 1,
        saturation: 1,
        gamma: 1,
        balance: [1, 1, 1],
    };
    let calibrated = actual;
    let result = materialRegionScore(calibrated, expected, downsampleFactor);
    const before = result;
    for (let round = 0; round < 9; round++) {
        let improved = false;
        for (const [key, initialStep, minimum, maximum] of dimensions) {
            const step = initialStep * Math.pow(0.5, round);
            let bestGrade = grade;
            let bestImage = calibrated;
            let bestResult = result;
            for (const direction of [-1, 1]) {
                const candidateGrade = write(
                    grade,
                    key,
                    Math.max(minimum, Math.min(maximum, read(grade, key) + direction * step)),
                );
                const candidateImage = transformImage(actual, candidateGrade);
                const candidateResult = materialRegionScore(candidateImage, expected, downsampleFactor);
                if (candidateResult.error + 1e-9 < bestResult.error) {
                    bestGrade = candidateGrade;
                    bestImage = candidateImage;
                    bestResult = candidateResult;
                }
            }
            if (bestGrade !== grade) {
                grade = bestGrade;
                calibrated = bestImage;
                result = bestResult;
                improved = true;
            }
        }
        if (!improved) break;
    }
    await writePng(calibrated, resolve(OUTPUT, `${target}-calibrated.png`));
    await writePng(
        sideBySide(expected, calibrated),
        resolve(OUTPUT, `${target}-calibrated-pair-reference-left.png`),
    );
    await writeDiff(
        calibrated,
        expected,
        resolve(OUTPUT, `${target}-calibrated-diff-3x.png`),
    );
    report[target] = {
        bounds,
        downsampleFactor,
        before,
        after: result,
        grade,
        calibrated: imageStatistics(calibrated),
        reference: imageStatistics(expected),
    };
}

await writeFile(
    resolve(OUTPUT, 'optimization-report.json'),
    JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
