# SHADY v1.1: "Every run a different day"

> **Status:** the binding build input is `docs/V1_1_BUILD.md`. Its §0 Director's amendments override this plan wherever they differ, for example the 5-rung comfort ladder, a single og.png with no link stubs, the cut records and nemesis, and 5 sun-shade shapes.

**Precedence.** For v1.1 work this file wins, then `V1_PLAN.md`, then the module READMEs. Older docs live in `docs/archive/` and are history only.

**Owner's brief:** "Compactly overhaul and enhance in every possible aspect, focusing on everything except audio." No audio work: new SimEvents exist and the audio layer ignores them.

---

## 1. Goals

All goals are measured with the seeded bots, the career sim, the perf harness and screenshots.

**G1. Newcomers stay.** v1.0 has a cliff from run 2: the human model dies around 9 AM on Day 1, median run 13-19 s, and never sees noon, night or Old Town.
- Human model at comfort rung R3 (about lifetime run 4): median run ≥ 60 s.
- Human model at R6 (standard rules): median run ≥ 20 s.
- First run: the player cannot melt inside the lesson.

**G2. Run 30 differs from run 3.**
- Every standard (profile 3) run draws a Day-1 biome (Meadow or Old Town) and a forecast for every day. There are 7 forecasts, so up to 12 Day-1 combinations.
- Bold sun swings are rewarded (SWING).

**G3. Links convert.**
- A friend arriving from a challenge link plays the tutorial first, then the sender's exact rules.
- Every shared link has a rich preview.
- Results can share a postcard image.

**G4. It looks and feels like a hit.**
- Shade reads cold and safe, noon is a visible boss, Nubs is readable and reactive, the ground is alive, and death has a beat.
- All of this costs nothing net in frame time: the floor frame at 4× CPU throttle drops from 43 ms to 30 ms or less.

**G5. A reason to return.**
- Missions never stall: in the career sim, at least 80% of careers complete a mission in runs 31-40 (v1.0: 15%).
- Daily hooks: Today's errand, Sunny Week, and the Daily par ("Snowbot").
- The catalog grows to about 7k Snow (v1.0: 1.9k).
- A Journal with recent-best framing.

**G6. Compact.**
- About 7.6k net new lines for the must-have items, including tests.
- Compaction gives back about 250 lines of cache code plus the dead profile and governor paths.
- The docs diet archives about 1.5k lines.
- The unit suite runs in 12 s or less.

## 2. Director's decisions (conflicts resolved)

1. **One assist budget: the comfort ladder.**
   - Six rungs set drain and the noon training cloud from your recent results (the retention lens, P2).
   - It replaces the lifetime-run profiles and `endlessDrain`.
   - It absorbs UX-3 (the noon-cloud taper).
   - The Parasol charm is rejected: the measured effect was zero or a power-up.
   - Daily and challenge runs never use assists.
2. **The Day Plan follows the profile.**
   - It is on for profile 3, which covers Daily, standard endless rungs R3-R6 and challenges sent from profile 3.
   - Rungs R0-R2 (profiles 0-2) keep the classic alternating Clear days, so onboarding is untouched.
   - With only two biomes, the plan varies Day 1's biome, then alternates. Forecasts vary every day.
3. **The dial shows shade that lasts.** It now shows now∧next shade. This is a display-truth fix, not an assist: the human model's survival doubles. The acceptance bots stay as they are.
4. **Deferred to v1.2, behind the Day Plan hook:**
   - Frost Loop forks: L cost, and the x = trailX(y) refactor touches 19 call sites.
   - Harbor and boats: L cost.
   - Snow Globe and Eclipse: needs a shade-all primitive, and the moment is rare.
   - Dawn Start: small audience.
   - Atlas.

   **Cut:**
   - Balloons (measured 0-0.5% of shade).
   - Windmills (flicker).
   - Charms.
   - Sun-path ghosts (they leak the solution).
   - Lazy UI screens (no gain).
5. **Honest framing.**
   - Bests count from lifetime run 3 onward.
   - The gold ruler flag shows your recent best (best of the last 10 runs).
   - Rungs below R6 are visible in the Journal.
   - Adaptive comfort can be switched off in Settings.
6. **Save v2.** An old v1.0 tab sees `future` and goes read-only instead of clobbering new fields.
7. **The guaranteed noon gate arch moves** to the first Old Town day ≥ 2.
8. **Golden hashes** are regenerated once, by core, at the end of its batch.

## 3. Scope

### 3.1 IN, ranked by hit potential per line

| # | Item | Batch IDs | Must/Stretch | Est. net lines |
|---|---|---|---|---|
| 1 | Dial v2: lasting shade is the target; the human bot reads it | GR6, CO6 | must | +135 |
| 2 | Challenge links that convert: warm-up, sender's rules, names, friend's puddle, PASSED, send-back | UM2, GR8, UM7 | must | +500 |
| 3 | Shadow winding fix (5.5% of shade rendered lit) | GR1 | must | +60 |
| 4 | Comfort ladder plus recent-best framing, history and pace line | CO1, UM3, GR7 | must | +650 |
| 5 | Cool-shade / warm-light colour script, atmosphere, contact AO | GR5 | must | +260 |
| 6 | Day Plan: seeded biome and 7 forecasts | CO2, GR10, UM8, UM9 | must | +650 |
| 7 | First run can't be lost inside the lesson, plus four plain-language cues | CO4, GR7, UM9 | must | +260 |
| 8 | Missions v2: skill gates, stale swap, Today's errand | UM4 | must | +420 |
| 9 | Postcard image share plus link previews (OG) | GR14, UM7, UM11 | must | +650 |
| 10 | Hero pass (bigger Nubs, merged pops, hop, breath) plus SWING | GR9, CO3 | must | +480 |
| 11 | Noon is a boss: mascot, HIGH NOON stamp, heat wisps; Day card 2.0 | GR10 | must | +380 |
| 12 | Living ground: decor, puddles, biome identity, seam | GR11 | must | +420 |
| 13 | Death beat plus recap tip | GR12 | must | +320 |
| 14 | Results Sun Strip hero, tip and pace lines, cleanup, Share pill | UM8 | must | +380 |
| 15 | Matched source-over composite plus caster sprite cache (perf headroom for 5/11/12) | GR2, GR3 | must | +440 |
| 16 | Journal, records, nemesis, next-goal tagline | UM10, UM3, UM9 | must | +450 |
| 17 | Sunny Week, Morning Snow, Welcome back, Daily par | UM5, GR15 | must | +320 |
| 18 | Sun Shades slot, catalog to ~7k Snow, 16 achievements | UM6, GR13 | must | +560 |
| 19 | Keyboard and wheel parity | CO5, GR7 | must | +140 |
| 20 | Compaction: backdrop cache, governor level 5, profile flags, test diet, docs diet | GR4, CO1, CO7, UM12 | must | −400 code, −1.5k docs |
| 21 | Night as the reward | GR16 | stretch | +200 |
| 22 | Transition sweeps plus sundial Title | GR17 (UM9 CSS fallback is must) | stretch | +150 |
| 23 | Melt Map ribbon, hour ticks, frozen mini-dial | GR18 | stretch | +150 |
| 24 | Boot trims: lazy Title world, lazy debug and bots | GR19 | stretch | +60 |

**Budget.**
- Must: core about 1.2k, gameRender about 3.2k, uiMeta about 3.2k, so about **7.6k net**.
- Stretch: about +0.56k.

### 3.2 OUT for v1.1

| Item | Reason |
|---|---|
| Forks / Frost Lane | v1.2 |
| Harbor biome and boats | v1.2, plugs into the Day Plan |
| Snow Globe and Eclipse | v1.2 |
| Dawn Start | — |
| Atlas | — |
| Charms and Parasol | — |
| Balloons | — |
| Windmills | — |
| Sun-path ghost in links | — |
| Daily par in a Worker | Sliced on the main thread instead |
| Lazy UI screens | — |
| Per-forecast bests | — |
| Any audio work | Out of scope |

---

## 4. Batches and items

Items are listed in implementation order within each batch. The full text of every item is in the build manifest (`batches`), and is reproduced here for the record.

### 4.1 core (src/core, src/config, scripts, core tests, tests/golden)

#### CO1 [MUST] Run rules v1.1 (~+150)
Comfort-ladder data, the noonCloud world knob, new RunConfig fields, and compaction of the profile flags.

**src/config/days.ts.**
- Add NoonCloud, ComfortRung, COMFORT_RUNGS, COMFORT_MAX = 6 and `comfortAfterRun(rung, minutes)`, exactly as CC-2.
- Delete ONBOARD_DRAIN and endlessDrain.
- Delete ProfileParams day1Floor, parkedNoonCloud and firstCloudOvertakes. The Day-1 floor becomes the table floor.

**tuning.ts.**
- `cloud.parkedFromMin/parkedToMin` becomes `parkedWindows: [[0,0],[300,420],[330,390]]`, indexed by NoonCloud.

**RunConfig and World.**
- RunConfig gains `noonCloud?`, `lesson?` and `forecast?` (CC-1).
- `effectiveNoonCloud(cfg) = cfg.noonCloud ?? (profile <= 2 ? 1 : 0)`.
- World gains `noonCloud`, `planOn` (false until CO2) and `forcedForecast` (null until CO2).

**Generation and hashing.**
- `placer.generateDay` parks the Day-1 cloud iff `w.noonCloud > 0`, using `parkedWindows[w.noonCloud]`.
- The Day-1 first cloud overtakes iff `w.noonCloud > 0`.
- hashState feeds noonCloud and planOn.

**API.**
- `createRun(cfg, build?, ahead = TUNING.world.hardAhead)`.
- `headlessConfig(seed, profile, drain?, noonCloud?)` sets `lesson: profile === 0`.
- index.ts exports the new names and drops the deleted ones.

**Tests.** drain.test.ts is replaced by comfort.test.ts:
- Every comfortAfterRun branch and clamp.
- Drains strictly increase across rungs 1-6.
- On one p3 seed, noonCloud 1 and noonCloud 0 hash differently.
- noonCloud 2 parks the cloud only from 330 to 390 min.

**Acceptance.**
- With only CO1 applied, the golden entries for p0-p2 and the `sim --check --seeds 40` output are byte-identical to v1.0.
- typecheck green.

#### CO2 [MUST] Day Plan (~+450)
A seeded biome and forecast for every day of plan-on worlds.

**1) src/config/forecasts.ts.** Display data as in CC-3, plus core tuning. Anything not listed is neutral (`clear`).

| Forecast | Changes |
|---|---|
| breezy | clouds ×1.5; drift ±30 u/s; overtakers U(1.35, 1.60)·v; waiters U(0.50, 0.65)·v |
| overcast | clouds ×1.5; rx U(80, 100); caster spacing ×1.3 |
| heat | εnoon +3; flakes per cluster +1; spacing ×0.92; flake and crystal Snow ×1.5 (Math.round) |
| long | εnoon −10; spacing ×1.15; latMax +10 |
| dazzle (Meadow only) | gazing balls from t = 6 s, every 12 s |
| market (Old Town only) | no balls; stall weight ×3; gate-arch chance 0.35 |

- Cloud count ×k gives n′ = round(n·k) spawn times, evenly spaced over [first, last] of the row's times.
- **Hard rule:** no forecast changes dayLen, nightLen, v, drain, phewT or floor.

**2) planDay(seed, day).** Iterative, using `rngFor(seed, 'plan', d)`.
- Day 1, first draw: biome (< 0.5 means Meadow).
- Day 1, second draw: forecast with weights clear 40, breezy 15, long 15, overcast 10, heat 10, and 10 for whichever of dazzle or market matches the biome.
- Day d ≥ 2: the biome alternates. Forecast weights are clear 30, plus 14 for each biome-eligible non-clear forecast except the previous day's.
- Each draw is `rng.next()·total`, taken in FORECAST_IDS order.
- If dazzle or market cannot meet the gates, set its weight to 0. The ids stay in the union.

**3) World.planOn and worldPlan.**
- `World.planOn = cfg.forecast !== undefined || (profile === 3 && !tutorial)`.
- `worldPlan(w, day)` is memoised in `w.plan`. Plan-off worlds return the parity biome and `clear`. `cfg.forecast` overrides every day's forecast; the biome still comes from planDay.

**4) dayParams(day, profile, plan?).**
- Carries `forecast` and the plan's biome.
- Cache key: ((d·4 + profile)·2 + biomeIdx)·8 + forecastIdx.
- Gazing balls appear only on Old Town days, unless dazzle.
- DayParams.gateAtNoon is removed. The noon gate arch goes on the first Old Town day ≥ 2. Plan-off worlds keep Day 2.

**5) biomeAtY(w, y) replaces biomeAtY(y).**
- Every core reader (placer, validator, guide, deathcause, create, dawn) uses `dayParams(day, profile, worldPlan(w, day))`.
- `s.params` always reflects the current day's plan.

**6) START_HUT.clearAhead.**
- 140 when Day 1 is Meadow, 200 when it is Old Town.
- If a forced forecast fails the idle gate, raise that forecast's Day-1 clearAhead in steps of 20, up to 240, and record the value.

**7) Results.** buildRunResult fills `RunResult.plan`.

**8) Sim tooling.** `scripts/sim.ts --forecast <id>`.

**Acceptance: each forecast forced** (`--forecast X --check`, 40 and 100 seeds):
- Oracle reaches Day 8 on 100%; unresolved = 0; rescues per chunk ≤ 0.8.
- Reactive p3 median death in [Day 2 noon, Day 4 noon].
- Novice p3 median death in [Day 1 9:30 AM, Day 1 3:00 PM].
- Idle p3 dies before 8 AM on ≥ 93%.

**Acceptance: plan mix** (`--check` with no flag):
- Every §13 row passes with the 3-point margin.
- Rescues per chunk ≤ 0.8.

**Fallbacks:**
- Heat: if rescues exceed 0.8, set spacing ×0.96, then εnoon +2.
- Overcast: if the reactive median is later than Day 4 noon, set spacing ×1.4.

**Unit tests (forecast.test.ts):**
- dayLen, nightLen and v are identical across every forecast for days 1-12.
- planDay is pure.
- The biome alternates from Day 2.
- No identical non-clear forecasts on consecutive days (1,000 seeds × 12 days).
- Day-1 frequencies across 10,000 seeds are within ±2 points of the weights.
- Biome-only forecasts never land on the other biome.
- A sliced build and a one-shot build of a plan-on world hash the same.
- cfg.forecast forces every day.

#### CO3 [MUST] SWING, Frost grace and phewMinChill (~+220)
Lives in nubs.ts `applyDaylight`. It runs on daylight ticks with `s.ready === 0`.

**Tuning.**
- `TUNING.swing = {minDeg: 45, maxGapTicks: 20, chainTicks: 180, chainMax: 5}`.
- `TUNING.mult += {graceDeg: 30, graceLitTicks: 21}`.

**State.** NubsState gains swSrc (−1), swTheta, swTick, swChain, swLastTick (−1e9) and litTheta.

**Detection.** On a tick with f = 0:
- `src = cloudId ≥ 0 ? cloudId : shaderId`. Casters and clouds share one id space.
- If src ≥ 0, a SWING fires when all of these hold:
  - swSrc ≥ 0;
  - src ≠ swSrc;
  - `tick − swTick − 1 ≤ 20`;
  - `|angleDiff(θ, swTheta)| ≥ 45`.
- On a SWING:
  - `chain = tick − swLastTick ≤ 180 ? min(5, swChain + 1) : 1`;
  - Snow += chain (never multiplied);
  - stats.swings++, and swingChainBest is updated;
  - push `{e: 'swing', deg: round(|diff|), chain, snow: chain, x, y}`;
  - swLastTick = tick.
- Then set swSrc = src, swTheta = θ, swTick = tick. Continuous shade can therefore never fire.
- Night and dawn reset swSrc to −1.

**Frost grace.**
- litTheta is θ on the first lit tick of a streak.
- At the 9th lit tick, the multiplier resets only if `|angleDiff(θ, litTheta)| < 30`. Otherwise it resets at the 21st lit tick.

**PHEW.** `phewMinChill = min(phewMinChill, prevChill)`, starting at 100.

**Other.** hashState feeds stats.swings. Chill, f, PHEW timing, the guide and the validator are untouched.

**Acceptance (swing.test.ts):**
- 44° gives no swing; 45° gives a swing.
- A 21-tick lit gap gives no swing; 20 gives a swing.
- The same source gives no swing.
- Continuous shade with a source change after a 60° turn gives no swing.
- The chain is 2 at +180 ticks and 1 at +181, capped at 5.
- The multiplier survives a 15-tick lit stretch with a 40° turn, and resets on a 15-tick stretch with a 10° turn.

**Acceptance (sim):**
- Death-time quantiles are identical to the CO2 commit for every bot.
- Reactive mean Snow rises 5-15%.
- swings/min is printed; reactive p3 is expected at about 1.0-2.0.

#### CO4 [MUST] First-run lesson floor (~+120)
- **Tuning:** `TUNING.lesson = {floor: 12, swingDeg: 15, shadeTicks: 15, maxDaylightTicks: 1500}`.
- **State:** SimState.lessonOn.
- **Activation:** when `cfg.lesson`, lessonOn becomes true at `go`.
- **Floor:** while lessonOn, on daylight ticks, `chill = max(chill, 12)` after the Chill update.
- **Pass detection:**
  1. On a downEdge, or when a key press starts, record lessonFromθ and clear lessonSwung.
  2. lessonSwung becomes true once θ moves 15° or more from lessonFromθ during that drag or hold.
  3. While lessonSwung, count consecutive f = 0 ticks. A lit tick resets the count only.
  4. At 15 ticks, emit `{e: 'lessonDone'}` and set lessonOn to false.
- **Timeout:** after 1500 daylight ticks of lessonOn, or at nightStart, lessonOn turns off with no event.
- **Acceptance:**
  - Idle p0 (40 seeds): no death before 25 s of daylight. v1.0 died at 10.2 s.
  - Novice p0 still reaches the first night on ≥ 75%.
  - Unit: a scripted 20° drag into shade fires lessonDone after 15 shaded ticks.
  - Unit: a passing shadow alone never fires it.
  - Unit: the floor holds until 1500 ticks, after which Chill can reach 0.
  - Unit: a run with lesson off hashes the same as v1.0 behaviour.

#### CO5 [MUST] Keyboard parity in the sun model (~+80)
- **Tuning:** TUNING.sun drops keyRate and adds keyRateMin 150, keyRateMax 330, keyRampTicks 15 and keyFine 90.
- **Input:** `InputFrame.key` is −2..2, where ±2 means fine.
- **State:** SunState.keyTicks counts consecutive ticks with the same sign.
- **Rate:**
  - fine (±2): 90°/s;
  - otherwise: `150 + 180·min(1, keyTicks/15)`.
- The validator's 180°/s human model is unchanged.
- **Acceptance (sun.test):**
  - A 1-tick tap turns 2.5°.
  - 15 held ticks reach 330°/s.
  - ±2 turns at 90°/s.
  - Key plus finger never oscillate.
  - 60 held ticks turn ≥ 250°.

#### CO6 [MUST] Results data and tooling (~+300)
**RunResult.** Adds `drain`, `noonCloud` and `plan`.

**Human bot.**
- Keeps a lagged `next[]` beside `now[]`.
- humanTarget uses now∧next of the stale snapshot when any bin is set, otherwise now.

**Advisory rows in sim.ts.** Rebased on rungs; they never fail `--check`.
- Human R0 (p0@30, nc1, lesson): first night ≥ 75%.
- Human R1 (p1@36, nc1): median run ≥ 60 s.
- Human R3 (p3@44, nc1): median run ≥ 60 s.
- Human R6 (p3@55, nc0): median run ≥ 20 s and lit share ≤ 45%.
- New columns: swings/min and lit share.

**Career mode: `--career N --runs R --bot B [--meta]`.**
- Seed for each run: `hashString('career-c-r')`.
- Run 0 is rung 0. Later runs use `COMFORT_RUNGS[rung]`.
- After each run: `rung = comfortAfterRun(rung, minutes)`.
- Report per run window (1-3, 4-9, 10-25, 26+): median run, median death clock, mean rung, and the share of runs that beat the previous 10.
- `--meta` dynamically imports the meta save and progression modules. It folds each RunResult through `applyRunResult(save, result, {today, playSeconds, rung})`, with today advancing one day every 5 runs from 2026-11-02.
- `--meta` reports:
  - the share of careers with a mission completion in runs 31-40;
  - the median run of the last completion;
  - unlock % per achievement;
  - catalog owned %.

**Acceptance.**
- `sim --check` green at 40 and 100 seeds.
- `--career 20 --runs 25` finishes in under 3 min on 4 workers.

#### CO7 [MUST, last] Compaction, test diet and goldens (~−150)
**Test diet:**
- Delete the bots.test "oracle survives through Day 3" case: sim --check covers it.
- determinism.test runs the 3-minute oracle once and compares with the golden.
- generator.test clearance uses seeds 1-25.

**Goldens.** Regenerate them once, adding entries for:
- plan-on p3 seeds;
- one forced run per forecast;
- an R3 run (p3, drain 44, nc1).

**Hand-off.** Finish with a "README notes" list.

**Acceptance:**
- Core unit files take ≤ 7 s wall time.
- The suite after merge takes ≤ 12 s.
- sim green at 40 and 100 seeds.
- Validator p90 ≤ 4 ms per chunk; generation + validation mean ≤ 1.8 ms per chunk.

### 4.2 gameRender (src/game, src/render, src/main.ts, src/audio compile-only, platform/haptics.ts, tests/e2e, game/render tests)

#### GR1 [MUST] Shadow winding fix (~+60)
In traceShadows:
- canopy discs use `arc(…, 0, TAU, true)`;
- cloud shadows use `ellipse(…, 0, 0, TAU, true)`.

The header comment is rewritten. A recording-context unit test checks that polygons have signed area < 0 (y-down) and that every arc and ellipse is anticlockwise. It covers dawn, 10 AM, noon and an Old Town day, with θ every 30°.

**Acceptance:**
- The test fails on v1.0.
- Missing union pixels drop from 5.48% to < 0.1%.
- Frames with holes drop from 40/42 to 0.

#### GR2 [MUST] Matched source-over composite (~+60)
The matched colour formula:
- `M_c = 1 − a(1 − C_c/255)`
- `β = 1 − min M`
- `K_c = clamp(round(G_c(M_c − 1 + β)/β))`

where C is pal.shadow and G is groundPal.ground.
- **Crisp:** fill K at globalAlpha β, source-over.
- **Soft:** fill the layer with K and blit at β, source-over.
- Skip when β < 0.002.

**Acceptance:**
- Pixel A/B at 6 fixed states (DPR 2): mean max-channel |Δ| ≤ 1.0; ≤ 1% of pixels > 3 levels; max ≤ 20.
- Soft at 1× and crisp at 4× are each ≥ 40% cheaper.

#### GR3 [MUST] Caster sprite cache and context recovery (~+380)
**Cache.** A new `casterSprites.ts`.
- Light key: θ in 6° steps, dayFrac in 64 steps, night in 16 steps, town, highContrast, elev in 16 steps, sunUp, and S·dpr.
- Sprite origins snap to integer device pixels.
- At most 3 re-renders per frame.
- Always drawn directly: pedestals, near canopies, while zoom is moving, and in debug.
- Eviction: anything unseen for 120 frames, with a cap of 64 (LRU, canvas set to 1×1).
- Counters are reported in perf().

**Recovery.** `contextrestored` and `pageshow` (persisted) call `recover()` and `cadence.invalidate()`.

**Acceptance:**
- At 4×, DPR 1: the caster pass is ≥ 70% cheaper and the floor frame is ≤ 30 ms.
- At 1×, DPR 2: the caster pass is ≤ 1.2 ms.
- casterRenders < 0.2 per frame, and hits ≥ 90%.
- Pixel A/B: mean ≤ 1.5; ≤ 1% of pixels > 8 levels.
- Border-ring test passes.
- The contextrestored test passes.

#### GR4 [MUST] Compaction (net ≤ −250)
**Delete the settled-Results backdrop cache:**
- the cache and its stills;
- puddleBox;
- resultsAB;
- the related spec.

Settled Results run on the 50 ms cadence instead.

**Governor:**
- Delete level 5 (detail).
- New ladder:
  - 0 full;
  - 1 crisp;
  - 2 DPR×0.75;
  - 3 DPR×0.625 with a particle cap of 200.
- Re-baseline the low-device start after GR2/GR3.

**K10 de-flake.** Freeze the probe; no retries.

**Acceptance:**
- Settled Results draw ≤ 45 times in 2 s.
- The puddle ring still pulses.
- govLevel ≤ 3, and fps after 12 s at 4× is ≥ 1.4× the v1.0 value of about 19.
- e2e passes 3 times in a row.
- Diff ≤ −200 lines.

#### GR5 [MUST] Cool-shade colour script, atmosphere and contact AO (~+260)
**Shadow keys:**

| Time | Colour | α |
|---|---|---|
| 6:00 | #4536A0 | 0.46 |
| 9:00 | #3550B0 | 0.54 |
| 12:00 | #2F62C4 | 0.60 |
| 15:00 | #3A42A8 | 0.54 |
| 18:00 | #30247A | 0.50 |

**New `atmosphere.ts`:**
- a sun-direction warm/cool gradient;
- a noon bleach;
- the night pool;
- the low-Chill vignette.

Forecast tints: heat adds +0.05; overcast scales alphas ×0.7.

**Contact AO.** A warm multiply sprite on each hull, padded 5 u. Skipped at governor level 3.

**Acceptance:**
- Noon shade reads blue, and the 9 AM sun side is warmer.
- WCAG contrast is ≥ v1.0 at every key.
- renderMs +0.4 ms or less.

#### GR6 [MUST] Dial v2 (~+120)
**Arcs:**

| State | Rule | Width | Radius | α | Caps |
|---|---|---|---|---|---|
| Lasting | now∧next | 8 px | R | 0.95 | round, with a white edge |
| Ending | now only | 3 px | R | 0.45 | — |
| Coming | next only | 2 px dashed | R+6 | 0.35 | — |

If nothing lasts, `now` is drawn at 5 px.

**Chill gauge:**
- Frost-white #EAF6FF at R−8.
- Hidden at Chill ≥ 99.
- Amber below 50.
- Amber, dashed and pulsing below 25.

Teal now means only shade, and red only glare.

**Acceptance:**
- The unit mask test passes.
- A clip shows three widths, no blue ring at full Chill, and amber below 50.

#### GR7 [MUST] Session run rules (~+300)
**Rungs to RunConfig:**
- Endless: rung 0 when runs = 0. Otherwise `stats.comfort`, or 6 when comfort is off.
- `?rung` and `?forecast` produce debug runs.
- Daily: p3, nc0.
- applyRunResult receives the rung.
- The prebuild runs after the save is updated.

**Day Plan.** Feed `ui.setRunPreview`.

**Lesson and cues.**
- HintTracker's own pass detection is deleted. lessonDone sets tutorialDone and shows the `shade-found` cue.
- `keep-shade` shows on `go` (p0-1).
- `drag` shows while the hint is active.
- `melting` shows on the first lowChill for runs ≤ 2.

**Input:**
- Shift sends ±2.
- The wheel produces one tap frame per event: −15° per notch, or −0.35°·deltaY, clamped to ±45°.

**Test hook.** state() gains profile, rung, drain, noonCloud, forecast, biome and lessonOn.

**Acceptance (e2e):**
- comfort 3 gives p3/44/nc1.
- With comfort off, drain is 55.
- A fresh first run survives 15 s idle, and the cues show.
- ArrowLeft held for 1 s turns ≥ 250°.
- One wheel notch turns 15° ± 1.
- The forecast chip is present.

#### GR8 [MUST] Challenge flow (~+220)
**Warm-up.** When runs = 0, the first run is the tutorial endless run. The challenge comes next, via the "Take the challenge" Retry.

**Rules from the code:**
- p (default 3)
- tutorial iff p = 0
- dr (default 55)
- nc (default 0)
- No lesson, hint or cues.

**Stamps:**
- "PASSED {NAME}!" (teal) the first time the target is reached.
- "PAST YOUR RECENT BEST" (gold), once per run, when history ≥ 3.
- Each stamp brings confetti(24) and haptics `best`.

**HUD:**
- The gold flag shows recentBest.
- A white tick shows nextMilestone.

**Friend's puddle.** At yAtTime(target) and trailX:
- a 12×7 u #8FD3FF ellipse;
- a 30 u pole;
- a 14×9 #2EC4B6 pennant;
- the name pill.

**Acceptance.** The e2e flow: the warm-up is profile 0, Retry is labelled "Take the challenge", and the next run uses the code's rules. demo("passed") passes, and a screenshot is taken.

#### GR9 [MUST] Hero pass and SWING juice (~+260)
**Nubs:**
- NUBS_SCALE 1.40.
- POP_PLUS spawns at (+16 u, z 200), and merges within 0.45 s.
- Mult pops sit at −18 u.

**Hop.** 0.34 s and 5 u (9 u at ×5), with squash and stretch. Triggers: multUp, PHEW, swing and dawn. None under reduced motion.

**Look and breath:**
- Look-at targets flakes within 70 u.
- Cold breath: a puff every 1.6 s while shaded.

**SWING:**
- A teal swept arc for 300 ms.
- A "SWING!" pop, with "×N" on chains.
- Haptic tick, rate-limited to one per 300 ms.
- Audio ignores it.

**Acceptance:**
- No pop overlaps the head.
- Three flakes give a single "+3".
- renderMs +0.1 ms or less.

#### GR10 [MUST] Noon boss, Day card 2.0 and forecast presence (~+380)
**Boss weight b ramps:**
- up over 11:00-11:30 AM, down over 12:36-1:00 PM;
- Heat Wave days are wider: 10:30 AM-1:30 PM.

**Mascot:**
- Scale, bloom, rays and a corona all grow with b.
- `boss` mood: shades pushed up, angry brows, a grin.

**HIGH NOON stamp.** Slams 2.4→1 over 220 ms, with a 3 u shake. The same stamp renderer is used for GR8's stamps.

**Heat wisps.**
- Spawn only on lit ground, 44-160 u from Nubs, while b > 0.3.

**Other:**
- The clock pill glows.
- The noonPassed relief beat.

**Day card.** "DAY N", plus "BIOME · FORECAST · NOON ε°" with a biome glyph and rays.

**Forecast presence:**
- A HUD forecast glyph.
- Breezy wind streaks.

**Acceptance:**
- Boss-ramp screenshots.
- Wisps only on lit ground.
- No alpha step > 0.2.
- renderMs +0.4 ms or less.

#### GR11 [MUST] Living ground (~+420)
**Decor.** A `decor.ts` deterministic decal layout:
- 48 u grid, 24 u trail clearance, footprints + 6 u.
- Meadow: 6 decals.
- Old Town: 5 decals.

**Puddles.** They freeze when shaded and steam when lit.

**Biome contrast:**
- Meadow ground #E6F2CF.
- Old Town ground #F2D9C4.
- Cobble rowH 18.
- Whitewash walls.
- Seeded roofs.

**Seam.** Blended through an alpha mask, with a signpost and lamps.

**Lookups.** Everything uses `biomeAtY(world, y)`.

**Acceptance:**
- The layout is identical for the same seed.
- No decal sits near the trail or inside a footprint.
- renderMs +0.3 ms or less.

#### GR12 [MUST] Death beat and recap tip (~+320)
**Beat:**
- Push-in to 1.18 via CameraFx.hold.
- Selective desaturation: clear inside 36 u, 0.75 beyond 70 u.
- A cool wash.
- The hat pops off.
- The guilty sun gets a sweat drop.
- Everything fades during the map pull.
- Governor gating applies.

**Recap.** `recap.ts` deathTip picks the tip, first match wins:
1. glare
2. "Shade was N° left/right. Drag ←/→." (exposure ≥ 1.5 s, |away| ≤ 90)
3. "In the sun k of the last 10 s."
4. noon advice

Shown as ResultsView.tip.

**Melt Map.** Callout labels flip when they overlap.

**Acceptance:**
- Desaturation frames look right, and zoom is about 1.18.
- renderMs +0.5 ms or less.
- Every branch is unit-tested.
- ≥ 85% of human R6 deaths get tip 2 or 3.
- Labels never intersect.

#### GR13 [MUST] Sun Shades rendering (~+260)
**Lens shapes:**
- classic
- round
- aviator
- shutter
- 3d
- monocle
- star
- heart
- ski

All animations work on every shape.

**Wardrobe.** `renderWardrobePreview(…, 'sun')`.

**Acceptance:**
- A grid of 9 shapes × 3 moods × 2 sizes.
- Sun draw time within ±5%.

#### GR14 [MUST] Postcard (~+330)
**Canvas.** 1080×1350:
- the map panel from an offscreen Renderer;
- the guilty sun with shades;
- the score block;
- vector glyph rows (never emoji);
- a footer.

**Lifecycle:**
- Pre-generated after the map settles.
- A PNG File is created.
- setPostcard(thumb).
- The share button calls shareFiles synchronously.

**Acceptance:**
- The download is a 1080×1350 PNG under 1.2 MB.
- The stubbed share is called within the click task.
- Built in under 60 ms.
- No frame over 33 ms.

#### GR15 [MUST] Daily par job (~+80)
**Job.**
- Runs the novice bot on today's Daily seed in slices of 3 ms or less.
- Never runs during play.
- Calls setDailyPar.

**Acceptance:**
- The par shows within 2 s at 4×.
- No long task over 50 ms.
- The par equals runBot.

#### GR16 [STRETCH] Night as the reward (~+200)
- Moon shadows.
- Window glows.
- 14 fireflies.
- Flower halos.
- A moon rim on Nubs.
- The "Night · Day N survived" card.

#### GR17 [STRETCH] Sweeps and sundial (~+150)
**Sweeps:**
- A sunset band.
- A dawn band, with the biome flip timed to the band.

**Sundial.** `--lsx/--lsy` follow the Title sun.

#### GR18 [STRETCH] Melt Map story (~+150)
- A Chill ribbon.
- Hour ticks.
- A frozen mini-dial.

#### GR19 [STRETCH] Boot trims (~+60)
- Title world built with `ahead` 1100.
- Lazy debug and bots.

### 4.3 uiMeta (src/ui, src/meta, src/platform except haptics.ts, public, index.html, vite.config.ts, .github, all *.md, scripts/gen-og.ts, tests/e2e/meta.spec.ts + og.spec.ts, meta/ui unit tests)

#### UM1 [MUST] Save v2 and migration (~+320)
- Save schema per CC-9.
- `type SaveV1 = Save` alias until integration.
- MIGRATIONS[0] maps v1 to v2:
  - comfort from the runs map;
  - shades default;
  - play-daily replaced;
  - records.snow seeded.
- sanitize repairs every field.
- A v1.0 tab sees `future`.

#### UM2 [MUST] Challenge links v1.1 and names (~+240)
**Codec:**
- p, dr, nc, n.
- Invalid optional fields are dropped.
- MAX_CODE_LENGTH 320.

**sanitizeName:**
- NFC normalization.
- 1-12 characters.
- Whitelist: `/^[\p{L}\p{N} ._'-]+$/u`.
- No bidi controls.

**Links.** `${base}c/N/#c=` and `c/d/#c=`.

**Banner copy.** "{Name} challenges you: Beat X", plus the "Warm-up run first" note.

**Settings.** A "Name on challenges" field.

#### UM3 [MUST] Comfort, history, pace, records and nemesis (~+380)
**Bests and comfort:**
- Bests count from runs ≥ 3.
- history (cap 30).
- comfort via comfortAfterRun.

**Helpers:**
- recentBest
- nextMilestone
- nextGoal

**Pace line:**
- "Your best in 10 runs!"
- "Better than k of your last 10"
- "Below your usual (…)"

**Records and nemesis:**
- 7 records, with at most 2 chips per run.
- nemesis keeps the top 10.

**Also updated:** playSeconds, swings and forecastNoons.

**Career acceptance** (after integration):
- Human runs 10-25: median ≥ 18 s and median death ≥ 10:00 AM.
- Novice reaches rung ≥ 5 by run 6.
- Reactive is at R6 from run 2.
- The recent best is beaten in 5-15% of runs 11+.

#### UM4 [MUST] Missions v2 (~+420)
**Gates:**

| Mission | Gate |
|---|---|
| reach-day-2 | 390 |
| hold-x5 | 390 |
| gate-arch | 720 |
| clean-balls | 720 |
| reach-day-3 | 1080 |
| Reach goals, tier ≥ 2 | target − 330 |

**Pool and swap:**
- MISSIONS[12] becomes swings-3, replacing play-daily (cursor-safe).
- A deferred queue holds gated missions.
- After 5 stale runs, the Swap button appears.

**Today's errand.** 12 shared errands, hashed by date, worth 30 Snow, with progress summed over all of that date's runs.

**Career acceptance** (after integration):
- ≥ 80% of careers complete a mission in runs 31-40.
- The median last-completion run is ≥ 36.

#### UM5 [MUST] Sunny Week, Morning Snow and Welcome back (~+240)
- **Morning Snow:** +15.
- **Welcome back:** ×2 run Snow after 3 or more days away, capped at +100.
- **Week:** Monday-based, built from date strings. 3, 5 and 7 days pay +30, +50 and +80.
- **Week card:** stamps with rays per day reached.
- No FOMO copy.

#### UM6 [MUST] Achievements 16, Shades slot and catalog (~+300)
**8 new achievements** (with rewards where they have one):

| Achievement | Reward |
|---|---|
| sundancer | shades-star |
| rematch | shades-heart |
| sunny-week | scarf-aurora |
| close-shave | — |
| glare-proof | shades-ski |
| ice-cold | nose-icicle |
| night-gardener | — |
| forecaster | — |

**Shades.**
- A 4th Wardrobe tab.
- 9 shades.
- Plus scarf-midnight, hat-gilded and scarf-aurora.

**Badge wall.** "x/16".

**Career acceptance.** Reactive owns ≤ 70% of the catalog by run 40.

#### UM7 [MUST] Sharing v1.1 (~+120)
**shareFiles.**
- `navigator.share` is called before any await.
- Otherwise the PNG is downloaded and the text copied, returning `saved`.

**Share text.**
- Forecast emojis in the header.
- The "Beat Sam's run:" line.
- The Daily par line.

#### UM8 [MUST] Results v1.1 (~+380)
**Sun Strip** (hero):
- One row per day, last 4 shown.
- 22 px tiles: hour tint mixed with the glyph colour, plus the glyph shape.
- Moon pills between days.
- Pop-in animation.

**Lines.** Tip and pace.

**Cleanup:**
- Zero tiles hidden.
- Gap collapsed.

**Rows and cards:**
- The warm-up card.
- "Send it back".
- The errand row and Swap.

**Share pill.** With the postcard thumbnail.

#### UM9 [MUST] Title, Daily, cues, Settings and logo (~+300)
**Title:**
- The forecast chip.
- The Best chip opens the Journal.
- The next-goal tagline.
- The welcome-back toast.
- The ghost hint moves below the dial.

**Cue line.** Uses aria-live.

**Keyboard.** A key chip shows under `.is-kbd`.

**Daily header.** Shows the forecast and the par.

**Settings:**
- Name.
- Adaptive comfort.
- Guide copy.

**Logo.** The `.logo-drop` var fallback.

#### UM10 [MUST] Journal (~+320)
- Bests.
- A 30-run bar chart: rungs below 6 hatched, with averages and the delta.
- Records.
- Totals.
- Nemesis.

#### UM11 [MUST] Link previews (~+200 plus PNGs)
**Previews:**
- OG and Twitter tags.
- `scripts/gen-og.ts` produces og.png, og-d1..7 and og-daily.

**Stubs.** `public/c/{1..7,d}/index.html` redirect to `../../`, keeping search and hash.

**Service worker.** The precache is unchanged.

#### UM12 [MUST] Docs diet and v1.1 docs
**New:** docs/V1_1_PLAN.md.

**Archive** these 4 into docs/archive/:
- TECH_SPEC
- CRITIQUE
- WAVE1_HANDOFF
- CONCEPTS

**Consolidate:**
- Fold the "Deliberate deviations" sections into V1_PLAN.
- Keep one URL-parameter table.
- README.md ≤ 90 lines.
- Add GDD status lines.
- Update the module READMEs per the contracts.

**Acceptance.** −1,500 lines or more.

---

## 5. Cross-batch contracts
These are the binding contract texts, also delivered as `crossContracts`.

**CC-0 Ownership.**
- Batch boundaries as in §4.
- Every cross-batch API that is missing in a worktree uses a `// V11-SHIM: CC-x` fallback. Integration removes all of them.
- Only core regenerates goldens.
- Only uiMeta edits `*.md`.
- Cross-batch e2e assertions are verified at integration.

**CC-1 RunConfig.**
- Adds `noonCloud? 0|1|2` (part of world identity; default p ≤ 2 → 1, else 0), `lesson?` and `forecast?` (a debug run).
- `createRun(cfg, build?, ahead?)`.
- `headlessConfig(seed, profile, drain?, noonCloud?)` sets lesson for p0.
- Removed: endlessDrain, ONBOARD_DRAIN, the profile flags and keyRate.

**CC-2 Comfort ladder.**
- `COMFORT_RUNGS[0..6]`, as {profile, drain, noonCloud}:

| Rung | profile | drain | noonCloud |
|---|---|---|---|
| R0 (tutorial) | 0 | 30 | 1 |
| R1 | 1 | 36 | 1 |
| R2 | 2 | 40 | 1 |
| R3 | 3 | 44 | 1 |
| R4 | 3 | 48 | 2 |
| R5 | 3 | 52 | 0 |
| R6 | 3 | 55 | 0 |

- `comfortAfterRun`:
  - From rung 0: m ≥ 1440 → 6; m ≥ 720 → 3; otherwise 2.
  - Otherwise: m ≥ 1440 → 6; m ≥ 390 → +1; m < 240 → −1; clamp to 1..6.
- Migration map for runs 1..8: [1,1,2,3,4,4,5,6]; runs ≥ 9 → 6.

**CC-3 Day Plan.**
- `ForecastId` in order: clear, breezy, overcast, heat, long, dazzle, market.
- FORECASTS display table: name, emoji, blurb, biome.
- `DayPlan`, `planDay(seed, day)`, `worldPlan(w, day)`, `biomeAtY(w, y)`.
- `World.planOn`, `DayParams.forecast`, `RunResult.plan`.

**CC-4 SWING.**
- `{e: 'swing', deg, chain, snow, x, y}`.
- RunStats gains swings, swingChainBest and phewMinChill.

**CC-5 Lesson.** `{e: 'lessonDone'}`; `SimState.lessonOn`.

**CC-6 Input.** `InputFrame.key` −2..2.

**CC-7 RunResult.** Gains drain, noonCloud and plan.

**CC-8 Challenge code.**
- Endless: `{v:1, k:'e', seed, m, s, p, dr, nc, n?}`.
- Daily: `{v:1, k:'d', d, m, s, n?}`.
- Validation and links: see the full text.

**CC-9 Save v2.** Full schema; see the full text.

**CC-10 Meta API.**
- applyRunResult options and outcome.
- recentBest, nextMilestone, nextGoal, setDailyPar, welcomeBackDue, swapMission, errandView.

**CC-11 UI API.**
- `journal` screen.
- setRunPreview, showCue, setPostcard.
- swapMission.
- renderWardrobePreview subject.
- ResultsView: tip, warmupFor, challengeName.
- ChallengeBanner: name, warmup.

**CC-12 Cosmetics.**
- `shades` slot.
- ShadesLook.
- Ids and colours.

**CC-13 Share.**
- shareFiles.
- ShareOutcome `saved`.
- Text format.

**CC-14 CSS and DOM.**
- `--lsx`, `--lsy`.
- `.cue` placement via `--nubs-y` and `--halo-r`.
- `.sui.is-kbd`.

**CC-15 Test hook.**
- state(), demo() and perf() additions.
- Removed hooks.
- `?forecast=` and `?rung=`.

**CC-16 OG.** Files and stub paths.

**CC-17 Par.** Computation and storage.

**CC-18 Sim tooling flags.**

(Each one is reproduced in full in the `crossContracts` list of this plan's build manifest; implementers must use those exact names, types and numbers.)

---

## 6. Sim and perf targets

### Hard targets (`npm run sim -- --check`, fail CI)

| Row | Target |
|---|---|
| §13 (unchanged numbers) | Each passes on the plan mix (p3 plan on, nc0) with a 3-point margin |
| idle p3 | Dies before 8 AM on ≥ 90% |
| novice p3 | Median death in [D1 10:00 AM, D1 3:00 PM] |
| novice p0 (lesson on) | Reaches the first night on ≥ 75% |
| reactive p3 | Median death in [D2 noon, D4 noon] |
| oracle p3 | Reaches Day 8 on 100% |
| world | Rescues per chunk ≤ 0.8 (tightened from 1.0); unresolved = 0 |
| Each forecast, forced (`--forecast X`) | Oracle 100% Day 8; unresolved 0; rescues per chunk ≤ 0.8; reactive median in [D2 noon, D4 noon]; novice median in [D1 9:30 AM, D1 3:00 PM]; idle before 8 AM ≥ 93% |
| SWING | Death quantiles identical to the pre-SWING commit for every bot |

### Advisory targets (PASS/MISS, never weaken; report)

| Row | Target |
|---|---|
| human R0 (p0@30, nc1, lesson) | First night ≥ 75% |
| human R1 (p1@36, nc1) | Median run ≥ 60 s |
| human R3 (p3@44, nc1) | Median run ≥ 60 s |
| human R6 (p3@55, nc0) | Median run ≥ 20 s; lit share ≤ 45% |
| reactive | 1.0-2.0 swings/min; mean Snow +5-15% |
| Career (`--career 20 --runs 25 --bot human`) | Runs 10-25: median ≥ 18 s and median death ≥ 10:00 AM |
| Career, novice | Rung ≥ 5 by run 6 |
| Career, reactive | R6 from run 2 |
| Career, recent best | Beaten in 5-15% of runs 11+ |
| Career meta (20 × 40) | ≥ 80% of careers complete a mission in runs 31-40; median last completion ≥ 36 |
| Career meta, catalog | Reactive owns ≤ 70% by run 40 |

### Perf targets
- **Floor frame** (4×, DPR 1, seed 42, Day 1): ≤ 30 ms (v1.0: 43).
- **Soft shadow pass** (1×, DPR 2): ≥ 40% cheaper.
- **Caster pass:** ≥ 70% cheaper at the floor; ≤ 1.2 ms at 1×.
- **Governed 4×:** fps ≥ 1.4× v1.0.
- **Per-feature renderMs deltas:**

| Feature | Max delta |
|---|---|
| AD1 | +0.4 ms |
| Hero | +0.1 ms |
| Noon | +0.4 ms |
| Decor | +0.3 ms |
| Dying | +0.5 ms |
| Night (stretch) | +0.3 ms over day |

- **Validator:** p90 ≤ 4 ms per chunk.
- **Unit suite:** ≤ 12 s.

---

## 7. Integration checklist
1. Merge core, then gameRender, then uiMeta. Replace every V11-SHIM. typecheck.
2. Run `npx vitest run` three times. Try `isolate: false` in vite.config.ts; keep it only if green 3/3.
3. Run `node scripts/sim.ts --check` at 40 and 100 seeds, and with `--forecast` for each id.
4. Run the career and meta reports. Record the numbers in the core README §11.
5. Full e2e, three times in a row. Perf harness rows.
6. `node scripts/gen-og.ts` on the merged build; commit the PNGs.
7. Manual smoke test at 390×844 touch and 1280×800: first run, a challenge link from a fresh profile, Daily, the postcard share, and the Journal.
8. Delete the SaveV1 alias; confirm `grep V11-SHIM` returns nothing.
