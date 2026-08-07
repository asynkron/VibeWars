# AI engines

An **engine** is one complete way of playing: how it values a board, which
genes it can express, how it mutates plans, how hard it searches. Two
engines can be instantiated side by side and play each other, which is the
only honest way to decide whether a tweak was an improvement.

```
AIEngine.ts          the interface + createEngine + withBudget
engineRegistry.ts    id -> engine, used by both the game and the tournament
engines/baseline.ts  the AI as originally shipped -- the control
engines/parthian.ts  the default, and the only other engine that ships
genes/hitAndRun.ts   step into the bracket, shoot, fall back out of reach
genes/shootAdvance.ts, shootBlock.ts, stormCapture.ts   the press family
planners/beam.ts     the beam tree search parthian uses
tournament.ts        seed pairs played from both seatings + significance test
```

Just two engines now. Parthian's own header lists the whole retired chain
that got it here in two stages: an ablation chain (wolfpack, gambit,
feint, mirage, talus, aegis, convoy, dredge, fitter, gatekeeper, mender,
sapper) whose winning values it inlined first, and a second retirement
(quickdraw, vanguard, bastion -- engines that once stood beside it) folded
in later on direct instruction rather than a tournament result. The table
below is what the ablation chain found; "What vanguard and bastion found"
after it covers the second retirement, including a real regression that
came with it.

An engine owns **values** (how the board is scored, which genes exist, how
plans mutate) and may also own its **search algorithm**, via `planner`. The
machinery lives in `../search.ts`, `../score.ts`, `../SimCommands.ts` and
`planners/`.

## What the tournaments found

| | vs baseline | compute |
|---|---|---|
| wolfpack (different weights) | 51.6% over 400 matches — **no measurable difference** | 1.07× |
| gambit (beam, depth 5) | **71.9%**, 95% 61.2–80.5 | 9.85× |
| feint (beam, depth 3) | **72.5%**, 95% 61.9–81.1 | 2.20× |

Gambit vs Feint head to head: 58.1%, interval 47.2–68.3 — **not decisive**
at 80 matches, so the extra two levels are not yet shown to be worth 4.4×
the thinking time.

The lesson is in the first row against the other two: seven tuned weights
moved nothing, and changing what the search *does* moved everything. The
beam looks five (or three) whole turns ahead and, at its own levels, keeps
the **worst**-scoring children alongside the best — a move that looks bad
now is exactly the move whose consequences need playing out. Neither engine
was told anything about unit matchups; both work them out.

The second round of challengers changed the SELECTION rather than the
search or the weights, and both were measured against feint at compute
parity:

| | vs feint (width 80) | at 6× width |
|---|---|---|
| mirage (duplicate outcomes collapsed) | **55.9%** over 400 matches, 95% 51.0–60.7 | not separable at 120 matches |
| talus (spread sacrifice slots) | **62.0%** over 400 matches, 95% 57.2–66.6 | not separable at 120 matches |

Both effects live where the ranking is short: at width 80 the keep slots
are scarce and the absolute bottom of the ranking is at its most
degenerate, so how the slots are spent matters. At width 480 the search
already buys redundancy and neither refinement separates from feint —
which was the opposite of the prediction both engine headers went in with,
and is exactly why the wide run existed.

(Dedup got a second life later as a **state-hash** — `SimState.stateHash`,
maintained incrementally per write, so two gene orders reaching the same
board collapse and the key rides the spread protocol's metadata, lifting
the old dedupe/spreadWorst exclusivity. Measured against parthian twice
at 40 matches each: no strength either time, compute parity 1.02× once
the hash went incremental. The flag exists, costs nothing, and stays off
until it wins something — `dedupProbe.test.ts` reruns the question.)

The third round changed the MOVE VOCABULARY and the sweep, and told a
different story:

| | width 80 | at 6× width |
|---|---|---|
| parthian (talus + hit-and-run gene) vs talus | **58.5%** over 400, 95% 53.6–63.2 | 58.8% over 120 — same size, one match short of certifying |
| parthian vs quickdraw (no sweep at all) | **61.5%** over 400, 95% 56.6–66.1 | **60.8%** over 120, 95% 51.9–69.1 |

Two lessons. A real tactic keeps its effect size when the search widens —
hit-and-run held at ~58–59% where the selection tweaks collapsed. And the
sweep earns its keep at every width: even with half of quickdraw's gene
mass carrying shots, enough plans still forget to fire that removing the
floor costs ~11 points of share. Timing belongs in the genome; the
guarantee belongs in the floor; they compose rather than compete.

## What vanguard and bastion found, and the merge that retired them

Two more engines stood beside parthian for a while, each an ablation of
it: **vanguard** added the press family (shootAdvance, shootBlock,
stormCapture — hit-and-run's siblings, one per way to spend the movement
a sweep-only shot leaves dead), and **bastion** added a blockade gene
(stand on the hex that denies the enemy the most path — the word the
water-choke retreat board's autopsy showed the vocabulary was missing).
Neither had a finished tournament verdict; vanguard's own header ended
"the verdict on whether they PAY is the tournament's, as always."

Both were folded into parthian directly rather than measured to a verdict
first — on instruction, not on a result — and blockade was then removed
again the same day, also on instruction. `waterChoke.test.ts` is the
closest thing to a measurement that exists for the merge, and its story
has a twist worth keeping:

| board | plain parthian | merged, with blockade | merged, blockade removed (current) |
|---|---|---|---|
| water choke (hold the formation) | 6/6 | 3/6 | **2/6 — regressed** |
| the retreat (walk back and shut the door) | 0/6 (bastion alone: 2/6) | 5/6 | **4/6** |
| the twin pass (compose two bodies) | 0/6 (bastion alone: 3/6) | 4/6 | **4/6** |

The twist: blockade was the obvious suspect for the choke regression, and
removing it changed nothing there (3/6 vs 2/6 is dice) — the press family
itself is what competes with the choke's precise two-hex-back shelling
formation. Meanwhile the retreat and twin gains **survive** blockade's
removal, so the press family alone lifted the two boards the blockade
gene's own autopsy was written about. The choke regression was not tuned
away; `waterChoke.test.ts`'s gate was lowered to the measured floor and
says so. A future weight pass could try to recover the formation-holding
ground without giving back the retreat and twin gains, but nothing here
has tried yet.

## Adding a variant

1. Copy `engines/baseline.ts`, change the `id`, `name`, `notes` and whatever
   values the hypothesis is about. Copy the whole options block rather than
   spreading baseline's — the diff between two engine files should be
   readable in one screen. (An **ablation** is the exception: spread the
   engine under test's options on purpose, because there the two must be
   provably identical apart from the one value being measured. Once the
   measurement is in, retire the ablation engine and inline its winning
   value into whichever engine keeps it — see parthian.ts's header for an
   example of a whole retired chain folded into one file.)
2. Change **one thing**, or accept that the result will not say which change
   did it. Wolfpack (see the table below) changed seven and was unreadable
   even before it turned out to be noise.
3. Keep the **search budget** comparable, and read the tournament's compute
   line before believing a win. An engine that simply thinks longer wins for
   an uninteresting reason. Where a challenger deliberately spends more —
   Gambit did — say so in its header and treat the cost as part of the
   result.
4. Register it in `engineRegistry.ts`.

A different **search algorithm** goes in `planners/` and is attached with
`planner:`. It receives the same `PlanTurnOptions` bundle; put its own
settings in a namespaced field (`beam`), and let a budget override only the
part that is genuinely a budget — width, never depth.

A new **gene** goes in `genes/`, implements `GeneDefinition`, and is listed
in the engine's `dialect.weights` and `dialect.extras`. Any movement it does
must go through `recordSimMove` or a unit that steps onto an enemy building
will not capture it. Engines that do not register the kind treat it as a
no-op rather than an error, so a plan can cross between engines safely.

A new **skill** (a `SkillDef` on a unit type) does NOT need a new gene or a
dialect edit: `genes/useSkill.ts` is one dialect word that delegates to
every skill-backed gene (burn, repair, load, unload -- add yours to its
`SKILL_GENES` table). It exists because the per-skill wiring failed in
practice: the burn gene fell out of every dialect when the engine roster
was flattened, and the AI silently lost arson -- see `fireGrove.test.ts`
for the exam that caught it.

**Frozen-future foresight** (`PlanTurnOptions.foresight`, implemented in
`simJob.frozenFutureValue`) is how a depth-3 beam sees payoffs that need
many turns but no decisions: every scored board with fire on it is also
scored ~20 decision-free turns ahead (fire spreads, standing units burn,
nobody moves) and the future blends in at half weight. Quiescence for
physics. It is what turned the grove exam from 0/6 to a real gate -- the
shipped engine now opens with the ignition, steps away from its own fire,
and burns the artillery to death -- and it is free on fireless boards
(guarded on `hasFire`), which the choke suite and neutrality fixture
confirm by not moving at all.

## Running matches

```bash
npm run tournament
```

```bash
ROUNDS=200 ENGINES=baseline:parthian MAP=rotor12x18 npm run tournament
```

`ROUNDS` counts **seed pairs**: each is played twice with the seats swapped,
so the first-mover advantage lands on both engines equally and cancels.
`ROUNDS=200` is 400 matches.

The report ends in a verdict rather than a win count, because a 12–8 result
is what a coin flip does one time in four. It prints a 95% Wilson interval
on the leader's share and says plainly when the sample cannot tell the two
engines apart. It also prints how much wall-clock each side spent thinking:
a large gap there invalidates the comparison however clean the win column
looks.

`BUDGET_SCALE=2` doubles the batch search budget for a slower, stronger
run — hillclimb dials only. `BEAM_SCALE=6` scales beam width the same way
(the first engine's own childCounts, applied to both seats), which is how
the wide rows in the table above were played.

## Playing a variant in the browser

```
?ai=baseline              both CPU sides play the control instead
?ai=baseline:parthian     one engine per side
```

The default is **parthian** — chosen on the measured results above: it
beat the previous default at batch width and held the same effect size at
six times the width, which is the signature of a real tactic rather than
a selection artifact. It carries spread sacrifice slots (inlined from the
retired talus ablation), so the live game runs its levels two-phase:
metadata first, selection in the planner, then a recompute of just the
picked children by absolute index — proven event-identical to the serial
planner in beamParallel.test.ts. Its custom genes (hit-and-run and the
press family) cross to the workers by name through genes/registry.ts,
like every custom gene.
