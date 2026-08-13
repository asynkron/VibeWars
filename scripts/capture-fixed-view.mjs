import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_URL = 'http://localhost:5173/?map=random30fixed&mode=human-cpu&difficulty=low';
const DEFAULT_OUTPUT = 'output/view1-comparison/game-view1-1440x900.png';

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const outputPath = resolve(outputArgument?.slice('--output='.length) || DEFAULT_OUTPUT);
const url = process.env.VIBEWARS_URL || DEFAULT_URL;

await mkdir(dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
    });
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

    // Freeze shader and animation clocks. The render loop still runs, so
    // asynchronously loaded assets can appear, but every rendered frame has
    // the same wind/water phase.
    await page.addInitScript(() => {
        Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => 0,
        });
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    const viewButton = page.getByRole('button', { name: 'View 1', exact: true });
    await viewButton.waitFor({ state: 'visible' });
    await viewButton.click();
    const desiredOptions = {
        grid: false,
        textures: true,
        minimap: false,
        bloom: true,
        grass: true,
        stats: false,
    };
    for (const [key, enabled] of Object.entries(desiredOptions)) {
        const button = page.locator(`.view-toggle[data-key="${key}"]`);
        const current = await button.getAttribute('aria-pressed');
        if ((current === 'true') !== enabled) await button.click();
    }
    await page.evaluate(async () => {
        await document.fonts.ready;
        window.renderFrameNow?.();
    });
    await page.screenshot({ path: outputPath });
    if (browserErrors.length) {
        throw new Error(`Browser errors while capturing View 1:\n${browserErrors.join('\n')}`);
    }
    console.log(outputPath);
} finally {
    await browser.close();
}
