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
// Talus rather than Feint, on measured grounds: 400 matches on the shipped
// map at the tournament budget, 248 wins to 152, a 62.0% share with a 95%
// interval of 57.2-66.6% -- clear of 50% by a wide margin -- at 1.02x
// compute parity. At six times the width the two are not separable (120
// matches, feint 53.8%, interval spanning 50%), so at live widths the
// claim is "at least as good, decisively better at batch width". Talus IS
// Feint apart from one value (the sacrifice slots sample the worse half
// of the ranking instead of its absolute bottom -- see engines/talus.ts),
// so everything Feint measured against baseline still describes this
// engine's cost and shape.
//
// Feint earned the seat before it: 72.5% against baseline over 80 matches
// (95% 61.9-81.1%) and cheaper per turn than the hillclimb it replaced.
// Mirage (duplicate outcomes collapsed) also beat Feint -- 55.9%, interval
// 51.0-60.7% -- but by less than Talus did, and the two changes cannot be
// combined today: dedup needs event logs the spread protocol does not
// ship. See beam.ts.
export const DEFAULT_ENGINE: AIEngine = talusEngine;

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
