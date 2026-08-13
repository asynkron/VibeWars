import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import {
    VIEW1_REGIONS,
    cropImage,
    downsampleImage,
    exactRegionScore,
    imageStatistics,
    materialRegionScore,
    readPng,
    sideBySide,
    writeDiff,
    writePng,
} from './view1-comparison.mjs';

const ROOT = resolve('output/view1-comparison');
const OUTPUT = resolve(ROOT, 'regions');
const REFERENCE_PATH = resolve(ROOT, 'reference-view1x-stretched-1440x900.png');
const GAME_PATH = resolve(ROOT, 'game-view1-1440x900.png');
const downsampleFactor = Math.max(1, Math.floor(Number(
    process.argv.find((value) => value.startsWith('--downsample='))?.split('=')[1] ?? 4,
)));

await mkdir(OUTPUT, { recursive: true });
const reference = await readPng(REFERENCE_PATH);
const game = await readPng(GAME_PATH);
if (reference.width !== game.width || reference.height !== game.height) {
    throw new Error(`Images are not aligned: reference ${reference.width}x${reference.height}, game ${game.width}x${game.height}`);
}

const gameOverview = new PNG({ width: game.width, height: game.height });
const referenceOverview = new PNG({ width: reference.width, height: reference.height });
game.data.copy(gameOverview.data);
reference.data.copy(referenceOverview.data);
const colors = {
    water: [40, 180, 255],
    grass: [180, 255, 70],
    forest: [50, 255, 150],
    beach: [255, 190, 60],
};
const drawBounds = (image, bounds, color) => {
    for (let x = bounds.left; x < bounds.right; x++) {
        for (const y of [bounds.top, bounds.bottom - 1]) {
            const offset = (y * image.width + x) * 4;
            image.data.set([...color, 255], offset);
        }
    }
    for (let y = bounds.top; y < bounds.bottom; y++) {
        for (const x of [bounds.left, bounds.right - 1]) {
            const offset = (y * image.width + x) * 4;
            image.data.set([...color, 255], offset);
        }
    }
};

const report = {
    schema: 'vibewars-view1-material-regions-v1',
    source: {
        reference: REFERENCE_PATH,
        game: GAME_PATH,
        width: game.width,
        height: game.height,
    },
    alignment: 'exact same pixel bounds; no offset search or local matching',
    downsampleFactor,
    regions: {},
};

for (const [name, bounds] of Object.entries(VIEW1_REGIONS)) {
    drawBounds(gameOverview, bounds, colors[name]);
    drawBounds(referenceOverview, bounds, colors[name]);
    const referenceCrop = cropImage(reference, bounds);
    const gameCrop = cropImage(game, bounds);
    const pair = sideBySide(referenceCrop, gameCrop);
    const downsampledReference = downsampleImage(referenceCrop, downsampleFactor);
    const downsampledGame = downsampleImage(gameCrop, downsampleFactor);
    await writePng(referenceCrop, resolve(OUTPUT, `${name}-reference.png`));
    await writePng(gameCrop, resolve(OUTPUT, `${name}-game.png`));
    await writePng(pair, resolve(OUTPUT, `${name}-pair-reference-left.png`));
    await writeDiff(gameCrop, referenceCrop, resolve(OUTPUT, `${name}-diff-3x.png`));
    await writePng(
        sideBySide(downsampledReference, downsampledGame),
        resolve(OUTPUT, `${name}-score-input-${downsampleFactor}x-reference-left.png`),
    );
    await writeDiff(
        downsampledGame,
        downsampledReference,
        resolve(OUTPUT, `${name}-score-diff-${downsampleFactor}x-3x.png`),
    );
    report.regions[name] = {
        bounds,
        width: referenceCrop.width,
        height: referenceCrop.height,
        score: materialRegionScore(gameCrop, referenceCrop, downsampleFactor),
        fullResolutionExactScore: exactRegionScore(gameCrop, referenceCrop),
        reference: imageStatistics(referenceCrop),
        game: imageStatistics(gameCrop),
    };
}

await writePng(gameOverview, resolve(OUTPUT, 'game-regions-overview.png'));
await writePng(referenceOverview, resolve(OUTPUT, 'reference-regions-overview.png'));
await writeFile(resolve(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.regions, null, 2));
