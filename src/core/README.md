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
pickups(0), validate(1), place(3), pickups(1), … — drawing only from streams keyed by (seed,
purpose, index), so it is a pure function of (seed, profile, tutorial): generating early, late, in
one go or in slices yields the same world (tested, including live-play hashes). place(k) puts chunk
k's casters; pickups(k − 2) then places chunk k − 2's flakes (and v1.6 glass, from that chunk's
finished validation job) and buds as a resumable job (v1.6 fix round 2: `placer.ts` beginPickups /
stepPickups; `placeChunk` still runs both at once for tools).

- `step()` guarantees the world is validated through `nubs.y + 1600` (`ensureGenerated`) — a
  fallback that can cost a whole chunk in one tick.
- **Call `generateSome(world, nubs.y + TUNING.world.idleAhead, budget)` in idle time every frame**
  (returns true when caught up). `budget` is in work units: 1 unit ≈ one validator step
  (~0.02 ms in Node, ~0.05 ms on a mid phone); placing a chunk's casters costs 8, a validation
  rescue 8, a glass contest stage its lit rows plus its Chill-DP slot-layers / 25 (a stage starts
  only as a slice's first work or when it fits the budget left). A chunk is ~60 units (p99 ~150).
  Measured (fix round 2, `node scripts/bench-step.ts --gen`: generateSome(w, y + 2400, 12) a frame
  at walking pace, Node): slices p50 0.14 ms, p99 ~1.2 ms, max ~3-5 ms (one rescue), as v1.5
  (p99 1.08, max 3.3 ms); before the round a placement ran up to six glass contests at once (20 ms).
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
  blames it. Journey levels start at 0.5 (1.0 on the Cold Snap's own level); endless at 0 (v1.6 fix
  round 2: half a meter, §16.1).
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

## 16. v1.6 contract (docs/V1_6_PLAN.md §10, minus amendment A1)

The base commit of v1.6: every shape below exists and is exported from `index.ts`. The contract
landed them as stubs; the owners filled the bodies (§16.1 economy, §16.2 world and Journey), and
since the integration `hashState` reads the new state and the goldens are the merged sim's.
Calibration (§16.3) shipped every rule but the **Frost Bank**; economy iteration 1 (§16.4) prices
the Bank's income and ships it too: `V16_SHIP` (the default of `RunConfig.v16`) is every rule on, and
a run plays the v1.5 frost meter (§15) only when it switches the Bank off.
Owners (§9 as amended by A2): **CORE-1** economy (ring, bank, garden), **CORE-2** world and Journey
(flares, Noon Heat, glass, Dares, guide.deep/flake/flare), **GAME** render, HUD, audio, input and
META's items. Shared files (`sim/types.ts`, `events.ts`, `objects.ts`, `tuning.ts` block shapes,
`hash.ts`, `bots.ts` dispatch and hooks, `scripts/sim.ts`, `index.ts`, this section) change only by
agreement; CORE-1 writes the economy half of this section, CORE-2 the world half. A1: there is no
ruleset 15, `RULES16_DATE`, challenge `r`, dual hashing or `--rules`.

| Shape | Where | Body owner |
|---|---|---|
| `V16Rules`, `V16_ALL`, `V16_NONE`, `V16_RULES`, `V16_SHIP` (the shipped default: every rule on since economy iteration 1); `RunConfig.v16` (unset keys take `V16_SHIP`'s) → `World.v16` (world identity) | sim/types.ts, gen/world.ts | shared (kill switches) |
| `RunConfig.relaxedGoal` (read by `levelOutcome`), `RunConfig.brittleShare` → `World.brittleShare` | sim/types.ts, level.ts | CORE-2 |
| NubsState `ringCharge`, `litStartMult`, `budGrewTick`, `streak`, `swFresh` (Int32Array 16), `swFreshN` | sim/types.ts | CORE-1 |
| NubsState `frostH` (mirrors `floor(100·frost)` until the Bank inverts it), `swingFrostTick` | sim/types.ts, mechanics.ts | CORE-1 |
| SimState `snapBankH`, `snapExt`, `snapBlooms`, `landTicks` (−1), `landHold`, `landSrc` | sim/types.ts | CORE-1 |
| SimState `clusterId`, `clusterTaken`, `clusterBroken`; `flareIdx`, `flareId`, `flarePhase`, `flareLit`, `flareTicks` | sim/types.ts | CORE-2 |
| GuideState `land` (CORE-1); `deep`, `flake`, `flare`, `flareTicks` (CORE-2); all 0 / −1 for now | sim/types.ts | as listed |
| Events `multDown`, `ringTrick`, `multUp.reason`, `frostReady.charges`, `frostGain`, `frostSpill`, `snapCash`, `snapExtend`, `snapLand` | sim/events.ts | CORE-1 |
| Events `clusterSaved`, `flareWarn/Rise/Parry/Miss/End`, `feat`, `featMet` | sim/events.ts | CORE-2 |
| RunStats (optional, filled with 0 by createRun) `multTicks` … `snapLandsOwn` | sim/events.ts | CORE-1 |
| RunStats `brittleSeen` … `gustWindows` | sim/events.ts | CORE-2 |
| `TUNING.ring`, `.bank`, `.garden` (CORE-1); `TUNING.brittle`, `.flare` (CORE-2), at the plan's starting values | config/tuning.ts | as listed |
| DayParams `noonHeat`, `flareCount`, `flareD` (plan values; nothing reads them yet) | config/days.ts | CORE-2 |
| `FLAKE_ID_BASE`, Pickup `cluster`/`ci`/`cn`/`brittle` (filled by the placer, brittle false), `Flare`, `FLARE_*`, `World.flares` (empty) | objects.ts, gen/placer.ts, gen/store.ts | CORE-2 |
| `Mechanics.brittle` (on outside the Journey; off on every level until the concept lands) | config/campaign.ts | CORE-2 |
| `worldElevation` (base ε), `flareLift` (0), `noonHeatAt` (1), `keptFlares` (0) | gen/plan.ts | CORE-2 |
| `deltaForSlot` (the plain table), `jobRows` (real) | gen/validator.ts | CORE-2 |
| `meltBudgetOf(s, p)` (reads `p.brittle`; used by updatePickups) | sim/pickups.ts | CORE-2 |
| `GoalKind` (+ verb goals; 'snow' stays until T6), `FeatKind`, `FeatSpec`, `LevelFlare`, `LevelDef.feats`/`.flares` (empty), `featValue` (0), `featMet`, `goalMet(…, relaxed)`, `starsFor(…, relaxed)` | config/campaign.ts | CORE-2 |
| step.ts hooks: `updateFlare(s)` before syncEclipse (sim/flares.ts), `updateLanding(s)` in applyDaylight after updateSwing (sim/nubs.ts), `updateFeats(s)` after passObjects (sim/feats.ts); no-ops, not exported | sim/*.ts | CORE-2, CORE-1, CORE-2 |
| `debugRing(s, level, charge)` (sets mult and ringCharge); `debugFlare(s, inTicks, d)` (adds a kept flare whose warning starts in `inTicks`; inert until updateFlare reads it) | sim/nubs.ts, sim/flares.ts | CORE-1, CORE-2 |
| `BotKind` + `'humanFeat'` (plays like humanDial on its own stream), `BotOptions` (`policy`, `snap`, `preAim`, `feats`), `BotPolicy`, `BOT_POLICIES`, `createBot(kind, salt, mechanics, opts)` | sim/bots.ts | shared |
| Bot hooks (no-ops): `econReactiveScore/Snap`, `econOracleBonus/Snap` | sim/bots/econ.ts | CORE-1 |
| Bot hooks (no-ops): `worldReactiveScore/Aim`, `worldOracleBonus`, `worldHumanTarget` | sim/bots/world.ts | CORE-2 |
| sim flags `--off ring,bank,garden,brittle,flares,noonHeat` and `--on …` (RunConfig.v16 over `V16_SHIP` on every row, campaign and career too; `--on bank` measures the Bank), `--policy` (the reactive mechanics rows), `--hours`, `--decisions`, `--bake` | scripts/sim.ts | shared |
| Report registry: `Sim16Module` (per-run `collector` in the workers, `report` after the v1.5 report, `modes`) | scripts/sim16/registry.ts | shared |
| `ECON` (`--policy` note, `--decisions`) / `WORLD` (`--hours`, `--bake`) | scripts/sim16/econ.ts / world.ts | CORE-1 / CORE-2 |

GAME builds against the debug hooks: `startFrost` and `debugRing` for the ring and pips,
`brittleShare: 1` for the glass arc, `startFrost: 1` for guide.land, `debugFlare` for the flare
telegraph (each layer lights up once its owner fills the body).

### 16.1 Economy (CORE-1: §2.1 Flow Ring, §2.2 Frost Bank, §2.4 Frost Garden and Landing, T2-T5)

Every rule keys off `World.v16` (`ring`, `bank`, `garden`); with all three off the v1.5 multiplier,
meter and snap return. **Shipped: all three on** since economy iteration 1 (§16.4 changes the Bank's
income, the cash-in and the start below, §16.5 the gauge rule, the Noon Heat and the glass bank; this
section describes the mechanism). With the Bank
switched off the v1.5 meter fills (shade, flakes, SWINGs, blooms, and the parries and saved glass
clusters of `payTrick`), starts at `TUNING.frost.runStart` 0.5 in Endless, Daily and challenge runs,
and a snap empties it and then cashes the ring in on it (`cashPerLevelH` hundredths of a meter per
level above x1 while cool, the ring back to x1); since iteration 1 it also holds a snap's trick
income for snapEnd and pays own landings a fresh SWING's `perSwing`. Code:
`sim/nubs.ts` (ring, freshness, PHEW, landing), `sim/mechanics.ts` (bank, cash-in, garden, re-aim,
guide.land), `sim/pickups.ts` (streak, Snow cap), `sim/create.ts` (start frost),
`sim/bots/econ.ts`, `scripts/sim16/econ.ts`; values in `TUNING.ring/.bank/.garden`.

- **Flow Ring** (daylight only). `nubs.mult` 1..5 is the level of `nubs.ringCharge` (integer units).
  A full-shade tick (snap cover included) adds `shadeUnits` 5 (×`deepMul` 2 in deep shade); the
  first `freeLitTicks` 6 lit ticks of a stretch are free, then each lit tick bleeds
  `bleedK[m−1]·Σw` (Σw = the 5 sample weights, glare 2; `bleedK` 2/3/6/12/24), except on the tick
  after a bud grew (`nubs.budGrewTick`). At `need[m−1]` (1080/1440/2160/2880, calibrated +20% from
  the plan's 900/1200/1800/2400: 25.2 s of plain shade from x1 to x5) the level rises (`multUp
  {level, reason}`, remainder kept; x5 keeps at most 2880, which full sun bleeds in 0.4 s and
  edge-riding in 2 s); below 0 it drops one level to ¾ of the new level's need (`multDown {from,
  to, cause: 'bleed'}`); x1 floors at 0. `multReset` is never emitted with the ring on.
  `nubs.shadeTicks` mirrors the progress to the next level in v1.5 units (`floor(charge ·
  mult.stepTicks / need)`) for the old HUD bar.
- **Tricks** (`ringTrick {kind, units}`, `stats.ringTricks`): +`trick` 600 for a fresh SWING, a
  bloom, an own landing (and CORE-2's saved glass cluster and flare parry: call
  `ringTrick(s, kind, units)` from nubs.ts); +`streakTrick` 300 for every 3rd flake or crystal in a
  row (`nubs.streak`, reset by any `flakeMelt`).
- **Fresh SWING**: its new source is neither end of a SWING confirmed in the last `freshTicks` 180
  (`isFreshSource`; `nubs.swFresh` keeps the last 8 endpoints as (id, tick); `nubs.swPendFrom` is the
  source a pending hand-off leaves). A non-fresh SWING still chains and pays Snow.
- **PHEW** sets `mult = max(mult, nubs.litStartMult)` (the level at the stretch's first lit tick;
  `multUp {reason: 'phew'}`), never above it. **Snow (T2)**: with the ring on, flakes pay
  `round(min(m, 3)·snowMult)` and crystals 5× that, because x4 and x5 pay through the snap's
  cash-in (on the Bank, or on the shipped v1.5 meter). The `flake`/`crystal` events still carry the
  true `mult`.
- **Frost Bank.** `nubs.frostH` 0..200 integer hundredths is the meter; `nubs.frost = frostH / 100`
  (0..2) mirrors it, so `frost ≥ 1` still means "a snap is ready". Income only from
  `addFrostH(s, source, h)` (mechanics.ts; CORE-2's sim/tricks.ts calls it for 'parry'): bloom
  `bloomH`, a fresh SWING `swingH` at most once per `swingEveryTicks` (`nubs.swingFrostTick`), an
  own landing `landH`; a saved glass cluster's `clusterH` goes to `bankGlassH` instead
  (`s.glassBankH`, paid as the next snap is cast, §16.5). No shade, deep, flake, crystal or PHEW income. Each landing on the meter emits
  `frostGain {source, amountH, charges}`; `frostReady {charges}` on crossing 100 and 200; above
  `capH` the rest is lost (`frostSpill {lostH}`). Under a snap income goes to `s.snapBankH` (at most
  `garden.bankCapH` 30 per snap) and lands at snapEnd as `frostGain {source: 'garden'}`.
  Stats: `frostEarnedH` (income, banked included), `frostSpilledH`, `snapCashH`.
- **castSnap** needs `frostH ≥ costH` and subtracts it, then cashes the ring in: `frostH +=
  snapGauge(chill)·min(cashMaxH, cashPerLevelH·(m − 1))`, never past `cashCapH`, nothing in the
  Noon Heat, the ring back to x1 at 0 (`multDown {cause: 'snap'}` when m > 1, then `snapCash {level,
  refundH, hot?, noon?}` and `frostGain {source: 'cash'}`); the snap cools Nubs to at most `chill +
  (maxChill − chill)·snapGauge(chill)` (`s.snapChillCap`, applied in applyDaylight while it lasts).
  `snapGauge` (mechanics.ts, §16.5) is 1 from `cashFullChill` (the gauge's white), falls across the
  amber to 0 at `coolChill`, 0 below it (red-hot: the snap only shades). Charges carry through night
  and dawn.
- **Start frost** (`createRun`, Bank on): Endless/Daily/challenge `runStartH`, lesson runs 0, Journey
  `campaignStartH` 50, a level that dares a snap (config/campaign.ts `startsWithSnap`: the Cold
  Snap's own level, a snapSave goal or Dare) `teachStartH` 100; `RunConfig.startFrost` (charges
  0..2) overrides. `runStartH` is 100 since economy iteration 1 (§16.4-§16.5: one snap in hand; it
  was 0 at calibration, when the charge alone added +683 min over 80 seeds; it is over the plan's
  120-minute bar, but mechanics vs dial fails without it, §16.5). With the Bank off the v1.5
  meter starts at `TUNING.frost.runStart` 0.5 in Endless, Daily and challenge runs (fix round 2;
  lesson runs, and every v1.6 economy rule off, start at 0), 0.5 on a Journey level, full on a level
  that dares a snap.
- **Frost Garden** (while `s.snapTicks > 0`): buds within [y − 30, y + `reach` 420] grow ×`growMul`
  2 (guide.bud uses the same reach; a flare's rise and hold use `TUNING.flare.budMul` instead when
  larger, never the product, once CORE-2's `s.flarePhase` runs). Bank on, every bud grows at the
  gauge's pace (× `snapGauge(chill)`, iteration 2: full speed from the white, none at the red line,
  §16.5). A bloom under the snap adds
  `extendTicks` 30 to it (`snapExtend {ticks}`, at most `extendCapTicks` 60 per snap, never past the
  day's last daylight tick), records the sunflower in `s.snapBloomIds` (`s.snapBlooms`,
  `stats.gardenBlooms`). **T5**: the snap cloud starts aimed at Nubs' scheduled position
  `reaimTicks` 30 ahead and is re-aimed every 30 ticks of its age and on every extension, in place
  (same object, id and t0; `x0/y0/vx/vy/life` change, so the path is continuous); with the Garden
  off it is the v1.5 frozen one-chord cloud. **T3**: the snap cloud is not a deep-shade source.
- **guide.land** (`updateLandGuide`, called from `updateGuide`): during a Garden snap, 1 where θ = b°
  fully shades Nubs (5 samples, no glare) at the snap's end tick (`dayTick + snapTicks`): his
  scheduled position, the elevation (`worldElevation`) and the clouds then; the snap cloud is dead on
  that tick, so it never counts; this run's sunflowers do. All 0 otherwise.
- **Landing** (`updateLanding`, after updateSwing): a Garden snap that bloomed arms it at snapEnd
  (`s.landTicks` = `landWindowTicks` 20); a hold must start inside the window (Nubs fully shaded by
  any source but the snap, `s.landHold`, `s.landSrc`) and last `landHoldTicks` 15: `snapLand {chain,
  own, x, y}`, `stats.snapLands`. Own (a sunflower of this snap shaded the center sample during the
  hold): a fresh SWING (chain + 1 with the chain timer paused across the snap, Snow = chain,
  `stats.swings`, +`landH` frost, a 'land' trick, `stats.snapLandsOwn`); any other shade: chain + 1
  only. Nightfall or a new snap cancels it.
- **Hash**: `hashState` reads ringCharge, litStartMult, streak, swFresh(N), frostH, swingFrostTick,
  snapBankH, snapExt, snapBlooms, snapChillCap, glassBankH, the landing fields and the ring/bank stats.
- **Bots** (`sim/bots/econ.ts`, its constants at the top; idle, novice and the human models unchanged):
  reactive with mechanics — ring: +0.5 on now-safe bins whose nearest center shader is not an end of
  the last SWING while Chill ≥ 60; policies `plain` (v1.5 gold), `chase` (every gold bin worth 3.5,
  above a safe bin's 3, while Chill ≥ 45 and outside 9:20 AM-2:40 PM; `econChasing` is exported for
  CORE-2's glass term), `naive` (that greed at every hour and any Chill), `safe` (no gold term);
  snaps `panic` (v1.5) or `plan` (lit, x3+, Chill < 60, no now ∪ next bin within ±45°, Bank on: not
  in the Noon Heat, where a snap pours nothing; else panic),
  or `hoard` (only when lit below its bar, never an overflow; iteration 2's sweep, with `snapChill`
  moving the panic, plan or hoard bar and `farm` adding a cool snap at that ring level with a bud in
  reach); bank: spends an overflow charge at frostH ≥ 190 when lit with Chill < 70; Garden: gold only under
  the snap, then in its last 36 ticks guide.land bins (up to 15° deep, +10 where guide.next — already
  past the end — agrees, +8 where this snap's own sunflower shades the landing spot). Oracle: under a
  Garden snap the bud bonus reaches 180°, and in the snap's last 36 ticks (guide.land) and the 40
  ticks after it (guide.now) a landing pull of up to 12 Chill; overflow snap at frostH ≥ 190 when lit
  (outside the Journey only with Chill < 70, as the reactive bot, since iteration 2);
  with flares on, holding two charges, it keeps one for a kept flare of d ≥ 8 and casts it when lit
  in the flare's rise or hold; Bank on, outside the Journey (iteration 2), its v1.5 lit-and-low snap
  (lit next step, Chill < snapChill 50) waits for a plan slack under 25 unless it holds two charges.
- **sim** (`scripts/sim16/econ.ts`): `--check` adds the economy table (mean multiplier, x5 share,
  level changes a minute, trick share of ring income, full-bank share, meters a day from income,
  snaps a day, blooms per snap, own-landing share, lit ticks in the 40 after snapEnd, 11 AM-1 PM
  under a snap, priced moments) and frost income by source, with the §2.1/§2.2/§2.4 gates (hard:
  reactive x5 ≤ 20% and mean x2.8-3.8, full bank ≤ 10%, dial-only ≤ 0.15 meters a day).
  `--decisions [--seeds 80]` plays reactive plain/chase/naive/safe, plain with plan snaps, dial-only,
  plain seeking glass (`BotOptions.glass`, and `'strong'`), humanDial R2-R4, plain with every v1.6
  rule off and plain with no starting charge, then the snap-rule sweep on plain play (`snapChill`:
  panic bars 25-70, plan bars 50, 70 and 80; `snap: 'hoard'` at 20, 25, the red line + 2 and + 10 and
  the panic bar 40; the x5 farm, `farm: 5`) and naive and chase under the strongest of those rules, and
  checks §2.2's gates and iteration 2's E1-E3 rows (§16.5; the pooled rows gate on the lower 1-SE
  bound at `--seeds 960`), with mechanics vs dial per 240-seed block as an advisory line. When a run switches the Bank off (`--off bank`) its own rows (full bank, dial-only
  income) measure the v1.5 meter and FAIL unless `--waive bank`; the meters/d column then shows the
  v1.5 meter's fills.

### 16.2 World and Journey (CORE-2: §2.3 glass, §2.5 Heat Flares and Noon Heat, §2.6 Dares, T1, T6, T7)

Every world rule keys off `World.v16` (`brittle`, `flares`, `noonHeat`); with all three off the
v1.5 world returns (the Dares and the bake are Journey data and always on). Code: `gen/plan.ts`
(elevation, Noon Heat), `gen/placer.ts` + `gen/contest.ts` (flares, glass), `gen/validator.ts`
(slot tables, keep test), `sim/flares.ts`, `sim/glass.ts`, `sim/feats.ts`, `sim/tricks.ts`,
`sim/guide.ts`, `sim/bots/world.ts` + `sim/bots/dares.ts`, `config/campaign.ts`,
`scripts/sim16/world.ts` + `bake.ts`; values in `TUNING.brittle/.flare`, `DayParams.noonHeat/flareCount/flareD`.

- **Elevation.** `liftElevation(w, p, tickAbs, base)` = base ε + Σ kept flares' lift (`liftOf`:
  smoothstep rise 18, hold 42, mirrored fall 30 ticks, `d`°), capped at εnoon − `epsMargin` 2
  (Endless) or `journeyEpsCap` 78 (Journey), never below base. `worldElevation(w, tick)` is the
  same at the world's own clock; step.ts, guide.ts, deathcause.ts, the validator rows and the bots
  all read it, so the sim and the fairness proof agree tick for tick.
- **Noon Heat (T1).** `noonHeatAt(w, day, dayTick)`: `DayParams.noonHeat` (`noonHeatOf`: Day 1 ×1,
  Days 2-3 ×1.1, Day 4+ ×1.2; down from the plan's 1.15/1.25, kept by the calibration, §16.3) from
  11 AM to 1 PM, Endless only (`w.level` null), else 1. The window's edges ([5/12, 7/12)·Dl) round
  to the validator's 6-tick step grid in absolute ticks, and a tick is heated when the step that
  holds it ends inside them: exactly what the DP charges (memoised per day). The Chill line in nubs.ts multiplies the
  drain by it; the validator uses one delta table per day slot (`deltaForSlot`, memoised per (day,
  in-window)) and the oracle one per planned step (`worldOracleDelta`).
- **Heat Flares (§2.5).** Endless: `addDayFlares` draws each day's flares from
  `rngFor(seed, 'flares', day)` (count `DayParams.flareCount`: none on Day 1 of profile 3, one on Day
  2, two from Day 3; one per window of `TUNING.flare.windows`, `gapSec` 8 apart), PENDING with a
  120-tick warning. Journey: `LevelDef.flares` (minute, d) with `warnTicksJourney` 72. The validator
  decides each pending flare in the job that covers it (`keepStep`): kept when a fixed sun angle,
  held through the hold, leaves Nubs lit on at most `parryMaxLit` 4 of its 42 ticks, counted tick
  by tick at his scheduled position (validator rules: clouds as circles, the run's own objects
  left out; fix round 2, so guide.flare can name exactly that parry: the plan's turn-limited path,
  then fix round 1's path on all 7 steps, kept flares that no telegraphed angle parried), and fewer
  than `keepMovedShare` 0.5 of the bins safe without it stay safe at the first hold tick (none safe
  counts as moved; a candidate stops at the first row that settles it); else
  it is shifted by `shiftsSec` (±0.5 … ±5 s; an Endless rise stays in its band of `keepWindows`,
  [0.12, 0.38] or [0.62, 0.88] of the day; a shift needing more forward room than the job's re-run
  prefix is skipped; clear of eclipses, locks, other flares and, in Endless, the Noon Heat window)
  and re-tested. Fix round 3: an Endless flare that fails every shift of its job is not dropped but
  moved on in time (`deferFlare`, forward only) to the first rise the next job decides, while its
  rise stays in its band; only a Journey flare, or one whose band runs out, is DROPPED (never lifts
  the sun). A Journey flare ends `finishMarginSec` 1 before the finish line; on a teaching
  level (L38) the next warning starts `teachGapSec` 1.5 after a flare ends. Keeping one recomputes
  the job's geometry from its first touched step. `sim/flares.ts` runs the kept ones: `flareWarn
  {id, inTicks, d}` → `flareRise` → hold (`s.flareLit` counts lit hold ticks, and each burns
  `burnPerLitTick` 0.4 Chill on top of the drain; the DP charges the same burn on the steps
  (holdTick, fallTick]: `slotDeltaAt`) → `flareParry {id, snow}` (≤ `parryMaxLit` 4 lit ticks:
  `stats.parries`, +5 Snow, `payTrick(s, 'parry')`) or `flareMiss`, then `flareEnd`;
  `s.flarePhase` 0..4 for the renderer and `flareMeltMul` (flakes melt ×2 over the rise and hold).
  **Scorch** (Endless, fix round 3): a miss also scorches the tank by `scorchPerLitTick` 4 Chill for
  each lit hold tick past `parryMaxLit` (at most `scorchMax` 80 in all, `s.flareScorch`): Chill stays
  at most `maxChill − flareScorch` (the Chill line, flakes and saved glass clamp to it) until
  nightfall or a Cold Snap heals it. The validator never models a scorched tank: from a kept Endless
  flare's first hold step to its fall step its DP holds the path on one bin of the flare's parry
  (`w.flareParry`, the keep test's fixed angles, validator rules; `parryAt`, no turning), so the
  proven path parries every flare.
  guide.flare: during the warning, the bins where the sun held through the hold leaves Nubs lit on
  at most `parryMaxLit` hold ticks (tick by tick at his scheduled position, the lifted elevation,
  this run's sunflowers in, the Cold Snap's re-aiming cloud out; computed once per flare and again
  when a sunflower blooms): never empty for a kept flare, and holding any of them parries (unit
  test). `guide.flareTicks` counts down.
- **Glass (§2.3).** Plain and glass flakes are placed two chunks behind the casters (the pickups
  job of chunk k − 2 after placing chunk k, from the finished validation job of that chunk; a
  contest runs in stages, `contest.ts` ContestRun, so idle generation slices it). A cluster turns glass
  when `contestCluster` says it is contested (the safe line's melt ≥ safe + 2, cost C0 − C1 in
  [12, 40], never a trap, and every other flake of the cluster savable on its own; see contest.ts)
  and the day's quota (`glassQuota`: 25% of eligible
  clusters on Day 1 of profile 3, 35% later, half on profile 2, none on profiles 0-1, Quick Melt,
  Hardy, the tutorial or with the rule off; `RunConfig.brittleShare` forces it; a Journey level
  `levelGlassShare`) allows; shifts of ±0.5/±1 s are tried. The brittle level (L21) falls back to
  savable-only glass when nothing contests. A glass flake melts after `meltBudget` 0.8 lit s.
  Fix round 3 (fairness): melt is counted in whole weighted lit ticks everywhere: the sim melts a
  flake once `round(p.melt · 60)` reaches `round(budget · 60)` (48 for glass, whatever order its
  plain, glare ×2 and flare ×2 ticks came in), guide.flake compares integer ticks, and the contest
  saves a flake only on paths that melt it at most `safeSteps` = 7 weighted steps (a lit step 1, a
  glare step 2: `meltRows`), so a flake lit exactly its budget counts as melted in all three. The
  contest checks every flake of the cluster (a window it cannot check rejects the shift).
  `sim/glass.ts` tracks the cluster under Nubs (`s.clusterId/Taken/Broken`): all of it collected →
  `clusterSaved {cluster, n}`, `stats.clustersSaved`, `stats.brittleSaved`, `payTrick(s,
  'cluster')` and `TUNING.brittle.saveChill` 10 Chill at once (below the contest's `costMin`, so
  glass is never free; with the Bank off its frost often lands on a full meter). guide.flake: for
  the nearest alive glass flake in its melt window, the bins where the sun held from now until Nubs
  reaches it leaves it lit for less than its remaining melt budget (glare ×2, a flare ×meltMul; fix
  round 2: one step's point mask named angles that then lost it), computed once per flake. The dial
  draws the decision (render/halo.ts glassDecision): a glint on the teal where a safe angle saves
  it, else the detour off the teal. **T7**: `hashState` reads pickups only to 600 u ahead.
- **guide.deep**: the part of guide.now where ≥ 2 sources (snap excluded, T3) cover the center
  sample. It is counted every other refresh (`DEEP_EVERY` 12 ticks, in `litMask`'s own pass: its
  counts stop at 2); between counts it is kept inside guide.now (`deep &= now`).
- **Tricks**: `payTrick(s, 'parry' | 'cluster')` (sim/tricks.ts) is the one bridge to the economy.
  It pays CORE-1's `addFrostH(s, kind, TUNING.bank.parryH/clusterH)` (the v1.5 meter,
  `addFrost(h / 100)`, with the Bank off) plus `ringTrick(s, kind, TUNING.ring.trick)`.
- **Dares (§2.6).** `sim/feats.ts` keeps the integer counters (`deepTicks`, `snapSavedTicks`,
  `earnedSnapSavedTicks` (a snap beyond the level's starting charges, alone over the center; a
  record only: the snapSave Dare counts every snap-alone tick, as its goal does, because a level
  that dares a snap starts with one ready; never during an eclipse, which shades every angle
  already: fix round 3, L192/L199/L200's snapSave was free there),
  `cloudsRidden`, `gateShaded`, `gateDeep`, `flipTicks`, `lockWindows/Held`, `gustWindows/Held`)
  and emits `feat {kind, value, target}` when a Dare's value moves (deep and snapSave every 6
  ticks) and `featMet {kind}` once. config/campaign.ts: `featValue`, `featMet`, `goalValue`,
  `goalMet(…, relaxed)`, `starsFor(…, relaxed)` (★1 goal, ★2 a Dare, ★3 the cool run), `DARE_OF`
  (each concept's own Dare, its first candidate), verb goals on the teaching levels (L5 deep 90
  ticks, L6 clean balls − 1, L7 1 SWING, L8 1 bloom, L10 60 snap ticks, L13 the arch shaded, L21 1
  glass cluster, L36 shaded ≤ 60 ticks after the flip, L38 parry 2); 'snow' stays in `GoalKind`
  only for GAME's compile. **Soft-fail**: `SOFT_FAIL_MISSES` 2, one on levels 1-10
  (`softFailMisses(level)`), `relaxedGoalFor(level, misses)`, `RunConfig.relaxedGoal`
  (read by `levelOutcome`: the goal scores as 'finish'; GAME keeps the miss count in the save).
- **Bake** (`node scripts/sim.ts --bake [--level N,…]` → `src/config/levelBake.gen.ts`;
  tests/unit/levelBake.test.ts checks it is current; ~10 minutes on 3 workers). The game reads only
  `LEVEL_BAKE_RUN` (one short string: each level's Dares, kept flares, bake-sized goal target and a
  teaching level's world variant, decoded by campaign.ts `bakeRun`); `LEVEL_BAKE` (tooling only, so
  the bundler drops it, keyed by `levelBakeKey` incl. `BAKE_VERSION` 4) holds per level the kept
  flares, what it offers (buds, balls with a glare-free line passed before the line, glass
  clusters, lock/gust windows and the holdable ones, plain flakes, deep-shade ticks, the longest
  one-cloud ride and the clouds ridable ≥ 1 s, SWING hand-offs, the longest fully shaded
  turn-limited stretch: `dareFits` reads them to prefilter the candidates), its world `variant` and
  its Dare candidates as the bots measured them (`dares`, `dares2`). Fix round 3 (scripts/sim16/
  dares.ts, bake.ts; review r3 "Dares need their verb", "teaching levels fail first tries"):
  - **Dares are sized from bots, not offers.** For each candidate (`dareCandidates`: the level's
    concepts' Dares, then blooms / SWINGs / snapSave in a seeded order, then flakes and deep; SWINGs
    from L7; the ring Dare is retired: on none of the 52 levels that offered it did it need its
    verb) the bake plays, to the finish line, the players who do not seek it (reactive, the oracle
    playing the verb goal, humanDial) and those who do (the Feat-seeking oracle, humanFeat), the
    human models on 10 training streams (`SIZE_SALTS` 101-110) that the campaign sim never plays.
    `sizeDare` puts the target just above the non-seekers (the reactive bot and the oracle under it,
    at most 2 of the 10 humanDial players at it; ticks clear by 12 and 10%, in whole tenths of a
    second; more than the goal when the goal counts the same thing, `dareFloor`) and grades it:
    tier 3 when the Feat-seeking oracle and ≥ 7 of 10 humanFeat players reach it (8 for the minor
    kinds), tier 2 when only the oracle does, tier 1 when no target needs the verb (the seekers'
    own level). `pickDare` takes the first tier-3 candidate, else blooms / snapSave / SWINGs at tier
    2, else flakes, else the best fit; a finale's second Dare only at tier 3 (either earns the star).
    The bake measures candidates one by one until the pick is settled, so `bakeRunEntry` re-derives
    the Dares from the file. A level that dares a snap starts with one ready, so snapSave (and a
    finale's second Dare after it) is measured that way.
  - **Teaching without walls.** A teaching level whose own world walls its lesson plays the first
    world variant (`levelSeed(id, v)` = hashString(`journey-${id}-${v}`)) on which `lessonReads`:
    humanDial passes on its first try on 80% of the 10 training streams (`LESSON_SHARE`), the oracle
    passes and the reactive bot finishes; confirmed on 20 fresh streams (`CONFIRM_SALTS` 201-220,
    80% again), since a search over many worlds with one set of streams finds worlds that suit
    those streams by luck. 14 lessons
    play a variant; L38 (the flare lesson) keeps its own world: humanDial does not read the flare
    telegraph and the keep test makes the shade move, so no world makes its parry a dial-follower's.
  The bake keeps a level's flares only at their data positions, each kept in its own job and all of
  them together (teaching levels try 0.1 s shifts and need every flare parried from a fixed angle,
  `stillParryable`; boss levels try 0.5 s shifts within ±6 s, then fill each of `BOSS_PHASES`).
  The world never depends on the Dares (a level's glass share reads its concepts), so the bake is a
  fixed point. Boss finales (50, 60, …, 200) carry `flare` (HP = kept flares); a parry Dare only
  where it needs its verb (the oracle's parry plan parries most flares by itself). On the
  Sunflowers lesson (L8) the placer turns each bud to the face whose ±8° are safe on the most steps
  while it is in reach (`tealFace`, from the finished job's rows), so following the dial grows it.
- **Hash**: `hashState` reads the flare state (`flareIdx/Id/Phase/Lit/Ticks`, kept flares within
  600 u), the cluster state and the world stats above (and, from fix round 1, `budGrewTick`,
  `swPendFrom`, `snapBloomIds` and the snap cloud's path).
- **Bots** (`sim/bots/world.ts`, `sim/bots/glassplan.ts`, `sim/bots/dares.ts`): reactive preAim (the last 18 ticks of a
  warning toward guide.flare, that bin held through the rise and the hold since the review of
  economy iteration 2, §16.6), chase/naive +1.5 on guide.flake; oracle: per-step Noon Heat and
  hold deltas, a parry plan (×6 on bins whose hold path stays shaded), a glass plan with slack ≥ 10
  (`glassValue`: a 1.6 s turn-limited DP over every glass flake in its melt window, the most urgent
  weighted up, ×45). With `BotOptions.dares` (`DARE_TERMS` from bots/dares.ts; tooling passes it,
  the game never imports it) the oracle plays the level's unmet verb goal and `BotOptions.feats` (the
  Feat-seeking oracle) adds each unmet Dare's term (pulls toward bud, deep, glass, cloud-ride, gate-deep,
  flip and window-hold bins, a committed SWING aim over a lit gap, glare lookahead, and a charged
  snap cast for snapSave). `humanFeat` focuses on an unmet Dare in a seeded half of its decisions
  (fix round 3: every kind has a focus): the Dare whose moment is now (a flare's warning and hold,
  its own snap, the eclipse's last seconds, a lock or gust ahead), else its first; it aims at the
  gold, the deep band, the glass arc, the flare's telegraphed angle (held through the hold), a
  SWING's turn, the shade over the next alive flake, ≥ 14° clear of a ball's glare, under a cloud,
  the shade the flip lands in, a shade that holds through the window, or lasting (deep) shade; it
  casts a ready snap in the sun for a snapSave Dare (`dareHumanSnap`, bots.ts's one hook line) and
  holds still under it.

### 16.3 Calibration (docs/V1_6_PLAN.md §11 Steps 2-3, §6)

Measured with every rule on, then with what ships (`V16_SHIP`), on `sim --check --seeds 40
--hours`, `--decisions --seeds 80`, `--campaign --bot all --tries 3` and `--career 40 --meta`
(profile 3 unless noted). Values tuned only inside the §11 ranges.

**Shipped off: the Frost Bank** (amendment A1 / §12). At every in-range setting it failed two of
its hard gates: the dial-only bot filled 0.23 meters a day from income (≤ 0.15; bloomH is at the
bottom of its range, 25, and the dial-only bot's accidental blooms alone pay 0.15 a day, the fixed
SWING, parry and glass income the rest), and naive greed outlived plain play by +1167 to +1336 min
mean (≤ 0; cashPerLevelH 5 with extendCapTicks 30 gave +906, Noon Heat 1.3 +1201, a naive bot that
keeps chase's Chill bar +1121, any other rule off +557 to +1207): with bloom income, greed always
pays. With the Bank off the v1.5 meter plays and greed no longer pays (naive − plain −197); the
Bank's own rows (a full meter, dial-only income) then measure the v1.5 meter (full 23-26% of
daylight, 0.28-0.30 meters a day passively, as in v1.5) and FAIL unless `--waive bank`. `sim … --on bank` and `RunConfig.v16 = { bank: true }`
(the game's `?on=bank`) bring it back.

**Tuned** (everything else stays at the builders' values, all inside the ranges: bloomH 25,
runStartH 0, cashPerLevelH 10, extendCapTicks 60, glass meltBudget 0.8 and quotas 0.25/0.35,
flare d 12 (Days 2-3) / 10 (Day 4+; fix round 2, was 10 / 8), holdTicks 42, warnTicks 120, Noon
Heat 1.1 (Days 2-3) / 1.2):
ring `need` +20% (1080/1440/2160/2880) and `bleedK` at x5 24. Without the Bank's cash-in a snap
leaves the ring as it is and the snap's cover keeps filling it, so the reactive bot sat at x5 20.2%
of daylight; now 16.1%. Survival does not move (the ring never touches coverage or Chill).

| §6 metric | v1.5 | target | shipped (Bank off), fix round 2 | gate |
|---|---|---|---|---|
| Reactive mean multiplier / x5 share | x1.5 / 2% | x2.8-3.8 / ≤ 20% | x3.32 / 13.8% | hard: pass |
| humanDial R2 Day-1 mean multiplier | x1.0-1.2 | x1.8-2.5 | x2.12 | advisory: pass |
| Chase − plain (mean) | +147 | ≥ +150 | +25 (80 seeds), +40 (240) | hard: **FAIL** |
| Naive − plain / safe − plain | – | ≤ 0 / < 0 | −138 / −158 (80 seeds); −152 / +50 (240) | hard: pass (80); safe fails at 240 |
| Plan-snap − panic-snap | – | ≥ +60 | −53 (80), −17 (240) | advisory: miss |
| Full meter unspent | 14-36% | ≤ 10% | v1.5 meter 39.4% (`--check`), 41.3% (`--decisions`) | hard: **FAIL** (Bank off; `--waive bank`) |
| Dial-only meters from income | 0.29 | ≤ 0.15 | v1.5 meter 0.43 (`--check`), 0.43 (`--decisions`) | hard: **FAIL** (Bank off; `--waive bank`) |
| Reactive snaps a day | 0.37 | 0.5-0.9 | 0.48 (`--check`), 0.50 (`--decisions`) | advisory: miss / pass |
| Glass clusters per daylight minute (Day 1 / 2+) | 0 | ≥ 1.8 / ≥ 2.5 | 0.62 / 1.11 | advisory: miss |
| Blooms per snap (reactive) | ~0.2 | ≥ 0.8 | 1.70 | advisory: pass |
| Lit ticks in the 40 after snapEnd (reactive / oracle) | 22 / 32 | ≤ 10 / ≤ 12 | 9.1 / 13.4 | advisory: pass / miss |
| Kept flares parry-feasible | – | 100% | 100%, from a fixed angle, tick by tick (validator and guide tests) | hard: pass |
| Oracle parry rate | – | ≥ 70% | 93.0% (fix round 3; 94.8% over 120 seeds) | hard: pass |
| Flare candidates kept, Days 2-4 | – | ≥ 85% | 92.0% (Days 5+ 84.4%; fix round 3, was 72.5%) | hard: pass (no waiver) |
| PreAim − plain parry rate | – | ≥ +15 points | +18.3 (69.2% vs 50.9%) | advisory: pass |
| Reactive deaths at 11 AM-1 PM | 12% | ≥ 25% | 35.9% (humanDial R3 15.0%, R4 12.5%) | advisory: pass (humans miss) |
| Priced moments a daylight minute, Days 2-4 (240 seeds) | – | ≥ +3 over v1.6 all off | 24.41 vs 22.33 (+2.08) | advisory: miss |
| Reactive dial median | Day 3 · 11:33 AM | Day 2 noon-Day 4 noon | Day 3 · 10:46 AM | hard: pass |
| Mechanics vs dial (median) | +609 min | ≥ +180 | +649 (Day 4 · 9:35 AM; +653 over 120 seeds) | hard: pass |
| Novice p3 median / idle / oracle | 11:34 AM / < 8 AM / Day 8 | unchanged windows | Day 1 · 11:34 AM / 100% < 8 AM / 100% Day 8 | hard: pass |
| Rescues per chunk / unresolved | 0.22-0.25 / 0 | ≤ 0.8, ≤ +0.1 / 0 | 0.564 (heat 0.79), +0.038 / 0 | hard: pass |
| Generation ms per chunk | 2.37 | ≤ 3.5 | 2.59 | hard: pass |
| Journey oracle / reactive 1-100 / Feat oracle ★2 | 200 / ≥ 95% / – | 200 / ≥ 95% / ≥ 85% | 200 / 100% / 91.5% (levels 1-10: 10/10) | hard: pass |
| Reactive three stars, 41-200 | 74% | ≤ 50% | 46.3% | advisory: pass |
| humanDial mean stars, 41-200 | 1.07 | ≥ 0.95 | 0.93 | advisory: miss |
| Career: humanDial at standard within 20 runs | 88% | ≥ 85% | 93% (missions in runs 31-40: 73%, advisory ≥ 80%) | advisory: pass / miss |

**Fix round 1** (the v1.6 review). The rules it changed, with the numbers behind them:
- **Flares.** The keep test needs a shaded parry path on all 7 hold steps (`keepShadedShare` 1; the
  plan's 0.85 kept flares whose best path took 5+ lit ticks, more than `parryMaxLit` 4). Shifts
  still reach ±5 s (the plan says ±1 s), but an Endless rise never leaves its window: the plan's
  ±1 s keeps 61% on Days 2-4, this 74.0%. Either way the ≥ 85% row now FAILs on the gating seeds
  (before the round it passed only there, 67.5-74% over 160), and the waiver is the integrator's
  (`--waive flareKeep`). A Journey flare ends 1 s before the finish (L50 and L190 had one past it),
  and the bake keeps each flare at its data position (L38: three statically parryable flares, 1.5
  s apart).
- **A miss costs Chill** (`flare.burnPerLitTick` 0.4, new; §11 has no range for it). Flares on
  against off was +45 min mean for plain reactive (240 seeds), a buff. With the burn it is 0 (Day
  4 · 8:29 AM both), and preAim pays (+15.2 points of parries).
- **Glass** cools by `brittle.saveChill` 10 when a cluster is saved whole. Plain reactive is
  unaffected (+7 min). Chase loses 28 min to its glass detours, and a chase glass weight of 4
  instead of 1.5 cost it 30 more, so glass stays a choice, not a must.
- **x4 and x5 pay** their level in Snow while the Bank is off (the x3 cap was for the cash-in).
- **Mechanics vs dial** (+165, hard FAIL on the gating 40 seeds; +202 before the round). The rise
  windows move two seeds (27, 40) out of the band the median sits in; unclamped flares give +188.
  Over 160 seeds it is +202 (mean +511; before the round +604 / +584). Mech runs are bimodal
  (Day 3 or Day 4+): 74 of 160 reach Day 4, 82 before the round, so the 40-seed median flips on
  one or two seeds. The burn and the hold length do not move it.
- **Chase − plain** stays the round's open hard gate: +81 over 240 seeds. Flares off gives +106,
  glass off +111, Noon Heat 1.3 +42, chase glass weight 4 +47. No in-range lever reaches +150; the
  Bank (or a redesign of greed's reward) is the integrator's call.
- The Bank's two rows FAIL while it ships off (`sim --check` used to print `n/a` and "All targets
  met"); `--waive bank` records the decision. `sim --check --seeds 40 --waive bank,flareKeep`
  leaves one failing row, mechanics vs dial.
- **Cost** (`node scripts/bench-step.ts --base c956421 --reps 11`, reactive, 12 seeds × 3 days):
  step() 1.056× v1.5 (median; min 1.106×, a noisy machine), guide refresh 1.068× (gate ≤ 1.10 and
  ≤ 1.5). Before the round it was 1.13-1.22×: guide.deep is counted every 12th tick inside
  `litMask`'s own pass, and guide.land and guide.flare are cached.

T8 (META mission retargets ×4 and ×5): `--career 40 --meta` completes a mission in runs 31-40 in
83% of careers (≥ 80%), the last at run 36 (≥ 36). The other advisory misses stay open for v1.7:
glass is contested on fewer clusters than the plan hoped (the quotas stay at 0.25/0.35: the
plan's 1.8-2.5 a minute is out of reach of their 0.2-0.4 range), humanDial's level changes (16-17 a minute, ≤ 14), the oracle's glass saves
(68%, ≥ 85%) and its blooms per snap (0.85, ≥ 1.2), humanDial's stars on 41-200, and the per-Dare
shares (the non-seeking bots meet the ring, deep, ride and flakes Dares on more than 35% of their
levels).

**Fix round 2** (the second v1.6 review). With these `sim --check --seeds 40` fails only the three
rows an integrator waiver names (`--waive bank,flareKeep`), and `--decisions --seeds 80` fails
chase − plain and the two Bank rows:
- **Mechanics vs dial** (+165, a non-waivable hard FAIL) → +649. Mechanics runs are bimodal (Day 3
  or Day 4+) and seeds 1-40 sit in the Day-3 block (+586 / +639 on seeds 41-80 / 81-120). The plan's
  lever does not move it (Endless flares off: +101 on seeds 1-40; d 8 / 6 lowers the keep rate to
  65%). The fix is the plan's starting charge on the shipped meter: Endless, Daily and challenge
  runs start with half a meter (`TUNING.frost.runStart`), +75 ± 38 min for the reactive bot alone
  (240 seeds; the plan drops a start above +120). It also makes the snap a Day-1 verb for the human
  models (humanDial snaps 0.71 / 0.65 / 0.12 times a run at R2-R4, was 0.27 / 0.20 / 0.01). It
  fills the v1.5 meter sooner, so the two Bank rows read worse (a full meter 23.4% → 39.4% of the
  reactive bot's daylight; the dial-only bot, which never spends, fills its one meter in more runs:
  0.30 → 0.43 a day).
- **An honest flare telegraph.** The keep test asks for a fixed sun angle that parries the flare
  under the sim's own rule (≤ `parryMaxLit` lit hold ticks, counted tick by tick), and guide.flare
  shows exactly those angles: holding any of them parries (a unit test plays it). Before, a kept
  flare with no fixed parry (about 1 in 6) telegraphed its first tick's shade and missed. preAim now
  parries 69% against plain's 51% and outlives it by +63 ± 34 min (240 seeds; +0.9 before). The flare
  lift is 12° / 10° (range 6-12): with the fixed-angle test the plan's 10 / 8 kept 67.5% of the
  Days 2-4 candidates, this 72.5% (Days 5+ 64.6%, was 53.9%). No in-range setting reaches 85%: the
  plan's "the shade moves" condition (`keepMovedShare` 0.5, not a §11 knob) drops most of the rest
  (with it off, 87.5%), so the row stays the integrator's (`--waive flareKeep`). A miss still burns
  0.4 Chill a tick: 1.0 made flares cost plain play −25 ± 34 min (240 seeds) but put the gating
  seeds' mechanics-vs-dial median back on the Day-3 block (+243).
- **The ring feeds survival again**: a snap cashes the ring in on the shipped meter (`cashPerLevelH`
  hundredths of a meter per level above x1, the ring to x1), and x4 and x5 pay through it (Snow
  capped at x3 again). Plain +65 min mean, snaps 1.56 → 1.75 a run; an early snap pays a little but
  plan − panic stays negative (−17, 240 seeds): the snap is still worth most as late as possible.
- **Greed (chase − plain)** stays short: +25 (80 seeds) and +40 (240) with the shipped meter, which
  sits full 40% of the day so greed's frost spills; the review's untested bloom-frost lever (0.35 a
  bloom outside 11 AM-1 PM, with no start) gave +48 ± 66 (240) and naive − plain +63 at 80 seeds.
  Like the Bank rows, it needs the Bank or a redesign (an integrator decision).
- **Generation**: the glass contest runs in stages in its own pickups job, a rescue costs 8 units
  and the DP stage checks the budget (§9: slices p99 3.99 → 1.2 ms, max 19.5 → ~4.7 ms, frames over
  2 ms 2.17 → 0.33 a minute; `bench-step.ts --gen`). The worlds are unchanged.
- **Glass**: guide.flake names the angles that save the glass flake over its window, and the dial
  draws the decision (a teal glint, or the detour off the teal). None of the review's levers (this
  guide, meltBudget 0.9, S_free ≤ need − 1) moved the reactive bot's glass saves much (chase 26-28%
  of clusters, a glass weight of 4 38-41%), so the glass detour stays a priced choice; no tuning
  changed.
- **Journey**: L1 and L4 dare 4 flakes (their "reach x4" and "2 SWINGs" were met by no bot), the
  ring Dare only where a verb pumps the ring, the Feat-seeking oracle tries a SWING after 1.5 s, and
  L8's buds face the safe teal (humanDial 0/3 → 3/3 there; levels 1-40 79.2% → 81.7%). A hard
  `--campaign` row checks the Feat-seeking oracle meets every Dare of levels 1-10.
- **Cost**: step() 1.087× v1.5 (median of 9 reps, min 1.073×; gate ≤ 1.10), the guide refresh
  1.02× (guide.flare's 42 lit masks run once per flare, guide.flake's point masks once per flake).
  (Fix round 2's measure; after fix round 3 and the economy iterations it read 1.09-1.15×: §16.6.)
- **build:single** ships no bots (`--mode single`; the Daily par has its own novice bot):
  681.3 → 669.0 KiB with this round's code, still 27.4 KiB over A3's 641.6 KiB (an integrator call).

**Fix round 3, world** (WORLD: the core and gameplay reviews of HEAD 38735c9). `sim --check --seeds
40` now fails only the two Bank rows (`--waive bank`); the flare keep row passes without its waiver.
- **Flares are a threat that anticipation answers (W1).** Flares on against off moved the dial-only
  reactive bot's median death by −2 min (120 seeds): a miss cost Chill, which shade refills within a
  second, so runs re-converged before noon. A miss now scorches the tank (§16.2, Endless only): 4
  Chill a lit hold tick past the parry's 4, at most 80, healed at nightfall or by a Cold Snap. The
  validator proves a parrying path (the DP holds a parry bin through each kept hold; a flare whose
  parry cannot stay above the floor is dropped). `node scripts/sim.ts --flares --seeds 120` (new
  mode, hard rows): the dial-only bot loses 82 min of median survival (mean 186), the preAim bot 4
  (mean 12; it parries 72.5%; at that commit: after the economy iterations it lost 59, so the gate
  failed, and the preAim bot now holds its parry bin: §16.6), the oracle parries 94.8% and reaches Day 8 on 100%; plain reactive with
  the mechanics, which reads no telegraph, loses 492 min median (mean 251), and mechanics vs dial is
  +227 on the gating seeds. Scorch 3 / 60 gave the dial bot only −37; a scorch that only a parry
  heals made the preAim bot lose more than the dial bot (it meets more flares).
- **The flare plan is honoured (W2).** 94% of the Days 2-4 candidates had a keepable rise somewhere
  in their draw window, but the keep test only tried the ~4 s one job decides. A candidate that fails
  every shift now moves on in time to the next job within its keep band: Days 2-4 kept 72.5% → 92.0%,
  Days 5+ 64.6% → 84.4% (40 seeds; through Day 8 83.3%); rescues per chunk on Days 1-4 0.242 against
  0.205 without flares and Noon Heat (+0.038, as before), unresolved 0 on every world kind.
- **Glass fairness (W3).** The contest checks every flake of a cluster (9% of glass clusters had an
  unchecked first flake; seed 1's middle flake saved at C1 41.8 < floor + margin 60), counts melt in
  whole weighted ticks with a flake lit exactly its budget melted (the sim's float sum let 24 glare
  ticks, 0.7999999999999999 s, survive), and weighs glare ×2. Unit tests for each fail on the old code.
  The Journey bake moved glass on 16 composed levels (re-baked).
- **Cost (W4).** Generation 2.18 → 2.32-2.50 ms a chunk (40 seeds × 8 days, Node, serial, a loaded
  machine; gate ≤ 3.5); idle slices (`bench-step.ts --gen`, against HEAD 38735c9) p50 0.15 ms, p99 1.14
  ms (0.93), frames over 2 ms 0.34 a minute (0.32).

**Fix round 3, Journey** (review r3: "many Dares are met without the verb", "teaching levels fail
first tries"; §16.2 Bake, docs/CAMPAIGN_PLAN.md §8, docs/V1_6_PLAN.md §6.1). `sim --campaign --bot
all --tries 3`: oracle 200/200, reactive 100% of 1-100, the Feat-seeking oracle ★2 on 100% (it was
91.5%); per Dare kind (`--tries 10`) the bots that do not seek it meet it on 0-33% of its levels,
humanFeat on 50-67% (blooms 122 levels, snapSave 32, SWINGs 28, flakes 18, still 1); humanDial's
first try on 1-40 is 93.6% over 20 held-out streams (81.7% before; L38, the flare lesson, stays a
wall for a dial-follower). A snap cast into an eclipse no longer counts as saving (L192/L199/L200's
free snapSave), and the finale Dare pill keeps the met Dare. The bake (`BAKE_VERSION` 4) plays bots,
~10 minutes on 3 workers; a change to the generator or the bots makes it stale (the bake vitest
re-derives a sample of levels and re-measures one Dare, so it notices).

**Fix round 3, merged** (WORLD, Journey and UX on one tree). The Journey was re-baked on the merged
tree (WORLD's glass contest and whole-tick melt move the Dare measures): against Journey's own bake,
9 levels' Dares moved (L53, L93, L121, L147, L151, L170, L182, L194, L197; L170 lost its second Dare),
the lesson variants did not. `sim --check --seeds 40` fails only the two Bank rows (`--waive bank`),
the other rows as in the WORLD paragraph above (flare keep Days 2-4 92.0%, gen 3.11 ms a chunk under
load). `sim --flares --seeds 120`: dial-only −82 min, preAim −4, oracle parries 94.8% (unchanged;
at that commit, §16.6 has today's).
`sim --campaign --bot all --tries 10`: every hard row passes; humanDial's first try on 1-40 92.8% of
400; per Dare kind (reactive / oracle / Feat-seeking oracle / humanFeat / humanDial) blooms 122 levels
1 / 0 / 100 / 56 / 4%, snapSave 31 0 / 0 / 100 / 67 / 4%, SWINGs 29 0 / 0 / 100 / 54 / 16%, flakes 17
29 / 24 / 100 / 55 / 32%, still 1 0 / 0 / 100 / 50 / 0%, all five kinds pass; humanDial mean stars on
41-200 0.71 (MISS, see V1_6_PLAN §6.1). build:single 659.6 KiB, 18.0 KiB over A3.

### 16.4 Economy iteration 1 (CORE-1: the Frost Bank ships on)

The economy's intent (docs/V1_6_PLAN.md §6.2: E1 planning beats hoarding, E2 greed is priced and
paid, E3 glass is a choice, E4 no double count, E5 the existing windows unchanged, E6 ship the Bank
only if E1-E5 hold with it) was not met at 103e965 (`sim --decisions --seeds 240`): with the v1.5
meter shipped, chase − plain +26 min, naive −200, safe −14, plan-snap − panic-snap −9, the meter
full 39.0% of daylight and the dial-only bot filling 0.44 meters a day; with the Bank on as it
stood, chase +564, naive +1088 (greed always paid), plan −29, the dial-only bot 0.22 a day and
mechanics vs dial +80 on the gating seeds.

**What the bots showed** (scratch runs of the real sim, 240 seeds, paired by seed):
- Greed is free in exposure: the reactive bot is lit 22-23% of daylight under every policy, and with
  the Bank survival is close to linear in snaps a day (about 950 min per snap a day). Any frost a
  bloom pays makes more greed better; only *how* a bloom is grown can price it.
- A late snap is the best snap: under the snap Chill refills at 30/s to full, so the Chill lost before
  a panic snap is free; 85% of the plan bot's gap-mouth moments were followed by a panic snap within
  2 s, at the same ring (cash-in 18.4 against 17.7 hundredths a snap), so the cash-in did not tell
  them apart (with no cash-in, plan − panic −34 ± 15: the earlier cast only ends earlier).
- A cash-in on every snap makes greedy bots' snaps self-financing (more charges, overflow snaps,
  more cash): 25 a level on every snap gave plan +58 but naive +1144.

**Rules** (one sentence each; values in `TUNING.bank`):
1. Frost freezes only on a cool Nubs (`coolChill` 40; the halo's Chill gauge is white at or above
   it, amber below): a sunflower banks `bloomH` 25 when it blooms with Nubs fully shaded and cool (a
   snap's cover counts), and nothing in the Noon Heat (`bloomFrostH`, mechanics.ts).
2. A snap cast while cool pours the ring into the frost, `cashPerLevelH` 25 a level above x1 (x5
   refunds the snap); a hot, panic snap pours nothing, and no pour fills the meter past `cashCapH`
   150 (`cashInH`; on the v1.5 meter the same rule, capped at a full meter).
3. A fresh SWING pumps the ring but pays no frost (`swingH` 0); a parry pays 5, each glass flake
   caught `glassFlakeH` 3 (pickups.ts) and a whole glass cluster 25.
4. Endless, Daily and challenge runs start with one snap (`runStartH` 100).
5. E4: the cash-in's ring reset also resets `litStartMult` (`resetRing`), so the PHEW a panic snap's
   own cloud triggers restores nothing; the v1.5 meter (Bank off) holds a snap's trick income
   (`addFrost(…, held)`: blooms, SWINGs, parries, glass, landings) in `snapBankH` for snapEnd and pays
   an own landing `frost.perSwing`, as the Bank does.
6. `TUNING.bank.ships` is true: `V16_SHIP` is every rule on.

**Measured, shipped** (`sim --decisions --seeds 240`; the same rows on seeds 241-480 from the scratch
harness, which reproduces the sim run for run):

| Row | 103e965 (Bank off) | Bank on as it stood | Iteration 1 (seeds 1-240) | seeds 241-480 | Gate |
|---|---|---|---|---|---|
| chase − plain | +26 | +564 | +218 | +169 | hard ≥ +150: pass |
| naive − plain | −200 | +1088 | −74 | −81 | hard < 0: pass |
| safe − plain | −14 | −597 | −142 | −81 | hard < 0: pass |
| plan-snap − panic-snap | −9 | −29 | +162 | +85 | new hard ≥ +30 (E1), advisory ≥ +60: pass |
| glass-seeking − glass-ignoring | +6 ± 22 (seeking all day) | −41 (all day) | +5 (chase's hours; clusters saved 8.3% vs 6.5%) | +13 | new hard > 0 (E3): pass, thin |
| reactive plain on a full meter | 39.0% | 1.2% | 2.1% (`--check` 1.3%) | – | hard ≤ 10%: pass |
| dial-only income, meters a day | 0.44 (fills) | 0.22 | 0.14 | – | hard ≤ 0.15: pass |
| reactive plain snaps a day | 0.52 | 0.74 | 0.62 | – | advisory 0.5-0.9: pass |
| humanDial snaps a run R2 / R3 / R4 | 0.71 / 0.64 / 0.13 | 0.14 / 0.15 / 0.01 | 1.11 / 1.11 / 1.01 | – | advisory ≥ 0.8: pass |

`sim --check --seeds 40`: every target met, with no waiver (the two Bank rows measure the Bank):
mechanics vs dial +373 (Day 3 · 3:46 PM vs 9:33 AM; ≥ +180), the dial median Day 3 · 9:33 AM, the
oracle to Day 8 on 100%, its glass saves 76.3% of glass flakes and its parries 92.7%, novice and idle
in their windows, rescues 0.570 a chunk (+0.038), reactive x3.36 with 15.6% at x5. `sim --career 40
--meta`: 100% of careers reach the standard rung within 20 runs, missions in runs 31-40 80%. The
humanDial rows of `--decisions` live longer than at 103e965 (mean R2 Day 2 · 10:55 AM, was 8:11 AM;
R4 Day 1 · 1:21 PM, was 11:13 AM): a snap in hand from the start is a Day-1 verb for them.

**Open.** The starting charge alone adds +476 ± 49 min (mean, reactive plain, 240 seeds), over the
plan's 120-minute bar for it (§2.2); without it mechanics vs dial is +21 (E5's hard ≥ +180 fails)
and half a pip gives +237 and +63, so it stays and the bar is the integrator's call (V1_6_PLAN
§6.2). E3's first half holds thinly: glass windows are about 1.5 s of a 50 s day (0.9 glass
clusters a day), the reactive glass-seeker saves 8.3% of glass clusters against 6.5%, and its edge
(+5 / +13) sits inside the chaos of a 240-seed block (±15-25); rewards big enough to lift it (5 a
glass flake: +29 to +38 over 480 seeds in neighbouring rule sets) put the dial-only bot at 0.16.

**Rejected levers** (240 seeds, seeds 1-240 unless noted): bloom frost only outside the Noon Heat
(naive +792), and also only at Chill ≥ 45 (+481); a 25-a-level cash-in on every snap (naive +1144);
the cash-in as snap length, 0.5 or 1 s a level (plan −8 / −9); the cool line for the cash-in at 25
(naive +245) or 50 (plan −41: the plan bot casts below 50), a 25-50 ramp (naive +76); the cash-in
capped at one snap (chase +82, +92 on 241-480) or 1.25 (chase +110 on 241-480); bloom frost only in
the low morning and evening sun (mechanics vs dial +152), the same with Garden blooms paid (naive
+36), or doubled there (chase +89 on 241-480); SWING frost kept at 5 (dial-only 0.17); glass rewards in Chill (a save lands near full
Chill: saveChill 40 moved no run) or as whole-cluster frost alone (50: seeking +1 ± 15 over 480).

### 16.5 Economy iteration 2 (CORE-1: one gauge prices the snap and the greed)

The review of iteration 1 (docs/V1_6_PLAN.md §6.3) measured the intent against stronger bots and
fresh seeds and found it unmet. Over four fresh 240-seed blocks (1-240, 1001-1240, 2001-2240,
3001-3240; 960 seeds paired by seed, ± one standard error), iteration 1 gave:
- plan-snap − a hoarder that snaps only when lit below Chill 25: +16 ± 22, while plan − panic read +132 ± 15;
- a cool x5 snap with a bud in reach, needed or not, against panic@45: +196 ± 35 (the x5 snap refunded itself);
- chase − plain +165 ± 25, a lower 1-SE bound of 140;
- naive − plain −45 ± 30;
- mechanics vs dial 175 on 1001-1240 (median; the hard bar is +180);
- the weight-4 glass seeker − plain −0 ± 24 (480 seeds).

**What the bots showed.**
- The best snap sat just above any line. With one binary line (the cash-in and the Chill refill
  both whole above it, both nothing below it) a hoarder that waited until just above it got a full
  refill and a full cash-in. With the line at 25, hoard@27 beat hoard@25 by 214 min.
- A flat cash-in of 25 a level made the x5 snap a free snap (4 × 25 ≥ the 100 it costs).
- Greed is cheap in exposure. Every policy is lit about 22% of daylight, and the reactive bot's
  survival tracks its snaps a day. So greed is priced only through what it earns.
- Glass is rare against what a detour costs. There are about 0.86 glass clusters a day. A detour
  with no reward costs the seeker −74 ± 22 min. The reactive seeker saves 17% of clusters whole
  against plain's 7%, and the oracle 51%. Every reward big enough to pay the seeker also pays
  naive, which seeks glass at every hour.

**Rules** (one sentence each; values in `TUNING.bank`; mechanics.ts):
1. The Chill gauge sets the snap (`snapGauge`):
   - In the white (Chill ≥ `cashFullChill` 50), a snap pours the whole ring into the frost
     (`cashPerLevelH` 30 a level above x1, at most `cashMaxH` 60, so no snap refunds itself) and
     cools Nubs to full (`s.snapChillCap`).
   - Across the amber, the pour and the cooling both shrink linearly, to nothing at the red line
     (`coolChill` 25).
   - Red-hot, a snap only shades (`snapCash.hot`).
2. Buds grow at the gauge's pace: full speed in the white, slower across the amber, none red-hot.
3. In the Noon Heat a snap pours nothing (`snapCash.noon`); a bloom there already banked nothing.
4. A saved glass cluster's `clusterH` 80 is banked (`s.glassBankH`, `bankGlassH`, called from
   CORE-2's sim/tricks.ts) and poured in as the next snap is cast, after its cost and cash-in:
   - a lucky dial-follower who never snaps never collects it;
   - it lands on a meter a charge has just left, so it spills only past two charges, as any income does;
   - a single glass flake pays nothing.
5. Frost values:
   - a bloom banks `bloomH` 32 (was 25);
   - a parry banks nothing (was 5: a dial-follower parries by luck);
   - `runStartH` stays 100.

Bots (`sim/bots/econ.ts`):
- The plan rule snaps at Chill < 60 (was 50) with a x3+ ring, and not in the Noon Heat when the
  Bank is on.
- The oracle's lone-charge snap waits for a plan slack under 25 (`ORACLE_TIGHT`). At 20, seed 9
  (long) snapped at Chill 22 on Day 7 and missed Day 8; at 30 and 40, seeds 181 and 64 (heat)
  died again.
- The oracle's overflow snap waits for Chill < 70, as the reactive bot's does (outside the
  Journey). Above that Chill, a snap turns a charge into at most half a pip. Under the growth rule
  seed 181 lost two charges that way and melted on Day 7 (`--check --seeds 240`: Day 8 on 239 of
  240). With the rule, no oracle run is lost on the plan, long or heat forecasts over seeds 1-240.

`sim --decisions` (scripts/sim16/econ.ts):
- It sweeps panic bars 25-70, plan bars 50/70/80 and hoarders at 20, 25, 27, 35 and 40.
- E1 gates against the best hoarder.
- E2 and E3 gate on the lower 1-SE bound at `--seeds 960`.
- It prints mechanics vs dial per 240-seed block.

**Measured, shipped** (`sim --decisions --seeds 960` and `--seeds 240`, `sim --check --seeds 40`
and `--seeds 240`, at the final commit; the scratch rows use the same four blocks as above):

| Row | Iteration 1, four fresh blocks | `--decisions --seeds 960` (seeds 1-960) | Iteration 2, four fresh blocks | Gate |
|---|---|---|---|---|
| E1: plan − the best hoarder | +16 ± 22 (hoard@25) | +78 ± 15 (reactive plain; hoard@40 +99, hoard@27 +152) | +92 ± 17 (reactive plain; hoard@40 +133) | hard ≥ +30: pass |
| E1: plan − panic | +132 ± 15 | +78 ± 15 | +92 ± 17 | hard ≥ +30, advisory ≥ +60: pass |
| E2: chase − plain | +165 ± 25 (bound 140) | +231 ± 29 (bound 202) | +188 ± 29 (bound 159) | hard bound ≥ +150: pass |
| E2: naive − plain | −45 ± 30 | −181 ± 32 | −220 ± 33 | hard < 0: pass |
| E2: naive − plain, strongest rule | – | −128 ± 38 (plan@80) | −96 ± 39 (plan@80) | hard < 0: pass |
| E2: safe − plain | −102 ± 25 | −154 ± 25 | – | hard < 0: pass |
| x5 farm − panic@45 | +196 ± 35 (480 seeds) | −145 ± 21 | – | new hard < 0: pass |
| E3: chase's-hours seeker − plain | −7 ± 7 | +13 ± 9 (bound +4; clusters saved 9.1% vs 7.5%) | −5 ± 9 | hard bound > 0: pass on 1-960 only |
| E3: weight-4 seeker − plain | −0 ± 24 (480 seeds) | +17 ± 19 (bound −2; saved 17.5%) | +1 ± 19 | hard bound > 0: **FAIL** |
| reactive plain on a full meter | 2.4% | 2.2% | 2.4% | hard ≤ 10% (E1 ≤ 15%): pass |
| dial-only income, meters a day | 0.14 | 0.12 | 0.11 | hard ≤ 0.15: pass |
| mechanics vs dial, median, per 240-seed block | 294 / **175** / 298 / 222 | 389 / 313 / 317 / 214 | 389 / 272 / 365 / 321 | hard ≥ +180 (`--check`): pass |
| the starting charge alone | – | +446 ± 25 | – | advisory ≤ 120: MISS |

The four fresh blocks are scratch runs of the real sim, paired by seed. The iteration-1 column
plays iteration 1's rules and plan bot in the same harness.

The plan bot changed with rule 3: it snaps at Chill < 60 (was 50) and holds its snap through the
Noon Heat. This does not decide E1. On the fresh blocks, iteration 1's plan bot (bar 50, blind to
the Noon Heat) outlives the best hoarder by +46 ± 13; at `--seeds 960`, the sweep's plan@50 does
by +37.

The other gates hold:
- `--seeds 240`: every hard row passes; E2 naive under the strongest rule (plan@70) is −161 ± 72.
- `sim --check --seeds 40`: every target met. Mechanics vs dial is +414; the dial median is Day 3 ·
  9:33 AM; the oracle reaches Day 8 on 100% and saves 78.0% of glass flakes.
- `sim --decisions --seeds 40 --off bank` (E6): with the Bank off, the v1.5 meter fails E1 and E2.
  Reactive plain sits on a full meter 40.5% of daylight, the dial-only bot fills 0.46 meters a
  day, and naive − plain is +5 ± 176. The Bank stays on.
- `sim --check --seeds 240`: every target met but one. The oracle reaches Day 8 on 100% on the plan mix and on all seven forecasts (it lost seed 181 before the overflow rule), and mechanics vs dial is +389. The miss is CORE-2's p3 heat rescue rate, 0.802 a chunk against the hard ≤ 0.8, which no rule here touches.
- `sim --campaign --bot all`, re-baked: every hard gate met.
- `sim --career 40 --meta`: 100% of careers reach the standard rung within 20 runs; missions in
  runs 31-40 70% (advisory ≥ 80%; 73% before).

**Open.**
- E3's first half fails:
  - At `--seeds 960`, the weight-4 seeker is +17 ± 19 (bound −2). The chase's-hours seeker is
    +13 ± 9 (bound +4, a pass).
  - On the fresh blocks they are +1 ± 19 and −5 ± 9.
  - The seeker saves 17.5% of glass clusters against plain's 7.5%. Clusters come about 0.72 a
    daylight minute on Day 1 and 1.19 later (`--check`; the plan's advisory asks 1.8 and 2.5), so
    the gap is about 0.09 clusters a day.
  - With no glass reward at all the seeker loses −74 ± 22: the cost of its detours.
  - A bigger banked reward pays plain's lucky saves about as much as the seeker's. On the shipped
    rules, on the fresh blocks:

    | clusterH, banked | weight-4 seeker − plain | chase's-hours seeker − plain | plain against the shipped rules |
    |---|---|---|---|
    | 80 (shipped) | +1 ± 19 | −5 ± 9 | – |
    | 120 | +18 ± 20 | −1 ± 9 | +13 ± 5 |
    | 160 | +19 ± 21 | −5 ± 9 | +23 ± 6 |

  - Paid at once, a reward the seeker can feel also lifts naive (which seeks glass at every hour)
    and the dial-only bot's income.
  - The rarity is CORE-2's (§2.3 quotas). The oracle half of E3 holds: it saves 78.0% of glass
    flakes (`--check --seeds 40`; ≥ 70%).
- The starting charge alone adds +446 ± 25 min (`--seeds 960`). Without it, mechanics vs dial is +60 and −17
  (median, two blocks): the Day-2 Noon Heat kills about 20% of runs before the earned economy
  starts, although the earned economy pays timed greed (chase with no starting charge outlives
  the dial-only bot by +412 min, mean). It stays: the plan's 120-minute bar is the integrator's
  call.

**Rejected levers** (the four blocks unless noted, each under the iteration-2 rules of its time):

| Lever | Result |
|---|---|
| Cash-in 20 a level (max 40) | plan − hoard@27 −2 |
| Cash-in 15 a level | plan − hoard@27 −17 |
| Refill ramped over 0-50 instead of the amber | naive − plain under plan@60 +97 |
| One binary red line at 25 | a 214-min cliff between hoard@25 and hoard@27 |
| A start charge of 75 | mechanics vs dial +162 on 1001-1240 |
| Glass 160 paid at once | spills on a full meter |
| bloomH 35 | dial-only income 0.17 a day |
| bloomH 32 without the growth rule | no gain over 30 |
| clusterH 50, banked | the weight-4 seeker −28 |
| Buds that grow only in the white | naive under plan@80 −238 ± 36, but chase − plain +151 ± 28 and plain −75 ± 13 |
| The growth ramp with a half-speed floor in the amber | naive under plan@80 −69 ± 37, chase +180 ± 30 |
| The growth ramp at bloomH 30 | chase +175 ± 29: lower bound 146 |

### 16.6 Review of economy iteration 2 (the fix round)

The review of iteration 2 (core, gameplay, phone-readability and regression lenses; docs/V1_6_PLAN.md
§6.4) found three hard rows failing (E3's seeker at `--seeds 960`, `sim --flares`'s preAim row,
p3 heat rescues at 240 seeds), a validator state leak, two holes in the gauge rules, and a HUD
that did not read the gauge. The economy loop's design is unchanged: one gauge prices the snap.

**Core rules** (each with what it measured; goldens re-made once, in the commit that changed it):
- **Real shade refills Chill under a snap.** A red-hot or amber snap's cooling cap
  (`s.snapChillCap`) applies only on ticks where the snap cloud is Nubs' only shade:
  `computeCoverage` sets `nb.realShade` when a caster or a cloud other than the snap is over his
  center sample, or when the sun is down or eclipsed, and `applyDaylight` skips the cap then
  (§16.7 replaces `nb.realShade` with the lit fraction without the snap, `nb.fReal`). Before,
  a red-hot snap held Chill at 20 for its whole life in a caster's full shade (four spots, 89-90 of
  90 ticks shaded: 20.0 at 1.5 s against 77-100 without the snap; an amber snap at 35 capped at 61).
  The rule's sentence ("red-hot, a snap only shades") now holds: it shades, and the shade it bridges
  to refills as usual.
- **Glass over the bank spills where you can see it.** `bankGlassH` keeps its cap of two charges,
  and the excess now goes to `stats.frostSpilledH` with a `frostSpill` event (it was dropped silently).
- **The gauge scales with the tank.** `whiteLine(maxChill)` and `coolLine(maxChill)` are
  `cashFullChill` 50 and `coolChill` 25 times `maxChill / 100`; `snapGauge(chill, maxChill)`,
  `coolNubs` (bud growth) and the halo read them. On the 17 ration levels (a 50 tank) the gauge is
  white from 25 and red under 12.5, as the validator already scaled its floor. Before, humanDial
  spent 43.6% of its daylight amber and 9.3% red, with white only at a full tank. Journey re-baked.
- **A Heat Wave day has no Noon Heat** (`ForecastTuning.noonHeat`, a share of the day's Noon Heat
  step: 0 on `heat`; `noonHeatOf` in days.ts). Rescues a chunk with the heat forecast forced
  (generation only, p3, Days 1-8, 240 seeds; the hard bar is 0.8):

  | Noon Heat share on heat days | seeds 1-240 | seeds 30001-30240 |
  |---|---|---|
  | 1 (before) | 0.802 | 0.823 |
  | 0.5 | 0.786 | 0.806 |
  | 0.25 | 0.781 | 0.790 |
  | **0 (shipped)** | **0.763** | **0.779** |

  Only 0 keeps a margin on both blocks (§16.7 lowers the sun to εnoon +2°). The forecast's higher sun (εnoon +3°) and its tighter
  spacing (×0.92) are that day's heat; its blurb says "no Noon Heat".
- **The Bank's kill switch is whole.** With `v16.bank` off a snap's cash-in is the v1.5 one
  (`cashInH` gauge factor 1), it sets no cooling cap, and buds grow at full speed: none of the gauge
  rules apply, so `--off bank` measures the v1.5 meter (it measured a hybrid).
- **The Garden's cap stays** (`garden.bankCapH` 30 a snap, below one bloom's 32): a white snap's
  cash-in (≤ 60) plus its Garden (≤ 30) stays under the 100 a snap costs, so no snap refunds itself
  (iteration 2's rule 1). At 2 × bloomH a white x3 snap with two Garden blooms would bank 124.
- **Validator.** The flare keep test's candidate and row buffers live in the `ValidationJob`
  (`job.keep`, reused from the world's last job), not at module level. Two worlds generated in
  alternating small slices (the game's live run beside its next-run prebuild or the Daily par) now
  equal each one generated alone (6 of 6 pairs; 4 of 6 differed, moving or dropping kept flares);
  a unit test (v16world.test.ts) pins it.
- **Hash.** `hashState` reads pickup positions and clusters (glass shifts move them), and the
  counters `x5Ticks`, `multDowns`, `frostSpilledH`, `snapCashH`, `gardenBlooms`, `snapLandsOwn`
  and `nb.realShade` (§16.7: `nb.fReal`, `nb.deepReal`).
- `snapCash` gains `amber` (cast in the amber: it pours and cools part of the way), for the tips.

**Bots** (`sim/bots/world.ts`, `sim/bots/econ.ts`, `sim/bots/dares.ts`):
- **preAim holds its parry.** In the warning's last `PREAIM_TICKS` (18) it locks θ's bin when
  guide.flare holds it, else the nearest guide.flare bin, and it holds that bin through the rise
  and the hold unless it is under its own snap (per-bot state in a `WeakMap<BotHookCtx, …>`). It
  slid to the bin in the warning, then followed its score again, and parried 74%.
- **`glass: 'near'`**, E3's seeker: `STRONG_GLASS_WEIGHT` (4) on guide.flake bins within 15° of a
  guide.now or guide.next bin, at any hour, at Chill ≥ 45. These are the cheap detours.
- **`hop: w`**, a stronger shade baseline for E2: +w on guide.now bins whose source is another
  caster at least 42° of turn away, at Chill ≥ 50, with no snap on. The bot hops to a SWING's shade.
- **humanFeat watches every flare** when it dares parry (`dareMoment`: a flare announced, rising
  or holding, or a parry focus): it does not drop its focus on the coin then. On the coin alone it
  met a boss's parry Dare 0-3 times in 6.

**Journey** (config/campaign.ts, scripts/sim16/bake.ts, re-baked):
- The oracle plays parry and glass by plan on every level (`ORACLE_PLANS`). Those Dares are sized
  above the reactive bot and humanDial only. It parried every kept flare on every boss, so no parry
  target could sit above it.
- A boss finale whose parry Dare needs its verb (`sizeDare` tier ≥ 2) offers it as its second Dare
  (`bossParry`). The bake measures parry first for a boss's second Dare.
- `sim --campaign` adds advisory rows: ≥ 25% of levels dare a verb other than blooms, every boss
  finale offers a parry Dare, and a count of the levels with two Dares.

  | Dare kinds (levels) | blooms | snapSave | SWINGs | flakes | parry | still | two Dares | bosses with parry |
  |---|---|---|---|---|---|---|---|---|
  | before (review, `--tries 3`) | 127 | 31 | 25 | 16 | 0 | 1 | 0 | 0 of 16 |
  | now | 127 | 29 | 24 | 16 | 13 | 1 | 10 | 13 of 16 (L50, L70, L200: no parry Dare needs its verb) |

**Tooling.**
- `sim --seed-from S` plays seeds S…S+n−1 in `--check`, `--decisions` and `--flares`, for held-out
  blocks.
- `--decisions` E3 gates the near seeker and keeps the two older seekers as "never a tax" rows,
  beside a control: plain play on worlds without glass.
- `--decisions` prints the dial-only bot's income with glass counted at the save, beside the gated
  number.
- `--decisions` adds four advisory hop@2 rows: plain, chase, naive and safe, each on the hop
  baseline and compared against it.
- `--check` adds a humanDial noon-death share from Day 2.
- `bench-step.ts --gen` alternates the trees' reps and gates the p99 slice paired: ≤ 1.1 × the
  base. The absolute 1.5 ms bar decides only while the base meets it too; under load v1.5 broke it
  itself. It prints ms a chunk for both trees.
- Tests that measured the machine:
  - the generator and validator vitests get 20 s timeouts;
  - gamify.spec is marked slow;
  - single.spec rebuilds dist-single when a source is newer than it, so it no longer plays a stale
    build;
  - the draw-call budget (render.spec) freezes on one sim tick. It plays at a third of its speed,
    and at a twentieth over its last two minutes. A loaded frame ran several ticks and froze Nubs
    half in the sun: 86 strokes against 74. Now it reads 71 strokes, loaded or not.

**Cost.**
- **step()**: the review measured 1.11-1.15× v1.5 (gate ≤ 1.10). The profile showed the shared
  lit-mask path grown per tick. Three changes:
  - `markRange` fills with `TypedArray.fill` (one or two calls), not a per-bin loop;
  - `markEllipse` tests a ground cloud (R = 0) once;
  - the clock memoises each day's row.

  `bench-step.ts --base-dir <v1.5 worktree>`, 12 seeds × 3 days, 9 alternating reps: reactive
  0.998 and 1.047 (min 0.999 and 0.989; it was 1.080-1.120 here before the change), oracle 1.015
  and 1.018. The guide refresh is 0.99-1.02×.
- **Generation**:
  - serial and idle, 40 seeds × 8 days: 2.79 ms a chunk against v1.5's 1.68 on the same machine
    (1.66×);
  - `bench-step.ts --gen`: 3.10 against 1.79 ms a chunk, p99 slice 1.46 against 1.38 ms (1.06×, a
    pass).

  The §6 bar (≤ 3.5 absolute) passes on this machine. On the plan's 2.37 ms v1.5 baseline the
  ratio would give about 3.9. §12's lever (fewer contest shifts) makes glass rarer, and E3 and the
  glass advisories are already short. This is an integrator call (§6.4).
- **build:single**: 665.0 KiB (`npm run build:single` at this round's last code commit), 23.4 over
  A3's 641.6. By source map, the shipped JS grew 542.3 → 585.4 KB over v1.5:
  - core +27.3 KB: mechanics, contest, validator, nubs, placer, guide, flares, feats, glass;
  - render +9.7 KB: halo, HUD, banners;
  - config +7.4 KB: campaign, tuning.

  This round's UX added about 3 KiB. Terser instead of esbuild saves about 7 KiB. This is an
  integrator call (§6.4).

**Measured** (seeds 1-960 unless noted; ± one SE, paired by seed):

| Row | Iteration 2 (§16.5, seeds 1-960) | Now, seeds 1-960 | Now, held out (30001-30240) | Gate |
|---|---|---|---|---|
| E1: plan − the best hoarder | +78 ± 15 (reactive plain) | +81 ± 23 (panic@30; reactive plain +93 ± 16) | +85 ± 46 (reactive plain) | hard ≥ +30: pass |
| E1: full meter | 2.2% | 2.5% | 1.8% | hard ≤ 10% (E1 ≤ 15%): pass |
| E2: chase − plain | +231 ± 29 (bound 202) | +269 ± 31 (bound 238) | +261 ± 71 | hard bound ≥ +150 at 960: pass |
| E2: naive − plain | −181 ± 32 | −122 ± 35 | −94 ± 70 | hard < 0: pass |
| E2: naive − plain, strongest rule | −128 ± 38 (plan@80) | −76 ± 40 (plan@80) | −22 ± 80 (plan@70) | hard < 0: pass |
| E2: safe − plain | −154 ± 25 | −218 ± 27 | −120 ± 61 | hard < 0: pass |
| E2 on hop@2: chase / naive / safe − hop@2 | – | +193 ± 35 / −283 ± 38 / −405 ± 31 (hop@2 − plain +419 ± 33) | +235 ± 68 / −217 ± 80 / −463 ± 64 (hop@2 − plain +461 ± 74) | advisory (≥ +150 / < 0 / < 0): pass; on seeds 1-240 alone chase reads +107 ± 67 (MISS) |
| x5 farm − panic@45 | −145 ± 21 | −156 ± 24 | −162 ± 49 | hard < 0: pass |
| E3: the near seeker − plain | – | +38 ± 17 (bound +21; clusters saved 13.5% vs 7.5%) | +25 ± 32 (13.5% vs 8.0%) | hard bound > 0 at 960: pass |
| E3: chase's-hours seeker − plain | +13 ± 9 | +10 ± 10 | +0 ± 17 | advisory mean > −1 SE: pass |
| E3: weight-4 seeker − plain | +17 ± 19 | +17 ± 19 | −1 ± 38 | advisory mean > −1 SE: pass |
| E3: plain − plain without glass | – | +50 ± 11 | +58 ± 28 | advisory mean > −1 SE: pass |
| dial-only income, meters a day (with glass at the save) | 0.12 | 0.12 (0.16) | 0.12 (0.17) | hard ≤ 0.15 (the first number): pass |
| mechanics vs dial, median, per 240-seed block | 389 / 313 / 317 / 214 | 697 / 367 / 383 / 303 | 361 | hard ≥ +180 (`--check`): pass |
| the starting charge alone | +446 ± 25 | +500 ± 27 | +527 ± 57 | advisory ≤ 120: MISS |
| priced moments a daylight minute, Days 2-4, over v1.6 off | – | +1.88 | +2.27 | advisory ≥ +3: MISS |

`sim --decisions --seeds 960` exits 0 (2576 s on 4 workers), and so does `--seeds 240`. Chase − plain rose from +231 to
+269 and naive − plain from −181 to −122. Two of this round's rules move Endless play: real
shade under a snap, and a Heat Wave without Noon Heat. They were not measured apart.

`sim --check --seeds 40` meets every target:
- mechanics vs dial +736 (Day 4 · 10:06 AM against Day 3 · 9:50 AM);
- the dial median Day 3 · 9:50 AM;
- the oracle reaches Day 8 on 100%, parries 93.2% and saves 78.1% of glass flakes;
- flare keep on Days 2-4 is 92.0%;
- p3 heat rescues 0.749 a chunk (0.788 before);
- preAim parries 90.4% against plain's 58.4%.

`sim --flares`:

| Seeds | dial-only loses | preAim loses (bar ≤ half) | oracle parries |
|---|---|---|---|
| 1-120 | 84 min median (mean 184) | −103 (mean −134): flares gain it time | 94.8% |
| 30001-30240 | 96 (mean 249) | −41 (mean −73), parrying 92.2%; before, 76 against the dial bot's 109 (review), a FAIL | 94.9% |

At 1-120 preAim parries 91.1%, against 74% before.

### 16.7 Review r5: fix round 2

The review of the fix round (core, gameplay, phone-readability and regression lenses; docs/V1_6_PLAN.md
§6.5) found the oracle melting on a held-out Heat Wave world, an unresolved validator failure and a
rescue rate on the bar on held-out heat worlds, a snap cap that lifted under a shadow over Nubs'
centre alone, a threat layer the standard rung never met, generation slices over the paired bar,
and the E2 held-out gate unspecified. The economy loop's design is unchanged.

**Core rules** (goldens re-made once per change, in its commit):
- **A snap's cooling cap follows real shade as it would be without the snap.** `computeCoverage`
  keeps the lit fraction with the snap's cloud left out (`nb.fReal`, glare weighted 2 as in `f`) and
  deep shade on the same terms (`nb.deepReal`); `nb.realShade` is gone. Under a snap whose
  `snapChillCap` is below the tank, the cap is max(`snapChillCap`, Chill, min(the Chill this tick
  would reach without the snap, the tank)): it never takes Chill away, and real shade refills
  exactly what it would refill alone. Before, any shadow over the centre sample lifted the cap and
  the snap's full cover refilled at 30 a second (review: 58.8 Chill after 2 s against 11.6 with the
  same steering and no snap). A unit test lays a shadow over the centre alone (Chill held at the
  cast) and over four samples (Chill equal to the no-snap value).
- **The validator never ends a chunk on a flare's account.** A kept Endless flare is dropped before
  any rescue is spent on it, on a failure anywhere in its lift (rise, hold or fall; it was the hold
  only), and when a chunk would otherwise accept an unresolved failure, the job's last kept flare is
  dropped and the DP resumes before its rise. Seed 80139 (heat): a rise failure used the chunk's 8
  rescues and a parked cloud before the hold revoked the flare; generation only, heat, seeds
  80001-80240: unresolved 1 → 0, flares kept on Days 2-4 86.9% → 86.6%.
- **A Heat Wave's sun stands 2° higher at noon** (was 3°). Rescues a chunk with the heat forecast
  forced (generation only, p3, Days 1-8, seeds 80001-80240; hard bar 0.8): v1.5 0.808, HEAD with
  flares off 0.808, HEAD 0.798; the review's levers: flare lift −2 on heat days 0.802, one flare a
  heat day 0.806; spacing ×0.88 0.792; εnoon +2° **0.714**. The forecast sat on the bar, not the flares.
- **Day 1 meets the threat layer** (profile 3; profiles 0-2 take the Noon Heat step a day later,
  and draw no Day-1 flare): one morning flare (lift 6°, keep-tested as every flare, `flareCountOf`,
  placer.ts `addDayFlares`), whose miss scorches at most `TUNING.flare.scorchMaxDay1` (20), and a
  Noon Heat of ×1.05. humanDial, seeds 1-240: R4 meets a flare warning 1% → 66% and the Noon Heat
  2% → 64%; reaches 11 AM 70% → 68% and the first night 12% → 11%; R3 meets them 10% → 68% and
  24% → 89%; novice p3 median Day 1 11:10 → 10:38 AM. With the full 80-point scorch on Day 1,
  R4's 11 AM share fell to 63%.

**Bots.** The oracle's parry plan assumes half its turn rate before the hold
(`PARRY_PLAN_REACH`): at the full rate every bin could still reach the parry until the last moment,
the bonus was flat, and the oracle set out too late (seed 80019, heat: 180° away at the warning,
missed, a 68-point scorch, melted two hours later). Charging a lit hold step the scorch it causes,
the review's first lever, instead lost eight other held-out seeds (it spent snaps on flares). A
parried hold step weighs 12 (`PARRY_W`, was 6): at 6, seed 62 with Long Shadows forced met Day 7's
flare 150° from its parry, valued the bins near it at a 12-Chill pull that lost to a few points of
slack, missed (a 76-point scorch) and melted; at 12 it and the eight seeds above reach Day 8. After
a miss the oracle plans with the tank the scorch left (`maxChill − s.flareScorch`, in its need DP and
its next-step clamp; it used the whole tank): seed 198 with Long Shadows forced missed Day 5's
afternoon flare (an 80-point scorch), crossed sun its 20-Chill tank could not afford and melted at
3:22 PM; it now reaches Day 8. Only runs after a miss change; the Journey has no scorch.

**Generation slices** (no world changes; goldens and the slicing-independence test unchanged):
- the validator's DP is charged a unit per 3 slots and pauses at the slice budget;
- the contest's Chill DP is resumable (its layers and step live in the contest run with the other
  flake's window) and runs 96 slot-layers a stage call, charged at 10 slot-layers a unit (was 25:
  measured ~2.5 µs a slot-layer);
- `slidingMaxCircular` copies its extended row in three straight loops.

**Tooling.**
- `sim --release`: `--decisions` on seeds 1-960, then E2 and E3 on the held-out blocks
  (`HELD_OUT`: 40001-40960 and 50001-50960) pooled; `Sim16Ctx.run` takes another seed block.
- `bench-step.ts --gen` reads both trees on one population (the k-th largest slice, k = 1% of the
  base's working slices), takes the median of ≥ 3 alternating reps over 30 seeds, and gates frames
  over 1 ms and 2 ms a minute paired at 1.1× beside the p99.
- `sim --check` prints the oracle's Day-8 share with its count, and humanDial R3/R4's flare
  meeting (advisory ≥ 50%) with their 11 AM and first-night shares.

## 17. Elementals (docs/ELEMENTALS_V2.md)

The Elemental Trials are v2 (docs/ELEMENTALS_V2.md, binding): each element plays its own verb
inside a run that stays a walk to the finish, against its own world objects. The v1 sun-variant
heroes (Ember's light table, Sprout's edge band, Volt, Drip's two-ended temperature, the swipe-down
abilities, duos, the green thumb, `?hero=`) are gone (§8, the C0a demolition). Every element rule
is gated on `s.trial !== null` (`s.el !== null`): Endless, Daily, challenge and Journey runs take
the old paths byte for byte (the goldens' other keys are unchanged).

### 17.1 Data and runs (the C0b contract)

- **Config.** `config/heroes.ts`: `HeroId` (`nubs`, `ember`, `drip`, `sprout`, `gust`), `HERO_IDS`,
  `HEROES` (§10.1 copy: name, element, tagline, three rule chips, meter word, `verb`, verb and key
  lines, `sunHeld` for the steer and blow verbs, glyph, gesture icon, face, intro trial, death tip),
  `CAUSE_TIPS`. `config/trials.ts`: `TRIALS` (§5, ids 1001..1007; a trial's cast is Nubs then each
  relay's newcomer, its card chip the walkers in order), `EL_KINDS`, the object places
  (`objects`, authored as compact `<code><minute>[:dx[:r[:drift]]]` strings), `TrialTune`,
  `isTrialId`, `trialDef`, `trialLevel`, `anyLevelDef`, `levelTag`/`levelShort`, `trialDareValue`
  (the run's counter of the Dare kind: `burns`, `drinks`, `trees`, `grove`, `cloudRide`),
  `trialStars`. `TUNING.elements` (§2.6) holds every element number.
- **Runs.** `campaignConfig(id)` takes a trial id (the trial's mechanics, `v16: V16_NONE`,
  `startFrost: 1`). `prepareRun` and `createRun` build a trial's world through `finishY + hardAhead`
  (ignoring `ahead`). `createRun` sets `s.trial`, the walker (`cast[0]`) at `elStart`,
  `stats.minChill = 100` (the walker's lowest steady health), the element counters at 0, and
  `s.el = createEl(s)`: the objects at their places (y at the minute's walk, x on the trail plus dx;
  y-sorted, ids `EL_ID_BASE + i`), the lane, wind, hold and leg fields, and the Drip mask buffer
  when Drip is cast. Rain proxies are clouds of kind `'rain'`; grown trees are casters
  `TREE_ID_BASE + i` (`removeCaster` takes one out).

### 17.2 The step on a Trial (`sim/elements.ts`, §7.7-§7.8)

- **`updateRelay`** right after `syncTime`: `tagSoon` exactly `tagSoonTicks` before a TAG; at
  `tagTick(t, i)` (the relay's minute on the 6-tick grid) the walker becomes the incoming element at
  its leg start meter (`tune.legStart[leg]`, else `TUNING.elements.start`), the leg fields reset
  (spent, hold, leg tick, the lane unless Drip walks on), the grace starts, the clean-TAG watch
  starts only into Nubs, Ember or Drip, and `tag` fires. The charge carries.
- **`updateSnap`** casts the Cold Snap on a Trial only while Nubs walks and no TAG is within
  `tagSoonTicks` (`tagLocked`). **The sun holds** (`updateSun`) while Drip or Gust walks.
- **`updateElements`** after the snap, in this order: the frame's verb (a tap `VERB_TAP`/key burn
  sets Ember's `burnTarget` burning at `cost · tune.costMul`, refused with a `fizz` when Flame is at
  or below the cost; a hold makes Sprout's `growTarget` the held site, a release lets go; a swipe
  adds ±`kick` to the wind, halved by `fogMuffle` while Gust stands in fog, at `swipe · costMul`
  Lift, refused when Lift is at or below it); Drip's steer and lane (`laneOf`: the ground-standing
  prism parts' footprint inside ±8 u of the walker's y, not their bounds, minus `clear`; `dx`
  slides toward `dxTarget` at `slide` and is clamped to the lane), the walker's x; the wind's decay
  (`keep`); weather wake, drift (`drift + gain · windAt`), prune and its rain proxy cloud; fires
  (douse under rain, spread at half burn when `|windAt| ≥ spreadAt` to burnables downwind, burn-out:
  bramble/gate gone, ice → puddle, puddle dried, plot and tree gone, `stats.burns`); plants (the
  hold pours `invest`/s up to the site's need, from Sap; growth ×`litMul` lit or wet, ×`rainMul`
  more wet, light bits on guide ticks;
  bridges at `need`, trees at ≥ `treeMin` once let go, `stats.trees`). No allocation.
- **`applyElDaylight`** replaces `applyDaylight`: the walker's rate (Nubs: today's trial rule;
  Ember: `refill·f − fade·(1−f)` with f = min(c, 5)/5, minus `douse` in a puddle and `rain` under
  rain; Drip: `grow·max(0, 1 − c/5) − evap·evapMul·c/5 (+ rain)`; Sprout: `root (+ rain)`; Gust:
  `air` outside weather, else `−soak` in rain and `−fog` in fog), floored at 0 by the TAG grace,
  `nb.safe` (§1.2), the contact table (§3.3: walls bump 30 or feed Ember its `paid` back on its own
  fire, gaps fell, streams carry, swim or sweep, puddles douse Ember or feed Drip once, stones feed
  Ember and sting Drip once, all floated over by Gust), steady health (`elHealth`) into
  `stats.minChill` and `lowChill` (Sap never), `cloudRide` ticks for Nubs under rain, the Cold Snap's
  income on Nubs legs, the clean-TAG watch, memory, lit totals and the leg tick.
- **Death and win:** `elDead` (§7.8): a fall, or a life meter (not Sap) at 0. `elDeath` names the
  cause (`heroCause`: fall, swept, crash with its wall, snuff, douse, rain, evaporate, sizzle, soak,
  fog; Nubs keeps today's melt line) and its line; `stats.grove` (`groveCount`) at the finish.
- **Reads** (`elements.ts`, no allocation): `walkerAt`, `windAt`, `weatherXAt` (stepping, 600 ticks
  at most), `weatherGood`, `arriveTicks`, `contactTicks`, `needOf`, `bridged`, `burnLeft`,
  `burnSweet` (an own wall's window opens at (burnTicks − 1) ticks of walking: a tap lands on the
  next tick, and still feeds), `growLeft`, `burnTarget`, `growTarget` (veiled sites and sites poured
  to their need excluded), `groveCount` (also the session's live grove count), `laneOf`, `pointLit`,
  `veiled` (fog over the target, or the trail-cover rule), `inWeather`, `heroHealth`, `elHealth`,
  `tagTick`, `nextTagTicks`, `nextTagHero`, `tagLocked`, `relayY`, `standTree`, `elStart`.
- **History, hash, replays:** the Melt Map's chill slot holds the walker's steady health;
  `hashState` feeds the trial block (relay, grace, lane, wind, hold, spent, leg, fall and every
  object's fields) only on a Trial; `recordFrame` copies `verb` only when set, `vx`/`vy` only with a
  tap or hold and `steer` only when set (a Nubs replay keeps the seven original fields).
- **`elFixture(s)`** (debug builds, `?elfix=1`): every object kind in each state, for art review.

### 17.3 The guide on a Trial

`updateGuide` fills Nubs' masks at the walker as in a Journey run; `elGuide` then makes the dial
per element (§4): Ember's `now`/`next` are light (lit ≥ 2), Sprout's the bins that light its focus
site (`siteMask`), Drip's and Gust's nothing (the sun holds). During a TAG's telegraph `guide.tag`
is the incoming element's: into Drip, the **Drip mask** (§4.4): `elTagMask` adds one point a tick
from `MASK_LEAD` ticks before the TAG (time samples × the lanes −20/0/+20 u, current casters and
rain proxies), and `elTagMarks` marks the bins shaded on at least max(`min`, `rel` · best) of the
samples; into Ember light, into Sprout its first site's light, into Nubs Nubs' strict shade.

### 17.4 Bots (`sim/bots/elements.ts`, trial-only)

All of them keep the **bot input contract** (§6.3): a tap ends the drag, presses `TAP_PRESS` (6)
ticks and sends one `verb 1` frame; a hold presses `HOLD_PRESS` (13) ticks, sends `verb 2` and
then `verb 3`; the sun is re-grabbed ≥ `REGRAB` (9) ticks later (`createHand`, `handPress`,
`handRelease`, `handCut`, `handFrame`). `createElPolicy(opts)` plays the element legs:
Ember taps own brambles/gates mid sweet window (never under a predicted shower, `showered`), ice and
walls past the TAG once `burnLeft ≤ 30`, dries a puddle on its path at `contactTicks ≤ 60` while
Flame > 30; Sprout holds the most urgent unbridged crossing to its need, then pours plots in arrival
order up to `treeMin` each while Sap > 25 (short pours carry on; downwind plots skipped unless the
option asks); Drip picks a lane every 6 ticks (+30 a reachable puddle, −20 a stone, +0.2 a shaded
tick), steering through a short queue; Gust scores both swipe ways every 6 ticks by the weather's
predicted cost in meter units (`harm`, sleeping weather included), swipes when one cuts it by more
than its cost, and pushes a helpful rain cloud of a later stretch (T4's ride cloud, T6's and T7's
garden clouds) over the trail whenever that adds no more harm than a swipe, spending Lift down to
one swipe once its own weather is past. Options: `salt` noise, `human` timing (reaction, first
exposure per element, tap and hold timing, aim and steer error, wrong and late swipes), `spam`
(G5d), `off` legs, `tapOnSight` (G5) and `gustDelay` (G8d: no Gust input for that many ticks
of each Gust leg). `reactive` delegates element legs to it and aims Nubs at
`guide.tag` before a Drip leg; `humanEl` (BOT_KINDS) is the humanDial model on Nubs legs plus the
policy with `human` timing.

### 17.5 Proof: `node scripts/sim.ts --trials` (`scripts/sim16/elaudit.ts`, `trials.ts`)

`elaudit.ts` makes each variant's **plan**: chained per-leg replays from go (plants pinned to their
latest stand tick for shade-seeking legs, earliest ×3 for Ember); rows per 6-tick step from
`gatherScene` + `litMask` with runtime casters and rain proxies; the turn-limited θ DP
(`slidingMaxCircular`, min-of-three, turn limit 0 on tap and pour steps) for Nubs and Ember (Ember's
taps scheduled first, `emberSchedule`); Sprout's latest-hold schedule and Sap ledger (the margin is
the crossings' ledger; the path bot's plots get `treeMin` each while the ledger keeps a reserve);
Drip's lane DP (33 lanes, consumed bits for puddles and stones, contacts along the segment in world
coordinates) from every marked bin of the mask on a 5° grid; held legs commit the end bin that
maximizes min(held, next) among the marks. `planPlayer` plays a plan under the input contract (or
with a constant θ, a leg's verb off, a spam Gust, a tap-on-sight Ember). `trials.ts` runs the gates
G0-G7 and G5b (§6.4: G0 with `hiddenShare`, at least half of a plot, puddle or stone drawn clear of
the generated casters, canopies out to their lumps' reach; G5b on 360 constant angles 1° apart) in a worker pool, `--check` (with `WAIVERS`: a G3/G4/G6/G7 failure kept with
its one-line reason, each accepted by the lead), `--pick <n>` (salts from `--from` to `--to`, `clearanceMoves`
first, lever `--sets`, the Dare nudge), `--survey N`, `--variant '<json>'` (drain, legStart,
costMul, evapMul, dareTarget, moves, add; and for a re-timed trial startMinute, lengthMinutes, relays
and objects, the authoring string, whose run starts at its own minute) and `--perf`. The pins and their measured gates are in
`config/trials.ts` beside each trial.

### 17.6 The pins (`config/trials.ts`; measured with `--trials --check --perf`)

| Trial | Salt | Levers | Gates |
|---|---|---|---|
| T1 Kindling | 468 | drain 34, legs 80/60/80, costMul 1.2 | all pass; G6 96% waived (every finisher burns all 7) |
| T2 Puddle Run | 187 | drain 28, legs 100/50/80, evapMul 1.2, puddle 218 removed (hidden by a canopy), stone 229 +4, puddle 252, Dare 6 | all pass: G5b best θ250 dies at 98%; G6 96% waived (every finisher drinks all 6) |
| T3 Green Bridge | 3584 | drain 34, legs 80/80/80 | all pass |
| T4 Weather Vane | 605 | drain 34, legs 80/80/80 | all pass; G6 83% waived (every finisher rides) |
| T5 Steam | 1113 | drain 34, legs 80/60/50/80, costMul and evapMul 1.2, Dare 5, puddles 425/492 8 u out | G4 100% and G6 92% waived |
| T6 Rain Garden | 198 | re-timed by the lead (9:46 AM-4:28 PM), drain 38, legs 60/60/65/80, garden cloud r461 waiting east, two crossings, plots 561 and 578 west (out from under canopies) | all pass: G5b best θ193 dies at 23%, G6 25%, G7 Sap 65 vs 41 and 3 trees vs 2 |
| T7 Five Elements | 1266 | re-timed by the lead (7:26 AM-4:50 PM), drain 42, legs 50/60/70/50/40/60, evapMul 1.2, Drip's puddles off the trail (545 −22, 562 +24, both in view) and an on-trail stone for the second ice, Dare 3 | all pass: Drip's leg fails unsteered, G5b best θ317 dies at 97%, G6 33%, G7 plot 420 burns and Sap 67 vs 52 |

Every waiver is accepted by the lead (`WAIVERS` in `scripts/sim16/trials.ts`; docs/ELEMENTALS_V2.md §13.3). `--perf`: every Trial tick
≤ 0.7× and guide refresh ≤ 0.7× a Nubs run's; no Trial passes a constant sun on a 0.25° scan either; `createRun` ≤ 26 ms unprepared, ≤ 0.4 ms prepared.

## 18. Controls v3 (docs/CONTROLS_V3.md, CORE)

One drag and one button replace the nine touch recognizers. The core gains a **driver**
(`src/core/drive`), a pure per-tick policy that turns the button's presses, the Gust vane and the
finger state into ordinary `InputFrame` fields before `step()`; `step()` itself is unchanged and
`recordFrame` records the frame after the driver, so a recorded run replays bit for bit without it
(§11.5). `src/core/drive` imports only core and config and keeps the determinism rules (no
`Math.exp/log/pow`, no wall clock, no per-tick allocation).

### 18.1 The driver (`drive/driver.ts`)

- **API.** `createDriver()` → `{ begin(s, opts), interrupt(), fill(s, f, c), observe(s), view, notes,
  noteN, clearNotes() }`. `DriveOpts`: `aimDeg` and `track` (`aimRadius`), `nowOnly` ('fog'),
  `autoSnap` (Endless R0-R1; ignored since CORE's cut list 3, §18.5), `autoAct` (Settings → Auto actions), `reducedMotion`. `DriveControl`
  per tick: `act` (a press lands), `vane` (notches: drag px / 36, keys ±1), `vaneUp` (snap the raw
  value to its notch), `rest` (the sun finger is down and still). `fill` runs only in the day phase.
- **Order in `fill`** (§2.2): the hand and the sun move are read from the frame as the input filled
  it, before the driver writes anything (so a glide's own closing `upEdge` is never a move or a lift);
  an interrupted glide or one whose leg ended closes; then the engagement clock, the stroke's net
  turn, the re-grip **carry** of an unfinished chase and the **undo** of a glide made since a lift at
  most `againstTicks` old or started at most `raceTicks` (3) before the touch-down; the vane (`vaneNotch`: symmetric rounding, ±0.5 → ±1); presses join the
  buffer (`bufferTicks` 18, not restarted by a press while one waits; in the last `preTagTicks` (45)
  before a TAG into Ember or Sprout a press waits for the incoming element's first tick; at nightfall
  a waiting press is refused at once and the act is `none` until day) and resolve or are refused with the first reason that
  applies (`charging`, `locked`, `nothing`, `low`, `full`, `wait`, `busy`; +16 on a repeat this leg);
  the walking element's verb (Ember's arms: tapped at their moment with Flame covering them,
  `WAIT_LOW` once, `EXPIRE` past the last working tick; Sprout's jobs: hold to the goal, release the
  tick after, pre-emption by an urgent crossing; Gust's governor: one gust per `every` ticks below
  the notch's band, the weaker band `low` at or below the policy floor, waiting at one gust's price +
  `gain`, a gust at once on the tick a drag sets a new notch, and never a calm of its own); Auto
  actions; aim help.
- **Aim help** (§4): planned on guide refresh ticks only, with the sun up, past the start beat,
  unlocked, no eclipse, **no lesson** (`s.lessonOn`), no hand, the sun settled, at least
  `regripTicks` after a real lift, `gapTicks` between glide starts, and only within `engageTicks`
  (300) of the last sun move (button presses, a resting finger and the start tap are not moves). The
  hand-over takes the last `handTicks` before a TAG into Drip (`handPlan`); otherwise the magnet
  (`aimPlan`) settles a lit sun, or one in ending shade after `endingTicks` (18) without a hand
  (restored in fix round 3), into lasting shade, or
  tracks a sun near its arc's edge back inside. Never against the stroke by more
  than `againstDeg` within `againstTicks` of the lift. A glide is eased over `glideTicks` ticks at
  `rate` (`rateReduced`) and its steps sum to `q1024(Δ)` exactly; it has its own edges unless the
  finger rests (then none), and a downEdge or a key ends it.
- **View** (`DriveView`, updated by `fill` and `observe`): the act, the button state, fill, the lock
  countdown, the next act's cost, the pick, the queue (arms in ignition order; Sprout's running and
  queued jobs), due (§3.2 from the pick's last working tick when it is a wall, §3.3 from `growLeft`
  when it is a crossing), the buffered flag, the incoming act, the vane with its resting flag and
  cost and `vaneLow` (0 full band, 1 weaker band, 2 waiting), the glide target, whether it is the
  hand-over and `glideTick` (a glide step was written this tick, the last one included), the last
  refusal.
- **Notes** (pairs in `notes[0 .. 2·noteN)`, at most 8 between drains): `PRESS`, `REFUSE`, `BUFFER`,
  `SETTLE` (a glide ended: 0 track, 1 rescue), `NOTCH`, `CALM` (0 a press, 2 a calm vane or notch 0 mid-drag; 1 is never sent),
  `WAIT_LOW`, `EXPIRE`, `HANDOVER` (the marked bin), `AUTO` (2 an arm, 3 a job; 1, a snap, is cut).

### 18.2 Aim, vane and the shared policy

- `drive/aim.ts`: `aimRadius(setting, ctx)` (§4.3 with `AIM_OVERRIDE`), `aimPlan`, `settleTarget`
  (the dial's preview: the same plan without track), `handPlan`, `aimOut` (the last plan's kind and
  marked bin), `q1024`, `glideTicks`, `glideStep`. Bins follow `binOf` (bin b covers
  [b − 0.5, b + 0.5)); glare stops the search for Nubs; a bud, glass glint, flare rim or (in a TAG
  telegraph) `guide.tag` under the sun is honoured.
- `drive/vane.ts`: `driveWeatherX(s, o, ticks, n)`: a weather object's x after `ticks`; since CORE's
  cut list 1 (§18.5) the calm-now prediction (`weatherXAt`) for every notch.
- `drive/pick.ts` (C0c): the timing and picks the driver and the bots share.

### 18.3 Journey content (§5.3)

`dazzle`, `slippery`, `clockwork`, `gusts` and `heavy` are retired: `ConceptId`, `CONCEPTS`,
`DARE_OF`, the conflicts, `sun.ts` (the mirror, the clockwork snap, the gust push; `SunState.gust`
stays 0 and keeps its hash feed) and `feats.ts`' gust windows lose them. `CONCEPT_IDS` has 40 ids,
all taught: L16 Wide Open (Big Sky), L29 Drought (Cloudless), L30 Crowded (Thicket), L31 Moon Sun
(Moonlit), L32 Lowland (Short Grass). Composed levels keep their draws (`composeDraw` over
`DrawId`, the retired ids frozen in `RETIRED_DRAW`), then `substitute` replaces each retired id by
the first fitting entry of `RETIRED_SUBS` (or `SUB_OVERRIDE`); `retiredLevel(id)` names the 46
changed levels. Renamed: L85 Pine Hollow, L94 Stop Clock, L165 Cloudburst Pass. The re-bake changed
only those 46 entries and `LEVEL_BAKE_RUN`; the goldens only campaign 32 and 100.
Fix round 3: `SUB_OVERRIDE` holds 16 entries (its cap) and `SUB_DRAIN` lowers a substituted level's
drain by at most 2 steps after the clamp (`makeLevel`); the re-bake changed L54, 79, 112, 139, 145,
162-165 and 167-169 and `LEVEL_BAKE_RUN`, and no `campaign` golden.

### 18.4 Touch bots and gates

`humanTouch`, `reactiveTouch`, `idleTouch` and `mashTouch` (§10.2) play through their own driver
(`touchOpts(s, rung)`: the run's Standard radius, `autoSnap` on R0-R1) and expose its view as
`drive`; `humanTouch` takes `{ rest: true }`, `reactiveTouch` `{ park: θ }`. `sim --campaign`
adds their rows and, with `--streams N --json FILE` / `--compare FILE`, the §9.5 recalibration
gates against the humanDial baseline; `sim --check` adds the idleTouch and humanTouch rung rows;
`sim --trials` adds G5e, G5f, G8, G8b, G8d (a second late on Gust), G9, G9b (1.5 s after a TAG
before anything is due) and the advisory G10, G11 and G4t, and `--perf` the
driver's µs per tick on T7; `node scripts/bench-step.ts --drive` times it at an Endless noon.

### 18.5 Measured (fix round 3, `fix3/core`) and what is still open

- `sim --campaign --bot all --tries 3 --compare <baseline>` (humanDial on C0c's content, 20 held-out
  streams × 3 tries, SHA-256 `dce2686f…05ee`): oracle 200/200, reactive 100% of 1-100, the
  Feat-seeking oracle ★2 on 100% and every Dare of 1-10; idleTouch passes nothing plain idle does not
  (11 passes); humanTouch 93.3% of 1-40 on its first try, its resting variant 94.2%; the five new
  teaching slots 20, 20, 20, 20 and 19 of 20; **the substituted-level gate passes** (worst margin −1,
  with `SUB_OVERRIDE` at 16 entries and `SUB_DRAIN` on L164, 167, 168 and 169: `src/config/campaign.ts`
  gives each entry's numbers). **Still failing:** the chapter gate on ch3 (199 vs 200), ch7 (181 vs
  182) and ch12 (178 vs 182). ch3 and ch7 miss by one stream on unchanged levels; ch12 by L119
  (unchanged, 11 vs 13) and L112 (18 vs 20, its best substitute). On the 154 unchanged levels
  humanTouch passes 2,381 streams within 3 tries against humanDial's 2,345 (docs/CONTROLS_V3.md
  §16.8).
- `sim --check --seeds 40`: every target met; idleTouch reaches no first night at R2-R4 (0 of 40
  each); humanTouch's median death is past humanDial's at R0, R2 and R3, short at R1 and R4 (advisory,
  within the row's seed noise).
- `sim --trials --check --perf`: every gate passes with only the accepted waivers (G6 on T1, T2, T4,
  T5; G4 on T5); G5e passes on T4, T6 and T7 (every constant vane dies on Gust's leg), G8d 8/8, G9b
  ≥ 1.55 s. Driver 0.45 µs per tick on T7.
- `bench-step`: step ×1.061, guide ×0.985; `--gen` passes; `--drive` 0.22 µs per tick.
- **Cut list** (§12.3): CORE's cuts 1 (`driveWeatherX`'s set-vane prediction) and 3 (Auto Snap) stand;
  cut 2, the ending rescue, is restored in fix round 3 (`aimPlan`'s `ending` argument). `build:single`
  832,726 B on this branch (+695 B over the merge's 832,031 B; the release budget is 834,560 B).
