// The engines that exist, by id. The live game and the tournament runner
// both resolve through here, so adding a variant is one import and one
// array entry -- and no engine can be reachable from a report without also
// being reachable from the game.

import { AIEngine } from './AIEngine';
import { baselineEngine } from './engines/baseline';
import { wolfpackEngine } from './engines/wolfpack';

export const ENGINES: readonly AIEngine[] = [baselineEngine, wolfpackEngine];

// What the live game plays unless told otherwise.
export const DEFAULT_ENGINE: AIEngine = baselineEngine;

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
