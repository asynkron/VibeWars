# VibeWars

A hex-grid turn-based strategy game that runs entirely in the browser — terrain, units,
destructible ground and an AI opponent that searches whole turns in Web Workers. No server, no
backend, no runtime dependencies.

**Play it: https://asynkron.github.io/VibeWars/**

It began as a proof of concept: a strategy game written end to end by an AI coding agent. It has
since grown into ~24k lines of TypeScript with 508 tests, and the code is unusually heavily
commented — most non-obvious decisions carry the measurement or the bug that forced them.

---

## Quick start

```bash
npm ci
```

```bash
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | Static build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | The full suite (37 files, 508 tests) |
| `npm run simulate` | `MATCHES=10` headless AI-vs-AI matches, prints win rates |
| `npm run tournament` | `ROUNDS=20` engine-vs-engine, prints a Wilson interval verdict |

Match setup rides in the query string: `?map=crown14&mode=human-vs-ai&ai=feint`.

---

## Tech

| | |
| --- | --- |
| **Language** | TypeScript 7 (strict), ES2020, bundler resolution |
| **Build** | Vite 8 → static files. `base: './'` so the build works under a project-site path |
| **Rendering** | Three.js **r128, loaded as a CDN global** — 18 `<script>` tags in `index.html`, typed as `declare const THREE: any` in `src/global.d.ts` |
| **Runtime deps** | **Zero.** `package.json` has no `dependencies` key; the four devDependencies are vite, vitest, typescript, jsdom |
| **Tests** | Vitest 4 + jsdom, with a stub standing in for the `THREE` global |
| **Concurrency** | Web Workers (`type: 'module'`) for AI search |
| **CI/CD** | GitHub Actions: every push to `main` runs typecheck + tests before building and publishing to Pages |

Three.js is a CDN global rather than an npm package, which is why nothing imports it and why the
test suite needs `src/test/threeStub.ts`. It is the single most surprising thing about the codebase.

---

## Architecture

Three layers, and one contract that ties them together.

```
  src/shared/hexengine/     the live game: Three.js rendering + the rule tables
            │                (38 files — GridSystem, TerrainSystem, UnitSystem, BuildingSystem …)
            │
            │  rule tables extracted into import-free modules
            │  (unitStats, terrainStats, skills, hexMath, priorityQueue)
            ▼
  src/systems/sim/          a pure, render-free model of those same rules
            │                SimState = frozen base + append-only event log
            │
            │  plans are searched here, then REPLAYED against the live game
            ▼
  src/systems/sim/ai/       turn planning: genes, engines, beam search, worker pool
```

### The resolve-first replay contract

The AI does not tell the game *what it wants to do*. It searches a plan, and the plan **is** a list
of `GameEvent`s carrying already-resolved facts — the exact damage, the exact crater hexes — which
are then replayed against the live board with animations.

That single decision explains most of the design:

- **All randomness is resolved up front** (`resolveAttack.ts`). Events carry outcomes, never dice.
- **`SimState.apply()` stays mechanical** and derives nothing. A lethal `unitAttacked` drives hp
  negative and stops; the separate `unitDied` is recorded by the command layer. Anything derived
  inside `apply` would be derived once in the sim and never in the live game.
- **The two sides cannot drift silently.** The live game imports `SPLASH_FACTOR`, `CRATER_DELTA` and
  `ROCKET_COUNT` straight out of the simulation's resolver.

Nine event variants exist: `unitMoved`, `unitAttacked`, `unitDied`, `unitRepaired`, `unitLoaded`,
`unitUnloaded`, `terrainModified`, `buildingCaptured`, `turnStarted`.

`fork()` shares the base arrays by reference and copies only the log and the override maps — which
is what makes hundreds of candidate branches per turn affordable, and it matters because **terrain
is destructible**, so the map itself is branchable state.

### The AI

A turn plan is an ordered list of **genes**, one action per unit — 7 builtin kinds (`moveTowards`,
`moveAway`, `moveRandom`, `moveToBuilding`, `standoff`, `attack`, `idle`) plus 8 that engines
register (`regroup`, `screen`, `mend`, `sink`, `holdDoor`, `repair`, `load`, `unload`). Moving and
attacking are separate per-turn resources, so a unit can move → move → attack in one turn.

Two search algorithms:

- **Hillclimb** (`search.ts`) — an evolutionary loop, population 24 over 4 rounds, cheap 2-ply
  rollouts then a deeper finalist stage.
- **Beam** (`ai/planners/beam.ts`) — a tree over whole turns, alternating sides by depth. It keeps
  the *worst*-scoring children alongside the best at its own levels, and only the depth-0 turn is
  ever returned for execution.

An **engine** is a named bundle of score weights, gene dialect, mutation rates and budget. Eleven
are registered; the default is **feint** (beam, depth 3). Nine of them fan child generation out to a
`SimWorkerPool` of up to 8 module workers.

A constraint worth knowing: **no skill may have a cooldown longer than the default engine is deep**,
or the AI cannot see the skill come back. Feint plays at depth 3, and Pike's Repair sits at exactly
cooldown 3.

Engines are compared by `runTournament`, which plays every seed **twice with the seats swapped**
(player 0 moves first), scores chess-style, and reports a **95% Wilson interval** on the point share
plus a compute-parity ratio — so an engine that merely thinks longer cannot win quietly. When the
interval still spans 50% it prints *"no measurable difference"* rather than naming a winner.

### Why the rule tables are import-free

`unitStats.ts`, `terrainStats.ts`, `skills.ts`, `hexMath.ts` and `priorityQueue.ts` were split out
of the renderer classes so the AI can run in a Worker with no canvas. The old classes re-export
every name, so no call site changed. `workerSafety.test.ts` walks the *real* static import graph
from 8 sim entry points against a 17-name forbidden list and fails with the exact offending chain.

---

## Game rules

**Coordinates.** Odd-q offset, flat-top hexes. Neighbour offsets depend on column parity, and
distance requires converting to cube first — a cube formula applied directly to offset coordinates
undercounts across a column shift.

**Units.** 12 types across 6 classes — infantry (Road, Pike), tank (Bulwark, Sabre, Drover, Lynx),
artillery (Kestrel, Mortar), aa (Halberd), air (Nightjar, Shrike), naval (Gunboat).

**Matchups** are a triangle: `aa → air ×2.0`, `tank → aa ×2.0`, `air → tank ×2.0`, each with the
reverse at ×0.5. Artillery, infantry and naval fight everything at ×1.0. On top of the multipliers
there is a hard rule: **artillery and infantry cannot target air at all.**

**Movement** is per unit type, not per terrain: each unit carries a `terrainCosts` map where `null`
means impassable. Pike is the only *ground* unit that can cross mountains; Gunboat is water-only;
the two aircraft pay 1 everywhere. A road costs a flat **0.5 for everyone** — checked before the
unit's own costs.

**Terrain is destructible.** Artillery craters lower tiles by 0.1 per rocket, and a tile that sinks
to the water level converts to water and drowns whoever cannot swim. Craters are deliberately
shallow — roughly ten hits on the same tile to flood it — so the map does not become open sea after
every artillery duel.

**Buildings** are captured by walking infantry onto the door. A composite depot is four pieces
sharing a `groupId` with exactly one entrance; capturing flips all four but yields the hidden prize
only once. The search is never shown *which* unit is hidden — it prices a capture at a flat 150.

**Skills.** Every attack is a skill (`SkillDef`: target rules, range, cooldown, whether it spends
the action or ends movement). Non-attack skills include Pike's Repair and the Drover's Load/Unload.
The cost is charged inside `apply()`, so a simulated cast, a replayed cast and a player's cast all
charge identically.

---

## Maps

Seven providers behind one `MapProvider` interface. A provider owns everything that makes a map
playable: dimensions, tiles, baked roads, both sides' starting units and the neutral buildings.

| Key | Name | Size | Per side |
| --- | --- | --- | --- |
| `mirror8` | Twin Ridge | 8×8 | 5 |
| `rotor12x18` | Half Turn | 12×18 | 5 *(default)* |
| `ford10` | Two Fords | 10×10 | 5 |
| `crown14` | Crown | 14×14 | 5 |
| `random20` | Random — Small | 20×20 | 3 |
| `random30` | Random — Medium | 30×30 | 5 |
| `random50` | Random — Large | 50×50 | 10 |

**The authored maps are rotations, not mirrors.** Only the northern half is authored; the south is
generated as its 180° rotation `(q, r) → (cols-1-q, rows-1-r)`. A north/south mirror is *not* an
isometry of an odd-q grid, because neighbour offsets depend on column parity — the half turn is one
only when `COLS` is even. Changing a map's width to an odd number silently breaks fairness.

Heights on three of the four come from a shared, import-free three-octave value-noise field
symmetrised by averaging `f(q,r)` with `f(cols-1-q, rows-1-r)`. That is bit-exact rather than
approximate, because two-term float addition is commutative and halving is exact in binary — so the
test asserts equality, not closeness.

The random maps use Perlin noise with a **fixed** permutation table, so the terrain layout is the
same on every load; the small map is literally the top-left corner of the large one. What varies is
per-tile height jitter and the roads the live game sprinkles. They carry no fairness guarantee —
only that nothing is stranded, unreachable or overlapping.

---

## Rendering notes

- Terrain, roads, tank tracks and scenery use **no texture assets** — value noise and fbm injected
  through `onBeforeCompile`, and seeded PRNGs for placement. The look is chosen from the fragment's
  world Y, not the tile's material, so a hillside grades from grass to rock to snow by itself.
- The hex grid overlay is drawn *in the terrain shader*, toggled through uniform objects every
  terrain material shares by reference — one write flips the whole map, no scene traversal.
- Post-processing is an `EffectComposer` with a `RenderPass` and one `UnrealBloomPass`, rendering
  into a **HalfFloat** target so values above 1.0 survive to be thresholded. Only two things are
  meant to bloom: the depot's energy panels and the shoreline surf.
- Shadows use VSM with `autoUpdate = false`, regenerated on demand or every third frame as a safety
  net.
- Scenery is procedural and instanced: 8 variants per kind built once and cloned, then merged to one
  mesh per tile.

---

## Testing

37 files, 508 tests (506 pass, 2 are batch reports gated behind env vars). The suite is not only
unit tests:

- **Fairness batteries** run 11 checks over every authored map — symmetry, determinism, identical
  rosters, every unit on ground it can stand on, every enemy reachable, identical capture costs for
  both sides, no road on water.
- **A committed digest fixture** (`neutrality.test.ts`) hashes the event stream of eight headless
  AI-vs-AI matches. Any change that alters play fails it, and the file's own instructions are to
  decide whether play was *supposed* to change before committing new numbers.
- **An import-graph guard** keeps the AI's dependencies canvas-free.
- **Headless full matches** and **real engine-vs-engine tournaments** under a tiny budget.

---

## Repo layout

```
index.html                 CDN script tags, inline CSS, one module entry
src/
  game.ts                  boot, start menu, input wiring
  render.ts                scene, camera, bloom chain, frame loop
  constants.ts             map sizes + config (import-free by necessity)
  shared/hexengine/        rendering + rule tables (38 files)
  systems/
    sim/                   event-sourced simulation
      ai/                  engines, genes, planners, worker pool
    maps/                  7 map providers + registry
    *.ts                   GameState, skill bar, HUD, view toolbar
public/assets/             models (.glb), textures, sounds
```

`src/systems/sim/ai/README.md` documents the engine layer in more depth — how to add an engine and
how to run a tournament.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
