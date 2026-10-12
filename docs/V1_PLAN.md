# SHADY v1: Authoritative build plan

**Precedence:** `V1_1_PLAN.md`, then `V1_PLAN.md`, then the module READMEs; `GDD.md` is the design background. The older docs are history in `archive/`.

> **One-liner:** You are the sun. Don't melt Nubs.

Nubs, a snowman, waddles up a sunny trail on his own. One horizontal drag swings the sun around the sky, and every shadow in the world swings with it. Keep him in the shade. Noon is the boss: shadows shrink to stubs. Dusk is relief and night is a reward. Your score is the time of day you reach: **"Nubs made it to Day 3 · 2:40 PM."**

This plan is the **vertical slice**. Its quality gate: *the first 60 seconds must feel great on a mid-range phone.* Polish beats breadth.

---

## 1. Scope

### 1.1 IN for v1
- Core: sun control, shadows (prism, slab, disc), Chill, Frost multiplier, PHEW, death.
- **Meadow** (odd days): tree, oak, cottage, standing stone, hedge, hut.
- **Old Town** (even days): house, tree, arch (plus gate arch), stall, column, wall, gazing ball (pedestal plus glare).
- Clouds (overtakers and waiters).
- Rescue **Shade Rocks** from the validator.
- Pickups: flakes (melting), ice crystals, night frost flowers.
- Seeded deterministic world with the fairness **validator**. No forks, no demand rule.
- Onboarding profiles 0/1/2 (§6), tutorial chunk, safe-arc guide with Auto rules, ghost-thumb hint.
- **Day ramp** that keeps rising after Day 6 (§4).
- Screens:
  - Title (live scene).
  - HUD.
  - Pause.
  - Dying, then Melt Map + Results.
  - Settings, including the backup code.
  - Daily (3 tries, plain list).
  - Missions + Achievements.
  - Wardrobe (15 cosmetics).
  - Rotate overlay; toasts; iOS "Add to Home Screen" sheet.
- Death line (glare / cloud / gap / plain), share text with hour glyphs, serverless challenge links.
- Full synthesized audio: SFX, adaptive pad and arpeggio, noon cicadas, night crickets, heartbeat. Haptics.
- PWA: manifest, hand-rolled service worker, icons. Save v1 with migration and backup code.
- Tooling:
  - Debug URL params, debug overlay, test hook.
  - Bots and `npm run sim` acceptance checks.
  - Unit tests (core + meta), Playwright e2e smoke + layout.

### 1.2 OUT of v1 (keep the code open for it, don't build it)
- Forks / Frost Lane, balloons, charms, Atlas, Postcard PNG, Dawn Start.
- Mission tiers beyond the simple repeat rule (§11).
- RLE replay encoding (keep in-memory record/replay for tests).
- Handedness mirroring, night music box, debug tuning sliders.
- Online leaderboards, native Capacitor projects. The path is `archive/TECH_SPEC.md` §18, with these decisions: seed the storage adapter from the asynchronous Preferences read **before** `new SaveStore()` (it reads once, at construction) and keep mirroring writes to localStorage; Android's back button calls `Session.handleBack()` and exits from a Title with no dialog; on Android 15 edge-to-edge, inset the web view or feed the real insets into `--safe-*` (as `simulateSafeArea()` does); no service worker in native (`canRegisterServiceWorker()`); challenge links use `VITE_SHARE_URL`; portrait only, icons from `public/icons/icon-1024.png`.

---

## 2. Conventions (all agents)

### 2.1 Layering
`src/config` → `src/core` (pure, deterministic) → `src/meta` → `src/render`, `src/audio`, `src/ui` (side effects) → `src/game` (orchestration); `src/platform` holds the browser and native seams. `tests/unit/architecture.test.ts` enforces this table on every layer (type-only imports count too):
- `config` imports only `config` (pure data tables that share types and constants); `core` imports only `core` and `config`.
- `platform` imports only `platform`.
- `meta` imports `meta`, `core`, `config` and `platform`.
- `ui` imports `ui`, `meta`, `core`, `config` and `platform`.
- `audio` imports `audio`, `core`, `config` and `platform`.
- `render` imports `render`, `core`, `config`, `meta` and `platform`, plus `../game/camera.ts` and `../game/assist.ts`.
- `game` and `main.ts` may import anything.
- One type-only exception remains: `platform/haptics.ts` reads the sim's event names from `core/sim/events.ts`.

### 2.2 TypeScript
- Use explicit `.ts` extensions in relative imports.
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on).
- No `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`).
- Strict mode. No `any` unless commented.

### 2.3 Determinism in `src/core` and `src/config`
**Forbidden:**
- `Math.random`, `Date`, `performance`.
- `Math.sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt`, and the `**` operator.
- `toFixed`/`parseFloat` on computed values.
- `window`, `document`, `localStorage`, `Float32Array`.

Use `src/core/dmath.ts`: polynomial sin/cos/atan with Cody-Waite reduction, built from `+ − * /`, `Math.sqrt`, floor/round/abs/min/max/sign/trunc/imul. `tests/unit/architecture.test.ts` enforces this.

### 2.4 Hot paths
No per-tick allocations in sim/render hot paths. Use preallocated typed arrays and reused event arrays.

### 2.5 No runtime npm dependencies
- All visuals are procedural Canvas 2D.
- All audio is WebAudio synthesis.
- Fonts: system UI stack only.

### 2.6 World coordinates
- **u** is the world unit. x points east (right), y points north (up the screen, the walking direction), z points up.
- The visible world width is **360 u**.
- Oblique projection: a point at height z is drawn **0.25·z** higher on screen.

### 2.7 Sun azimuth θ
- Degrees in [0, 360). 0 = east, 90 = north, counter-clockwise positive.
- Light comes **from** θ. The sun vector **u** = (cos θ, sin θ) points toward the sun.
- A point at height h casts its shadow at p − u·L, where L = min(h/tan ε, cap).
- Shade logic test for ground point p and prism footprint F: p is shaded iff the segment [p, p + u·L] intersects F.

---

## 3. Sun control (rewritten; fixes critique #1)

### 3.1 InputFrame (per 60 Hz tick, produced by `src/game/input.ts`, consumed by `core/sim/sun.ts`)
```ts
interface InputFrame {
  dTheta: number;   // degrees requested this tick, sign/sensitivity applied, quantized to 1/1024°
  down: boolean;    // a pointer is held during this tick (after downEdge/upEdge applied)
  downEdge: boolean;// a pointer went down this tick (catch)
  upEdge: boolean;  // the pointer went up this tick (release)
  release: number;  // release angular velocity °/s on the upEdge tick, quantized to 1/64 °/s; 0 otherwise
  key: -1 | 0 | 1;  // keyboard: +1 = counter-clockwise (Left/A), −1 = clockwise (Right/D)
}
```

### 3.2 Drag mapping
- Δθ = −(dx / worldViewportCssWidth) × **360°** × sensitivity, then ×(invert ? −1 : 1).
- So a full viewport width is one full turn, and dragging right turns the sun **clockwise**.
- Sensitivity defaults to 1.0 (range 0.6-1.5). Vertical motion is ignored.

### 3.3 Sun state machine
States are `idle`, `dragging`, `chasing`, `coasting`.
- **downEdge:** if |ω| > 90, emit `catch`. Then ω = 0, target = θ, mode = `dragging`.
- **dragging:**
  - target += dTheta.
  - θ moves toward target by at most maxRate·DT.
  - maxRate is **600°/s**: 450 while ε < 15°, 300 under reduced motion.
- **upEdge tick:**
  - Apply that tick's dTheta to target first.
  - Then store ω_rel = clamp(release · smoothstep(200, 600, |release|), ±cap): **only genuine flicks coast** (`TUNING.sun.flickMin/flickFull` = 200/600, in °/s of requested angle). cap = 360, or 180 under reduced motion.
  - So a lift below 200°/s stops where the finger left it (once the chase ends), 400°/s coasts at 200°/s, 300°/s drifts less than 15° in total, and 600°/s or faster coasts at the cap (about 103° of travel at 360°/s).
  - Enter `chasing`: keep following target at maxRate.
  - When |angleDiff(target, θ)| < 1°, switch to `coasting` with ω = ω_rel.
- **coasting:**
  - θ += ω·DT, then ω *= 0.9433354499 (that is, e^(−3.5/60)), then target = θ.
  - If |ω| < 5, set ω = 0 and mode = `idle`.
- **key ≠ 0:** θ += key·180·DT, target = θ, ω = 0. The keyboard overrides coasting and chasing.
- **Detents:** d = floor(θ/15). When d changes, emit `detent{dir, index}`. They are feedback only; there is no snap.
- **Release velocity** (computed in input.ts): (θreq_last − θreq_first)/(t_last − t_first) over the requested-angle samples in the last 80 ms. It is 0 if the newest sample is older than 50 ms. `pointercancel` gives release 0.

### 3.4 Required `sun.test.ts` cases
1. Catch mid-coast moves θ by less than 1°.
2. A 180° drag over 120 ms followed by a 60 ms hold ends within 1° of +180°.
3. The release tick's dTheta is applied.
4. Key and finger together never oscillate.
5. Friction decay.
6. The ±cap clamp.
7. The follow-rate caps (600, 450, 300).
8. A detent event at each 15° crossing.
9. Flick-only inertia: a 150°/s lift doesn't coast; a 400°/s lift coasts at 200°/s; a 300°/s lift drifts less than 15°; a 1000°/s flick coasts at the cap. Catch semantics are unchanged.

---

## 4. Clock, days, difficulty

### 4.1 Daylight, clock and elevation
- **Dl(N):** 50 s for N ≤ 5 and **45 s for N ≥ 6** (no shrinking).
- **Night length:** 8 s for N ≤ 6, then max(5, 8 − 0.5·(N−6)).
- **Clock:** 6:00 AM + 720·t/Dl minutes.
- **Elevation:** ε(t) = 6° + (εnoon − 6°)·sin(π·t/Dl).
- **Score:** M = (N−1)·720 + floor(720·t/Dl).
- **Formats:**
  - HUD: `h:mm AM` in **10-minute steps**.
  - Exact minutes on death and results.
  - Full format: `Day N · h:mm AM/PM`.

### 4.2 Day table (standard profile)

| Day | Biome | εnoon | Walk v (u/s) | Dl (s) | Caster spacing (u) | Lateral (u) | Clouds: spawn t (s) | Gazing balls | Flakes/cluster | Validator floor |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Meadow | 48 | 70 | 50 | 45, with the Day-1 wave (§7.2) | 20-46 | 9, 19, 38 | none | 3 | 50 |
| 2 | Old Town | 58 | 80 | 50 | 60 | 20-55 | 8, 24, 40 | every 14 s from t=6 | 3 | 45 |
| 3 | Meadow | 66 | 90 | 50 | 65 | 20-60 | 6, 19, 32, 45 | none | 4 | 40 |
| 4 | Old Town | 72 | 100 | 50 | 70 | 20-65 | 5, 16, 27, 38, 49 | every 10 s from t=5 | 4 | 40 |
| 5 | Meadow | 76 | 110 | 50 | 75 | 20-70 | 4, 13, 22, 31, 40, 49 | none | 4 | 35 |
| 6 | Old Town | 76 | 120 | 45 | 75 | 20-70 | 6 evenly spaced over [4, 44] | every 8 s from t=4 | 4 | 35 |
| N ≥ 7 | odd Meadow, even Old Town | 76 (80 from Day 10) | 130 | 45 | 75 + 4·(N−6) | 20 to 70 + 4·(N−6) | max(3, 6 − (N−6)) evenly spaced over [4, 44] | every max(5, 8 − (N−6)) s from t=4 | 4 | max(25, 35 − 2·(N−6)) |

- "Caster spacing" is the mean gap along y; each gap is spacing · U(0.7, 1.3), shaped on Day 1 by the wave in §7.2.
- "Lateral" is the distance from the trail centerline to the nearest footprint point. The minimum of 20 is the **clearance** (critique: raise 14 to 20).
- Walk speed: y advances at v during daylight. At night it advances at v·8/nightLen, so night distance is always 8·v.

---

## 5. Nubs, Chill, scoring rules

### 5.1 Coverage and Chill
- **Coverage samples:** 5 ground points at the center and at ±5.5 u along x and y.
- **Lit weight per sample:** 0 if shaded and not in glare; 1 if lit; +1 if in glare (glare ignores shade). f = Σ/5, in [0, 2].
- **Chill:**
  - max 100; starts at max.
  - Daylight: dChill/dt = −drain·f + 30·max(0, 1 − f), with drain from the profile, or lower for early endless runs (§6).
  - Night: +30/s. Dawn: set to max.
  - Death: Chill ≤ 0 during daylight. It is the only fail state.

### 5.2 Frost multiplier
- Levels ×1 to ×5.
- Each continuous 4.0 s at f = 0 adds +1.
- f > 0 continuously for ≥ 0.15 s resets it to ×1.
- Frozen at night. It multiplies flake and crystal Snow only.

### 5.3 PHEW (critique fix)
- Armed only when Chill was ≥ 40 within the last 3 s and the PHEW latch is open.
- The latch closes after a PHEW and re-opens when Chill > 50.
- Fires when, in daylight, Chill < T (T = 15; 20 for profiles 0-2) and f goes from > 0 to 0.
- Reward: +3 Snow, plus the juice (0.4× timescale for 350 ms real, a "PHEW!" pop, a frost burst).

### 5.4 Pickups
- **Flakes:**
  - Clusters every U(5, 8) s of trail time while t ∈ [0.08·Dl, 0.92·Dl], on the trail centerline, 24 u apart.
  - Collected within 14 u of Nubs' center.
  - **Melting is time-based:** while the flake is ≤ 1.6·v ahead of Nubs (in y) and lit (×2 in glare), it accumulates melt. It melts at **1.2 s** (`TUNING.pickups.meltBudget`, the GDD's value) and never refreezes.
  - Reward: +mult Snow and +6 Chill.
  - Emit the `flakeMelt` event per melt; the audio layer throttles it.
- **Ice crystal:** 1 per day at t ∈ U(0.3, 0.7)·Dl. Same melt rules. +5·mult Snow and +35 Chill.
- **Frost flowers:** at night, every 60 u along the trail. +2 Snow, no multiplier, they don't melt.

### 5.5 Run Snow and hour glyphs
- **Run Snow** = Σ flake rewards + Σ crystal rewards + 2·flowers + 3·PHEWs.
- **Hour glyphs:** per daylight in-game hour (12 per day), lit = ∫f·dt (glare counts double, since f already includes it).
  - `cool` if lit ≤ 0.2 s.
  - `warm` if lit is 0.2-1.0 s.
  - `hot` if lit > 1.0 s or Chill < 25 at any moment in that hour.
  - `melt` for the hour Nubs died in.
- **Share glyphs:** cool = ❄️ (U+2744 U+FE0F), warm = 🟨, hot = 🔥, melt = 💧. Append 🌙 after each completed day.

---

## 6. Onboarding profiles (critique fix: first run must reach night)

`RunConfig.profile` is computed by the session from lifetime runs. **Daily and challenge runs always use profile 3.**

| Profile | Lifetime runs | Drain | Day 1 εnoon | Extras |
|---|---|---|---|---|
| 0 | 0 | 30 | 40° | Tutorial chunk 0; Day 1 validator floor 70; a **parked cloud** rides with Nubs from 11:00 AM to 1:00 PM on Day 1, its shadow reachable by pointing the sun roughly north; guide always on; PHEW T = 20 |
| 1 | 1 | 40 | 44° | The same parked noon cloud and overtaking first cloud as profile 0; PHEW T = 20 |
| 2 | 2 | 47 | 48° | The same parked noon cloud and overtaking first cloud as profile 0; PHEW T = 20 |
| 3 | ≥ 3 | 55 | 48° | Standard |

Days 2 and later use the standard table in every profile; only the drain persists for the whole run.

**Endless drain ramp.** Endless runs without a `?profile=` or `?bot=` override also cap the drain by lifetime runs: the session sets `RunConfig.drain = endlessDrain(runs) = min(PROFILES[min(3, runs)].drain, 30 + 3·runs, 55)` (`ONBOARD_DRAIN = { start: 30, perRun: 3, max: 55 }`). Runs 0-9 drain 30, 33, 36, 39, 42, 45, 48, 51, 54, 55, and 55 from then on, so the step to the full drain is never a cliff. Daily, challenge and bot runs keep the profile drain, and world generation and the validator always use the profile drain, so a seed builds the same world either way.

### 6.1 Tutorial chunk (profile 0, y ∈ [−120, 480])
- The trail is straight at x = 180.
- The authored layout must satisfy two tests:
  1. Holding θ0 keeps Nubs fully shaded for ≥ 80% of the first 2.5 s.
  2. Around 3 s, one deliberate swing of ≥ 90° is needed, and it is feasible.
- Flakes sit where the post-swing shade falls.
- Start hut: always the first caster, at y = 10, nearest edge **20 u to the RIGHT**, so θ0 ≈ east. The glyph opens on the right edge, so a rightward drag reads like turning a wheel.
- **Non-tutorial runs:** the start hut's side is random. θ0 = the direction from Nubs to the hut center.

### 6.2 Ghost-thumb hint
- Profiles 0-1 only.
- Shown when Nubs has been lit for 0.3 s and the guide shows a safe arc ≥ 10° wide. It swipes in the shorter rotation direction, in a band at 60-80% of screen height.
- At most 3 times per run. Also shown on the Title.

### 6.3 Guide (safe arcs on the halo dial) Auto rules
- Profile 0: always on.
- Lifetime runs ≤ 5: Days 1-2, then fading linearly on Day 3 from 6 AM to noon.
- Runs 6-10: Day 1 full. Day 2 alpha = (10 − runs)/5.
- Runs 11-20: Day 1 only.
- 21+: off.
- Settings override: Auto / Always / Off. "Always" adds 🧭 to shares.
- **Glare arcs are always shown.**

---

## 7. World generation and fairness

### 7.1 Trail
- Control points every 120 u in y: x(i+1) = clamp(x(i) + U(−70, 70) + 0.15·(180 − x(i)), 80, 280).
- Uniform Catmull-Rom, so x = trailX(y).
- Profile 0 tutorial range: x = 180.
- Half-width 15 u.

### 7.2 Casters
- **Placement:** GDD §2.7 rules and kinds.
- **Spacing and the Day-1 wave:** the gap after a caster placed at daylight time t is spacing · (waveA + waveB·sin⁴(180°·t/Dl)) · U(0.7, 1.3), with t clamped to [0, Dl]; nights use a factor of 1 and the tutorial chunk is authored. Day 1 has waveA 0.75 and waveB 0.65: dense at dawn and dusk and 1.4× sparser at noon (a day mean of about 0.994), so noon is the boss from the first day. Later days are flat (waveA 1, waveB 0). Over 30 seeds the share of sun angles that fully shade Nubs on Day 1 is about 31% at 7-8 AM against 19% at 11 AM-1 PM.
- **Clearance:** every ground footprint stays ≥ 20 u from the trail centerline, checked against a polyline sampled every 8 u. Push outward 4 u per step, at most 20 steps.
- Rectangle kinds are rotated by 15°·randInt(0..11); trees are not rotated.
- **Gate arch:**
  - 10% of Old Town arches straddle the trail. Posts are 14×14 with centers at trailX ± 34; the lintel slab is 82×14 at z 70-90.
  - **Day 2 always gets one gate arch** placed between 11:00 AM and 1:00 PM.
  - Gate arches are exempt from clearance; their posts are 27 u from the centerline.
- **Names:** seeded "the {Adj} {Noun}" (GDD §2.7 lists).

### 7.3 Clouds, glare, rescues
- **Clouds:** GDD §2.8, minus balloons.
  - Ellipse rx U(60, 80), ry 0.66·rx, altitude 300.
  - Shadow offset min(300/tan ε, 900).
  - Overtakers spawn 350 u behind and move at U(1.20, 1.35)·v; waiters spawn 450 u ahead and move at U(0.65, 0.80)·v.
  - Lateral drift U(−10, 10) u/s, x0 U(60, 300), life 40 s.
- **Gazing ball:**
  - Pedestal prism 10×10, h 30. Mirror z 40.
  - Glare spot r 22 centered at ball + u·**min(40/tan ε, 160)**, active while ε ≥ 8°.
  - Lateral U(40, 80), alternating sides.
- **Rescue Shade Rock:** prism 30×30 (rotated 0), h = clamp(40·tan ε + 20, 60, 160), at the failure point's y. Nearest edge 20 u from the centerline, sides alternating. `rescue: true`.

### 7.4 Validator (single path; no forks)
- **Steps:** 0.1 s steps (by time) along the trail centerline.
- **Masks:** 360 bins. fLit[b] from the 5 samples, including glare and clouds (clouds as circles of radius ry).
- **Human model:**
  - Turn rate **180°/s**, so the window is ±18 bins per step.
  - A bin counts as safe at step j only if it is safe at j−1, j and j+1: use fLitH[b] = max over those 3 steps.
- **DP:** C[b] = min(maxChill, slidingMaxCircular(C, 18)[b] + Δ(fLitH[b])·0.1).
  - Δ is the profile's drain/regen.
  - Night resets C to max.
- **Failure:** if max(C) < floor (day floor; profile 0 Day 1 = 70):
  - Insert a Shade Rock at the failure y and revalidate the chunk from its stored entry carry.
  - Up to 8 rescues per chunk.
  - Then use a parked cloud at a distance of exactly R(ε at failure) from the path, riding at v for 6 s, and revalidate.
  - If it still fails, accept it and count it in `world.stats.unresolved` (the sim reports it; the target is 0).
- **Timing:**
  - Chunks are 480 u.
  - Validation of chunk k runs after chunk k+1 has been placed.
  - Generation must be resumable/time-sliced: ensureGenerated runs with a budget and the session calls it in idle time, 3 chunks ahead.
  - The sim's hard guarantee is generated through nubs.y + 1600.
  - Chunk content is a pure function of (seed, profile, k, prior chunks), so frame timing can never change the world.
- **Cost target:** ≤ 4 ms per chunk on mid-range phones. Use analytic angular extents (`archive/TECH_SPEC.md` §6) so only bins near each part are tested.

---

## 8. Input, OS gestures, run start (critique fixes)

### 8.1 Pointer handling
- Ignore pointerdowns that start within **20 CSS px of the left/right edges** or inside **bottom safe inset + 16 px**.
- **Latest pointer wins:** a new pointerdown takes over and counts as a catch.
- `pointercancel` is a release with ω = 0.
- `lostpointercapture` is treated as pointerup.

### 8.2 Back navigation (app-wide history sentinel)
- One history entry of ours (`history.pushState({ shady: 1 }, '')`) is on top exactly while Back has something to do in the game: any screen except boot and the Title, or an open modal (confirm dialog, install or restore sheet; `ui.isModalOpen()`).
- On `popstate`: an open modal closes first; play pauses; pause stays paused; any other screen takes its back action (menus → their parent, Results → Home, dying → skip, Settings → where it was opened from).
- In-app navigation that ends that state (Home to the Title, or closing a dialog there) takes the entry back with `history.back()`. On the Title with nothing open there is no entry, so Back leaves the game.
- A native shell routes its back button to the same handler and exits the app from the Title.

### 8.3 Run start
- **Any pointerdown on the canvas** (not on DOM buttons) during Title/hold starts the run: `start` event plus catch semantics, and θ stays exactly θ0. The Title sway is a render-only offset and is discarded.
- Space/Enter also start the run.
- During hold: the clock is frozen, Nubs' y is frozen, Chill is constant.

### 8.4 Title tray
- Title tray buttons are DOM.
- **Retry speed:**
  - A tap during Dying skips to Results.
  - Retry activates 0.3 s after Results appear.
  - Tapping the map area above the sheet also retries.
  - Space/Enter retries.

### 8.5 Escape and visibility
- Escape/P pauses.
- Visibility hidden: pause. Losing window focus during play (`blur`) pauses too. Nothing ever auto-resumes.

---

## 9. Presentation fixes (critique)

- **Halo dial around Nubs** (main readout):
  - A ring of radius 40 u around Nubs' ground point, drawn above the world.
  - Sun pointer: a small sun on the ring at θ. It never fades.
  - Teal safe arcs (solid = now, dashed = +0.6 s) and red hatched glare arcs.
  - 24 detent ticks plus a curved rotation arrow while dragging.
  - Fades to 35% when not dragging and Chill is full.
  - The big edge sun glyph (sunglasses mascot) stays as decoration; keep it out of the HUD band.
- **Nubs readability:**
  - Draw a ground footprint disc (r 9 u) over the 5 test points: frost-white rim when f = 0, wet-dark when lit.
  - The sprite is compressed: body center −4 u, head −12 u, scale 0.9.
  - Partial shade tints by sample (left/right/front).
- **Compact HUD row:**
  - `D2` badge + `2:40 PM` + a time ruler (dawn → noon → dusk gradient, noon icon, PB flag, challenge flag).
  - Snow + multiplier at top right; pause at top left (48×48 DOM button).
  - On tall screens (view height > 760 u) Nubs sits at 70% from the top, otherwise 68%.
- **Clouds** fade to 0.2 α within 70 u of Nubs' screen point. They are drawn with a soft rim and a light interior.
- **Shadow layer:**
  - An offscreen half-CSS-resolution canvas.
  - Each part shadow is filled with the same **opaque** color as its own fill call, so the union is automatic with no winding issues.
  - Composite onto the world with `multiply` and the LUT alpha.
- **Melt Map:**
  - Frame the last ~600 u around the puddle at ~0.55 scale, inside the area above the results sheet.
  - Pin the two named casters with callout labels, and draw the lit gap as a red bracket.
- **Photosensitivity:** no full-screen flash above 0.2 α or faster than 3 Hz. Ease shadow-layer alpha over 40 ms during sweeps faster than 300°/s.

---

## 10. Death line

Use the first cause that matches. {time} is the death clock, `h:mm AM/PM`.

| # | Cause | Condition | Line |
|---|---|---|---|
| 1 | glare | Glare ≥ 50% of lit weight over the last 60 ticks | "Glared by {Ball} at {time}." |
| 2 | cloud | At tick −60, a cloud would have fully shaded Nubs at some θ within ±60° of θ(−60) (`cloudTurnRate` 60°/s × `cloudTurnSec` 1 s: a turn a player can make in that second) | "Melted by You at {time}. That cloud was right there." |
| 3 | gap | last = the most recent caster that shaded the center sample (within 5 s); next = the nearest caster ahead whose shade covers Nubs' position 0.5 s ahead at some θ | "Melted by You at {time}, between {last} and {next}." If only one is known: "…, just past {last}." or "…, right before {next}." |
| 4 | plain | none of the above | "Melted by You at {time}." |

`DeathInfo` carries `lastId`/`nextId` so the Melt Map can pin them.

---

## 11. Meta

### 11.1 Snow, Wardrobe, Missions
- **Snow wallet:** earned from run Snow plus mission rewards; spent in the Wardrobe.
- **Wardrobe (15 items):** as GDD §6, with the Gold scarf, Sun Visor and Crown unlocked by achievements.
- **Missions:** 3 active, from the ordered pool below. A completed mission is replaced at the next run start.
  - When the pool is exhausted, it repeats with numeric thresholds ×tier, Day goals +(tier−1) and rewards ×tier.

| # | Mission (id) | Reward |
|---|---|---|
| 1 | Reach 9:00 AM (`reach-9am`) | 10 |
| 2 | Collect 10 flakes in one run (`flakes-10`) | 10 |
| 3 | Survive a noon (reach 12:30 PM) (`survive-noon`) | 20 |
| 4 | Reach a ×3 multiplier (`mult-3`) | 15 |
| 5 | Ride a cloud's shadow for 3 s straight (`cloud-ride`) | 20 |
| 6 | Reach Day 2 (`reach-day-2`) | 30 |
| 7 | Collect an Ice Crystal (`ice-crystal`) | 20 |
| 8 | Two PHEWs in one run (`two-phews`) | 25 |
| 9 | Walk under a gate arch between 11 AM and 1 PM (`gate-arch`) | 30 |
| 10 | Pass 2 gazing balls in one run with no glare contact (`clean-balls`) | 30 |
| 11 | Reach Day 3 (`reach-day-3`) | 50 |
| 12 | Reach a ×4 multiplier (`hold-x5`) | 30 |
| 13 | Play today's Daily (`play-daily`) | 15 |

- A fresh save opens with Reach 9:00 AM, Collect 10 flakes and Survive a noon: three goals a first-timer can see happen.
- Multiplier goals clamp at ×5 (tier II of both reads "Reach a ×5 multiplier"). `hold-x5` keeps its id; a save whose unfinished `hold-x5` had progress (seconds held at ×5, which implies ×5 was reached) migrates that progress to ×5 once.
- "Play today's Daily" counts a run that used a Daily try, even one that ends after midnight.

### 11.2 Achievements (8)

| Achievement | Condition | Reward |
|---|---|---|
| First Light | Finish your first run | none |
| Night Owl | Survive to your first night | none |
| High Noon | Reach 12:30 PM on Day 3 | Sun Visor |
| Solstice | Reach Day 5 | Crown |
| Seventh Sun | Reach Day 7 | Gold scarf |
| Phew-nomenal | 25 lifetime PHEWs | none |
| Cloud Rider | 10 s continuously under one cloud | none |
| Daily Habit | 7 different Dailies played | none |

### 11.3 Daily Solstice
- **Number:** #N = days since 2026-01-01 (local date) + 1, so 2026-10-11 is #284.
- **Seed:** xmur3("shady-daily-YYYY-MM-DD"). Profile 3, no charm.
- **Tries:** 3 scored tries; best counts.
  - A try is counted **and saved** when the run passes 6:30 AM.
  - Best progress is saved each in-game hour.
  - After 3 tries the button becomes Practice (unscored).
  - Results label the run 'Try n/3' (a counted try), 'Not counted' (it melted before 6:30 AM, so no try was used) or 'Practice' (another date, or no tries left when it began). Retry reads 'Retry · practice' when the next run of that date can't count.
- **Unlocked after 3 completed lifetime runs**, i.e. once onboarding (profiles 0-2) is over. A save that already holds a Daily entry stays unlocked.
- **Dates:** a date from `?mode=daily&date=` or a Daily challenge link is accepted only if it is a valid `YYYY-MM-DD` from 2026-01-01 (`DAILY_EPOCH`, Daily #1) through tomorrow's local date (ISO strings compare lexicographically); anything else is ignored.
- **Midnight:** the session tells the UI about a new local date (checked at most once a second and when the page shows again); the Daily screen, the Title's Daily dot and the history refresh. A Play press on a screen still showing yesterday refreshes to today with a toast instead of starting yesterday's Daily.
- The screen lists the last 14 days.

### 11.4 Share and challenges
- **Share text:** as GDD §9, using the glyphs from §5.5 above.
- **Challenge code:** base64url JSON `{"v":1,"k":"e","seed":N,"m":M,"s":S}` or `{"v":1,"k":"d","d":"YYYY-MM-DD","m":M,"s":S}`.
  - Example: Day 2 · 2:40 PM is m = 1240.
  - A link is `<base>#c=<code>`. The base is the page's own address (origin + path) when it is served over http(s) and not in a native shell; otherwise `VITE_SHARE_URL` (the committed `.env` has `https://alnadel.github.io/NewGame/`, and the GitHub Pages build sets it to the Pages URL); otherwise there is no link line. A `file:` build never shares a `file:` link.
  - Opening a link shows a Title banner "Beat Day 2 · 2:40 PM". The run uses profile 3 and that seed (or that date's daily, unscored if not today).
  - A teal flag on the ruler marks the target.
- **Share mechanism:** Web Share API, then clipboard, then a toast.

### 11.5 Save
- localStorage key `shady.save`, schema v1 (`archive/TECH_SPEC.md` §12 minus charms, postcards and handedness; v2 in V1_1_PLAN UM1), using `src/meta/saveTypes.ts`.
- Memory fallback with a one-time toast.
- `navigator.storage.persist()` after the first completed run.
- **Backup code** (Settings): export copies base64url of JSON; import validates via migrate().
- **Other tabs:** the store adopts a save another tab or instance writes (storage events, and a re-read when the page shows again); a newer version's save on disk makes it read-only (`canPersist` false; Reset and Restore say so); the first failed write shows the one-time toast.
- **iOS:** show the "Play SHADY from your Home Screen" sheet once after lifetime run 3, when not standalone and not in an in-app browser. The Home Screen app keeps its own storage, so the sheet copies a backup code first; the app's first launch with no runs offers to paste it (restore sheet).
- **Android:** when the browser offers installation (`beforeinstallprompt`), Settings shows an "Install SHADY" row.

---

## 12. Audio and haptics

### 12.1 Audio
- Recipes per GDD §12, minus the fork lock.
- **Unlock:** call `ensureAudio()` on pointerdown, pointerup, touchend, click and keydown until `ctx.state === 'running'`.
- Show a small muted icon while audio is not running.
- Resume on visibility.

### 12.2 Haptics
- Patterns per GDD §13.
- Detent haptic only every 45°, at most 8/s, and none while |ω| > 300°/s.
- Global 40 ms gap.
- `navigator.vibrate` is guarded; no-op on iOS.

---

## 13. Sim acceptance targets (`npm run sim -- --check`, 100 seeds)

| Bot | Target |
|---|---|
| idle (holds θ0), profile 3 | Dies before 8:00 AM Day 1 on ≥ 90% of seeds |
| novice (200 ms perception lag, 180°/s, reads `guide.now`), profile 3 | Median death between Day 1 10:00 AM and Day 1 3:00 PM |
| novice, profile 0 | Reaches the first night on ≥ 75% of seeds |
| reactive (no lag, 200°/s, reads `guide.now` and `guide.next`), profile 3 | Median death between Day 2 noon and Day 4 noon |
| oracle (follows the validator DP), profile 3 | Reaches Day 8 on 100% of seeds |
| world | Mean rescues per chunk ≤ 1.0; `unresolved` = 0 |

**Advisory onboarding rows** (printed as PASS/MISS; they never fail `--check`). The `human` bot is a seeded model of a new player (250-350 ms reaction lag, aim noise, over/undershoot, minimum-jerk drags):

| Bot | Goal |
|---|---|
| human, profile 0 | Reaches the first night on ≥ 50% of seeds |
| human, profile 1 at `endlessDrain(1)` = 33 | Median run ≥ 30 s of real time |
| human, profile 3 at `endlessDrain(4)` = 42 | Median run ≥ 25 s of real time |

Each sim row also reports `melted%` (flakes melted ÷ all flakes resolved), the first-night share and the median run length in seconds. Current numbers are in `src/core/README.md` §11.

Tune `src/config/days.ts`/`tuning.ts` until these pass. **Never weaken a target to make it pass**; report it instead.

---

## 14. Debug and test hooks

**URL params** (the one table; the README points here):

| Param | Effect |
|---|---|
| `?test=1` | Exposes `window.__SHADY_TEST__` (below) for e2e and tooling |
| `?seed=N` | Endless world seed |
| `?mode=daily&date=YYYY-MM-DD` | The Daily of that date (Daily #1 to tomorrow; practice unless it is today) |
| `?day=N&t=dawn\|noon\|dusk\|HH:MM` | Start on Day N at that time |
| `?chill=N` | Starting Chill |
| `?profile=0..3` | Force a difficulty profile |
| `?rung=0..4` | Force a comfort rung for endless runs (v1.1) |
| `?forecast=clear\|breezy\|overcast\|heat\|long\|dazzle\|market` | Force that forecast on every day it fits (v1.1; other days are clear) |
| `?plan=0\|1` | Force the Day Plan off or on (v1.1; screenshots and baselines pin `?plan=0`) |
| `?bot=idle\|novice\|reactive\|oracle\|human` | A bot plays |
| `?fast=N` | N× ticks per frame (1-16) |
| `?guide=always\|off` | Override the shade guide |
| `?perf=0` | Full quality: no frame-time governor, no low-end caps (captures, A/B timing) |
| `?debug=1` | Overlay: frame, sim, generation and render ms, counts, ε, θ, f, chunk and rescues; toggles for test points, masks and shadow outlines |
| `?mute=1` | No audio |
| `?reset=1` | Clear the save (dev builds only: a shared link must not wipe a save) |

Runs started with `?day`, `?t`, `?chill`, `?profile`, `?rung`, `?forecast`, `?plan`, `?bot`, `?fast` or `?guide` are debug runs: not saved, scored, shared or counted as Daily tries.

**`window.__SHADY_TEST__`:**
```ts
{
  screen(): string;
  state(): { phase, day, minutes, chill, snow, theta };
  forceDeath(): void;
  runHeadless(seed, ticks, bot): string /*hash*/;
  setTimeScale(n): void;
  audioState(): string;
}
```

## 15. Decisions taken while building (formerly the READMEs' "deviations")

Gameplay and presentation:
- **First lesson.** v1.0 looped the first hint at 0.5× game time until a swing of ≥ 15° ended in full shade; v1.1 moves the pass rule into the sim (V1_1_PLAN CO4 with A5: `lessonDone`, the Chill floor of 12) and keeps the 0.5× time scale while `lessonOn`.
- **Hint target and direction.** The hint aims at the widest arc safe now *and* 0.6 s ahead (gaps ≤ 6° merged), keeps its first way round while that arc exists, honours Settings → invert, and shows the target on the halo (a glow, a bracket, dots along the way and a ghost sun gliding in step with the ghost thumb, read from `ui.ghostProgress()`).
- **Title sway** follows the ghost hand's swing (hand right → sun clockwise, or the other way with invert), and Nubs' footprint follows the swaying sun, so the Title shows drag → sun → shade → cool Nubs.
- **Start beat** (`TUNING.start.readyTicks`): 0.8 s in which the sun answers the finger but the clock, Nubs and Chill wait, so Retry's tap never walks Nubs out of the start hut's shade.
- **Nubs is drawn larger than the GDD body** (1.15× in v1.0; V1_1_PLAN GR9 raises it); the footprint disc still marks the true test area, with its rim at r 13.5 u so its quadrants stay visible.
- **X-ray**: a caster drawn in front of Nubs re-stamps him at 62 % alpha; canopies near him fade to ~0.62.
- **Heat squiggles** above a lit Nubs as well as steam (white steam is invisible on noon ground); glare spots draw **above** the shadow layer; the canvas sun mascot hides on the Title (the DOM logo carries it).
- **Crisp shadow mode** exists beside the soft half-resolution layer (cost notes in `src/game/README.md`).
- The in-play ghost hint sits below Nubs and his dial (`top: min(84%, 100% − inset − 72px)`); on the Title the hand sits below the dial when it fits above the chips, otherwise above Nubs (`ui/screens/title.ts` fit()).

Audio levels (found with the audio lab's level check and spectrogram; GDD §12 values were inaudible, masking or clipping):
- Pad 0.028 (GDD 0.035) at ±4 cents, 1 : 0.6 (equal ±7 cent saws cancelled into a tremolo); arpeggio 0.09 with a 0.4 s ring (GDD 0.03, 180 ms); sizzle 0.12 (GDD 0.22).
- Cicadas 0.4 and crickets 0.05 (GDD 0.07 and 0.03 measured −51 dBFS RMS); flake bell 0.18, multiplier chime 0.12, glare 0.16, cloud 0.2, melt 0.09, catch +2 dB.
- The heartbeat adds an octave partial and a soft knock (55 Hz alone is inaudible on phone speakers); keys fold around C4 (−5…+6).
