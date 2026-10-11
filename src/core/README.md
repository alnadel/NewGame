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
  Enforced by `tests/unit/architecture.test.ts`, which also bans `Math.random`, `Date`,
  `performance`, `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot/cbrt`, the `**` operator,
  `toFixed`, `parseFloat`, `window`, `document`, `localStorage` and `Float32Array` in both folders.
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
startDay?, startT?, startChill?, dailyDate? }`. `tutorial` should be `true` exactly for profile 0
(first run). Daily/challenge runs use profile 3. `startDay`/`startT` (seconds after that dawn) and
`startChill` are debug hooks; a start on Day 8 generates the world from Day 1 (≈100 ms).

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
| `minutes` | score so far (`scoreLabel(minutes)` → "Day 2 · 2:40 PM"). |
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
("2:47 PM"), `scoreLabel(minutes)` / `formatScore(minutes)` ("Day 2 · 2:47 PM"). Ruler helpers:
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
`tutorialStraightRange(trail)`. `biomeAtY(y)` ('meadow' odd days, 'oldtown' even, nights keep their
day's biome); `dayAtY(y)`. Pickups `{ id, kind: 'flake'|'crystal'|'flower', x, y, day, melt, state }`
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

- `createBot(kind)` → `{ kind, next(s): InputFrame }` for `'idle'|'novice'|'reactive'|'oracle'`
  (`BOT_KINDS`); `next` returns a reused frame. Parameters in `TUNING.bots`.
- `runBot(cfg, ticks, kind)` → final state; `runHeadless(seed, ticks, kind, profile = 3)` → hash
  (the `__SHADY_TEST__.runHeadless` hook); `headlessConfig(seed, profile)`.
- `hashState(s)` — 16-hex digest of tick-determined state only (clock, Nubs, sun, Snow/pickup
  counters, casters and pickups < 1000 u ahead); generation progress is deliberately excluded.
- `createReplay(cfg)`, `recordFrame(replay, frame)`, `playReplay(replay, onStep?)` — in-memory.
- `node scripts/sim.ts [--seeds N] [--days D] [--bot idle|novice|reactive|oracle|all] [--profile P]
  [--check] [--workers W]` — balance report and V1_PLAN §13 acceptance check (exit 1 on failure).
- `node scripts/golden.ts` — rewrites `tests/golden/hashes.json` (do it only deliberately).

## 11. Tuning

`src/config/tuning.ts` (`TUNING`, frozen) holds every constant; `src/config/days.ts` holds the day
table, the Day ≥ 7 ramp, `PROFILES` and `dayParams(day, profile)`; `src/config/casters.ts` holds
caster geometry, biome mixes, names and the authored tutorial chunk. Changing any of them changes
worlds: re-run `npm run sim -- --check` and `node scripts/golden.ts`.

Tuned from the V1_PLAN table (to meet §13 with margin): Day 1 caster spacing 55 → 45, lateral
20-50 → 20-46, an extra Day 1 cloud at t = 9 s, and the start hut's side kept clear for 140 u.
`npm run sim -- --check` fails a target that passes by less than 3 percentage points of seeds
(`--margin`); at 40/50/100 seeds idle p3 dies before 8 AM on 97.5/98/98%.

## 12. Decisions beyond the docs

- Slab logic is the exact swept test (segment [p + u·R(z0), p + u·R(z1)] vs the footprint), so it
  matches the rendered hull exactly (GDD's 3-height sampling would not).
- PHEW compares the Chill *before* the tick that found shade with T.
- Up to 2 parked validator clouds per chunk (one per failure that survives the rocks).
- The tutorial's θ0 points east (start hut on the right), right-hand casters shade the first 2.5 s
  (95%), then the shade moves to the left; flakes sit in the post-swing shade at y 300/324/348.
  With 300-500 u dawn shadows the right-hand casters behind Nubs still offer a ≥ 30° clockwise
  alternative for about a second; the big (≥ 90°) swing to the west arc is the one that lasts.
