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
import { mirageEngine } from './engines/mirage';
import { talusEngine } from './engines/talus';
import { parthianEngine } from './engines/parthian';
import { quickdrawEngine } from './engines/quickdraw';

export const ENGINES: readonly AIEngine[] = [baselineEngine, wolfpackEngine, gambitEngine, feintEngine, aegisEngine,
    menderEngine, dredgeEngine, gatekeeperEngine, sapperEngine, fitterEngine, convoyEngine, mirageEngine, talusEngine,
    parthianEngine, quickdrawEngine];

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
