import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
    VIEW1_REGIONS,
    VIEWPORT,
    cropImage,
    imageStatistics,
    materialRegionScore,
    readPng,
    sideBySide,
    writeDiff,
    writePng,
} from './view1-comparison.mjs';

const ROOT = resolve('output/view1-comparison');
const OUTPUT = resolve(ROOT, 'material-optimization');
const REFERENCE_PATH = resolve(ROOT, 'reference-view1x-stretched-1440x900.png');
const URL = process.env.VIBEWARS_URL
    || 'http://localhost:5173/?map=random30fixed&mode=human-cpu&difficulty=low';
const requestedTarget = process.argv.find((value) => value.startsWith('--target='))
    ?.split('=')[1];
const cycles = Number(process.argv.find((value) => value.startsWith('--cycles='))
    ?.split('=')[1] ?? 2);
const rounds = Number(process.argv.find((value) => value.startsWith('--rounds='))
    ?.split('=')[1] ?? 6);
const downsampleFactor = Math.max(1, Math.floor(Number(
    process.argv.find((value) => value.startsWith('--downsample='))?.split('=')[1] ?? 4,
)));
const targets = requestedTarget ? [requestedTarget] : Object.keys(VIEW1_REGIONS);
for (const target of targets) {
    if (!VIEW1_REGIONS[target]) throw new Error(`Unknown material target: ${target}`);
}

const neutral = () => ({
    exposure: 1,
    contrast: 1,
    saturation: 1,
    gamma: 1,
    balance: [1, 1, 1],
});
const dimensions = [
    ['exposure', 0.14, 0.35, 2.20],
    ['contrast', 0.14, 0.35, 2.40],
    ['saturation', 0.12, 0.20, 1.80],
    ['gamma', 0.10, 0.45, 1.80],
    ['balance.0', 0.07, 0.55, 1.55],
    ['balance.1', 0.07, 0.55, 1.55],
    ['balance.2', 0.07, 0.55, 1.55],
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
const reference = await readPng(REFERENCE_PATH);
const referenceRegions = Object.fromEntries(
    Object.entries(VIEW1_REGIONS).map(([target, bounds]) => [
        target,
        cropImage(reference, bounds),
    ]),
);
let offlineSeeds = {};
try {
    const offline = JSON.parse(await readFile(resolve(ROOT, 'regions/optimization-report.json'), 'utf8'));
    offlineSeeds = Object.fromEntries(
        Object.entries(offline).map(([target, result]) => [target, result.grade]),
    );
} catch {
    // The live search is complete without a seed; the offline pass only
    // offers a measured first candidate that still has to beat neutral.
}

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
    await page.addInitScript(() => Object.defineProperty(
        performance,
        'now',
        { configurable: true, value: () => 0 },
    ));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'View 1', exact: true }).click();
    const desired = {
        grid: false,
        textures: true,
        minimap: false,
        bloom: true,
        grass: true,
        stats: false,
    };
    for (const [key, enabled] of Object.entries(desired)) {
        const button = page.locator(`.view-toggle[data-key="${key}"]`);
        if ((await button.getAttribute('aria-pressed') === 'true') !== enabled) await button.click();
    }
    await page.evaluate(async () => {
        await document.fonts.ready;
        window.renderFrameNow?.();
    });

    const grades = Object.fromEntries(Object.keys(VIEW1_REGIONS).map((target) => [target, neutral()]));
    await page.evaluate((initial) => {
        for (const [target, grade] of Object.entries(initial)) {
            window.setRuntimeMaterialCalibration(target, grade);
        }
        window.renderFrameNow();
    }, grades);

    const candidatePath = resolve(OUTPUT, '.candidate.png');
    const captureRegion = async (target) => {
        const bounds = VIEW1_REGIONS[target];
        await page.screenshot({
            path: candidatePath,
            clip: {
                x: bounds.left,
                y: bounds.top,
                width: bounds.right - bounds.left,
                height: bounds.bottom - bounds.top,
            },
        });
        const image = await readPng(candidatePath);
        return {
            image,
            ...materialRegionScore(image, referenceRegions[target], downsampleFactor),
        };
    };
    const apply = async (target, grade) => {
        await page.evaluate(({ target, grade }) => {
            window.setRuntimeMaterialCalibration(target, grade);
            window.renderFrameNow();
        }, { target, grade });
    };

    const baseline = {};
    for (const target of targets) baseline[target] = await captureRegion(target);
    const history = [];

    for (let cycle = 0; cycle < cycles; cycle++) {
        for (const target of targets) {
            let grade = grades[target];
            let current = await captureRegion(target);
            const seed = cycle === 0 ? offlineSeeds[target] : null;
            if (seed) {
                await apply(target, seed);
                const seeded = await captureRegion(target);
                if (seeded.error + 1e-8 < current.error) {
                    grade = structuredClone(seed);
                    grades[target] = grade;
                    current = seeded;
                    console.log(`${target} seed ${current.score.toFixed(4)}`);
                } else {
                    await apply(target, grade);
                }
            }
            for (let round = 0; round < rounds; round++) {
                let improved = false;
                for (const [key, initialStep, minimum, maximum] of dimensions) {
                    const step = initialStep * Math.pow(0.5, round + cycle * 2);
                    let bestGrade = grade;
                    let best = current;
                    for (const direction of [-1, 1]) {
                        const candidateGrade = write(
                            grade,
                            key,
                            Math.max(
                                minimum,
                                Math.min(maximum, read(grade, key) + direction * step),
                            ),
                        );
                        await apply(target, candidateGrade);
                        const candidate = await captureRegion(target);
                        if (candidate.error + 1e-8 < best.error) {
                            bestGrade = candidateGrade;
                            best = candidate;
                        }
                    }
                    if (bestGrade !== grade) {
                        grade = bestGrade;
                        grades[target] = grade;
                        current = best;
                        improved = true;
                        console.log(
                            `${target} ${key}=${read(grade, key).toFixed(4)}`
                            + ` score=${current.score.toFixed(4)}`,
                        );
                    }
                    await apply(target, grade);
                }
                if (!improved) break;
            }
            history.push({ cycle, target, grade: structuredClone(grade), score: current.score });
        }
    }

    const fullPath = resolve(OUTPUT, 'game-view1-material-calibrated-1440x900.png');
    await page.evaluate(() => window.renderFrameNow());
    await page.screenshot({ path: fullPath });
    const finalFull = await readPng(fullPath);
    const results = {};
    for (const target of targets) {
        const final = cropImage(finalFull, VIEW1_REGIONS[target]);
        const expected = referenceRegions[target];
        const after = materialRegionScore(final, expected, downsampleFactor);
        await writePng(final, resolve(OUTPUT, `${target}-game.png`));
        await writePng(
            sideBySide(expected, final),
            resolve(OUTPUT, `${target}-pair-reference-left.png`),
        );
        await writeDiff(final, expected, resolve(OUTPUT, `${target}-diff-3x.png`));
        results[target] = {
            bounds: VIEW1_REGIONS[target],
            before: {
                score: baseline[target].score,
                error: baseline[target].error,
                distributionError: baseline[target].distributionError,
                exact: baseline[target].exact,
            },
            after,
            grade: grades[target],
            reference: imageStatistics(expected),
            game: imageStatistics(final),
        };
    }
    const report = {
        schema: 'vibewars-view1-live-material-optimization-v1',
        alignment: 'exact same pixel bounds; each candidate is a real game render',
        cycles,
        rounds,
        downsampleFactor,
        results,
        history,
    };
    await writeFile(
        resolve(OUTPUT, 'report.json'),
        JSON.stringify(report, null, 2) + '\n',
    );
    await unlink(candidatePath).catch(() => {});
    if (browserErrors.length) {
        throw new Error(`Browser errors during material optimization:\n${browserErrors.join('\n')}`);
    }
    console.log(JSON.stringify(results, null, 2));
} finally {
    await browser.close();
}
