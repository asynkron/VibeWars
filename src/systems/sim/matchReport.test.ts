import '../../test/threeStub';
import { describe, it } from 'vitest';
import { runHeadlessMatch } from './headless';
import { mirror8MapProvider } from '../maps/Mirror8MapProvider';

// Batch balance report -- NOT part of the normal test run. Activated by
// the MATCHES env var, via:
//
//   npm run simulate            (default 10 matches)
//   MATCHES=50 npm run simulate
//
// Prints per-match outcomes and aggregate win rates for AI vs AI on the
// mirror map. Because the map and rosters are exactly mirrored, any
// systematic skew between player 0 and player 1 indicates a first-mover
// (or other structural) advantage rather than map imbalance.

// Node global; declared locally to avoid pulling @types/node into a
// browser-targeted codebase for one env read.
declare const process: { env: Record<string, string | undefined> };

const MATCHES = Number(process.env.MATCHES ?? 0);

describe.skipIf(MATCHES <= 0)('AI vs AI balance report', () => {
    it(`runs ${MATCHES} headless matches and reports win rates`, () => {
        const wins = [0, 0];
        let draws = 0;
        let totalTurns = 0;
        const reasons = new Map<string, number>();

        for (let match = 0; match < MATCHES; match++) {
            const result = runHeadlessMatch(mirror8MapProvider, { seed: 1000 + match });
            totalTurns += result.turns;
            const reasonKey = result.reason.replace(/ \(points.*/, '');
            reasons.set(reasonKey, (reasons.get(reasonKey) ?? 0) + 1);

            if (result.winner === -1) draws++;
            else wins[result.winner]++;

            console.log(
                `match ${String(match + 1).padStart(2)} | seed ${1000 + match} | ` +
                `${result.winner === -1 ? 'draw    ' : `P${result.winner} wins `} | ` +
                `${String(result.turns).padStart(3)} turns | ${result.reason} | ` +
                `survivors P0=[${result.survivors[0]}] P1=[${result.survivors[1]}]`
            );
        }

        console.log('---');
        console.log(`P0 wins: ${wins[0]}  P1 wins: ${wins[1]}  draws: ${draws}`);
        console.log(`avg turns: ${(totalTurns / MATCHES).toFixed(1)}`);
        console.log('endings:', Object.fromEntries(reasons));
    }, 600_000);
});
