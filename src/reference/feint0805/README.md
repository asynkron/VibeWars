# FROZEN REFERENCE — do not edit anything in this folder

The complete Feint engine exactly as it stood in commit
`d781f2cd8a530a70da62cde096973288a5ad811f` (2026-08-06, "The Pyramid is
vital"), the last commit before the engine flatten and everything that
followed (useSkill, frozen-future foresight, factory production, the
aggression-term removal).

Every `.ts` file here is a **byte-exact** `git show` of that commit — all
of `feint.ts`'s transitive dependency closure (its own SimState,
SimCommands, score, search, planners, genes, worker — everything),
extracted with the directory structure preserved so every relative import
resolves *inside this folder*. Nothing here imports the live codebase;
nothing here may be edited, formatted, or "fixed". It exists to be a
fixed point: an opponent and a reading reference the current engine can
always be measured against.

**The one sanctioned exception: `shared/hexengine/unitStats.ts`.** Unit
stats are the WORLD MODEL, not the engine — a frozen brain planning with
stale stats is not a reference, it is an engine playing the wrong game.
That file is kept as a byte-copy of the LIVE
`src/shared/hexengine/unitStats.ts` (never a live import — the isolation
stands), and must be re-copied whenever unit balance changes:

```bash
cp src/shared/hexengine/unitStats.ts src/reference/feint0805/shared/hexengine/unitStats.ts
```

Everything else stays frozen at the commit above.

The only sanctioned connection to the live game is the adapter OUTSIDE
this folder (`src/systems/sim/ai/engines/feintReference.ts`), which
imports `feintEngine` from here and registers it as the engine id
`feint`. If the adapter needs glue, the glue goes in the adapter.

To re-verify byte-exactness:

```bash
git show d781f2c:src/systems/sim/ai/engines/feint.ts | diff - src/reference/feint0805/systems/sim/ai/engines/feint.ts
```

(and likewise for any other file; the path under this folder mirrors the
path under `src/` at that commit).
