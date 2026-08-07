// Standing probe, env-gated: the FROZEN 2026-08-05 Feint (see
// src/reference/feint0805/README.md) against today's parthian, head to
// head at the tournament budget. The fixed point every future engine
// change can be measured against -- "did we actually get better than
// where we were?"
//
//   REFERENCE_PROBE=20 npx vitest run referenceProbe --disable-console-intercept
//
// The frozen engine plans with its own frozen rules (no production
// knowledge, no foresight, no useSkill) inside a match loop running
// today's rules -- that ENGINE drift is part of what is being measured.
// Its UNIT STATS are not allowed to drift: the frozen folder's
// unitStats.ts is kept synced to the live one (see its README), so the
// reference always plans on the real board.
//
// MEASURED (2026-08-07, 20 seed pairs = 40 matches, rotor12x18, under
// today's rules incl. factory production): frozen feint 9W 31L -- 22.5%
// [12.3-37.5] -- today's parthian ahead with the interval clearing 50%,
// at 1.66x feint's thinking time (foresight and production rollouts are
// not free). Head to head the engine is measurably STRONGER than the
// 08-05 reference; how the games LOOK (ground troops idling since the
// aggression term left, helicopters doing the visible work) is a
// separate axis this probe does not score.

import '../../../test/threeStub';
import { describe, it, expect } from 'vitest';
import { runTournament, formatTournament } from './tournament';
import { requireEngine } from './engineRegistry';
import { runHeadlessMatch } from '../headless';
import { rotor12x18MapProvider } from '../../maps/Rotor12x18MapProvider';

declare const process: { env: Record<string, string | undefined> };

const ROUNDS = Number(process.env.REFERENCE_PROBE ?? 0);

describe('the frozen feint runs in today\'s match loop', () => {
    it('plays a full match against parthian without erroring', () => {
        const result = runHeadlessMatch(rotor12x18MapProvider, {
            seed: 1, maxTurns: 60,
            engines: [requireEngine('feint'), requireEngine('parthian')],
            plan: { beamChildCounts: [24, 12, 8], beamDepth: 3 },
        });
        expect([0, 1, -1]).toContain(result.winner);
        expect(result.turns).toBeGreaterThan(0);
    }, 120_000);
});

describe.skipIf(!ROUNDS)('reference probe', () => {
    it(`frozen feint vs parthian, ${ROUNDS} seed pairs`, () => {
        const feint = requireEngine('feint');
        const parthian = requireEngine('parthian');
        const result = runTournament(feint, parthian, {
            provider: rotor12x18MapProvider,
            rounds: ROUNDS,
        });
        console.log(formatTournament(feint, parthian, result));
    }, 3_600_000);
});
