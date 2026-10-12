> Historical; superseded by V1_1_PLAN.md, V1_PLAN.md and the module READMEs.

# SHADY: Technical Architecture and Spec v1.0

This spec matches the existing scaffold in `/home/user/NewGame`:
- Vite 8.3.4 (`base: './'`), TypeScript 6.0.2 (strict), Vitest 5.0.3 (`tests/unit/**/*.test.ts`, node environment), Playwright 1.56.1 (`tests/e2e`, projects `mobile` = Pixel 7 Chromium and `desktop` = Desktop Chrome, webServer build+preview on port 4173).
- Node 22.22. `build:single` is `vite build --mode single --outDir dist-single && node scripts/inline-build.mjs dist-single` (§14.1).
- **No runtime dependencies.**

---

## 0. Ground rules

1. **Layering.** `src/config` → `src/core` (pure, deterministic) → `src/meta` → `src/render`, `src/audio`, `src/ui` (side effects) → `src/game` (orchestration, with `main.ts`); `src/platform` holds the browser and native seams.
   - `config` imports nothing; `core` imports only `core` and `config`.
   - `platform` imports only `platform`.
   - `meta` imports `meta`, `core`, `config`, `platform`.
   - `ui` imports `ui`, `meta`, `core`, `config`, `platform`.
   - `audio` imports `audio`, `core`, `config`, `platform`.
   - `render` imports `render`, `core`, `config`, `meta`, `platform`, plus the allowlisted `../game/camera.ts` and `../game/assist.ts`.
   - `game` and `main.ts` may import anything.
   - `tests/unit/architecture.test.ts` (§16.1) enforces the whole table on every layer, reading imports with a TypeScript scanner (type-only and dynamic imports count). Any exception is listed in the test by file, with its owner.
2. **Determinism.** Everything in `src/core` must be bit-for-bit reproducible across engines (V8, JavaScriptCore, Node):
   - **Forbidden in core and config** (same test, on code with comments, strings and template text removed): `Math.random`, `Date`, `performance`, `Math.sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt`, the hyperbolic and `log2|log10|log1p|expm1` functions, the `**` operator, `toFixed`, `toPrecision`, `toExponential`, `toLocale*`, `parseFloat`, `Intl`, `crypto`, `globalThis`, `self`, `window`, `document`, `localStorage`, `Float32Array`. Use `dmath.ts` instead.
   - **Allowed:** `+ − * /`, `Math.sqrt`, `Math.abs`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.trunc`, `Math.min`, `Math.max`, `Math.sign`, `Math.imul`, and `Float64Array`/`Int32Array`/`Uint8Array`/`Uint32Array`.
   - These are IEEE-754 exact or integer operations, so results match across devices. `Array.prototype.sort` is stable; sort comparators must be total.
3. **Imports use explicit `.ts` extensions** (for example `import { step } from './step.ts'`) so `scripts/*.ts` run directly with Node's built-in type stripping. tsconfig additions:
   ```json
   "allowImportingTsExtensions": true,
   "erasableSyntaxOnly": true
   ```
   Add `"scripts"` to `include`. Because of `erasableSyntaxOnly`: no `enum`, no `namespace`, no parameter properties. Use string-literal unions and `as const` objects.
4. **One source of tuning truth:** `src/config/tuning.ts` (a frozen object `TUNING`) and `src/config/days.ts` (the day table, `dayParams(day, charm)`). Every number in the GDD lives there.

---

## 1. Folder and module layout

```
index.html                     canvas#game + div#ui + safe-area probe; viewport-fit=cover; manifest link
vite.config.ts                 existing + shadySW() plugin (emits sw.js at build)
public/
  manifest.webmanifest
  icons/ icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png favicon.svg icon-1024.png
scripts/
  inline-build.mjs             (exists)
  sim.ts                       headless bots + validator stats  (node scripts/sim.ts)
  golden.ts                    writes tests/golden/hashes.json
  gen-icons.ts                 rasterizes src/render/iconSvg.ts via Playwright Chromium
src/
  main.ts                      boot: load save, create subsystems, start loop, register SW
  config/
    tuning.ts                  TUNING constants
    days.ts                    DAY_TABLE, dayParams(), cloud/balloon/ball schedules
    content.ts                 caster catalog, name lists, cosmetics, charms, missions, achievements (pure data)
  core/
    dmath.ts                   deterministic trig: dsin dcos dtan datan2 dacos + degree helpers, sun-vector table
    rng.ts                     hashString (xmur3), splitmix32, mulberry32, Rng class, rngFor(seed, ...keys)
    geom.ts                    convex hull (monotone chain), point-in-convex, segment-vs-convex, poly ops, smoothstep
    clock.ts                   day/time math: dayLength, nightLength, elevation, yAtTime/timeAtY, minutes, formatClock
    trail.ts                   control points, Catmull-Rom trailX(y), branchOffset(y, fork, side), polyline sampling
    shadows.ts                 litWeight(), isShadedBy*(), partShadowPolygon() (render), glare center
    intervals.ts               per-point angular shade masks (360 bins) for validator / guide / bots
    gen/
      catalog.ts               builds Caster parts from kind + position + rotation
      placer.ts                chunk caster placement, forks, pickups, floaters, gazing balls, tutorial overrides
      validator.ts             DP reachability, rescues, demand rule, lane validation
      world.ts                 WorldStore (chunks, active windows, spatial buckets), ensureGenerated()
    sim/
      types.ts                 SimState, InputFrame, SimEvent, RunConfig, RunStats, DeathInfo
      create.ts                createRun(cfg)
      step.ts                  step(state, input) – orchestrates the sub-steps below
      sun.ts                   sun control: follow/inertia/catch/detent
      nubs.ts                  coverage, chill, multiplier, PHEW, parasol, hour log, history
      pickups.ts               melting + collection
      forks.ts                 preview/lock
      guide.ts                 guide masks (now, +0.6 s) every 6 ticks
      deathcause.ts            death line selection
      hash.ts                  hashState() FNV-1a over canonical fields
    score/
      share.ts                 hour glyphs, share text builders, formatTime
      challenge.ts             encode/decode challenge codes (base64url JSON)
    meta/
      missions.ts              pure mission progress from RunStats + events
      achievements.ts          pure achievement checks
      daily.ts                 dailyNumber(date), dailySeed(date), dailyCharm(n)
    replay.ts                  InputFrame recording, RLE encode/decode, replay runner
    bots.ts                    idle / novice / reactive / oracle bots -> InputFrame
  game/
    loop.ts                    rAF fixed-step accumulator, timescale, hit-stop, interpolation alpha
    session.ts                 owns SimState; run lifecycle; routes events to fx/audio/haptics/meta/ui
    input.ts                   Pointer Events + keyboard -> per-step InputFrames
    camera.ts                  view metrics, world->screen transform, shake, zoom pulses
    fx.ts                      event -> particles, rings, text pops, slow-mo, vignettes
    perf.ts                    frame-time governor (DPR / particle caps)
    debug.ts                   URL params, debug overlay, window.__SHADY_TEST__
  render/
    canvas.ts                  canvas sizing, DPR cap, letterbox, safe-area insets
    palette.ts                 time-of-day LUT, material tinting
    sprites.ts                 pre-rendered glow/bloom/flake/sparkle sprites, ground tiles
    ground.ts trail.ts shadowLayer.ts casters.ts nubs.ts floaters.ts pickups.ts
    particles.ts               pooled SoA particle system (400) + rings (16) + text pops (12)
    sunDial.ts                 sun glyph + face, dial path, ticks, safe-arc guide, moon
    hud.ts                     time readout, ruler + flags, snow/multiplier, pause icon hit-rect, chill ring
    meltMap.ts                 results map view
    postcard.ts                1080x1920 PNG composer
    iconSvg.ts                 pure SVG string builder for app icons
    renderer.ts                frame orchestration and draw order
  audio/
    engine.ts                  AudioContext, buses, unlock, noise buffers, suspend/resume
    recipes.ts                 one function per sound recipe (GDD §12)
    music.ts                   16th-note scheduler, pad, arpeggio, ambience, key system, melody recorder
    sfxRouter.ts               SimEvent -> recipes with throttles; continuous params per frame
  platform/
    storage.ts                 StorageAdapter (localStorage + memory fallback; Capacitor later)
    haptics.ts                 Haptics interface: WebVibrate / Null / (Native later)
    share.ts                   navigator.share / clipboard / download fallbacks
    pwa.ts                     service worker registration
    lifecycle.ts               visibilitychange, pagehide, blur, orientation
    safeArea.ts                reads env(safe-area-inset-*) via probe element
    native.ts                  isNative() (Capacitor global detection) – adapters switch on it
  meta/
    save.ts                    SaveV1 schema, defaults, migrate(), SaveStore (debounced writes)
    progression.ts             applyRunResult(save, result) -> {save, toasts, unlocks}
  ui/
    ui.ts                      screen state machine + transitions
    dom.ts                     h() element helper, button factory
    ui.css
    screens/ title.ts pause.ts results.ts daily.ts wardrobe.ts charms.ts missions.ts atlas.ts settings.ts rotate.ts toast.ts
tests/
  unit/*.test.ts
  golden/hashes.json
  e2e/smoke.spec.ts layout.spec.ts
```

**package.json scripts to add:**
```json
"sim": "node scripts/sim.ts",
"sim:check": "node scripts/sim.ts --check --seeds 50 --days 8",
"golden": "node scripts/golden.ts",
"icons": "node scripts/gen-icons.ts",
"test:all": "npm run typecheck && npm test && npm run sim:check && npm run e2e"
```
Add `"engines": { "node": ">=22.18" }`.

---

## 2. Deterministic core

### 2.1 dmath.ts
- Range reduction is Cody-Waite: k = round(x · 2/π); r = (x − k·PIO2_HI) − k·PIO2_LO, with PIO2_HI = 1.5707963267341256 and PIO2_LO = 6.077100506506192e-11.
- Kernels on |r| ≤ π/4 are fdlibm's `__kernel_sin` and `__kernel_cos` polynomials (coefficients copied as literals). Quadrant selection uses k & 3.
- `dtan(x) = dsin(x)/dcos(x)`.
- `datan(x)` uses fdlibm's atan (reduction table atanhi/atanlo plus an 11-term polynomial). `datan2(y, x)` handles quadrants explicitly. `dacos(x) = datan2(sqrt(1−x²), x)` with x clamped to [−1, 1].
- **Degree helpers:** `sinD`, `cosD`, `tanD`, `atan2D` (result in [0, 360)), `wrapDeg`, `angleDiff(a, b)` (in (−180, 180]).
- **Tables built once at module load:** `SUN_COS[360]`, `SUN_SIN[360]` (1° bins) and `ROT15_COS/SIN[24]`.
- **Accuracy target:** |dsin − Math.sin| ≤ 2e-16·max(1, |x|) for |x| ≤ 1e4. This is tested, though determinism matters more than accuracy.

### 2.2 rng.ts
- `xmur3(str): () => uint32`.
- `splitmix32(a): uint32` mixer.
- `mulberry32(seed)` returns a generator object.
- `class Rng { next(): number /*[0,1)*/; int(lo, hi) /*inclusive*/; range(a, b); chance(p); pick<T>(arr) }`, where `next = mulberry32 >>> 0 / 2^32`.
- `rngFor(seed: number, ...keys: (string | number)[]): Rng` mixes the seed with `xmur3` of each key via splitmix32.
- **Streams:**

  | Stream | Used for |
  |---|---|
  | `rngFor(seed, 'trail')` | Control points (sequential) |
  | `rngFor(seed, 'chunk', k)` | Placement in chunk k |
  | `rngFor(seed, 'sky', day)` | Clouds and balloons |
  | `rngFor(seed, 'balls', day)` | Gazing balls |
  | `rngFor(seed, 'names', casterId)` | Caster names |
  | `rngFor(seed, 'fork', day, i)` | Fork Frost Lane side |
  | `rngFor(seed, 'flakes', k)` | Flake clusters |

  Order of draws within a stream is part of the contract and is covered by golden hashes.

### 2.3 Fixed timestep
- `TICK_HZ = 60`, `DT = 1/60`. The sim only advances in whole ticks.
- Slow-mo and hit-stop change how many ticks run per real second, never DT.
- The guide and validator use 0.1 s steps = 6 ticks.

### 2.4 Input frames and replays
```ts
export interface InputFrame {
  dTheta: number;        // degrees requested this tick (already sign/sensitivity-applied), quantized to 1/1024°
  down: boolean;         // finger (or key) held during this tick
  release: number;       // release angular velocity °/s if the finger lifted this tick, else NaN
  key: -1 | 0 | 1;       // keyboard rotate direction (180°/s)
}
```
- A replay is `{ v: 1, cfg: RunConfig, frames }`. Frames are RLE-encoded as `[count, dThetaQ (int, 1/1024°), flags]` triples with flags bit0 = down, bit1 = has release; the release value is quantized to 1/64 °/s and stored separately.
- `replay.ts` has `record(frame)`, `encode()`, `decode()`, `runReplay(cfg, frames): SimState`.
- Tests replay a recorded run and compare `hashState`.

### 2.5 hashState
FNV-1a 32-bit (two lanes giving a 64-bit hex string) over the canonical number sequence:
- tick, tGlobal, day, nubs.y, nubs.x, nubs.lane, nubs.chill, nubs.mult, nubs.shadeTimer, sun.theta, sun.omega, run Snow;
- flakes taken/melted counts, caster count, rescue count;
- current chunk index, `world.lastValidatedChunk`.

Each float is written as its 8 IEEE bytes through a shared DataView.

---

## 3. Data model (src/core/sim/types.ts)

```ts
export type CharmId = 'none' | 'parasol' | 'sundog' | 'snowball' | 'longnight' | 'iceheart';
export type BiomeId = 'meadow' | 'oldtown';
export type CasterKind = 'hut'|'tree'|'oak'|'cottage'|'stone'|'hedge'|'house'|'arch'|'stall'|'column'|'wall'|'pedestal';

export type Part =
  | { t: 'prism'; pts: Float64Array; h: number }              // CCW world-space convex footprint (x0,y0,x1,y1,...)
  | { t: 'slab';  pts: Float64Array; z0: number; z1: number }
  | { t: 'disc';  cx: number; cy: number; r: number; z: number };

export interface Caster {
  id: number; kind: CasterKind; name: string; biome: BiomeId;
  x: number; y: number; rot: number;           // rot in 15° steps (index 0..23)
  parts: Part[];
  minX: number; maxX: number; minY: number; maxY: number; // ground AABB incl. discs
  maxZ: number;                                 // tallest part top, for reach culling
  rescue: boolean; gate: boolean;               // rescue tree / gate arch
  chunk: number;
}
export interface Floater {                      // cloud or balloon; position is analytic in time
  id: number; kind: 'cloud' | 'balloon'; t0: number; x0: number; y0: number;
  vx: number; vy: number; rx: number; ry: number; z: number; life: number;
  circles: Float64Array;                        // render-only lumps (dx,dy,r)*n, seeded
}
export interface GazingBall { id: number; x: number; y: number; name: string; casterId: number }
export interface Pickup {
  id: number; kind: 'flake' | 'crystal' | 'flower'; x: number; y: number;
  lane: -1 | 0 | 1;                              // 0 main; ±1 fork branch side
  melt: number; state: 0 | 1 | 2;               // alive / taken / melted
  day: number;
}
export interface Fork { id: number; yStart: number; frostSide: -1 | 1; preview: -1 | 1; locked: -1 | 0 | 1 }

export interface RunConfig {
  seed: number; mode: 'endless' | 'daily' | 'attract'; charm: CharmId;
  tutorial: boolean; gentle: boolean; guide: 'auto' | 'always' | 'off'; lifetimeRuns: number;
  theta0?: number; startDay?: number; startT?: number; startChill?: number; dailyDate?: string;
}
export interface SimState {
  cfg: RunConfig; tick: number; tGlobal: number;
  day: number; tDay: number; phase: 'hold' | 'day' | 'night' | 'dead';
  eps: number; tanEps: number; ux: number; uy: number;     // sun vector derived each tick
  sun: { theta: number; target: number; omega: number; down: boolean; detent: number; vel: Float64Array /*ring of last 8 θ deltas*/ };
  nubs: { y: number; x: number; lane: -1|0|1; chill: number; maxChill: number; f: number; glareW: number;
          litStreak: number; shadeTimer: number; mult: number; phewCd: number; parasol: number;
          lastShaderId: number; wasLit: boolean };
  world: WorldStore;
  stats: RunStats; hourLit: Float64Array /* 12 per day, grown per day */; hourHot: Uint8Array;
  history: Float64Array /* ring 1024×(x,y,chill) every 20 u */; historyLen: number;
  recent: Float64Array /* ring 90×(f, glareW, |dθ|, shaderId) for death cause */;
  guide: { now: Uint8Array; next: Uint8Array; tick: number };
  events: SimEvent[];   // cleared at start of each step
  death: DeathInfo | null;
}
export type SimEvent =
  | { e: 'detent'; dir: 1 | -1 } | { e: 'catch' }
  | { e: 'flake'; mult: number; degree: number } | { e: 'crystal'; mult: number } | { e: 'flower' }
  | { e: 'flakeMelt'; x: number; y: number }
  | { e: 'shadeEnter'; litFor: number } | { e: 'shadeExit' }
  | { e: 'multUp'; level: number } | { e: 'multReset' } | { e: 'phew' }
  | { e: 'forkPreview'; side: -1 | 1 } | { e: 'forkLock'; side: -1 | 1; frost: boolean }
  | { e: 'noonBanner' } | { e: 'noonPassed' } | { e: 'nightStart' } | { e: 'dawn'; day: number }
  | { e: 'cloudCapture'; id: number } | { e: 'glareTouch' } | { e: 'lowChill' }
  | { e: 'hourEnd'; day: number; hour: number } | { e: 'death'; info: DeathInfo };
export interface DeathInfo { day: number; minutes: number; x: number; y: number; cause: 'glare'|'longway'|'cloud'|'gap'|'plain'; line: string; lastName?: string; nextName?: string }
export interface RunStats { flakes: number; flakesMelted: number; crystals: number; flowers: number; phews: number;
  snow: number; maxMult: number; x5Hold: number; x5HoldBest: number; frostLanes: number; cloudRideBest: number;
  cloudRideCur: number; ballsPassedClean: number; ballGlared: boolean; gateNoon: boolean; longWay: boolean;
  litTotalToday: number; untouchableDay: boolean; minutes: number; dayReached: number }
```

**WorldStore** (`gen/world.ts`):
- `chunks: Chunk[]` (index k covers y ∈ [k·480, (k+1)·480)).
- `casters: Caster[]` sorted by y, plus `bucket: Map<number, Caster[]>` keyed by floor(y/120) for range queries.
- `floaters: Floater[]`, `balls: GazingBall[]`, `pickups: Pickup[]`, `forks: Fork[]`.
- `trail: TrailStore` holds `cps: Float64Array` of control-point x values (control point i sits at y = −600 + 120·i) and `forcedRanges`.
- Status fields: `placedThrough` (chunk index), `validatedThrough`, `dpCarry: Float64Array(360)`, `rescueCount`, `rescueSide`.

Pruning: the active caster window is y ∈ [nubs.y − 700, nubs.y + 1600]; objects behind y − 900 are pruned.

---

## 4. Simulation step order (src/core/sim/step.ts)

`step(s, input)`, one tick:
1. `s.events.length = 0`. If `phase === 'dead'`, return.
2. **Sun** (`sun.ts`); see §5.
3. **Clock**:
   - Skipped in `phase === 'hold'`, which is attract/daily-ready: the clock is frozen until the first frame with `down && dTheta !== 0`, then phase becomes `'day'`.
   - Otherwise `tGlobal += DT` and `(day, tDay, phase)` are derived via `clock.ts`.
   - `eps`, `tanEps` and the sun vector `ux, uy` (from θ via `cosD`, `sinD`) are updated.
   - Events fire on transitions: `noonBanner` at tDay ≥ Dl/2 − 2; `noonPassed` at ≥ 0.6·Dl; `nightStart`; `dawn` (also refills Chill to max and resets parasol); `hourEnd`.
4. **Nubs advance:**
   - `y += v·DT` in daylight and `y += v·8/nightLen·DT` at night.
   - Lane: if inside a fork window and locked, `x = trailX(y) + lane·55·forkBlend(y − yStart)`; otherwise `x = trailX(y)`.
5. **World:** `ensureGenerated(world, y + 1600, maxChunks = 1)`. This is a hard guarantee. The game layer also pre-generates during idle (§9.10), so this branch normally does nothing.
6. **Forks** (`forks.ts`): preview from y_f − 140 to y_f − 40, then lock (events).
7. **Coverage** (`nubs.ts`):
   - For each of the 5 samples, compute `litWeight(sample)` from casters within reach R = min(520, maxZ/tanε) + 60 (bucket query), floaters, and glare.
   - Set `f` and `glareW`. Record `lastShaderId` = the first caster or floater id that shades the center sample.
8. **Chill:**
   - drain = `effectiveDrain(s)` = `s.cfg.drain ?? s.params.drain`: the profile drain (30 / 40 / 47 / 55 for profiles 0-3), or the endless onboarding ramp `endlessDrain(runs)` the session passes as `RunConfig.drain` (V1_PLAN §6). World generation and the validator always use the profile drain. (Charms such as the parasol are out of v1.)
   - `chill += (−drain·f + regen·max(0, 1 − f))·DT`, clamped to [0, maxChill]. Regen is 30, or 20 for Snowball. Night: `chill += 30·DT`.
   - Frost multiplier rules, PHEW, `shadeEnter`/`shadeExit` events, hour log, cloud-ride timers, `lowChill` event when chill first crosses below 25.
9. **Pickups** (`pickups.ts`):
   - Melt every alive pickup with 0 < (p.y − nubs.y) ≤ 280 whose point is lit (single-point `litWeight`), at weight×DT.
   - Collect when same lane and |p − nubs| ≤ 14.
10. **History:** every 20 u of y, push (x, y, chill). Push `recent` ring entries every tick.
11. **Guide** (`guide.ts`): every 6 ticks, compute `guide.now` (mask at Nubs) and `guide.next` (mask at y + 0.6·v) via `intervals.ts`. A bin is 1 if all 5 samples are fully shaded and glare-free.
12. **Death:** if `chill ≤ 0` in daylight, set `phase = 'dead'`, compute `death = deathCause(s)` (§2.14 of the GDD), and emit `death`.

Everything here is pure arithmetic on `s`. Rendering never mutates `s`.

---

## 5. Sun control (src/core/sim/sun.ts)

```
if input.down and !sun.down: sun.omega = 0; emit catch if |omega_before| > 90
if input.down: sun.target += input.dTheta; maxStep = maxRate*DT  (600, 750 sundog, 300 reduced-motion)
               delta = clamp(angleDiff(sun.target, sun.theta), -maxStep, +maxStep); sun.theta = wrap(sun.theta + delta)
elif upEdge: sun.omega = clamp(release * smoothstep(flickMin, flickFull, |release|), ±cap) (TUNING.sun.flickMin/flickFull = 200/600 °/s; cap 360, 180 reduced): only genuine flicks coast; sun.target = sun.theta
else: sun.theta = wrap(sun.theta + sun.omega*DT); sun.omega *= FRICTION_PER_TICK (0.9433354499; sundog 0.9592377960);
      if |omega| < 5: omega = 0; sun.target = sun.theta
input.key != 0: sun.theta = wrap(sun.theta + key * -180 * DT) (Right/D = clockwise = negative); omega = 0
detent: d = floor(theta/15); if d != sun.detent: emit detent(dir); sun.detent = d
```
- `reducedMotion` is passed in through `RunConfig` (as `cfg.reducedMotion?: boolean`) so replays stay deterministic.
- `sun.target` is wrapped lazily; it may accumulate beyond 360 during a drag, and `angleDiff` handles that.

---

## 6. Shadow maths (src/core/shadows.ts, src/core/intervals.ts)

**Logic tests** (per sample point p, sun vector u, `cot = 1/tanEps`):
- **Prism** (pts, h): L = min(h·cot, 520). Shaded iff `segmentIntersectsConvex(p, p + u·L, pts)`. This is a Liang-Barsky clip against CCW edges, with an early accept when p is inside.
- **Slab** (pts, z0, z1): shaded iff `pointInConvex(p + u·min(z·cot, 520), pts)` for z ∈ {z0, (z0+z1)/2, z1}.
- **Disc** (cx, cy, r, z): shaded iff |p + u·min(z·cot, 520) − c|² ≤ r².
- **Floater** at time t: center = (x0 + vx·(t − t0), y0 + vy·(t − t0)). Offset R = min(z·cot, 900). Shaded iff the point q = p + u·R lies inside the ellipse ((qx−cx)/rx)² + ((qy−cy)/ry)² ≤ 1 (circle for balloons).
- **Glare** (ball b, ε ≥ 8°): center g = b + u·min(40·cot, 300). The sample is in glare iff |p − g| ≤ 22.
- `litWeight(p) = (shaded && !inGlare ? 0 : 1) + (inGlare ? 1 : 0)`.

**Render polygons** (`partShadowPolygon(part, ux, uy, cot, out: Float64Array): number` returns the vertex count):
- Prism: monotone-chain hull of pts ∪ (pts − u·L).
- Slab: hull of the two offset copies.
- Disc: circle center c − u·R (rendered with `arc`).
- Floaters: ellipse at center − u·R.

These are the same sets as the logic tests: segment p→p+uL hits F ⇔ p ∈ F ⊕ [−uL, 0], which is that hull. A property test checks agreement.

**Angular masks** (`intervals.ts`, `shadeMask(px, py, eps, t, world, out: Uint8Array(360) /*count of shaded per bin*/)`). For each part within reach:
- **Prism:**
  - d_min = distance(p, F). If d_min > L, skip.
  - Compute vertex angles via `atan2D` and the convex angular extent [a0, a1] (unwrapped, < 180°).
  - If max vertex distance ≤ L, mark all bins whose centers lie in [a0, a1].
  - Otherwise test each bin in [a0, a1] with the exact segment test (bin center vectors from the `SUN_COS/SIN` tables).
- **Disc (and circular floaters/glare):** with R the offset at that height and D = |c − p|:
  - If D + R ≤ r, all bins.
  - If |D − R| > r, none.
  - Otherwise half-angle φ = acosD((D² + R² − r²)/(2DR)); mark bins in [α − φ, α + φ], where α = atan2D(c − p).
- **Elliptical clouds** in the validator are treated as circles of radius ry (conservative). Runtime uses the true ellipse.
- **Slab:** for each of the 3 heights, test bins inside the angular extent of the offset polygon's possible positions. That is the extent of pts as seen from p, widened by asin(min(1, R/D)); with the 1° grid, simply test all bins whose q falls in the polygon's AABB, which is cheap.

Per sample the result is a shaded bitset; glare bins are a separate bitset. The validator combines them into `fLit[b] = (Σ samples (1 − shaded) + Σ samples glare) / 5`. The guide uses a strict mask (fLit == 0).

---

## 7. World generation (src/core/gen)

### 7.1 Trail
Control point i (y_i = −600 + 120·i) is generated sequentially from the `'trail'` stream:
```
x_{i+1} = clamp(x_i + U(−70, 70) + 0.15·(180 − x_i), 80, 280)
```
The value is then post-clamped into any forced range covering y_{i+1}:
- forks: x ∈ [140, 220] and |Δx| ≤ 20 over [y_f − 200, y_f + 300];
- tutorial: x = 180 over [−120, 480].

Forced ranges must be known before the control points are generated. Fork y positions come only from the clock schedule (`yAtTime(day, t_f)` plus the chunk-fit adjustment), so `world.ts` computes the fork list for day N before generating control points that cover day N.

`trailX(y)` is uniform Catmull-Rom on (cps[i−1..i+2]) with local parameter (y − y_i)/120. y is linear in the parameter for uniformly spaced y, so x is a cubic in y.

### 7.2 Chunk placement (`placer.ts`, chunk k, rng = rngFor(seed, 'chunk', k))
1. **Biome** for each y comes from the day at y (odd days Meadow, even days Old Town) via `clock.timeAtY`.
2. **Casters:** cursor y_c starts at the chunk's carried cursor (stored in world).
   - Repeat: y_c += spacing(day)·rng.range(0.7, 1.3); side flips with p = 0.6; kind by biome weights; lat = rng.range(latMin, latMax); rot = rng.int(0, 11)·15° (trees 0).
   - Build parts (`catalog.ts`). Position the center so the nearest ground-footprint point is `lat` from trailX(y_c) horizontally, then apply the clearance loop (≥ 14 u from the centerline polyline sampled every 8 u and from the active fork branches; push outward 4 u per iteration, max 20 iterations).
   - 10% of Old Town arches whose y_c is not within a fork window become gate arches centered on the trail.
3. **Forks** inside the chunk:
   - Frost side = `rngFor(seed, 'fork', day, i).chance(0.5) ? -1 : 1`.
   - Outer-side spacing ×1.6 on the frost branch over [y_f, y_f + 250].
   - 1-2 island casters (kinds tree, stone, hut or column, with half-extent ≤ 30) at y ∈ [y_f + 80, y_f + 170].
   - Frost Lane pickups: 6 flakes from y_f + 70 at 22 u spacing, plus a crystal with 30% chance at y_f + 210.
4. **Flake clusters:** Poisson-like spacing of rng.range(5, 8)·v along y during t ∈ [0.08·Dl, 0.92·Dl]. Clusters are 3 or 4 flakes, 24 u apart, on the main path (in fork windows, only on the Safe Lane, with lane = safeSide). One crystal per day at t = rng.range(0.3, 0.7)·Dl. Night frost flowers every 60 u.
5. **Floaters:** at the first chunk of each day, generate that day's clouds and balloon from `rngFor(seed, 'sky', day)` per the GDD §2.8 / §3.1 schedule. Spawn y is relative to `yAtTime(day, tSpawn)`.
6. **Gazing balls** (Old Town days): `rngFor(seed, 'balls', day)`; schedule per day table; lateral U(40, 80), alternating sides; each adds a 10×10, h30 'pedestal' caster.
7. **Names:** `rngFor(seed, 'names', id)` picks an adjective + noun.
8. **Tutorial overrides** (cfg.tutorial): chunk 0 uses the fixed list from GDD §4 instead of steps 2 and 4. Chunk 1 uses spacing ×0.85 and validator floor 60. A guaranteed overtaker cloud spawns at t = 19 on Day 1.

### 7.3 Validator (`validator.ts`)
Validation lags placement by one chunk: chunk k is validated after chunk k+1 has been placed, so long dawn shadows from casters ahead are included. Adding casters only ever adds shade, so earlier validated chunks stay valid.

```
validateChunk(world, k):
  C = world.dpCarry (Float64Array 360; init all = maxChill for k = 0)
  for path in pathsThrough(k):           // main; inside a fork: safe lane then frost lane, each starting from C at y_f − 40
    floor = path.frost ? 15 : dayFloor(day) (tutorial chunk 1: 60)
    for y_j from path.y0 to path.y1 step v(day_j)·0.1:
      (day_j, t_j) = timeAtY(y_j); if night: C.fill(maxChill); continue
      eps = elevation(day_j, t_j)
      p = pathPoint(y_j, path.lane)
      fLit[0..359] = combined masks for 5 samples (§6)
      W = slidingMaxCircular(C, radius = 24 bins)   // 240°/s × 0.1 s; monotonic deque on doubled array, O(360)
      for b: C[b] = min(maxChill, W[b] + (−55·fLit[b] + 30·max(0, 1 − fLit[b]))·0.1)
      if max(C) < floor: return FAIL(y_j, path)
    after a fork: C = C_safe_lane_end
  demand check (main/safe path only, t ∈ [0.16·Dl, 0.84·Dl]): rolling AND of strict masks over 100 consecutive steps;
     if any bin survives: mirror the caster nearest the window midpoint across trailX (x' = 2·trailX(y) − x, re-clearance) → revalidate (max 3 per chunk)
  world.dpCarry = C; mark validated
on FAIL(y, path): insert rescue Tree at y + 20 on side −world.rescueSide (alternate), trunk nearest edge 16 u from the path centerline,
     canopy r30 z75, rescue = true; revalidate the chunk from its start (max 8 rescues per chunk);
     after 8: insert a parked cloud (vy = v, x offset from the path by min(300·cot, 900)·0.7, life 6 s) and accept.
```
- Cost target: ≤ 4 ms per chunk on a mid-range phone (about 70 steps × 5 samples × ~40 parts, analytic in most cases).
- `world.stats` records rescues per chunk for `npm run sim`.

### 7.4 ensureGenerated(world, yTarget, maxChunks)
While `placedThrough·480 < yTarget + 480` and the budget allows: place chunk k+1, then validate chunk k. Chunk content is a pure function of (seed, cfg.charm, cfg.tutorial, k, previous carry), so it doesn't matter whether generation happens in idle frames or inside `step`.

---

## 8. Input (src/game/input.ts)

**Element.** The `canvas#game` element gets:
- CSS `touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;`;
- `contextmenu` prevented;
- `overscroll-behavior: none` on html/body;
- body `position: fixed; inset: 0; overflow: hidden`.

**Pointer events** on the canvas:
- `pointerdown`: only if no primary pointer is active. Store pointerId, call `setPointerCapture`, set `down = true`, record lastX. Pushing the first sample to the velocity ring resets it.
- `pointermove` for the active id: iterate `getCoalescedEvents()` when available. For each, dx = e.clientX − lastX, then `pending += −dx / viewportCssW · 310 · sensitivity · (invert ? −1 : 1)`. Push (timeStamp, cumulative θ request) into a ring of 16 samples.
- `pointerup` / `pointercancel` / `lostpointercapture`: compute release ω from the ring as (θ_last − θ_first)/(t_last − t_first) over samples within the last 80 ms. If the newest sample is older than 50 ms, ω = 0. Set `pendingRelease = ω`, `down = false`.
- Secondary pointers are ignored.

**Taps** (down→up < 200 ms and < 8 px of total movement) are reported to the UI layer, which uses them for Retry on the results map. In play a tap is just a catch.

**Keyboard:**
- ArrowLeft/A → key = +1 (counter-clockwise); ArrowRight/D → key = −1.
- Space/Enter → start/retry; Escape/P → pause.

**Per-tick frames:** `takeFrames(n): InputFrame[]` is called by the loop with the number of ticks it will run this frame.
- The accumulated `pending` is split evenly across the n frames, each quantized to 1/1024°. The remainder is carried.
- `down` is set on all n frames.
- A release lands on the last frame.
- With n = 0 (hit-stop), input keeps accumulating.

**UI routing:** `#ui` has `pointer-events: none`; only its interactive children set `pointer-events: auto` and call `stopPropagation` on pointerdown. Canvas drags never start on buttons.

---

## 9. Rendering pipeline (Canvas 2D)

### 9.1 Canvas, DPR, resize, letterbox, safe areas (`canvas.ts`, `safeArea.ts`)
- **Canvas size.** `canvas#game` is styled `position: fixed; inset: 0; width: 100vw; height: 100dvh`.
- **Resize.** A ResizeObserver on the canvas, plus `visualViewport` resize and `orientationchange`, recompute:
  - `cssW = canvas.clientWidth`, `cssH = canvas.clientHeight`;
  - `dpr = min(devicePixelRatio, 2) · perfScale`, where perfScale ∈ {1, 0.75, 0.625} comes from the governor;
  - `canvas.width = round(cssW·dpr)`, `canvas.height = round(cssH·dpr)`.
- **World viewport** (`k` = CSS px per u):
  1. `k = cssW / 360`; `viewH = cssH / k`.
  2. If `viewH < 600`: `k = cssH / 600`; the viewport is 360·k wide, centered, with side bars.
  3. If `viewH > 860`: the viewport height is 860·k, top-aligned at the safe-area top inset, and the remaining bottom area is a bar.
  4. Bars are filled with the LUT ground color darkened 35% plus a 4% noise tile. The world is clipped to the viewport rect.
- **Safe areas.** `safeArea.ts` reads `env(safe-area-inset-*)` from a hidden probe div (`padding: env(...)`) through `getComputedStyle` on each resize. HUD placement uses the insets; the world renders full-bleed under notches. `index.html` has `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`.
- **World transform.** World y points up. With `yTop = nubsY + 0.68·viewH`:
  `ctx.setTransform(dpr·k·zoom, 0, 0, −dpr·k·zoom, dpr·(vx + shakeX + zoomTx), dpr·(vy + yTop·k·zoom + shakeY + zoomTy))`.
  A point at height z is drawn at (x, y + 0.25·z). Text and HUD are never drawn under this transform.
- **Interpolation.** The renderer receives `(curr, prevSnap, alpha)`:
  - `nubsY = lerp`, `nubsX = lerp`, `theta = prev + angleDiff(curr, prev)·alpha`, `tRender = prev.t + DT·alpha`;
  - floaters, ε and LUT values are computed from `tRender`;
  - shadow polygons are recomputed in render from the interpolated θ/ε, so 120 Hz displays stay smooth.

### 9.2 Draw order (`renderer.ts`)
1. Clear the full canvas with the bar color.
2. Save; clip to the world viewport; set the world transform.
3. Ground fill (LUT).
4. Ground detail tile grid for the current biome (256 u tiles, at most 2×5 drawImage calls).
5. Trail: the edge polyline (34 u, darker 12%) then the fill (30 u), round joins, sampled every 8 u of y within view ±100. Then fork branches and the Frost Lane tint.
6. Decals: footprints and drips (ring of 64).
7. Ground pickups: flakes, crystals, flowers (glow sprites + shapes). Fork chevrons.
8. Glare spots.
9. **Shadow layer** composite (§9.3).
10. Frost sparkles (ground particles).
11. **Depth-sorted objects**, descending y (far first). Each caster draws side faces, then top, then rim; trees draw trunk then canopy. Nubs is inserted at his y; the pedestal ball is drawn with its caster.
12. Floaters (balloons, then clouds) at their oblique height.
13. Air particles (steam, sparkles, confetti); additive glows use `globalCompositeOperation = 'lighter'` and are batched together.
14. Nubs overlays: chill ring with the sun pointer, "!" bubble, text pops.
15. Restore. Screen space: vignettes (low Chill, multiplier pulse), sun dial (ticks, guide arcs, glyph, face, moon), HUD, debug overlay.

### 9.3 Shadow layer (`shadowLayer.ts`)
- An offscreen canvas of `ceil(viewportCssW/2) × ceil(viewportCssH/2)`, independent of DPR (half CSS resolution).
- Each frame:
  - `clearRect`; transform = world transform with `dpr` replaced by 0.5;
  - `fillStyle` = LUT shadow color (opaque); **one** `beginPath()`;
  - append every visible part's shadow polygon (moveTo/lineTo/closePath, all CCW) and every disc/ellipse (`arc`/`ellipse` subpaths);
  - one `fill('nonzero')`, so the union is one draw call.
- Composite: `ctx.globalCompositeOperation = 'multiply'`, `globalAlpha = LUT shadowAlpha (+0.17 high contrast)`, `imageSmoothingEnabled = true`, then `drawImage(layer, viewportRect)`. Bilinear upscaling gives a free soft penumbra.
- No `ctx.filter`, no `shadowBlur`.
- Culling: casters with maxY ≥ viewBottom − 600 and minY ≤ viewTop + 600; floaters whose shadow AABB intersects the view.

### 9.4 Casters (`casters.ts`)
- **Prism:** for each footprint edge (a→b), with outward normal n, if n.y < 0 draw the quad (a, b, b + (0, 0.25h), a + (0, 0.25h)) with color `mix(side, top, 0.25·max(0, n·u))`. Then draw the top polygon offset by 0.25h. Rim: stroke the top edges with n·u > 0.3 using #FFFFFF at 0.6 α, width 1.5 u.
- **Roofs:** cottages and huts split the top into two triangles/quads along the long axis (the sun-facing half 12% lighter). Houses draw a 3 u inset parapet.
- **Trees:** trunk prism, then the canopy at (cx, cy + 0.25·z): 5 seeded lumps, a highlight crescent offset 0.25·r toward u, alpha 0.7 when within 45 u of Nubs.
- **Material colors** are tinted by `palette.tint(materialRGB)`, which is cached per frame.

### 9.5 Particles and FX (`particles.ts`, `game/fx.ts`)
- **Particles:** structure-of-arrays pool, capacity 400 (the governor can reduce it to 200). Float32Array fields x, y, z, vx, vy, vz, life, maxLife, size, size1, rot, vrot, alpha0; Uint8Array kind; Uint32Array rgba. Free-list stack; overflow recycles the oldest.
  - Kinds: steam, drip, sparkle, frostSparkle (ground), frostBurst, petal, confetti, shard.
  - Updated in render time (real dt × timescale) and drawn with pre-rendered sprites or simple paths. Particles use Math.random; they are not part of the sim.
- **Rings:** 16 slots (x, y, r0, r1, t, dur, rgba, width).
- **Text pops:** 12 slots (string, x, y, scale curve, color).
- **Slow-mo / hit-stop:** `fx.timeScale(target, durationRealMs)` and `fx.hitStop(ms)`, consumed by the loop.
- **Camera shake:** trauma-style. `amp` (u) decays exponentially; `(shakeX, shakeY) = amp·k·(noise(t·40), noise(t·40 + 17))` with a cheap sin-hash noise. Zeroed in reduced motion.
- **Zoom pulse:** `zoom = 1 + z0·e^(−t/τ)` around Nubs' screen point.

### 9.6 Sun dial (`sunDial.ts`)
- **Dial path:** a rounded rect inset 26 CSS px from the viewport edges (plus the top/bottom safe insets), corner radius 40.
- **Glyph position:** `rayRectIntersection(nubsScreen, (cosθ, −sinθ), dialRect)`.
- **Glyph drawing:** bloom sprite (pre-rendered 256 px), 12 rotating ray wedges, core disc, face per Chill band, guilty turn on death.
- **Guide:** for each run of set bins in `guide.now`, sample the dial path every 2° and stroke a 6 px teal polyline; `guide.next` is drawn dashed. Alpha follows the GDD's Auto rules (computed in `session` and passed in).
- **Ticks:** 24 detent ticks while dragging.
- **Night:** moon glyph at θ + 180°.

### 9.7 HUD (`hud.ts`)
- **Scale:** `hudScale = clamp(cssW/390, 0.85, 1.3)`.
- **Contents:** the time readout (DAY label + clock) at the top center with 12 px padding below the safe inset; the ruler (60% of viewport width × 6 px) with noon icon and flags; Snow and multiplier at the top right; charm icon; the pause button at the top left. The pause button is a DOM button for accessibility and is mirrored in the HUD layout; the canvas only reserves its space.
- **Text:** `ctx.font = '800 28px system-ui, …'` with tabular numerals via `font-variant-numeric` unavailable in canvas, so digits are drawn with a fixed advance: measure "0" once per size and place each char.

### 9.8 Melt Map and postcard (`meltMap.ts`, `postcard.ts`)
- **Melt Map** reuses the ground/trail/caster renderers (no side faces, no shadows) at zoom 0.35, centered on the midpoint of the last 2000 u. History dots are r3 u, colored by Chill (100 #5AB8FF → 50 #FFC23D → 0 #FF5D5D). Day boundary labels and the puddle marker are drawn in screen space.
- **Postcard:**
  - `OffscreenCanvas(1080, 1920)` when available, otherwise a detached canvas.
  - Draws the Melt Map at scale 3, then the bottom panel, then `convertToBlob`/`toBlob('image/png')`.
  - Shares via `platform/share.ts` (`navigator.canShare({files})` → `navigator.share`), otherwise an `<a download>` fallback.

### 9.9 Sprites (`sprites.ts`)
Built at boot and whenever DPR changes:
- glow (64 px radial white → transparent), sun bloom (256 px), flake (32 px), sparkle (16 px);
- ground tiles (Meadow and Old Town, 256 u at the current k·dpr, max 512 px).

### 9.10 Loop (`game/loop.ts`)
```
frame(now):
  real = min((now − last)/1000, 0.1); last = now
  if hitStopMs > 0: hitStopMs −= real*1000; scaled = 0 else: scaled = real * timeScale (timeScale timers tick in real time)
  acc += scaled; n = min(floor(acc / DT), 5); if n == 5: acc = 0 else acc −= n*DT
  frames = input.takeFrames(n)
  for i < n: snapshotPrev(state); step(state, frames[i]); session.onEvents(state.events)
  session.idleWork(budgetMs = 3)   // ensureGenerated(world, nubs.y + 2400, 1) when frame time allows
  renderer.draw(state, prevSnap, acc/DT, real)
  audio.update(state, real); requestAnimationFrame(frame)
```
- The loop pauses (stops calling `step`) on Paused/hidden.
- The title "attract" state is a `'hold'`-phase sim of the next run; the auto-sway is the session feeding dTheta.
- **Render cadence** (`game/cadence.ts`, details in `src/game/README.md`). Every rAF still steps the sim, generates, updates audio and the UI; only `renderer.draw` is skipped:
  - **Menus** (Settings, Daily, Missions, Wardrobe): the UI paints an opaque background over the world rect, so the canvas is drawn once on entry and again only after a resize, a DPR or governor change, or a canvas-affecting setting. The UI never depends on the canvas animating behind a menu.
  - **Pause**: at most 30 fps. **Title under reduced motion**: at most 10 fps.
  - **Play, dying, Results and the Title**: at most 60 fps on a 60 Hz timeline, but every rAF while a finger or key is down or the clock runs at another rate (hit-stop, slow-mo).
  - **Settled Results** redraw only the puddle marker over a cached backdrop.
- **Crash containment.** The loop schedules its next frame before running this one and catches what it throws (logged). After 30 failing frames in a row the save is flushed and a self-contained overlay (`#crash`, role alertdialog: "Something went wrong. Your progress is saved." and a Reload button) covers the game; a one-off failure heals on the next frame. If boot itself throws, the splash becomes "SHADY couldn't start." with Reload. Uncaught errors and rejections flush the save.

---

## 10. Audio engine (src/audio)

**engine.ts**
- `new AudioContext({ latencyHint: 'interactive' })` is created lazily on the first `pointerdown`/`keydown`/`touchend`. Then `ctx.resume()` and a 1-sample silent buffer is played (iOS unlock).
- Graph: buses `sfx`, `music`, `amb` → `master` (0.9) → `DynamicsCompressor` (−14 dB, ratio 4, attack 0.003, release 0.25) → destination.
- Noise buffers built once: white (2 s mono) and pink (2 s, Paul Kellet filter).
- `visibilitychange` hidden → `ctx.suspend()`; visible + playing → `resume()`.

**recipes.ts.** One function per GDD §12 recipe: `(ctx, out: AudioNode, when: number, p?) => void`. Each creates nodes, schedules envelopes with `setValueAtTime`/`exponentialRampToValueAtTime` (never ramping to 0; 0.0001 is the floor), and stops the sources at end + 0.05 s. Nodes disconnect on `onended`.

**music.ts**
- 90 BPM 16th-note clock. Scheduling runs from a 25 ms `setInterval` plus rAF with a 120 ms lookahead.
- Pad voices are persistent oscillators. Their filter cutoff is updated with `setTargetAtTime`; chords crossfade every 4 bars.
- The arpeggio pattern is chosen per bar from the Frost multiplier (GDD §12).
- Key per day: the root ratio ×1.5 folded into [1, 2).
- The melody recorder stores up to 32 flake degrees per run; the results screen replays them.
- **Quantized SFX:** `scheduleOnGrid(fn)` runs fn at the next 16th-note boundary.

**sfxRouter.ts**
- Maps SimEvents to recipes, with throttles: detent ≥ 50 ms apart, bells ≤ 12/s.
- Each frame updates continuous voices: sizzle (f), cicadas (noon window), crickets (night), heartbeat (Chill), pad cutoff (ε).

Gameplay never depends on audio timing.

---

## 11. Haptics (src/platform/haptics.ts)

```ts
export type HapticName = 'detent'|'catch'|'flake'|'crystal'|'shade'|'multUp'|'multMax'|'phew'|'glare'|'fork'|'heartbeat'|'death'|'day'|'best'|'ui';
export interface Haptics { play(name: HapticName): void; setEnabled(on: boolean): void }
```
- **Patterns** come from GDD §13 (`PATTERNS: Record<HapticName, number | number[]>`).
- **WebVibrateHaptics:** enabled only if `typeof navigator.vibrate === 'function'` and the setting is on. Global 40 ms gap (heartbeat exempt); detent ≥ 50 ms apart. Calls are wrapped in try/catch.
- **NullHaptics** is used on iOS web.
- **NativeHaptics** (Capacitor, Later):
  - A single value ≤ 8 → `Haptics.impact({ style: Light })`; ≤ 20 → Medium; otherwise Heavy.
  - Arrays are played as a sequence of impacts at the on-durations, using setTimeout for the gaps.

---

## 12. Persistence (src/meta/save.ts, src/platform/storage.ts)

**StorageAdapter**
```ts
interface StorageAdapter { get(key: string): string | null; set(key: string, v: string): void; remove(key: string): void }
```
`WebStorageAdapter` wraps every call in try/catch with an in-memory Map behind it. `get()` reads the backing store first and falls back to memory only when the backing value is missing or unreadable (or a write to that key failed and hasn't been retried successfully). `set()` tries the backing store on every call, so a transient failure (quota, private mode hiccup) heals on the next write; `degraded` is true while the latest write failed or there is no backing store. The UI shows a one-time toast "Progress can't be saved in this browser mode." on the first failed write after boot (`SaveStore.onDegraded`).

**Key** `shady.save`. **Schema v1:**
```ts
interface SaveV1 {
  v: 1; createdAt: number;
  settings: { sfx: number /*0..1, .8*/; music: number /*.6*/; haptics: boolean /*true*/; sensitivity: number /*1.0*/;
              invert: boolean; reducedMotion: 'auto' | 'on' | 'off'; highContrast: boolean; guide: 'auto' | 'always' | 'off';
              handed: 'right' | 'left' };
  stats: { runs: number; bestMinutes: number; bestSnowRun: number; lifetimeSnow: number; wallet: number; phews: number;
           flakes: number; daysSurvived: number; frostLanes: number; maxDay: number; cloudSeconds: number; dailyDaysPlayed: number };
  unlocks: { charms: CharmId[]; cosmetics: string[]; postcards: BiomeId[]; achievements: string[] };
  equipped: { charm: CharmId; scarf: string; hat: string; nose: string };
  missions: { cursor: number; tier: number; active: { id: string; progress: number }[] };
  daily: Record<string /*YYYY-MM-DD*/, { tries: number; bestMinutes: number; bestSnow: number; glyphs: string }>;
  flags: { tutorialDone: boolean; hintsShown: number; lastChallenge?: string };
}
```

**migrate(raw)**
- Parse JSON in try/catch. On failure, or if the result is not an object, return `defaults()`.
- If `v === 1`, deep-merge with `defaults()` and clamp/validate every field: numbers finite, sensible ranges, ids filtered against `content.ts`.
- Future `v > 1`: copy raw to `shady.save.future`, use defaults in memory, and **never overwrite** it.
- Before writing a migrated save, keep the old raw value in `shady.save.bak`.
- Later versions append to `MIGRATIONS: ((s) => s)[]`.

**SaveStore**
- `get()` returns the in-memory object; `update(fn)` mutates it and schedules a 300 ms debounced write.
- `flush()` runs on `pagehide`, `visibilitychange` → hidden, and run end (and right after a Wardrobe buy or equip).
- Keys: `SAVE_KEY` = `shady.save`, with `SAVE_BAK_KEY` (`.bak`) and `SAVE_FUTURE_KEY` (`.future`) derived from it.
- `canPersist` is false while a newer version's save sits on disk; the store then never writes, and Reset and Restore answer "A newer version of SHADY saved progress here. Update the game first."
- **Other instances** (another tab, the installed app): a `storage` event on the key, or a re-read when the page becomes visible that finds different bytes, adopts the other save if it migrates cleanly (newer versions are ignored). With no unsaved local change it replaces the current save without writing; with one, it takes the other save but keeps the local settings (and equipped items the other save owns), then writes. Either way `onExternalChange(cb)` fires; the session refreshes the UI, the settings and, between runs, the run count and the held run.
- `onDegraded(cb)` fires once, on the first failed write after boot. `dispose()` flushes and detaches the listeners.
- Daily entries are pruned to the latest 60 dates.

**progression.ts.** `applyRunResult(save, result)` is pure (tested):
- updates stats, wallet, bests and daily tries;
- applies mission progress, completions and replacements, achievements, charm unlocks by max day, and postcard unlocks;
- returns toasts.

---

## 13. Screens and UI state machine (src/ui)

**Choice: DOM overlay for menus and panels; canvas for the in-play HUD.**
- The DOM gives crisp text at any DPR, real buttons (focus, aria, keyboard, screen readers), flexbox layouts that respect `env(safe-area-inset-*)`, and native scrolling for lists such as the Wardrobe. All of that is costly to rebuild in canvas.
- The HUD stays in canvas because it must be frame-synced with the world and juiced every frame (pops, ruler, chill ring), which DOM layout or style updates would make janky.
- The pause button is the one DOM element visible in play.

**Mechanics**
- `#ui` is a full-screen absolutely positioned div. Each screen module exports `mount(root, ctx): Screen` with `{ el, onEnter(), onExit(), onBack() }`.
- **World column.** The session publishes the world viewport on `#ui` as `--world-left/top/width/height` (whole px; 400/0/480/800 at 1280×800, 0/0/390/844 on a phone). Screens, HUD controls, the tray, sheets, dialogs and toasts are laid out inside that rect (fallbacks 0/0/100%/100%); scrims and the menus' paper may cover the viewport. Safe-area padding is max(0, inset − distance from the rect edge to the viewport edge).
- `ui.ts` holds `current: ScreenId` and a transition table:
```
boot→title; title→play|daily|wardrobe|charms|missions|atlas|settings; daily→play|title;
wardrobe|charms|missions|atlas|settings→title (settings also→pause when opened from pause);
play→pause|dying; pause→play|title|settings; dying→results; results→play|title; *→rotate→(previous)
```
  Illegal transitions throw in dev and are ignored in prod.
- **Transitions:** screens fade/slide with CSS transitions (180 ms; opacity only under reduced motion).
- **Back:** the Escape key, the browser's Back (through the session's history sentinel, V1_PLAN §8.2) and a native back button call `ui.back()`: an open modal closes first (`ui.isModalOpen()`), then the screen's back action.
- **Toasts:** a stack at the top of the world column (below the header on menus) that auto-hides after 2.5 s; a screen switch fades the old screen's toasts out in about 120 ms.
- **Screen readers:** a polite live region announces the Results summary and "Paused"; focus moves into screens only in keyboard mode, and menus return focus to the control that opened them.
- **Theming:** `ui.css` uses CSS custom properties for the palette (GDD §10); text is ≥ 16 px (1rem) on menus and Results; every control has a 48×48 px hit area; buttons grow with their label (min-height, not height); `:focus-visible` gets a two-tone ring (3 px ink outline plus a white halo) that reads on any background, and `forced-colors` mode keeps switches, sliders and selections visible.
- **Results panel:** a DOM sheet anchored to the bottom (at least 58% tall, more when its content needs it, up to 96 px below the top), so the Melt Map stays visible above it; on short or large-text screens the whole sheet scrolls as one with Retry pinned. `ui.resultsSheetTop()` (cached by a ResizeObserver) tells the renderer where the sheet starts. The tap-to-retry hit area is the canvas region above the sheet.
- **Rotate overlay:** shown when a touch device (`matchMedia('(pointer: coarse)')`) is held landscape with innerHeight < 500. It pauses play.

---

## 14. PWA

**`public/manifest.webmanifest`**
```json
{ "name": "SHADY: Don't Melt Nubs", "short_name": "SHADY", "start_url": "./", "scope": "./",
  "display": "standalone", "orientation": "portrait", "background_color": "#F6B07C", "theme_color": "#34306B",
  "icons": [ {"src":"icons/icon-192.png","sizes":"192x192","type":"image/png"},
             {"src":"icons/icon-512.png","sizes":"512x512","type":"image/png"},
             {"src":"icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"},
             {"src":"icons/favicon.svg","sizes":"any","type":"image/svg+xml"} ] }
```
`index.html` also links `apple-touch-icon.png` and sets `<meta name="theme-color" content="#34306B">` and `apple-mobile-web-app-capable`.

**Service worker.** It is hand-rolled; no workbox dependency. The `shadySW()` plugin in `vite.config.ts` hooks `generateBundle` (client build only) and emits `sw.js`:
```js
const VERSION = '<sha1 of sorted asset names+sizes>'; const ASSETS = ['./', './index.html', ...bundleFiles, ...publicFiles];
self.addEventListener('install', e => e.waitUntil(caches.open('shady-'+VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== 'shady-'+VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => { const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') e.respondWith(fetchWithTimeout(r, 3000).then(res => { cachePut('./index.html', res.clone()); return res; }).catch(() => caches.match('./index.html')));
  else e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { cachePut(r, res.clone()); return res; }))); });
```

- **Precache with `cache: 'reload'`.** Install fetches every asset past the HTTP cache, so a CDN's stale `index.html` (GitHub Pages caches it for minutes) can never be precached next to a new version's assets. Navigations keep their network-first path (a `Request` init can't be built from a navigate-mode request).

**Registration** (`platform/pwa.ts`): only when `import.meta.env.PROD`, `import.meta.env.MODE !== 'single'`, `'serviceWorker' in navigator`, `location.protocol === 'https:'` or `http:` on localhost/127.0.0.1, and `!isNative()`. It calls `navigator.serviceWorker.register('./sw.js', { scope: './' })`.
- No `skipWaiting`: a new version activates on the next cold start, so a running game never reloads.
- **Install prompt (Android/Chromium).** `captureInstallPrompt()` (called by the UI) prevents and stashes `beforeinstallprompt` and clears it on `appinstalled`; Settings shows an "Install SHADY" row while `canPromptInstall()` and the game isn't standalone, and `promptInstall()` resolves `'accepted' | 'dismissed' | 'unavailable'`. On iOS the "Play SHADY from your Home Screen" sheet (V1_PLAN §11.5) explains the steps instead; it is skipped in in-app browsers.

### 14.1 Single-file build
`npm run build:single` = `vite build --mode single --outDir dist-single && node scripts/inline-build.mjs dist-single`.
- The `single` mode never registers a service worker (`canRegisterServiceWorker()` checks `MODE`), and `shadySW()` emits no `sw.js` for it (nor for any build into `dist-single`).
- `inline-build.mjs` inlines the script and stylesheet into `index.html`, inlines `icons/favicon.svg` as a `data:` URI, removes the manifest and apple-touch-icon links, and exits 1 if the output still references `./assets/`, a `<script src>` or a stylesheet `<link>`. The result opens from `file://` and in WebViews.
- Without an http(s) address, challenge links use `VITE_SHARE_URL` from `.env` (V1_PLAN §11.4).

**Icons.** `src/render/iconSvg.ts` exports `iconSvg(size: number, maskable: boolean): string`: an indigo #34306B background (full-bleed when maskable, with an 80% safe zone), the sun disc #FFE27A with rays and sunglasses, and a tiny white Nubs silhouette at the lower right. `scripts/gen-icons.ts` launches Playwright Chromium, sets the page content to each SVG at 192/512/180/1024 px, and screenshots the PNGs into `public/icons/` (the 1024 px PNG feeds Capacitor assets). It also writes `favicon.svg`. Outputs are committed.

---

## 15. Performance budget

| Item | Budget |
|---|---|
| Target device | Mid-range Android (Pixel 4a / Moto G 2022 class) in Chrome; iPhone 11 Safari |
| Frame | 60 fps; CPU ≤ 8 ms per frame total |
| Sim tick | ≤ 0.25 ms (5 samples × ≤ 40 parts + pickups) → ≤ 1.25 ms at 5 ticks/frame |
| Guide masks (every 6 ticks) | ≤ 0.8 ms |
| Chunk place + validate | ≤ 4 ms, in idle work, at most 1 per frame, normally 1 per ~6 s |
| Render | ≤ 6 ms. Shadow layer: 1 fill. Casters ≤ 60 visible, ≤ 4 fills each. Particles ≤ 400. Total path fills ≤ 450 per frame |
| Canvas | DPR ≤ 2; shadow layer at half CSS resolution; no shadowBlur, no ctx.filter, no getImageData per frame |
| Memory | ≤ 60 MB JS heap; no per-tick allocations in core hot paths (preallocated scratch Float64Arrays; events array reused) |
| Bundle | ≤ 150 KB gzipped JS+CSS; first paint ≤ 1.5 s on 4G; title interactive ≤ 2 s |
| Input latency | Touch → θ change visible within one frame |

**Governor** (`perf.ts`): rolling mean frame time over 120 frames.
- Above 20 ms: step DPR down 1 → 0.75 → 0.625 (of the cap), then particle cap 400 → 200, then disable ground detail tiles. One step per 3 s; never step back up within a session.
- Exposed in the debug overlay.

---

## 16. Testing plan

### 16.1 Unit tests (Vitest, `tests/unit`)

| File | Covers |
|---|---|
| `architecture.test.ts` | Checks every layer's imports against the §0.1 table (type-only and dynamic imports included) and scans `src/core/**` and `src/config/**` for the forbidden tokens of §0.2 |
| `dmath.test.ts` | 20k random x ∈ [−1e4, 1e4]: \|dsin − Math.sin\| ≤ 1e-15·max(1,\|x\|) (same for dcos, datan2 vs Math.atan2 within 2e-16 relative); literal snapshots of 16 specific outputs (bitwise via DataView hex) |
| `rng.test.ts` | Known first 10 outputs for seeds 1 and 0xDEADBEEF; `rngFor` stream independence; `int` bounds |
| `geom.test.ts` | Hull of random sets (all points inside/on hull, CCW); point-in-convex; segment-vs-convex vs brute-force sampling on 5k cases |
| `clock.test.ts` | ε at noon per day equals the table; ε(0) = 6; `formatClock` ('Day 3 · 2:40 PM' for minutes 2·720+520); day lengths for Days 6-11; `yAtTime` / `timeAtY` round-trip; Long Night keeps y(day start) identical |
| `shadows.test.ts` | Stone 26×26 h130 at ε 48°: shadow length 117 along −u; arch hole lit at noon; tree canopy offset 75·cot; cloud cap 900; glare on the opposite side from the shadow; **property test**: 10k random (p, θ, ε, part) → logic test == pointInPolygon(p, render polygon) except within 1e-6 of edges |
| `intervals.test.ts` | Analytic masks vs brute-force per-bin `litWeight` for 2k random scenes: ≥ 99.5% of bins identical, mismatches only adjacent to interval edges |
| `trail.test.ts` | Catmull-Rom linear-y property; forced ranges honored; clearance helper |
| `generator.test.ts` | Golden hashes of chunks 0-9 for seeds 1, 2, 3 (from `tests/golden/hashes.json`); clearance ≥ 14 for every caster on seeds 1-100; forks fully inside chunks; tutorial chunk 0 equals the authored list |
| `validator.test.ts` | Empty world fails → rescue inserted → passes; sliding-window max equals naive max on random arrays; demand rule triggers on a crafted hedge corridor; across seeds 1-100 × 8 days, no chunk exceeds 8 rescues |
| `sim.test.ts` | Full sun 100 → 0 in 1.82 s ± 1 tick; regen 30/s; profile drains 30/40/47/55 and the endless `cfg.drain` override (`drain.test.ts`); glare doubles drain; multiplier +1 per 4.0 s and reset after 0.15 s lit; PHEW only below 15 and with cooldown 3 s; flake melts after 1.2 s lit (72 ticks) and not beyond 280 u; pickups collected only on matching lane; fork picks the shadier branch with Safe Lane on a tie; night regen; death at Chill ≤ 0; `'hold'` phase freezes the clock until a drag |
| `sun.test.ts` | Catch zeroes ω; release ω from frames; only flicks coast (smoothstep 200-600 °/s); friction decay; ±360 cap; 600°/s follow cap; detent events at each 15° crossing; keyboard rate |
| `determinism.test.ts` | Scripted 3-minute input (sine sweeps + flicks), run twice → equal `hashState` every 600 ticks; record → encode → decode → replay equals live hash; hash equals `golden.hashes.scripted` |
| `deathcause.test.ts` | Crafted scenarios for each of the 5 causes; correct names in the line |
| `share.test.ts` | Glyph strip mapping thresholds; endless and daily text exact strings; assisted marker |
| `challenge.test.ts` | Encode/decode round-trip; rejects malformed codes |
| `daily.test.ts` | `dailyNumber('2026-10-11') === 284`; seed stability; charm rotation |
| `save.test.ts` | Defaults; corrupted JSON → defaults; v1 merge fills missing fields; future version not overwritten; clamping |
| `progression.test.ts` | Wallet math; mission completion/replacement and tiers; charm unlocks by max day; achievements |
| `bots.test.ts` | Idle bot dies before 8:00 AM Day 1 on seeds 1-10; oracle survives Day 4 on seeds 1-5 (fast subset) |

**Golden file.** `tests/golden/hashes.json` is produced by `npm run golden`, which runs `scripts/golden.ts` in Node. It is committed and updated only deliberately (the PR must say why).

### 16.2 Headless simulation (`scripts/sim.ts`)
```
node scripts/sim.ts [--seeds 200] [--days 8] [--bot idle|novice|reactive|oracle|all] [--check] [--csv out.csv] [--charm none]
```
- Runs the real `createRun`/`step` with bot input at maximum speed (no rendering).
- **Bots** (`core/bots.ts`, deterministic):
  - `idle`: holds θ0.
  - `novice`: sees `guide` masks from 12 ticks ago; max 200°/s; targets the nearest bin maximizing a ±6-bin box-blurred shade score with a distance penalty of 0.2 per bin.
  - `reactive`: no lag, ±4 blur, penalty 0.5 per bin, 200°/s.
  - `oracle`: every 6 ticks runs the validator DP over the next 30 steps from its current θ and Chill and follows the argmax path; 240°/s.
- **Report:** per-bot median, p10 and p90 death time; histogram by day; mean safe-angle % by day and hour; rescues per chunk (mean, max); flakes collected/melted %; mean Snow; fork Frost Lane %.
- **`--check`** exits non-zero if any GDD §3.4 acceptance target fails. `sim:check` runs 50 seeds in CI.

### 16.3 Playwright e2e (`tests/e2e`, existing config; projects mobile + desktop)
- **Test hook.** With `?test=1`, `window.__SHADY_TEST__` exposes `{ screen(): string; state(): { phase, day, minutes, chill, snow }; forceDeath(): void; runHeadless(seed: number, ticks: number, bot: string): string /*hash*/; setTimeScale(n: number): void }`.
- **`smoke.spec.ts`**
  1. Load `/?test=1&seed=42`. No console errors or page errors (listener collects them). `canvas#game` has a non-zero size. `screen() === 'title'`. Two screenshots 300 ms apart differ (live title).
  2. Mouse drag across the canvas → `screen() === 'play'`; after 1.5 s, `state().minutes > 0`.
  3. `forceDeath()` → within 3 s, `screen() === 'results'` and the results panel contains "Melted by You". Click Retry → `screen() === 'play'`.
  4. Pause button → `'pause'`. `document.dispatchEvent(new Event('visibilitychange'))` with hidden emulated → remains paused.
  5. Daily screen shows "#" plus the computed number for today, and the Play button reads "try 1/3".
  6. Determinism across engine and Node: `runHeadless(7, 3600, 'reactive')` equals `golden.hashes.headless_7_3600_reactive`.
  7. PWA (desktop project only): the manifest link resolves to JSON with name "SHADY: Don't Melt Nubs"; after load, `navigator.serviceWorker.getRegistration()` is truthy (preview serves the prod build on localhost).
- **`pwa.spec.ts`**: the service worker registers on the preview build and serves the game offline after a reload.
- **`single.spec.ts`** (desktop): builds `dist-single` if it is missing, opens it from `file://`, plays a run to Results without console errors, requests no service worker, manifest or `./assets/` file, and checks that the share text links to `VITE_SHARE_URL` (read from `.env`), never `file:`.
- Further specs cover the lifecycle flows, the render cadence, Back and the history sentinel, other tabs' saves, robustness, keyboard play and the world-column layout (`src/game/README.md` lists them).
- **`layout.spec.ts`** runs at viewports 360×640, 390×844 and 430×932, plus landscape 844×390 on mobile:
  - pause button and results buttons lie inside the viewport and outside a simulated 47 px top inset (CSS var override);
  - the rotate overlay is visible in landscape on the mobile project;
  - screenshots are attached as artifacts (not asserted).
- An optional WebKit iPhone 13 project is enabled when `SHADY_E2E_WEBKIT=1` (needs `npx playwright install webkit`) and runs `smoke.spec.ts` (6) to prove JavaScriptCore determinism.

**CI order** (`.github/workflows/ci.yml`): `npm run typecheck`, `npm test`, `npm run sim -- --check --seeds 50`, `npm run build:single`, `npm run e2e`. Only a green run on `main` (a push or a manual dispatch) builds and deploys GitHub Pages, with `VITE_SHARE_URL` set to the Pages URL.

---

## 17. Debug tooling and URL params (`game/debug.ts`)

| Param | Effect |
|---|---|
| `?seed=N` | Endless seed |
| `?mode=daily&date=YYYY-MM-DD` | Daily run for a date (unscored if not today) |
| `?day=N&t=noon\|dawn\|dusk\|HH:MM` | Start at that day/time (`RunConfig.startDay`/`startT`) |
| `?chill=N` | Starting Chill |
| `?profile=0..3` | Force a difficulty profile |
| `?bot=idle\|novice\|reactive\|oracle\|human` | Autoplay with a bot |
| `?fast=N` | N× ticks per frame (soak/tuning) |
| `?guide=always\|off` | Override the guide |
| `?debug=1` | Overlay (updated 4×/s) with FPS, sim, generation and render ms, caster/particle counts, DPR scale, chunk/rescue counts, ε, θ, f, current hour lit time; toggles to draw the test points, validator masks and shadow polygons as outlines |
| `?mute=1` | Mute audio |
| `?perf=0` | Full quality: no frame-time governor and no low-end device caps (captures, A/B timing) |
| `?test=1` | Test hook |
| `?reset=1` | Clear the save; dev builds only |

Runs started with `?day`, `?t`, `?chill`, `?profile`, `?bot`, `?fast` or `?guide` are debug runs: not saved, scored, shared or counted as Daily tries (the overlay never changes `TUNING`, so determinism holds).

---

## 18. Path to Capacitor (iOS/Android)

1. `npm i @capacitor/core @capacitor/app @capacitor/haptics @capacitor/preferences @capacitor/share @capacitor/filesystem @capacitor/status-bar @capacitor/splash-screen` and `npm i -D @capacitor/cli @capacitor/ios @capacitor/android @capacitor/assets`.
2. `npx cap init SHADY app.shady.game --web-dir=dist`, then `npx cap add ios` and `npx cap add android`. `base: './'` already makes the build work from the app bundle.
3. **Adapters** switched by `platform/native.ts → isNative()` (checks `globalThis.Capacitor?.isNativePlatform?.()`):
   - **Storage:** `PreferencesAdapter`. Preferences is asynchronous and `SaveStore` reads once, synchronously, in its constructor, so at boot `await Preferences.get({ key: 'shady.save' })` and seed the adapter **before** `new SaveStore(...)`; writes are mirrored to localStorage as a backup.
   - **Haptics:** `NativeHaptics` (§11).
   - **Share:** text via `Share.share({ text, url })`. Postcard: `Filesystem.writeFile` (Cache directory, base64), then `Share.share({ files: [uri] })`.
   - **Lifecycle:** `App.addListener('pause' | 'resume')` → pause and audio suspend/resume. `App.addListener('backButton')` → the session's back handler (`Session.handleBack()`, the same path as the browser's Back), and `App.exitApp()` when the Title shows with no modal open.
   - **Status bar:** `StatusBar.setOverlaysWebView({ overlay: true })` and `StatusBar.hide()` during play.
   - **Splash:** `SplashScreen.hide()` after the first rendered frame.
   - **PWA:** service worker not registered when native.
   - **Share links:** a native page has no web address, so challenge links use `VITE_SHARE_URL` (`shareBase()`); point it at the public web build.
   - **Android 15 edge-to-edge:** apps targeting SDK 35 draw under the system bars. Let the shell inset the web view (`adjustMarginsForEdgeToEdge`) or feed the real insets into the `--safe-top/right/bottom/left` properties on `<html>`, which both the DOM layout and the canvas read (`platform/safeArea.ts`).
4. **Orientation lock:**
   - iOS `Info.plist`: `UISupportedInterfaceOrientations` = portrait only; `UIRequiresFullScreen` = YES.
   - Android `AndroidManifest.xml` activity: `android:screenOrientation="portrait"`.
5. **Assets:** `npx @capacitor/assets generate --iconBackgroundColor '#34306B' --splashBackgroundColor '#F6B07C'` from `assets/icon.png` (the 1024 px output of `npm run icons`).
6. **Audio on iOS:** WKWebView WebAudio uses the same unlock-on-first-gesture path. The hardware mute switch silences WebAudio; that is accepted in v1, with a native audio-session plugin Later.
7. **Build:** `npm run build && npx cap sync && npx cap open ios|android`.
8. **Store compliance:** no ads, no tracking, no network calls (privacy label "Data Not Collected"). Age rating 4+.

---

## 19. Implementation order (milestones; each ends green on tests)

1. **Core maths:** `dmath`, `rng`, `geom`, `clock`, `shadows`, `intervals`, plus their tests and `architecture.test.ts`.
2. **World:** `trail`, `catalog`, `placer`, `validator`, `world`, generator/validator tests, `scripts/sim.ts` with the idle and oracle bots.
3. **Sim:** `types`, `create`, `step`, `sun`, `nubs`, `pickups`, `forks`, `guide`, `deathcause`, `hash`, `replay`; sim/determinism tests; golden file.
4. **Greybox playable:** `canvas`, `camera`, `loop`, `input`, `renderer` (ground, trail, shadow layer, prisms, Nubs, sun glyph); Title hold → play → death → instant retry.
5. **HUD and Results:** HUD, Melt Map, results panel DOM, pause, UI state machine, save v1 and progression.
6. **Audio:** engine, recipes, music, router; haptics.
7. **Juice:** particles, rings, pops, slow-mo/hit-stop, palette LUT, materials, clouds/balloons/glare visuals, chevrons, sun faces.
8. **Meta:** Daily, missions, achievements, wardrobe, charms, atlas, share text, challenge links, postcard.
9. **Onboarding:** tutorial overrides, ghost thumb, guide Auto rules, gentle tuning.
10. **Polish and shipping:** PWA (manifest, SW plugin, icons script), perf governor and profiling on device, e2e smoke + layout.
11. **Tuning:** iterate `days.ts` until `npm run sim:check` passes the GDD §3.4 targets, then hand-playtest the first 60 seconds against the GDD §4 beat list.
