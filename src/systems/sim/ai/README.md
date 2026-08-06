# AI engines

An **engine** is one complete way of playing: how it values a board, which
genes it can express, how it mutates plans, how hard it searches. Two
engines can be instantiated side by side and play each other, which is the
only honest way to decide whether a tweak was an improvement.

```
AIEngine.ts          the interface + createEngine + withBudget
engineRegistry.ts    id -> engine, used by both the game and the tournament
engines/baseline.ts  the AI as originally shipped -- the control
engines/wolfpack.ts  a challenger: baseline with different weights + a gene
engines/gambit.ts    a challenger that changes the SEARCH, not the weights
engines/feint.ts     gambit at depth 3 -- the ablation that held the default
engines/mirage.ts    feint with duplicate child outcomes collapsed
engines/talus.ts     feint with spread sacrifice slots
engines/parthian.ts  talus + the hit-and-run gene -- now the default
engines/quickdraw.ts parthian with NO sweep -- the refuted counter-hypothesis
genes/hitAndRun.ts   step into the bracket, shoot, fall back out of reach
genes/regroup.ts     a gene only wolfpack registers
planners/beam.ts     a beam tree search, used by every feint-family engine
tournament.ts        seed pairs played from both seatings + significance test
```

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

## Adding a variant

1. Copy `engines/baseline.ts`, change the `id`, `name`, `notes` and whatever
   values the hypothesis is about. Copy the whole options block rather than
   spreading baseline's — the diff between two engine files should be
   readable in one screen. (An **ablation** is the exception: `feint.ts`
   spreads gambit's options on purpose, because there the two must be
   provably identical apart from the one value under test.)
2. Change **one thing**, or accept that the result will not say which change
   did it. Wolfpack changed seven and was unreadable even before it turned
   out to be noise.
3. Keep the **search budget** comparable, and read the tournament's compute
   line before believing a win. An engine that simply thinks longer wins for
   an uninteresting reason. Where a challenger deliberately spends more —
   Gambit does — say so in its header and treat the cost as part of the
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

## Running matches

```bash
npm run tournament
```

```bash
ROUNDS=200 ENGINES=baseline:wolfpack MAP=rotor12x18 npm run tournament
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
?ai=gambit               both CPU sides use it
?ai=baseline:feint       one engine per side
```

The default is **parthian** — chosen on the measured results above: it
beat the previous default at batch width and held the same effect size at
six times the width, which is the signature of a real tactic rather than
a selection artifact. It inherits talus's spread sacrifice slots, so the
live game runs its levels two-phase: metadata first, selection in the
planner, then a recompute of just the picked children by absolute index —
proven event-identical to the serial planner in beamParallel.test.ts. Its
hit-and-run gene crosses to the workers by name through genes/registry.ts,
like every custom gene.
