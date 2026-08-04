// The guard on a failure that leaves no trace.
//
// A search config crosses postMessage to each worker, which structured-
// clones it -- and a GeneDefinition holds functions, which structured clone
// refuses. Five of the nine engines carry custom genes, so every one of them
// threw DataCloneError on every AI turn the moment it ran with real workers.
// It stayed hidden because the default engine has no extras and because the
// tests run under jsdom, where `Worker` is undefined and the pool quietly
// falls back to the serial path.
//
// Genes travel as NAMES now. That moves the failure mode rather than
// removing it: a name the far side cannot resolve means the worker searches
// without that gene, the parallel planner plays a different game than the
// serial one, and nothing anywhere says so. Hence this file.

import '../../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { GENE_REGISTRY, extrasFromKinds } from './registry';
import { ENGINES } from '../engineRegistry';

describe('every engine\'s genes can survive the wire', () => {
    it.each(ENGINES.map((engine) => [engine.id, engine] as const))(
        '%s names only registered genes',
        (id, engine) => {
            const kinds = Object.keys(engine.options.dialect?.extras ?? {});
            for (const kind of kinds) {
                expect(GENE_REGISTRY[kind], `${id} uses "${kind}", which genes/registry.ts does not know`)
                    .toBeDefined();
            }
            // And the rebuild really produces the same behaviour object, not
            // merely something with the right key.
            const rebuilt = extrasFromKinds(kinds);
            for (const kind of kinds) {
                expect(rebuilt[kind]).toBe(engine.options.dialect!.extras[kind]);
            }
        }
    );

    it.each(ENGINES.filter((e) => Object.keys(e.options.dialect?.extras ?? {}).length > 0)
                   .map((e) => [e.id, e] as const))(
        'the config %s would post is structured-cloneable',
        (id, engine) => {
            // The actual assertion, against the actual mechanism: this is
            // the shape beamParallel hands to SimWorkerPool.pump, and
            // structuredClone is what postMessage does to it.
            const dialect = engine.options.dialect!;
            const config = {
                dialect: { ...dialect, extras: {} },
                extraKinds: Object.keys(dialect.extras),
                score: engine.options.score,
            };
            expect(() => structuredClone(config), `${id} cannot cross postMessage`).not.toThrow();
        }
    );

    it('refuses a name it cannot resolve instead of dropping it', () => {
        // Silently skipping would leave the parallel planner searching a
        // smaller game than the serial one, with no symptom but a worse
        // engine in the browser than in the tournament.
        expect(() => extrasFromKinds(['nosuchgene'])).toThrow(/GENE_REGISTRY/);
    });

    it('still throws on the old shape, so the fix cannot silently regress', () => {
        // If someone puts the dialect back on the wire whole, this is what
        // happens -- proven here rather than asserted in a comment.
        const withFunctions = { dialect: { extras: { screen: { applicable() {}, apply() {} } } } };
        expect(() => structuredClone(withFunctions)).toThrow();
    });
});
