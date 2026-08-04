// Every custom gene, by the name that appears in a dialect's weight table
// and in Gene.kind.
//
// IT EXISTS BECAUSE FUNCTIONS DO NOT SURVIVE postMessage. A dialect carries
// its custom genes as `extras: Record<string, GeneDefinition>` -- objects
// holding `applicable` and `apply` -- and SimWorkerPool.pump posts the whole
// search config to each worker, which structured-clones it. Structured clone
// throws DataCloneError on a function, so every engine with extras threw on
// every AI turn the moment it ran with real workers:
//
//     DataCloneError: applicable(){} could not be cloned.
//
// That is aegis, dredge, gatekeeper, mender and sapper -- five of the nine
// engines. It stayed invisible because DEFAULT_ENGINE is Feint, whose extras
// are empty, and because the tests run under jsdom where `Worker` is
// undefined, so the pool falls back to the serial path and never posts
// anything.
//
// So the wire carries NAMES, and the worker looks the behaviour up on its
// own side. The name is data; the function never crosses.
//
// Registering a gene here is what makes it usable by a parallel planner.
// registry.test.ts fails the build if any engine's dialect names an extra
// this file does not know, because the failure mode otherwise is the worst
// kind: the worker silently drops the gene and the parallel planner quietly
// searches a different game than the serial one.

import type { GeneDefinition } from '../../SimCommands';
import { REGROUP, regroupGene } from './regroup';
import { SCREEN, screenGene } from './screen';
import { MEND, mendGene } from './mend';
import { SINK, sinkGene } from './sink';
import { HOLD_DOOR, holdDoorGene } from './holdDoor';

export const GENE_REGISTRY: Readonly<Record<string, GeneDefinition>> = {
    [REGROUP]: regroupGene,
    [SCREEN]: screenGene,
    [MEND]: mendGene,
    [SINK]: sinkGene,
    [HOLD_DOOR]: holdDoorGene,
};

// Rebuild an extras table from the names that came over the wire.
//
// Throws on an unknown name rather than skipping it. A missing gene does not
// break anything visibly -- the plan simply never contains it -- so the
// parallel planner would search a smaller game than the serial one and the
// only symptom would be an engine mysteriously playing worse in the browser
// than in the tournament.
export function extrasFromKinds(kinds: readonly string[]): Record<string, GeneDefinition> {
    const extras: Record<string, GeneDefinition> = {};
    for (const kind of kinds) {
        const gene = GENE_REGISTRY[kind];
        if (!gene) {
            throw new Error(
                `Gene "${kind}" is not in GENE_REGISTRY. A worker cannot rebuild it, ` +
                'so the parallel planner would search without it. Register it in genes/registry.ts.'
            );
        }
        extras[kind] = gene;
    }
    return extras;
}
