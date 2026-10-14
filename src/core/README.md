# SHADY core

`src/core` (with its data in `src/config`) is the whole game: sun control, shadows, Nubs, Chill,
scoring, the seeded world, the fairness validator, bots and replays. It is pure and deterministic:
no DOM, no clocks, no `Math.random`, no engine-dependent maths. Everything else (`src/game`,
`render`, `audio`, `ui`, `meta`, `platform`) drives it and draws it.

Import from **`src/core/index.ts`** (the public API). Everything listed below is exported there.

```ts
import { createRun, step, takeSnap, lerpSnap, queryCasters, partShadow, TUNING } from '../core/index.ts';
```

---

## 1. Ground rules

- **Layering.** `src/config` imports nothing. `src/core` imports only `src/core` and `src/config`.
  `tests/unit/architecture.test.ts` enforces the whole table on every layer, reading imports from
  the AST (type-only imports count too): platform → platform; meta → meta/core/config/platform;
  ui → ui/meta/core/config/platform; audio → audio/core/config/platform; render →
  render/core/config/meta/platform plus `../game/camera.ts` and `../game/assist.ts`; game (and
  `main.ts`) may import anything. One type-only exception is listed in the test
  (`platform/haptics.ts` → `core/sim/events.ts`) until its owner moves the type.
- **Banned tokens** in both folders (same test): `Math.random`, `Date`, `performance`,
  `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot/cbrt`, the hyperbolic
  `sinh/cosh/tanh/asinh/acosh/atanh`, `log2/log10/log1p/expm1`, the `**` operator, `toFixed`,
  `toPrecision`, `toExponential`, `toLocale*`, `parseFloat`, `Intl`, `crypto`, `globalThis`,
  `self`, `window`, `document`, `localStorage` and `Float32Array`. The check runs on a TypeScript
  scanner pass that drops only comments, string literals and template text, so code inside
  template `${…}` expressions and after regex literals is checked too.
- **Determinism.** Only `+ − * /`, `Math.sqrt/floor/ceil/round/trunc/abs/min/max/sign/imul` and the
  fdlibm ports in `dmath.ts`. Same seed + same input frames ⇒ bit-identical state on V8, JSC and
  Node. Time is integer ticks; dTheta/release arrive pre-quantized.
- **Never mutate sim state from outside `step()`.** The renderer only reads. Pickups are the one
  world object with mutable fields (`melt`, `state`), and only `step()` writes them.
- **Hot path.** `step()` does not allocate per tick (scratch arrays are module-level; the events
  array is reused; event objects are allocated only when an event fires).

## 2. Coordinates and conventions

| Thing | Convention |
|---|---|
| World unit | **u**. x east (right), y north (up the screen, walking direction), z up. Visible width 360 u (`TUNING.viewWidth`). |
| Oblique projection (render) | a point at height z is drawn 0.25·z higher on screen. The core never applies it. |
| Polygons | flat `Float64Array` `[x0, y0, x1, y1, …]`, **counter-clockwise** in world space (x right, y up). |
| Sun azimuth θ | degrees in [0, 360): 0 east, 90 north, CCW positive. Light comes **from** θ. |
| Sun vector | `u = (ux, uy) = (cos θ, sin θ)` points toward the sun. Shadows fall along −u. |
| Elevation ε | degrees; `ε(t) = 6 + (εnoon − 6)·sin(π t/Dl)`, 0 at night (`sunUp === false`). `cot = 1/tan ε`. |
| Shadow length | a point at height h shades `p − u·min(h·cot, 520)`; clouds use `min(300·cot, 900)`. |
| Glare spot | circle r 22 at `ball + u·min(40·cot, 160)`, active while ε ≥ 8°. Glare is on the **sun** side. |
| Angular bins | 360 bins, bin b ≡ θ = b° exactly (`binOf(θ)` rounds). Masks are `Uint8Array(360)`. |
| Coverage samples | 5 ground points: `SAMPLE_DX/DY` = center, east, west, north (front), south (back), ±5.5 u. |
| Time | 60 Hz ticks (`TICK_HZ`, `DT = 1/60`). Day N = `dayTicks(N)` daylight ticks + `nightTicks(N)` night ticks (whole numbers). |
| Absolute time | `tickAbs`/`tAbs` count from **Day 1 dawn** in every run (clouds and the validator use it). |
| Score | `minutes = (day − 1)·720 + floor(720·t/Dl)`; 720 through the night. |

## 3. Running a run

```ts
const s = createRun({ seed, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });
// Title: s.phase === 'hold' — clock, Nubs and Chill frozen; the scene (coverage, guide) is live.
// Each fixed 60 Hz tick:
takeSnap(s, prev);          // for interpolation
step(s, frame);             // one InputFrame per tick
for (const e of s.events) route(e);   // valid until the next step()
```

### `RunConfig`
`{ seed, mode: 'endless'|'daily'|'challenge', profile: 0|1|2|3, tutorial, reducedMotion,
startDay?, startT?, startChill?, dailyDate?, drain?, noonCloud?, lesson?, forecast?, plan? }`.
`startDay`/`startT` (seconds after that dawn) and `startChill` are debug hooks. v1.1 (CC-1, A1):
- `noonCloud?: 0 | 1 | 2` — the Day-1 parked training cloud (1 = 11:00 AM-1:00 PM, 2 = 11:30 AM-
  12:30 PM, 0 = none); unset = 1 for profiles 0-2, 0 for 3 (`effectiveNoonCloud`). World identity.
- `lesson?` — the first-run lesson floor (Chill ≥ 12) until `lessonDone` (CC-5, A5), then held to daylight
  tick 750 and faded out over 600 ticks (`lessonGrace`); no world effect.
- `forecast?` — debug: that forecast on every day it fits (A8), Day Plan on.
- `plan?` — the Day Plan on or off; `World.planOn = forecast !== undefined || (plan ?? (profile
  === 3 && !tutorial))`. Dailies set `plan: date >= PLAN_START_DATE` ('2026-10-14'); challenge
  codes carry it (`pl`).
- `drain?` overrides the profile drain (30 / 40 / 47 / 55 for profiles 0-3) through
  `effectiveDrain(s)`; the world and its validator always use the profile drain.

**Comfort ladder (CC-2 with A2).** Endless runs take their rules from `rungConfig(rung, {
tutorialDone })` → `{ profile, drain, noonCloud, tutorial: rung === 0, lesson }` over
`COMFORT_RUNGS` (`COMFORT_MAX = 4`):

| Rung | Profile | Drain | Noon cloud | |
|---|---|---|---|---|
| 0 | 0 | 30 | 1 | tutorial, lifetime run 0 only |
| 1 | 1 | 35 | 1 | a gentle floor (fix round 1) |
| 2 | 2 | 38 | 1 | classic clear days |
| 3 | 3 | 42 | 1 | the Day Plan |
| 4 | 3 | 55 | 0 | standard: the Daily's rules |

`comfortAfterRun(rung, minutes, prev?)` (`COMFORT_STEPS = { standard: 1440, up: 390, down: 300 }`;
`prev` = the endless run before, `{ rung, minutes }`): from rung 0, Day 3 → 3, else 1; from rungs
1-2, Day 3 → 3, past 12:30 PM one up, before 11:00 AM one down (not below 1); standard (4) only
from R3, after two R3 runs in a row past 12:30 PM or one into Day 3 (before 11:00 AM → 2); from 4,
before 11:00 AM → 3. The first run at 4 after R3 (`isWarmup(rung, prevRung)`) is the warm-up:
`rungConfig(4, { tutorialDone, warmup: true })` plays `STANDARD_WARMUP` (p3, drain 48, noon cloud 1).
Meta stores the rung (`stats.comfort`) and marks the warm-up in the history (`w: 1`).

### Building a run in slices
`createRun(cfg)` generates the world through Nubs + 1600 u at once (≈ 20-60 ms in Node for Day 1).
To spread that over frames: `const b = prepareRun(cfg)` (cheap: the start hut only), then
`prepareSome(b, units)` each frame until it returns true, then `createRun(cfg, b)`, which only does
what is left. The run is identical however the work was sliced (`determinism.test.ts`). The session
uses it to build the next endless run while a death and the Results play.

### `InputFrame` (V1_PLAN §3.1, produced by `src/game/input.ts`)
`{ dTheta, down, downEdge, upEdge, release, key }`. `dTheta` is degrees requested this tick
(already `−dx/viewW·360·sensitivity·(invert?−1:1)`, quantized to 1/1024°); `release` is °/s on the
`upEdge` tick (quantized to 1/64), else 0; `key` is +1 CCW (Left/A), −1 CW (Right/D), else 0.
A tap within one tick is `downEdge && upEdge`. `NO_INPUT` is a frozen empty frame.

### Starting
In `'hold'`, `step()` ignores everything until a frame with `downEdge` **or** `key ≠ 0`. That frame
emits `start`, applies catch semantics, and **θ stays exactly θ0** (its dTheta/key are discarded).
For Space/Enter send one tap frame (`{downEdge: true, upEdge: true}`). The Title sway is
render-only: add it to the displayed θ and drop it at start.

**Start beat.** The start tick opens `s.ready = TUNING.start.readyTicks` (48 ticks, 0.8 s) of
`'day'` ticks in which the sun follows the input and coverage is live, but the clock, Nubs' walk,
Chill, the multiplier, pickups and the guide wait (`s.tick` still counts). `go` fires on the last
beat tick and the clock runs from the next one. Every run (Title, Retry, Restart, Daily, challenge,
debug starts) therefore opens with ~1 s before Nubs can be lit: the beat plus the ~0.2 s the start
hut's θ0 shade lasts. Because the clock is frozen, the world, the score and an idle player's fate
are exactly as without it. Draw Nubs standing (not walking) while `s.ready > 0`.

**Start hut.** In generated (non-tutorial) worlds no caster stands on the start hut's side of the
trail for y ∈ (0, `START_HUT.clearAhead` = 140 u): the hut's shade at θ0 ends ~15 u in, and holding
θ0 must stop working soon after so the idle bot dies before 8:00 AM (V1_PLAN §13) — the first swing
is the run's first lesson. `world.startSide` is the hut's side.

### Sun state machine (`sun.ts`, V1_PLAN §3.3)
`s.sun = { theta, lag, omega, omegaRel, mode, detent, dTheta }`; target = `wrapDeg(theta + lag)`
(lag is unwrapped so a fast 270° swipe goes the long way). `mode` is `'idle'|'dragging'|'chasing'|
'coasting'` — show detent ticks/rotation arrow while `dragging`; `sun.dTheta` is this tick's signed
change. Follow rate `sunMaxRate(reducedMotion, eps)`: 600°/s, 450 while ε < 15°, 300 reduced.

**Only genuine flicks coast (K1).** On `upEdge` the stored release speed is
`ω_rel = clamp(release · smoothstep(flickMin, flickFull, |release|), ±cap)` with
`TUNING.sun.flickMin/flickFull` = **200/600 °/s** of requested angle and cap 360°/s (180 under
reduced motion). A lift below 200°/s stops where the finger left it, 400°/s coasts at 200°/s,
300°/s drifts < 15°, and 600°/s and up coast at the full cap (≈ 104° of travel at 360°/s). Catching
a coasting sun is unchanged. `smoothstep(a, b, x)` lives in `dmath.ts`.

### Phases
`'hold' → 'day' ⇄ 'night' → … → 'dead'`. Daylight ticks are `dayTick ∈ [0, dayTicks(day))`; the
tick reaching `dayTicks(day)` starts the night; the tick ending the night is dawn (`day + 1`,
`dayTick = 0`, Chill refilled). After `'dead'`, `step()` is a no-op and `s.death` is set.

## 4. `SimState` fields the game reads

| Field | Meaning |
|---|---|
| `phase`, `tick` | phase; sim ticks since start (hold excluded, the start beat included). |
| `ready` | start-beat ticks left (> 0: the clock, Nubs and Chill wait; the sun moves). |
| `day`, `dayTick`, `tDay`, `params` | current day, ticks/seconds since its dawn, its `DayParams` (biome, εnoon, v, Dl, …). |
| `tickAbs`, `tAbs` | absolute ticks/seconds since Day 1 dawn (pass `tAbs` to cloud functions). |
| `minutes` | score so far (`formatScore(minutes)` → "Day 2 · 2:40 PM"). |
| `eps`, `tanEps`, `cot`, `sunUp`, `ux`, `uy` | sun this tick (0 / false at night). |
| `theta0` | initial azimuth (from Nubs at y 0 to the start hut's center). |
| `sun` | see §3. |
| `nubs.x/y` | Nubs' ground point (he walks the centerline: `x = trailX(y)`). |
| `nubs.w` | `Float64Array(5)` lit weight per coverage sample (0 shaded, 1 lit, 2 glare), order C, E, W, N, S — use for the footprint disc rim and left/right/front partial-shade tint. |
| `nubs.f`, `nubs.glare` | mean lit weight Σw/5 ∈ [0, 2] (0 = fully shaded); samples in glare. |
| `nubs.chill`, `nubs.maxChill` | Chill (0..100). |
| `nubs.mult` | Frost multiplier 1..5. |
| `nubs.cloudId`, `nubs.rideTicks` | cloud fully covering Nubs now (−1) and how long (ticks). |
| `nubs.glareBallId` | ball whose glare touches Nubs now (−1). |
| `guide.now/next/glare/lit`, `guide.sunUp`, `guide.tick` | §6. |
| `stats` | `RunStats` (events.ts): Snow, flakes, PHEWs, best ×5 hold, cloud rides, balls, gate, days, nights, lit total. |
| `hourGlyphs` | `HourGlyph[][]`, one array per day played (12 for finished days; the death hour is `'melt'`). |
| `death` | `DeathInfo` once dead (line, cause, time, x/y, `lastId/nextId/ballId` to pin on the Melt Map via `world.byId`). |
| `world` | the `World` (§5). |
| `events` | `SimEvent[]` of the last step. |

Clock strings: `hudClock(day, dayTick)` ("2:40 PM", 10-minute steps), `exactClock(day, dayTick)`
("2:47 PM"), `formatScore(minutes)` ("Day 2 · 2:47 PM"). Ruler helpers:
`dayTicks(day)`, `noonBannerTick(day)`, `noonPassedTick(day)`, `hourTicks(day)`, `minutesOfDay`.

### Events (`src/core/sim/events.ts`)

| Event | When |
|---|---|
| `start` | first touch/key in hold (the start beat begins). |
| `go` | last tick of the start beat; Nubs sets off on the next tick. |
| `detent {dir, index}` | θ crossed the 15° line `index·15°` (dir +1 CCW). Feedback only. |
| `catch {omega}` | touch-down while |ω| > 90°/s. |
| `flake {mult, degree, x, y, snow}` | flake collected; `snow` = Snow awarded (= mult); `degree` = (flakes today + mult) mod 10 for the bell. |
| `crystal {mult, x, y, snow}` | ice crystal (+5·mult Snow, +35 Chill). |
| `flower {x, y, snow}` | frost flower at night (+2). |
| `flakeMelt {x, y}` | a flake or crystal melted (throttle the "tss" in audio). |
| `shadeEnter {litFor}` / `shadeExit` | f went lit → 0 (after `litFor` s lit) / 0 → lit. Daylight only. |
| `multUp {level}` / `multReset {from}` | multiplier +1 after 4 s in full shade / reset after 0.15 s lit. |
| `phew` | PHEW (+3 Snow): shade found below T with recent Chill ≥ 40 and the latch open. |
| `noonBanner` / `noonPassed` | t = Dl/2 − 2 s / t = 0.6·Dl. |
| `nightStart {day}` / `dawn {day}` | sunset / new day (Chill refilled). |
| `hourEnd {day, hour, glyph}` | an in-game daylight hour finished (hour 0..11). |
| `cloudCapture {id}` | a cloud first fully covers Nubs. |
| `glareTouch {ballId}` | glare starts touching Nubs. |
| `lowChill` | Chill crossed below 25. |
| `gateArch {noon}` | Nubs walked under a gate arch (`noon`: between 11:00 AM and 1:00 PM). |
| `ballPassed {clean}` | a gazing ball fell out of glare reach behind Nubs; `clean` = it never glared him. |
| `death {info}` | Chill hit 0 in daylight. |

`buildRunResult(s)` → `RunResult` (melody empty; `assisted` false — the session fills both).

## 5. The world

`s.world: World` holds y-sorted `casters`, `byId: Map<id, Caster>`, `clouds`, y-sorted `balls` and
`pickups`, the `trail`, `theta0`, `startHutId`, and generation progress/stats.

### Range queries (fill a reusable `out` array, return the count)
- `queryCasters(world, y0, y1, out)` — casters whose ground bounds overlap [y0, y1], **sorted by
  center y** (draw in descending y for depth). For shadows use a wider window (`y0 − 600`, `y1 +
  600`): shadows reach 520 u.
- `queryPickups(world, y0, y1, out)` — every state; skip `state !== PICKUP_ALIVE` or animate it.
- `queryBalls(world, y0, y1, out)` — gazing balls (mirror at `BALL_Z` = 40 above the ground).
- `queryClouds(world, tAbs, out)` — clouds alive at `tAbs`.

### Casters (`objects.ts`)
`{ id, kind, name, biome, x, y, rot, parts, hull, hullN, minX..maxY, maxZ, side, rescue, gate,
ballId, chunk }`. `kind` ∈ hut, tree, oak, cottage, stone, hedge, house, arch, stall, column, wall,
pedestal (gazing ball stand), rock (validator rescue "Shade Rock", `rescue: true`). `rot` in degrees
(multiples of 15). Parts:
- `prism {pts, n, h}` — solid block: footprint polygon, height h (draw side faces + top at 0.25·h).
- `slab {pts, n, z0, z1}` — floating plate (arch lintel z 70-90, stall roof z 40-46).
- `disc {cx, cy, r, z}` — tree canopy at height z.
`hull` is the ground footprint of the solid parts (canopies excluded); `gate` arches straddle the
trail. Names are re-drawn (up to 16 times) to avoid repeats within ±800 u, so death lines tell casters apart.

### Shadows (exactly the sets the sim tests — see `shadows.ts`)
- `partShadow(part, ux, uy, cot, out)` → prism/slab: CCW convex polygon in `out` (≤ 6 vertices; give
  it 16 slots), returns the vertex count; disc: writes `[cx, cy, r]`, returns −1.
- `cloudShadow(cloud, tAbs, ux, uy, cot, out)` → `[cx, cy, rx, ry]` (axis-aligned ellipse).
- `glareCenter(ball, ux, uy, cot, out)` + `glareActive(eps)`; radius `TUNING.glare.radius`.
Fill all polygons, circles and ellipses of the frame into one path with one opaque color (all CCW in
world space, so `nonzero` unions them; under a y-flipped transform pass the arc direction matching
the polygons). No shadows at night (`sunUp === false`).

### Clouds
`{ id, kind: 'overtaker'|'waiter'|'parked', t0, life, x0, y0, vx, vy, rx, ry, z: 300, lumps }`.
Body center at `tAbs`: `cloudCenter(cloud, tAbs, out)`; draw it at oblique height 0.25·z. `lumps`
is a render-only `(dx, dy, r)·n` list. `cloudVisibility(cloud, tAbs)` gives a 0..1 fade for its
first/last 1.5 s (validator "parked" clouds pop in near Nubs; fade them).

### Trail, biome, pickups
`trailX(world.trail, y)`, `trailSlope(world.trail, y)` (dx/dy), half-width `TUNING.trail.halfWidth`;
`tutorialStraightRange(trail)`. `biomeAtY(w, y)` (the Day Plan's biome; nights keep their day's),
`worldDayAtY(w, y)`. Pickups `{ id, kind: 'flake'|'crystal'|'flower', x, y, day, melt, state }`
— `melt` is lit seconds (melts at 1.0: shrink it), `state` 0 alive / 1 taken / 2 melted.

## 6. Guide masks (halo dial)

Every 6 ticks (`guide.tick` = the sim tick of the update) `s.guide` holds, per whole degree b:
- `now[b] = 1` — the sun at b° fully shades Nubs (all 5 samples, no glare): solid teal arcs;
- `next[b] = 1` — same 0.6 s ahead: dashed arcs;
- `glare[b] = 1` — some sample would be in glare: red hatched arcs (always shown);
- `lit[b]` — lit counts 0..10 (f = lit/5) for the current position.
All zero at night (`guide.sunUp === false`). `guide.lit[b]` equals the per-tick coverage with θ = b°
(tested), so arcs are exactly where shade is.

## 7. Interpolation

```ts
const prev = createSnap(), curr = createSnap(), view = createSnap();
takeSnap(s, prev); step(s, f); takeSnap(s, curr);   // per tick
lerpSnap(prev, curr, alpha, view);                   // per frame, alpha = acc / DT
```
`RenderSnap` = `{ tick, tAbs, day, dayTick, phase, nubsX, nubsY, theta, ux, uy, eps, tanEps, cot,
chill, f, mult }`; θ blends along the short arc, ε does not blend through night. Rebuild shadow
polygons from `view.ux/uy/cot` and cloud positions from `view.tAbs` every frame.

## 8. Melt Map history

Every 20 u of y the sim records `(x, y, chill, f)`. `historyLength(s)` (≤ 1024 ≈ 20 000 u) and
`historyAt(s, i, out)` (oldest first) read it. Casters behind Nubs − 900 u are pruned; `death.lastId`
/`nextId` casters are always still in `world.byId` at death.

## 9. Generation, idle work and performance

The world is a fixed job sequence — place(−1), place(0), place(1), validate(0), place(2),
validate(1), … — drawing only from streams keyed by (seed, purpose, index), so it is a pure function
of (seed, profile, tutorial): generating early, late, in one go or in slices yields the same world
(tested, including live-play hashes).

- `step()` guarantees the world is validated through `nubs.y + 1600` (`ensureGenerated`) — a
  fallback that can cost a whole chunk in one tick.
- **Call `generateSome(world, nubs.y + TUNING.world.idleAhead, budget)` in idle time every frame**
  (returns true when caught up). `budget` is in work units: 1 unit ≈ one validator step
  (~0.02 ms in Node, ~0.05 ms on a mid phone); placing a chunk costs 8. A budget of 8-16 per frame
  keeps slices under ~1 ms; a chunk is ~60 units (p99 ~150).
- `validatedY(world)` and `world.stats` (`chunksPlaced/Validated`, `rescues`, `rescuesPerChunk`,
  `parkedClouds`, `unresolved`, `dropped`, `work`) feed the debug overlay.

Measured in Node 22 (this container, 100 seeds × 8 days): gen + validate **≈ 1.5-1.6 ms/chunk**
mean (p50 1.3, p90 3.6, p99 7.6 ms); 8-unit slices p99 ≈ 1 ms; **step ≈ 9-11 µs/tick** with the
guide (oracle runs, world pre-generated, bot excluded). In headless Chromium a reactive-bot run
costs ≈ 30 µs/tick including in-step generation and the bot. Expect 2-3× on a mid-range phone.
The whole core bundles to ≈ 80 KB minified / 26 KB gzipped.

### Validator (V1_PLAN §7.4)
DP over 360 bins in 0.1 s steps with the human model (±18 bins/step, a bin is safe only if safe at
the previous, current and next step), clouds as circles of radius ry, glare included, profile
drain. Failure (best Chill < day floor) → a Shade Rock (30×30, h = clamp(40·tan ε + 20, 60, 160),
nearest edge 20 u), ≤ 8 per chunk; then a parked cloud at distance R(ε) riding at v for 6 s (≤ 2
per chunk); then the failure is counted in `stats.unresolved` (target 0). Each chunk's job re-runs
the last 2 s of the previous chunk so a deficit that started before a chunk boundary can still be
rescued where it built up (adding shade never invalidates earlier chunks). Rescue rocks are aimed:
among the failure point and wall slots ±4 rock lengths along the trail, on either side, the rock
that fully shades the DP's best reachable angles for 3 consecutive steps wins.

## 10. Bots, headless runs, replays, hashes

- `createBot(kind, salt = 0)` → `{ kind, next(s): InputFrame }` for
  `'idle'|'novice'|'reactive'|'oracle'|'human'|'humanDial'` (`BOT_KINDS`); `next` returns a reused
  frame; `salt` gives the human models another decision stream.
  Parameters in `TUNING.bots`.
- **`human`** is a seeded model of a new player, for tooling only (the sim's advisory rows and
  `?bot=human`). It seeds itself from `s.cfg.seed` on its first `next()` (`rngFor(seed, 'bot',
  'human')`), draws a reaction lag of 250-350 ms per decision and sees the guide masks that late,
  acts only when that stale view shows Nubs lit or the sun's current angle unsafe, aims with
  N(0, 10°) noise and a ±N(0, 0.2) over/undershoot, drags with a minimum-jerk profile lasting
  120 ms + 0.9 ms/°, lifts at ω = 0 and pauses 120 ms (`TUNING.bots.human`). Deterministic per seed.
- `runBot(cfg, ticks, kind)` → final state; `runHeadless(seed, ticks, kind, profile = 3)` → hash
  (the `__SHADY_TEST__.runHeadless` hook); `headlessConfig(seed, profile, drain?, noonCloud?)`
  (lesson on for profile 0).
- `hashState(s)` — 16-hex digest of tick-determined state only (clock, Nubs, sun, Snow/pickup
  counters, casters and pickups < 1000 u ahead); generation progress is deliberately excluded.
- `createReplay(cfg)`, `recordFrame(replay, frame)`, `playReplay(replay, onStep?)` — in-memory.
- `node scripts/sim.ts [--seeds N] [--days D] [--bot B|all] [--profile P] [--forecast F] [--check]
  [--margin PTS] [--workers W]` — balance report and the V1_PLAN §13 check on the plan mix (exit 1
  on failure); `--check` also runs every forecast forced at the same seed count (A16). Rows print
  death-time quantiles, `melted%`, first-night share, median run seconds, Snow, SWINGs per minute and
  lit share. **ADVISORY** rows run the perception-limited human model (A6) at rungs R0-R4 against
  the V1_1_PLAN §6 targets and never fail `--check`.
- `node scripts/sim.ts --career N [--runs R] [--bot B] [--meta]` — comfort-ladder careers; `--meta`
  folds every run through the meta API (A14).
- `node scripts/golden.ts` — rewrites `tests/golden/hashes.json` (do it only deliberately).

## 11. Tuning

`src/config/tuning.ts` (`TUNING`, frozen) holds every constant; `src/config/days.ts` holds the day
table, the Day ≥ 7 ramp, `PROFILES`, the comfort ladder and `dayParams(day, profile, plan, mods)`;
`src/config/casters.ts` holds caster geometry, biome mixes, names and the authored tutorial chunk.
Changing any of them changes worlds: re-run `npm run sim -- --check` and `node scripts/golden.ts`.
`sim --check` fails a target that passes by less than 3 percentage points of seeds (`--margin`).

- **Day-1 wave.** Day rows carry `waveA`/`waveB` (Day 1: 0.75 / 0.65; later days 1 / 0): the gap
  after a caster at daylight time t is `spacing · (waveA + waveB·sin⁴(180°·t/Dl)) · U(0.7, 1.3)`, so
  Day 1 is dense at dawn and dusk and 1.4× sparser at noon (day mean 0.994).
- **Flakes** melt after `TUNING.pickups.meltBudget` = 1.2 lit seconds (never above 1.3).
- **Death line**: a cloud is blamed only within ±60° of θ one second before death.
- **SWING** needs a ≥ 38° hand-off (45° until v1.3): a reactive player SWINGs 1-2 times a minute.
- Measured numbers live in `docs/V1_1_PLAN.md` §0 and `docs/CAMPAIGN_PLAN.md` (v1.3 tables).

## 12. Decisions beyond the docs

- Slab logic is the exact swept test (segment [p + u·R(z0), p + u·R(z1)] vs the footprint), so it
  matches the rendered hull exactly (GDD's 3-height sampling would not).
- PHEW compares the Chill *before* the tick that found shade with T.
- Up to 2 parked validator clouds per chunk (one per failure that survives the rocks).
- The tutorial's θ0 points east (start hut on the right), right-hand casters shade the first 2.5 s
  (95%), then the shade moves to the left; flakes sit in the post-swing shade at y 300/324/348.

## 13. v1.1 additions (V1_1_PLAN CC-1..CC-7, CC-18)

- **Day Plan (CC-3).** `FORECASTS`/`FORECAST_IDS`; `planDay(seed, day)` (pure; Day 1 biome by coin
  flip, then alternating; weighted forecasts, never the same non-clear forecast twice in a row);
  `worldPlan(w, day)`, `paramsAt(w, day)`, `firstTownDay(w)`, `biomeAtY(w, y)`. Forecasts never
  change day length, night length, v or drain.
- **SWING (CC-4)** `{ e: 'swing', deg, chain, snow, x, y }`; **lesson (CC-5)** `{ e: 'lessonDone' }`,
  `SimState.lessonOn`; **keys (CC-6)** `InputFrame.key` −2..2; **Results (CC-7)** `RunResult.drain`,
  `noonCloud`, `plan`, `deathTip`/`deathRecap` (`sim/recap.ts`), `createParJob(dateSeed)`.

## 14. Campaign (CAMPAIGN_PLAN, core scope)

The contract (names and shapes) is `docs/CAMPAIGN_PLAN.md` §2-§3; everything is exported from
`src/core/index.ts`. Data: `src/config/campaign.ts` (levels; re-exports `src/config/concepts.ts`).

- **Concepts.** `Concept { id, name, title, blurb, icon, kind, tune?, level? }`: `name` is the
  concept's own short name ("Glare"), `title` the title of the level that teaches it ("Glass
  Garden"). `level.cost` is what the concept is worth in drain points; `level.drainCap` caps the
  effective drain (lock/gusts 40, eclipse 45). `foldTuning` multiplies the ×-knobs, adds `latMax`
  and lets the last override win.
- **Curve.** `drain = (curve(id) − Σ cost) / drainMul`, clamped to 22-55 (effective ≤ 62). The
  curve is a sawtooth: teaching chapters 28 → 34 (finales +6), composed chapters from 32-39
  (chapter 5) to 41-48 (chapter 20), each finale 7 above its chapter's base. Lengths: teaching
  levels 240 (chapter 1) / 300 minutes from dawn, their finales an hour longer; composed chapters 360 → 720
  with the first two levels of each 30 minutes shorter. Time concepts keep their own windows.
- **Goals and stars.** Flake goal 55% of the flakes the level offers (`expectedFlakes`), Snow goal
  0.7 Snow per flake (min 5). `starsFor`: 1 for passing, +1 for flakes ≥ `stars.flakes` (65%, 80%
  on flake-goal levels), +1 for a cool run: `litTotal ≤ stars.sunSec` (22% of the level's daylight)
  and `minChill ≥ stars.minChill` (20% of the tank). `LevelStats.litTotal` is optional (0).
- **Running a level.** `campaignConfig(id, base?)` / `resolveLevelConfig(cfg)` make the level the
  world's identity (seed, profile 3, plan off, mods, biome, drain, start, forecast). The world
  carries `level`, `mods`, `walkMul`, `heightScale`, `startY`, `finishY` (a `finish` caster stands
  there), `gateY`, `eclipseTick`, `validatorDrain` (the level's). Every y ↔ time reader goes
  through the `world*` functions in `gen/plan.ts` (sprint/stroll scale the world, not the clock).
- **Sim state.** `s.level`, `s.mods`, `levelProgress(s)`; `phase 'won'` + `{ e: 'levelWon',
  passed, stars, flakes, minChill }` at the line; `RunResult.level`. `s.sun.gust`, `s.sun.locked`
  (`sunGustAt`, `sunLockedAt`), `s.eclipse`/`s.eclipseOn` (`eclipseAt`), `s.moonlit`.
- **Behaviour concepts.** heavy (follow ≤ 220°/s, no coast), slippery (coast e^(−0.35/60)/tick),
  clockwork (release snaps to 30°), gusts (2 s of ±25°/s every 8 s), lock (1.2 s every 7 s),
  dazzle = Mirror Sun (every turn of the input reversed; the bots know), eclipse (6 s of f = 0 at the
  midpoint, then the sun returns 180° away), fog/blind (render only).
- The oracle plays for stars on a level (a 12-Chill margin, shaded bins preferred) and knows the
  lock schedule. `node scripts/sim.ts --campaign [--level N,…] [--bot …] [--tries N]` prints every
  level, a per-chapter pass/stars table and the gates (hard: oracle 200/200, reactive ≥ 95% of
  1-100; advisory: humanDial ≥ 75% of 1-40 and ≥ 90% of 1-10). `--tries N` replays the human
  models with N decision streams (`createBot(kind, salt)`).

## 15. v1.5 core mechanics (docs/V1_5_PLAN.md)

Three mechanics, on in every endless/daily/challenge run (`World.mech`, all true) and in the Journey
from the level that teaches each (`mechanicsOf(levelId)`: deep shade 5, Sunflowers 8, Cold Snap 10;
off before). `RunConfig.mechanics?: Partial<Mechanics>` overrides them (debug, part of the world's
identity). Code: `sim/mechanics.ts` (buds, frost, snap), `computeCoverage`/`applyDaylight` (deep).

- **Sunflower buds.** `World.buds` (y-sorted, ids from `BUD_ID_BASE`), `queryBuds`. The generator
  places one every U(3, 5) s of daylight walking (÷ up to 1.5 on later days), moved ≤ 0.6 s into
  the nearest gap between casters, 25-42 u from the centerline, **facing the azimuth that throws
  its bloom's shadow back across the trail 0-120 u before it** (± 20°; "light it from there, its
  shadow falls here"), never within faceTol + 15° of θ0 (then the other side of the trail; an idle
  sun never grows one); never in the tutorial's chunk 0; on
  its own stream, two chunks behind the caster placement, so no generated id, name or caster moves.
  A bud within [Nubs − 30, Nubs + 360] of y grows while the sun shines from within ±15° of `face`
  (`budFacing(b, θ)`) at 1/0.8 s and fades at 0.8/s; at 1 it blooms (+5 Snow, +frost): a caster of
  kind **`'sunflower'`** joins `world.casters`/`byId` for the rest of the run (`bud.casterId` =
  `RUNTIME_ID_BASE + (bud.id − BUD_ID_BASE)`), parts = `[prism stem 8×8 h 44, disc head r 56 at z
  48]` (`SUNFLOWER`, heights × `world.heightScale`): a low, wide head whose shadow lies within
  ~50 u + 48·cot ε of the stem, so it covers the trail beside it over a broad range of θ. `guide.bud[b] = 1` for b within ±faceTol of
  an unbloomed bud in reach (gold arcs), refreshed with the other masks; 0 at night.
- **Frost meter and the Cold Snap.** `nubs.frost` 0..1 fills per second of full daylight shade
  (0.004, ×4 in deep shade), per flake or crystal (0.012), per SWING (0.05) and per bloom (0.12),
  never while a snap is on; `frostReady` fires when it fills. `InputFrame.snap` with a full meter in
  daylight casts a snap: a `Cloud` of kind **`'snap'`** (id `SNAP_ID_BASE + n`, **z 0** so its
  shadow lies right under it at any θ, rx 64, ry 42) that starts on Nubs and rides the trail's chord
  with him for `SNAP_TICKS` (3 s); `s.snapTicks` counts down, `s.snapCloudId` names it (−1 none),
  the meter empties. It never counts as a cloud ride or a SWING source, and the death line never
  blames it. Journey levels start at 0.5 (1.0 on the Cold Snap's own level); endless at 0.
- **Deep shade.** `nubs.deep`: fully shaded with two or more sources (casters or clouds, the snap's
  included) over the center sample. Chill regen ×2, multiplier charge ×2, frost ×4; `deepEnter`
  after ≥ 1 s out of it; `stats.deepSeconds`.
- **Events** `budGrow {id,x,y,grow}` (every 6 ticks per growing bud), `bloom {id,x,y,snow}`,
  `frostReady`, `snap {x,y,cloudId}`, `snapEnd`, `deepEnter`. **Stats** `blooms`, `snaps`,
  `deepSeconds` (always filled). `hashState` covers frost, deep, the snap, the stats and the buds
  within 600 u ahead; replays record `snap`.
- **The world stays a pure function of its config.** Run-made objects (ids ≥ `RUNTIME_ID_BASE`)
  are skipped by the validator (`gatherScene(…, live = false)`), its lit cache and caster spacing,
  so worlds, rescues and goldens of the generator are unchanged by play. The oracle plans with them
  (`stepLitLive`).
- **Debug/screenshot hooks.** `RunConfig.startFrost` (1 = a snap ready at once), `debugBloom(s,
  id?)` (blooms that bud, or the nearest unbloomed one ahead, now; the `bloom` event sits in
  `s.events` until the next step), `RunConfig.mechanics`.
- **Bots.** `createBot(kind, salt, mechanics = true)`: reactive adds gold bins that are safe now
  (any gold while Chill ≥ 55) and snaps when lit and low with no safe angle within 45°; the oracle
  plans with sunflowers and the snap, takes free gold (or any while Chill ≥ 60% off flake goals)
  and snaps when squeezed (campaign: whenever its next step is lit); humanDial snaps when lit under
  30 Chill. Idle, novice and `human` never use them.
- **Journey.** Concepts `deep` (Deep Shade · Double Shade, level 5), `bloom` (Sunflowers · Sun
  Garden, 8), `snap` (Cold Snap · Frost Cloud, 10, the chapter-1 finale); `TEACH_LEVELS` = 40;
  Wide Open, Crowded and Drought are no longer taught alone (they compose); composed levels 41-200
  are unchanged. See docs/CAMPAIGN_PLAN.md §7 for the numbers.
- **Numbers** (`sim --check --seeds 40 --mech`, profile 3; per daylight minute | per day reached):
  buds passed ~13-16 | 11-12 (one every ~4 s); blooms: oracle 6.4 | 4.5, reactive 2.9 | 2.4, novice
  0.5 | 0.4 by accident, idle 0; Cold Snaps (= meters filled): oracle 0.96 | 0.68, reactive 0.45 |
  0.37 (a good player snaps about once every one to two days; a Journey level starts with half a
  meter); deep shade 9-18% of daylight. Sunflowers shade Nubs (alone or in a deep overlap) on 9.5%
  of the oracle's daylight and 5.5% of the reactive bot's (2.1% / 2.8% before their faces were aimed
  and their heads made low and wide). Survival: reactive Day 3 · 11:39 AM (dial) → Day 4 · 9:48 AM
  using the mechanics (+609 min, p90 Day 4 → Day 6); novice 11:08 → 11:34 AM; idle unchanged;
  oracle ≥ Day 8 either way. step() cost is unchanged within noise.
- **sim.** The §13 reactive rows run the bot dial-only (`reactive p3 dial`); `reactive p3` uses the
  mechanics and must outlive it by ≥ 180 minutes (hard). The mechanics table prints blooms, snaps,
  meters filled, buds passed per daylight minute and per day, and deep shade's share. `--mech` adds
  an oracle row without them; `--campaign --nomech` plays the Journey with the bots ignoring them.
