// PARTHIAN -- the default engine, and the only one besides baseline. A
// beam search five (well, three: see beam.depth below) turns deep that
// keeps its worst-looking moves alive alongside the best, per-type unit
// worth, spread sacrifice slots, and four genes for spending the movement
// a sweep-only shot leaves dead: hit-and-run (close, shoot, fall back
// beyond reach), shootAdvance, shootBlock, stormCapture. Named for the
// Parthian shot, which is the first of those tactics with horses.
//
// SELF-CONTAINED ON PURPOSE. This used to be a chain of ablations --
// gambit (the beam) -> feint (shallower) -> talus (spread sacrifices) ->
// parthian (this gene) -- each engine spreading the previous one's options
// and changing exactly one value, so a tournament between two links could
// say which change did what. That measurement is done; the chain answered
// its questions (see below) and nothing still reads the intermediate
// files, so they are gone and their winning values are inlined here
// directly. What follows is the settled shape, not a diff against a
// scaffold that no longer exists.
//
// THE BEAM (was gambit.ts / feint.ts). HeroesOfBlazor's AIBrain: a
// hillclimb that scores a move 2 plies deep will not close on a kill that
// only pays off two turns later, because the chip damage of closing costs
// points now and the kill lands past the horizon the cheap stage can see.
// The fix is a beam tree that plays candidates out several turns deep and
// keeps the WORST-scoring children alive at its own levels alongside the
// best -- a move that looks bad now is exactly the move whose consequences
// need playing out. Depth 5 (gambit) beat baseline at 71.9% over 400
// matches; depth 3 (feint) matched it at 72.5% for a fifth of the compute,
// which is why depth stops at 3 here.
//
// PER-TYPE UNIT WORTH (also gambit). Baseline values every unit at
// unitBase + hp*hpWeight regardless of type; typeValue below says a
// Kestrel outranging its target is worth more than a Bulwark trading
// blows evenly.
//
// SPREAD SACRIFICE SLOTS (was talus.ts). The beam's "keep the worst
// alive" slots, taken from a spread through the worse half of the ranking
// instead of off its absolute bottom -- at the live search width the
// bottom of the ranking is suicide noise (a unit walking into fire), not
// an interesting sacrifice. Beat feint 62.0% over 400 matches at
// tournament width; the edge washed out at 6x width (not separable at 120
// matches) but never measured worse, which is what earned it a permanent
// place here rather than its own seat.
//
// HIT-AND-RUN (this engine's own addition, was on top of talus). The
// counter to slow armour is not outshooting it but never being where it
// can answer: a fast unit that strikes and ends its turn outside the
// target's move + range has dealt its damage for free. The sequence
// already existed in the vocabulary as three independent genes in the
// right order on the same unit -- a lottery ticket the search rarely
// drew -- so this gene makes the tactic as samplable as 'attack' itself.
// See genes/hitAndRun.ts. MEASURED, and it won and kept winning where the
// selection tweaks did not: 58.5% over 400 matches against talus (95%
// 53.6-63.2%), and the SAME effect size at six times the width (58.8%
// over 120, one match short of certifying) -- an effect that holds its
// size under a wider search is what a real tactic looks like, as opposed
// to a selection artifact. It also beat the sweepless Quickdraw (retired;
// the sweepless hypothesis lost cleanly at both widths) at both widths.
//
// THE PRESS FAMILY (was vanguard.ts). Hit-and-run's siblings: three more
// genes that spend the movement a sweep-only shot leaves dead, one per
// use of it -- keep coming (shootAdvance), shut the door (shootBlock),
// kick the door in (stormCapture). Combined first, like sapper before it:
// the individual effects were expected to be small, and the singles can
// be split out afterwards if the family shows a win. Weights: the dead-
// zone guard lives in shootAdvance itself, and every gene here falls back
// to 'idle' when inapplicable (see GeneDefinition.fallback) rather than
// rerolling into advance pressure -- a board where a gene never fires
// should add nothing, not something. See genes/shootAdvance.ts,
// genes/shootBlock.ts, genes/stormCapture.ts.
//
// WEIGHTS. Every purposeful slot through hit-and-run is untouched at its
// original value; the press-family trio is funded entirely out of what
// used to be the noise budget (moveRandom + idle, 0.10 combined), which
// keeps 0.02 each of the noise it had. (A blockade gene -- stand where
// your body denies the most path, from the retired bastion engine --
// rode along here briefly and was removed on instruction. Removing it
// changed nothing on the water-choke board it was suspected of
// regressing, and the retreat/twin gains survived its removal: the press
// family alone carries them. waterChoke.test.ts holds the numbers.)
//
// See engineRegistry.ts for how this engine was chosen as the default,
// and ai/README.md for the full tournament table.

import { createEngine } from '../AIEngine';
import { beamPlanGen } from '../planners/beam';
import { beamPlanParallel } from '../planners/beamParallel';
import { HIT_AND_RUN, hitAndRunGene } from '../genes/hitAndRun';
import { SHOOT_ADVANCE, shootAdvanceGene } from '../genes/shootAdvance';
import { SHOOT_BLOCK, shootBlockGene } from '../genes/shootBlock';
import { STORM_CAPTURE, stormCaptureGene } from '../genes/stormCapture';
import { USE_SKILL, useSkillGene } from '../genes/useSkill';

export const parthianEngine = createEngine({
    id: 'parthian',
    name: 'Parthian',
    notes: 'The default: a five-turn beam (run at depth 3) with spread sacrifice slots, per-type unit worth, hit-and-run and the press family.',
    planner: beamPlanGen,
    // Same search, fanned out across workers, for the live game only.
    // Proven to return the identical plan -- see beamParallel.test.ts. Runs
    // as a TWO-PHASE level because the spread picks from the node's whole
    // ranking: round one returns every child as metadata, selection happens
    // in the planner, then round two recomputes only the picked children.
    asyncPlanner: beamPlanParallel,
    options: {
        // --- The beam, in HeroesOfBlazor's own proportions: 7 best plus 4
        // --- sacrifices kept per own node, one reply per opponent node.
        // --- Selection is PER NODE, not pooled across the level -- see
        // --- beam.ts, where doing it globally collapsed the whole search.
        beam: {
            depth: 3,
            childCounts: [80, 60, 30, 20, 16],
            keepBest: 7,
            keepWorst: 4,
            keepOpponent: 1,
            genesPerUnit: 3,
            // The sacrifice slots spread through the worse half of the
            // ranking instead of its absolute bottom -- see header.
            spreadWorst: true,
            // dedupeChildren stays OFF, and that is a measured decision,
            // not an oversight. State-hash dedup (see SimState.stateHash)
            // composes with spreadWorst and was tried here twice: first
            // with a walk-the-board hash (47.5% over 40 matches, at 1.53x
            // thinking time), then again after the hash went incremental
            // and the cost vanished (43.8% over 40 matches, at 1.02x).
            // Free now -- but both intervals span 50%, both point
            // estimates lean under it, and the retreat scenario held
            // fewer seeds with it on. A flag that changes play earns its
            // place through measurement, and this one has not yet.
            // ai/dedupProbe.test.ts reruns the question.
        },

        // --- Frozen-future foresight: every scored board with fire on it
        // --- is also scored 20 decision-free turns later (fire spreads,
        // --- standing units burn, nobody moves) and the future blends in
        // --- at half weight. This is what lets a depth-3 beam see that a
        // --- lit treeline kills the artillery fifteen turns out, and that
        // --- standing beside your own fire is how infantry cooks -- both
        // --- measured blind without it (see fireGrove.test.ts). Half
        // --- weight because the freeze assumes nobody dodges. Free on
        // --- fireless boards: guarded on hasFire in simJob.
        foresight: { turns: 20, weight: 0.5 },

        // --- How the board is valued.
        score: {
            unitBase: 100,
            hpWeight: 10,
            armySize: 3,
            // Restored 2026-08-07 after a day away: without it every
            // no-contact plan ties and ground units idle while the score
            // waits for a payoff to appear -- the reference probe showed
            // the engine WINNING while looking asleep. One point per hex
            // is a tiebreak, not a strategy; everything real outbids it.
            aggression: 1,
            buildingOwned: 25,
            captureYield: 150,
            buildingBlockPenalty: 15,
            capturePull: 3,
            // The hard rule's score mirror -- see ScoreWeights.vitalWorth.
            vitalWorth: 1500,
            // Same hard-objective mirror for optional HQ maps.
            headquartersWorth: 1500,

            // Roughly: reach and speed are worth more than raw hit points,
            // which the flat model already counts. Kestrel and Mortar
            // shell from 2-3 hexes and are never shot back at by what they
            // hit; Nightjar crosses four hexes and one-shots any tank;
            // Pike is the only class that can take a building at all.
            typeValue: {
                Bulwark: 1.0,   // the reference: a plain line tank
                Sabre: 1.0,
                Drover: 0.95,
                Lynx: 0.9,      // fast but only 2-4 damage
                Halberd: 1.05,  // range 2 and the only answer to air
                Kestrel: 1.25,  // outranges everything it shoots at
                Nightjar: 1.3,  // 4 move, one-shots tanks
                Shrike: 1.35,   // 5 move, 6-9 damage
                Pike: 1.2,      // captures; nothing else does
                Road: 1.1,
                Gunboat: 0.9,
                // The scenario units. The Pyramid's crown-jewel status is
                // NOT priced here -- it is vital (unitStats), and the
                // score's vitalWorth term mirrors the hard rule for every
                // engine at once, which beats hand-tuning one table. What
                // remains here is the anti-grind: the Kloss is worthless
                // as a TARGET (chipping its mountain of hp earns nothing)
                // and priceless only through where it stands.
                Kloss: 0.05,
                Pyramid: 1.0,
                Boll: 1.0,
            },
        },

        // --- Which genes exist and how often each is rolled. Weights sum
        // --- to 1.00 exactly -- see the header's WEIGHTS note for how the
        // --- press family was funded out of the noise budget.
        dialect: {
            weights: [
                ['attack', 0.30],
                ['moveTowards', 0.20],
                ['standoff', 0.10],
                ['moveAway', 0.10],
                ['moveToBuilding', 0.10],
                [HIT_AND_RUN, 0.10],
                [SHOOT_ADVANCE, 0.02],
                [SHOOT_BLOCK, 0.02],
                [STORM_CAPTURE, 0.02],
                // The whole skill vocabulary through one word -- see
                // genes/useSkill.ts. Funded from the idle slot; its
                // fallback IS idle, so on a board where no skill applies
                // (most units, most turns) the mass flows right back and
                // the weight is purely additive.
                [USE_SKILL, 0.02],
                ['moveRandom', 0.02],
            ],
            extras: {
                [HIT_AND_RUN]: hitAndRunGene,
                [SHOOT_ADVANCE]: shootAdvanceGene,
                [SHOOT_BLOCK]: shootBlockGene,
                [STORM_CAPTURE]: stormCaptureGene,
                [USE_SKILL]: useSkillGene,
            },
            focusFireChance: 0.5,
            sweep: {
                killBonus: 100,
                friendlyFirePenalty: 1.5,
            },
        },

        // --- Inherited from baseline, unread by the beam. Kept so a diff
        // --- against baseline's own options stays legible.
        population: 24,
        rounds: 4,
        lookaheadPlies: 2,
        replyCandidates: 6,
        finalists: 4,
        deepPlies: 2,
        replyPopulation: 8,
        replyRounds: 2,
        parsimonyPenalty: 0.001,
        immediateWeight: 0.01,
        survivorFraction: 0.25,
        initGenesPerUnit: 3,
        replyGenesPerUnit: 2,
        maxGenesPerUnit: 6,
        mutation: { insert: 0.25, remove: 0.20, replace: 0.20, swap: 0.20 },
    },
});
