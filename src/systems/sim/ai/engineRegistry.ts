// The engines that exist, by id. The live game and the tournament runner
// both resolve through here, so adding a variant is one import and one
// array entry -- and no engine can be reachable from a report without also
// being reachable from the game.

import { AIEngine } from './AIEngine';
import { baselineEngine } from './engines/baseline';
import { wolfpackEngine } from './engines/wolfpack';
import { gambitEngine } from './engines/gambit';
import { feintEngine } from './engines/feint';
import { aegisEngine } from './engines/aegis';
import { menderEngine } from './engines/mender';
import { dredgeEngine } from './engines/dredge';
import { gatekeeperEngine } from './engines/gatekeeper';
import { sapperEngine } from './engines/sapper';
import { fitterEngine } from './engines/fitter';
import { convoyEngine } from './engines/convoy';

export const ENGINES: readonly AIEngine[] = [baselineEngine, wolfpackEngine, gambitEngine, feintEngine, aegisEngine,
    menderEngine, dredgeEngine, gatekeeperEngine, sapperEngine, fitterEngine, convoyEngine];

// What the live game plays unless told otherwise.
//
// Feint rather than baseline, on measured grounds: 80 matches on the
// shipped map, 58.0 points to 22.0, a 72.5% share with a 95% interval of
// 61.9-81.1%. It is also FASTER at the live budget -- 0.71 s per turn
// against baseline's 2.06 -- because a three-level beam does less work
// than a hillclimb with a deep finalist stage. Stronger and cheaper, so
// there is no trade to weigh.
//
// Not Gambit, which is the same engine two levels deeper: it beats
// baseline by the same margin (71.9%) for 4.4x Feint's thinking time, and
// 80 matches could not separate the two head to head (58.1%, interval
// 47.2-68.3%). Until that interval clears 50%, the extra depth is not
// paid for.
export const DEFAULT_ENGINE: AIEngine = feintEngine;

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
