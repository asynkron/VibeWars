// The simulation layer must not reach the renderer.
//
// This is not a style rule. A Web Worker has no canvas, no document and no
// THREE global, so the AI can only run off the main thread -- and only be
// parallelised across several threads -- if the search's import graph is
// free of everything that renders. It is very easy to break by accident:
// one `import { HexCoord }` for a distance calculation drags in GridSystem,
// whose class body runs `new THREE.TextureLoader()` at module scope, and
// with it render.ts constructing a WebGLRenderer.
//
// So the property is checked rather than hoped for. The test walks the real
// import graph from the search's entry points and fails with the exact
// chain that reintroduced the dependency.

import { describe, it, expect } from 'vitest';
// @ts-expect-error -- node builtins, and this project deliberately has no
// @types/node: it targets the browser, and this is the one test that needs
// to read its own source tree.
import { readFileSync, existsSync } from 'node:fs';
// @ts-expect-error -- see above.
import { dirname, resolve } from 'node:path';
declare const process: { cwd(): string };

// Vitest gives each test file its own URL; resolve the source tree from
// the project root instead, which is the process cwd under `npm test`.
const SIM_ROOT = resolve(process.cwd(), 'src/systems/sim');

// Anything here (or anything that imports it) needs a canvas.
const FORBIDDEN = [
    'render',
    'game',
    'GridSystem',
    'ModelSystem',
    'EnvironmentLightingSystem',
    'VisualizationSystem',
    'AudioSystem',
    'UnitSystem',
    'HexCoord',
    'BuildingSystem',
    'FootprintSystem',
    'RoadSystem',
    'ProceduralDecorations',
    'PathIndicatorSystem',
    'GlowSystem',
    'RotorSystem',
    'LightPool',
];

function importsOf(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const specifiers: string[] = [];
    // Static imports and re-exports; type-only ones are erased at build
    // time and cannot pull a module into a worker, so they are skipped.
    const pattern = /^\s*(?:import|export)\s+(?!type\b)[^'"]*from\s*['"]([^'"]+)['"]/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
    return specifiers;
}

function resolveSpecifier(from: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;   // bare specifiers: none in this project
    const base = resolve(dirname(from), specifier);
    for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
        if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
    }
    return null;
}

// Depth-first walk returning the first chain that reaches a forbidden
// module, or null. The chain is what makes a failure actionable.
function findRenderDependency(entry: string): string[] | null {
    const seen = new Set<string>();
    const walk = (file: string, chain: string[]): string[] | null => {
        if (seen.has(file)) return null;
        seen.add(file);
        for (const specifier of importsOf(file)) {
            const target = resolveSpecifier(file, specifier);
            if (!target) continue;
            const name = target.split('/').pop()!.replace(/\.ts$/, '');
            const next = [...chain, name];
            if (FORBIDDEN.includes(name)) return next;
            const deeper = walk(target, next);
            if (deeper) return deeper;
        }
        return null;
    };
    return walk(entry, [entry.split('/').pop()!.replace(/\.ts$/, '')]);
}

describe('the simulation layer can run without a renderer', () => {
    // headless.ts is excluded on purpose: it is the batch match runner, it
    // already runs in node, and nothing in a worker would import it.
    const entries = [
        'search.ts',
        'SimState.ts',
        'SimCommands.ts',
        'score.ts',
        'resolveAttack.ts',
        'SimPathfinding.ts',
        'ai/planners/beam.ts',
        'ai/AIEngine.ts',
    ];

    for (const entry of entries) {
        it(`${entry} reaches nothing that needs a canvas`, () => {
            const chain = findRenderDependency(resolve(SIM_ROOT, entry));
            expect(chain, chain ? `import chain: ${chain.join(' -> ')}` : '').toBeNull();
        });
    }

    it('the pure modules it depends on are themselves clean', () => {
        for (const file of ['unitStats.ts', 'hexMath.ts']) {
            const path = resolve(SIM_ROOT, '../../shared/hexengine', file);
            const chain = findRenderDependency(path);
            expect(chain, chain ? `import chain: ${chain.join(' -> ')}` : '').toBeNull();
        }
    });
});
