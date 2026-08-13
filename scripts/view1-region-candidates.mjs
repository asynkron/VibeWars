import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    cropImage,
    readPng,
    sideBySide,
    writePng,
} from './view1-comparison.mjs';

const ROOT = resolve('output/view1-comparison');
const OUTPUT = resolve(ROOT, 'region-candidates');
const reference = await readPng(resolve(ROOT, 'reference-view1x-stretched-1440x900.png'));
const game = await readPng(resolve(ROOT, 'game-view1-1440x900.png'));

const candidates = {
    grass: {
        a: { left: 760, top: 625, right: 900, bottom: 675 },
        b: { left: 805, top: 655, right: 945, bottom: 705 },
        c: { left: 860, top: 700, right: 1000, bottom: 750 },
        d: { left: 530, top: 570, right: 650, bottom: 620 },
    },
    beach: {
        a: { left: 975, top: 300, right: 1075, bottom: 390 },
        b: { left: 980, top: 390, right: 1080, bottom: 480 },
        c: { left: 560, top: 480, right: 675, bottom: 555 },
        d: { left: 310, top: 430, right: 400, bottom: 525 },
    },
};

await mkdir(OUTPUT, { recursive: true });
for (const [material, entries] of Object.entries(candidates)) {
    for (const [name, bounds] of Object.entries(entries)) {
        const pair = sideBySide(cropImage(reference, bounds), cropImage(game, bounds));
        await writePng(pair, resolve(OUTPUT, `${material}-${name}-reference-left.png`));
    }
}

console.log(JSON.stringify(candidates, null, 2));
