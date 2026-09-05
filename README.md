# VibeWars

A browser strategy game on a destructible hex grid, with Three.js rendering and
AI opponents that search complete turns in Web Workers.

[Play VibeWars](https://asynkron.github.io/VibeWars/)

## Run and verify

```bash
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript checks |
| `npm test` | Gameplay, map, rendering-resource and UI regression tests |
| `npm run build` | Build all three entry points into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run simulate` | Headless AI matches; configure `MATCHES` |
| `npm run tournament` | Engine comparisons; configure `ROUNDS` |
| `npm run capture:view1` | Capture the fixed map with frozen animation clocks |
| `BENCH=fast npm test -- perfBench --disable-console-intercept` | Planner timing and event digests |

The project uses TypeScript, Vite, Vitest and the npm `three` package. The engine's
remaining `THREE` global is assembled by `src/threeGlobal.ts`; it is not a CDN
script. Tests that need geometry use real Three.js objects. The permissive stub
in `src/test/threeStub.ts` supports imports in tests that do not render.

GitHub Actions runs typecheck, tests and build before publishing pushes to `main`
to Pages. Relative asset paths allow deployment beneath a project subpath.

## Playing and inspecting

The start menu selects the map, opponent mode and difficulty. Match links use
`?map=crown14&mode=human-cpu&difficulty=low`. Modes are `human-cpu`, `cpu-cpu`
and `human-human`; difficulty is `low`, `medium` or `hard`. `?ai=baseline` selects
an engine for both CPU sides; `?ai=baseline:parthian` selects them separately.

Click a friendly unit to select it, then a reachable tile to move or an enemy to
attack. The skill bar exposes special actions. Next Unit cycles selection; End
Turn passes control. Drag to pan, right-drag to rotate and scroll to zoom. Enable
the minimap in the toolbar to navigate by clicking or dragging it.

The toolbar also controls the grid, procedural texture detail, bloom, grass and
frame statistics. Display preferences persist locally. Two additional pages reuse
the production rendering code:

- `terrain.html`: terrain inspection without units or turns.
- `trees.html`: procedural tree controls with orbit and zoom.

## Code structure

| Location | Responsibility |
| --- | --- |
| `src/game.ts` | Startup, match setup and input wiring |
| `src/render.ts` | Scene, cameras, postprocessing and frame loop |
| `src/shared/hexengine/` | Live rendering, units, terrain and shared rule tables |
| `src/systems/` | Turn lifecycle, HUD, skill bar, minimap and view toolbar |
| `src/systems/maps/` | Authored maps, random generation, buildings and starting rosters |
| `src/systems/sim/` | Render-free state, commands, combat resolution and headless matches |
| `src/systems/sim/ai/` | Engines, genes, planners and worker pool |
| `src/reference/feint0805/` | Frozen Feint benchmark implementation; see its README before editing |
| `public/assets/` | Unit/building models, textures and sounds |

Three authored maps share `rotationalMap.ts`: layout validation, roads, spawn
rotation, coherent relief and shore ramps. Map-specific data preserves their
rosters, mountain scale and factory/depot pads. All map assembly goes through
`generateMap`, which applies building foundations after generating terrain.

The map registry includes four symmetric authored maps (`mirror8`, `rotor12x18`,
`ford10`, `crown14`), random maps at three sizes, the seeded `random30fixed` map,
and tactical scenarios. The default map is `rotor12x18`. Random maps sample
Perlin noise at a new offset each match; the fixed provider restarts the same
seeded generator for repeatable comparisons.

## Gameplay contract

The AI plans against `SimState`, then replays resolved `GameEvent` facts against
the live game. Damage, terrain changes and other random outcomes are resolved
before replay; animation does not roll a second outcome. Forks share immutable
base data and retain their own events and overrides.

Rule tables and coordinate math are available without rendering dependencies.
The worker-safety test walks the real import graph to prevent renderer imports
from entering AI workers. Scenery and fire simulation share the same per-tile
random stream so burnable vegetation agrees with what the player sees.

Important invariants:

- Coordinates use **odd-q offset** hexes. Half-turn symmetry requires an even
  column count; a north/south reflection does not preserve adjacency.
- Roads discount passable ground to 0.5 movement. They do not open impassable
  terrain, and aircraft and naval units receive no road discount.
- Movement and actions are separate resources. Skills own their action costs,
  cooldowns and movement-ending rules in both simulation and live execution.
- Artillery can lower terrain into water. Units that cannot survive the new
  terrain drown. Combat also applies class matchups and health-scaled damage.
- Infantry captures buildings through their entrances. Grouped depot pieces
  share ownership and yield their hidden prize once. HQs, production, fire,
  transport and vital-unit defeat rules apply in both game modes.

The registered engines are baseline, parthian (default) and frozen Feint. Engine
budgets and strategy are separate. Tournaments swap seats for each seed and
report confidence intervals and compute parity. See
[src/systems/sim/ai/README.md](src/systems/sim/ai/README.md) for engine development.

## Rendering and regression checks

Terrain, roads and vegetation use small disposable geometry chunks. Editable
tiles remain authoritative; terrain and vegetation updates visit only affected
chunks. Shared geometry helpers preserve source assets when rebuilding caches.
Projectile animations share one flight implementation, reuse scratch objects
and own their fading materials while retaining cached geometry and textures.
Effect lights come from a fixed pool; overlapping effects must work when it is
exhausted. Shadows and water reflections refresh when relevant scene state changes.

Tests include authored-map fairness and exact board fingerprints, deterministic
headless-match digests, live/simulation rule parity, worker isolation, geometry
transforms and resource ownership, projectile lifecycle, skill selection and
minimap coordinates. A cleanup must preserve the existing match digests; change
fixtures only when a gameplay change is intentional and independently verified.

`npm run capture:view1` also fails on browser initialization or asset errors.
The `compare:view1:*` and `optimize:view1:*` scripts support visual calibration;
use the fixed map and frozen animation clocks for meaningful comparisons.

## License

Apache 2.0 — see [LICENSE](LICENSE).
