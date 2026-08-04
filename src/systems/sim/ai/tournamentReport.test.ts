// Engine-vs-engine batch report -- NOT part of the normal test run.
// Activated by the ROUNDS env var, via:
//
//   npm run tournament                        (default 20 rounds = 40 matches)
//   ROUNDS=100 npm run tournament
//   ROUNDS=50 ENGINES=baseline:wolfpack MAP=rotor12x18 npm run tournament
//
// A round is a SEED PAIR: the same seed played twice with the seats
// swapped, so the first-move advantage lands on both engines equally. 20
// rounds is 40 matches.
//
// The verdict line is the point. Win counts alone invite reading noise as
// a result, so the report prints a 95% interval on the leader's share and
// says plainly when the sample cannot tell the engines apart.

import '../../../test/threeStub';
import { describe, it } from 'vitest';
import { runTournament, formatTournament, TOURNAMENT_BUDGET } from './tournament';
import { requireEngine } from './engineRegistry';
import { getMapProvider } from '../../maps/mapRegistry';
import { rotor12x18MapProvider } from '../../maps/Rotor12x18MapProvider';

// Node global; declared locally to avoid pulling @types/node into a
// browser-targeted codebase for a couple of env reads.
declare const process: { env: Record<string, string | undefined> };

const ROUNDS = Number(process.env.ROUNDS ?? 0);
const PAIRING = process.env.ENGINES ?? 'baseline:wolfpack';
const MAP_KEY = process.env.MAP ?? rotor12x18MapProvider.key;
// Optional: raise the per-turn search budget for a slower, stronger batch.
const BUDGET_SCALE = Number(process.env.BUDGET_SCALE ?? 1);

describe.skipIf(ROUNDS <= 0)('AI engine tournament', () => {
    it(`plays ${ROUNDS} seed pairs (${ROUNDS * 2} matches) and reports a verdict`, () => {
        const [idA, idB] = PAIRING.split(':');
        const a = requireEngine((idA ?? '').trim());
        const b = requireEngine((idB ?? '').trim());
        const provider = getMapProvider(MAP_KEY);
        if (!provider) throw new Error(`Unknown map "${MAP_KEY}"`);

        const budget = BUDGET_SCALE === 1 ? TOURNAMENT_BUDGET : {
            ...TOURNAMENT_BUDGET,
            population: Math.round(TOURNAMENT_BUDGET.population! * BUDGET_SCALE),
            rounds: Math.round(TOURNAMENT_BUDGET.rounds! * BUDGET_SCALE),
        };

        console.log(`map: ${provider.name} (${provider.cols}x${provider.rows})`);
        console.log(`budget: ${JSON.stringify(budget)}`);
        console.log('');

        const started = Date.now();
        const result = runTournament(a, b, {
            provider,
            rounds: ROUNDS,
            seed: 1000,
            budget,
            onMatch: (match) => {
                const seatLine = `${match.seats[0]} (first) vs ${match.seats[1]}`;
                const outcome = match.winner ? `${match.winner} wins` : 'draw';
                console.log(
                    `r${String(match.round + 1).padStart(3)} seed ${match.seed} | ${seatLine.padEnd(34)} | ` +
                    `${outcome.padEnd(15)} | ${String(match.turns).padStart(3)} turns | ${match.reason}`
                );
            },
        });

        console.log('');
        console.log(formatTournament(a, b, result));
        console.log('');
        console.log(`wall clock: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }, 24 * 60 * 60 * 1000);
});
