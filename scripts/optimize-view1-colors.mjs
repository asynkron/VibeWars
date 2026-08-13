import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
    VIEW1_REGIONS,
    VIEWPORT,
    cropImage,
    exactRegionScore,
    readPng,
    scoreImages,
    writeDiff,
} from './view1-comparison.mjs';

const OUTPUT_DIR = resolve('output/view1-comparison');
const REFERENCE = resolve(OUTPUT_DIR, 'reference-view1x-stretched-1440x900.png');
const BASELINE = resolve(OUTPUT_DIR, 'game-view1-1440x900.png');
const URL = process.env.VIBEWARS_URL || 'http://localhost:5173/?map=random30fixed&mode=human-cpu&difficulty=low';
const iterations = Number(process.argv.find((x) => x.startsWith('--iterations='))?.split('=')[1] ?? 5);
const target = process.argv.find((x) => x.startsWith('--target='))?.split('=')[1] ?? 'scene';
if (target !== 'scene' && !VIEW1_REGIONS[target]) {
    throw new Error(`Unknown target ${target}; use scene, ${Object.keys(VIEW1_REGIONS).join(', ')}`);
}
const suffix = target === 'scene' ? '' : `-${target}`;
const BEST = resolve(OUTPUT_DIR, `game-view1-optimized${suffix}-1440x900.png`);
const DIFF = resolve(OUTPUT_DIR, `view1-diff${suffix}-3x.png`);
const RESULT = resolve(
    OUTPUT_DIR,
    iterations > 0
        ? `color-grade-optimization${suffix}.json`
        : `color-grade-current${suffix}.json`,
);
const reference = await readPng(REFERENCE);
const scoreTarget = (image) => target === 'scene'
    ? scoreImages(image, reference)
    : exactRegionScore(
        cropImage(image, VIEW1_REGIONS[target]),
        cropImage(reference, VIEW1_REGIONS[target]),
    );

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
            browserErrors.push(message.text());
        }
    });
    page.on('response', (response) => {
        if (response.status() >= 400) browserErrors.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(() => Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 }));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'View 1', exact: true }).click();
    const desired = { grid: false, textures: true, minimap: false, bloom: true, grass: true, stats: false };
    for (const [key, enabled] of Object.entries(desired)) {
        const button = page.locator(`.view-toggle[data-key="${key}"]`);
        if ((await button.getAttribute('aria-pressed') === 'true') !== enabled) await button.click();
    }
    await page.evaluate(async () => { await document.fonts.ready; window.renderFrameNow?.(); });

    const capture = async (grade, path) => {
        await page.evaluate((next) => { window.setRuntimeColorGrade(next); window.renderFrameNow(); }, grade);
        await page.screenshot({ path });
        const image = await readPng(path);
        return { image, ...scoreTarget(image) };
    };

    let grade = await page.evaluate(() => window.getRuntimeColorGrade());
    let current = await capture(grade, BASELINE);
    const before = {
        target,
        score: current.score,
        error: current.error,
        ...(target === 'scene'
            ? {
                localPerceptualError: current.localPerceptualError,
                rawPixelMae: current.rawPixelMae,
            }
            : {
                perceptualError: current.perceptualError,
                rgbMae: current.rgbMae,
            }),
        grade: structuredClone(grade),
    };
    console.log(`baseline ${current.score.toFixed(4)}`);

    const dimensions = [
        ['exposure', 0.04, 0.50, 1.20], ['saturation', 0.06, 0.35, 1.30], ['gamma', 0.04, 0.70, 1.40],
        ['balance.0', 0.035, 0.70, 1.30], ['balance.1', 0.035, 0.70, 1.30], ['balance.2', 0.035, 0.70, 1.30],
    ];
    const read = (g, key) => key.startsWith('balance.') ? g.balance[Number(key.at(-1))] : g[key];
    const write = (g, key, value) => {
        const n = structuredClone(g);
        if (key.startsWith('balance.')) n.balance[Number(key.at(-1))] = value; else n[key] = value;
        return n;
    };
    for (let round = 0; round < iterations; round++) {
        let improved = false;
        for (const [key, initialStep, min, max] of dimensions) {
            const step = initialStep * Math.pow(0.5, round);
            let best = current;
            let bestGrade = grade;
            for (const direction of [-1, 1]) {
                const value = Math.max(min, Math.min(max, read(grade, key) + direction * step));
                const candidateGrade = write(grade, key, value);
                const candidate = await capture(candidateGrade, resolve(OUTPUT_DIR, '.candidate.png'));
                if (candidate.error + 1e-7 < best.error) { best = candidate; bestGrade = candidateGrade; }
            }
            if (bestGrade !== grade) {
                grade = bestGrade; current = best; improved = true;
                console.log(`${key} -> ${read(grade, key).toFixed(4)}  score ${current.score.toFixed(4)}`);
            } else {
                await page.evaluate((next) => { window.setRuntimeColorGrade(next); window.renderFrameNow(); }, grade);
            }
        }
        if (!improved) break;
    }
    const final = await capture(grade, BEST);
    await writeDiff(final.image, reference, DIFF);
    const result = {
        before,
        after: {
            target,
            score: final.score,
            error: final.error,
            ...(target === 'scene'
                ? {
                    localPerceptualError: final.localPerceptualError,
                    rawPixelMae: final.rawPixelMae,
                }
                : {
                    perceptualError: final.perceptualError,
                    rgbMae: final.rgbMae,
                }),
            grade,
        },
    };
    await writeFile(RESULT, JSON.stringify(result, null, 2) + '\n');
    await unlink(resolve(OUTPUT_DIR, '.candidate.png')).catch(() => {});
    if (browserErrors.length) {
        throw new Error(`Browser errors during View 1 optimization:\n${browserErrors.join('\n')}`);
    }
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser.close();
}
