# AI engines

An **engine** is one complete way of playing: how it values a board, which
genes it can express, how it mutates plans, how hard it searches. Two
engines can be instantiated side by side and play each other, which is the
only honest way to decide whether a tweak was an improvement.

```
AIEngine.ts          the interface + createEngine + withBudget
engineRegistry.ts    id -> engine, used by both the game and the tournament
engines/baseline.ts  the AI as shipped -- the control
engines/wolfpack.ts  the challenger: a copy of baseline.ts with edits
genes/regroup.ts     a gene only wolfpack registers
tournament.ts        seed pairs played from both seatings + significance test
```

The machinery still lives in `../search.ts`, `../score.ts` and
`../SimCommands.ts`. What moved into an engine is the **values** — which is
exactly the part a variant needs to own.

## Adding a variant

1. Copy `engines/baseline.ts`, change the `id`, `name`, `notes` and whatever
   values the hypothesis is about. Copy the whole options block rather than
   spreading baseline's — the diff between two engine files should be
   readable in one screen.
2. Keep the **search budget** (`population`, `rounds`, `lookaheadPlies`,
   `replyCandidates`, `finalists`, `deepPlies`, `replyPopulation`,
   `replyRounds`) identical to baseline's. An engine that simply thinks
   longer wins for an uninteresting reason, and `AIEngine.test.ts` enforces
   this for the engines that ship.
3. Register it in `engineRegistry.ts`.

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

`BUDGET_SCALE=2` doubles the batch search budget for a slower, stronger run.

## Playing a variant in the browser

```
?ai=wolfpack             both CPU sides use it
?ai=baseline:wolfpack    one engine per side
```
