// The engines that exist, by id. The live game and the tournament runner
// both resolve through here, so adding a variant is one import and one
// array entry -- and no engine can be reachable from a report without also
// being reachable from the game.

import { AIEngine } from './AIEngine';
import { baselineEngine } from './engines/baseline';
import { parthianEngine } from './engines/parthian';
import { feintReferenceEngine } from './engines/feintReference';

// Three engines: baseline (the control), parthian (the default), and
// feint -- the FROZEN 2026-08-05 engine, byte-exact from before the
// flatten and everything after it, running its own copied rules from
// src/reference/feint0805/ (see its README). It exists as a fixed
// reference point: ?ai=feint plays it, tournaments measure against it.
// Everything else parthian ever beat -- the ablation chain and the
// engines that once stood beside it -- answered its question and is gone
// as files; parthian.ts inlines every winning value directly and
// ai/README.md keeps the measured table.
export const ENGINES: readonly AIEngine[] = [baselineEngine, parthianEngine, feintReferenceEngine];

// What the live game plays unless told otherwise.
//
// Parthian rather than Talus, on measured grounds: 232 wins to 164 over
// 400 matches at the tournament width -- a 58.5% share, 95% interval
// 53.6-63.2% -- and the SAME effect size at six times the width (58.8%
// over 120, one match short of certifying), at 1.07x compute. Holding its
// size where the selection tweaks collapsed is what makes the hit-and-run
// gene a tactic rather than an artifact; see engines/parthian.ts.
//
// The seat's lineage, every step a measurement: Feint beat baseline
// (72.5% over 80, and cheaper); Talus beat Feint (62.0% over 400 at batch
// width, not separable at 6x); Parthian beat Talus as above. Quickdraw --
// Parthian without the attack sweep -- lost at BOTH widths (61.5% and
// 60.8% to Parthian), which is why the sweep stays in every engine here.
export const DEFAULT_ENGINE: AIEngine = parthianEngine;

export function getEngine(id: string): AIEngine | undefined {
    return ENGINES.find((engine) => engine.id === id);
}

// Same, but loud: a typo in an env var or query string should say what the
// options were rather than silently falling back to the default engine and
// producing a tournament of baseline against itself.
export function requireEngine(id: string): AIEngine {
    const engine = getEngine(id);
    if (!engine) {
        throw new Error(`Unknown AI engine "${id}". Known engines: ${ENGINES.map((e) => e.id).join(', ')}`);
    }
    return engine;
}
