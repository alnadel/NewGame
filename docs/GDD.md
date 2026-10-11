# SHADY: Game Design Document v1.0

Code name `shady`. Store title: **SHADY: Don't Melt Nubs**. Platforms: web/PWA first, then iOS and Android through Capacitor. Portrait, played with one thumb.

---

## 0. What this game is built from

- **Core rules:** SUNDIAL (concept #9). You turn a 1D sun dial; the time of day sets how high the sun is; noon is the boss of each day; the trail forks and Nubs picks the shadier branch; clouds act as long-reach umbrellas; mirror glare is a second-order hazard; a validator guarantees every stretch is survivable.
- **Character and brand:** SHADY (concept #0). Nubs the snowman; a sun mascot wearing sunglasses whose face reacts to Nubs; snowflakes ahead of Nubs melt in sunlight; the PHEW slow-mo save; a puddle death with a floating carrot.
- **Grafts:**
  - "Melted by You" causal death line and serverless challenge links (PASTIME).
  - Time ruler with a personal-best (PB) flag (Tipping Point).
  - Spoiler-free glyph share strip (CREASE).
  - Flake notes quantized to the music and melody replay on the results screen (BLOOMLOOP/PASTIME).
  - Safe-arc guide, catch-on-touch, speed cap, bots, debug params (feasibility judge).

All visuals are procedural vector drawing and all audio is synthesized. No asset files.

---

## 1. Pitch

**One-liner:** You are the sun. Don't melt Nubs.

**Elevator pitch:** Nubs, a chubby snowman, waddles along a sunny trail on his own. You can't move him. You can turn the sun. One horizontal swipe swings every shadow in the world at once, like clock hands, and you lay cool shade under him. Dawn is gentle with long shadows. Noon is brutal, with shadows shrinking to stubs. Dusk is a breather and night is a reward. Then it's Day 2. Your score is the time of day you reach: **"Nubs made it to Day 3 · 2:40 PM."**

**Design pillars**
1. **One finger moves all the shade in the world.** Even failing feels like playing with a toy.
2. **The day is the difficulty curve.** Each day is a 58-second chapter with a built-in tension wave.
3. **Every melt is visibly your fault.** The death line names the gap.
4. **Retry takes under one second.** Runs are short and chapters are natural stopping points.

**Session targets:** a first run lasts 25-45 s. A competent run lasts 1.5-3 min (Day 2-3). An expert run lasts 5-8 min (Day 5+). A typical sitting is 6-10 runs.

---

## 2. Core rules

All gameplay constants live in `src/config/tuning.ts` and `src/config/days.ts`. The numbers below are the v1 defaults.

### 2.1 Units, camera, projection

- **u** is the world unit. The ground plane has x pointing east (right) and y pointing north (up the screen, the walking direction). Heights are z.
- The visible world width is fixed at **360 u** (x ∈ [0, 360]). The camera never pans horizontally.
- Visible world height runs from **600 to 860 u**, depending on screen aspect. Outside that range the view is letterboxed (see tech spec).
- Nubs is drawn at **68% of the view height from the top**, so you always see at least 408 u ahead.
- **Oblique projection:** a point at height z is drawn **0.25·z u higher** on screen. Prisms show their south side faces and their top face.
- Camera y follows Nubs exactly. The only camera effects are shake and zoom pulses.

### 2.2 The day clock

- **Day N daylight length:** Dl(N) = 50 s for N ≤ 5, and Dl(N) = max(30, 50·0.9^(N−5)) s for N ≥ 6. That gives 45, 40.5, 36.45, 32.8, then 30 s.
- **Night** lasts 8 s (12 s with the Long Night charm).
- **In-day time** t ∈ [0, Dl). The clock reads 6:00 AM + 720·t/Dl minutes. On Days 1-5 that is 14.4 in-game minutes per real second, and one in-game hour lasts 4.167 s. The display format is `Day N · h:mm AM/PM`.
- **Sun elevation:** ε(t) = 6° + (εnoon(N) − 6°)·sin(π·t/Dl).
- **εnoon by day:** 48°, 58°, 66°, 72°, then 76° for every day from Day 5 on.

Shadow ratio L/h at noon:

| Day | εnoon | tan εnoon | L/h at noon | 120 u stone at noon |
|---|---|---|---|---|
| 1 | 48° | 1.111 | 0.90 | 108 u |
| 2 | 58° | 1.600 | 0.62 | 75 u |
| 3 | 66° | 2.246 | 0.45 | 53 u |
| 4 | 72° | 3.078 | 0.32 | 39 u |
| 5+ | 76° | 4.011 | 0.25 | 30 u |

At 6:00 AM (ε = 6°), L/h = 9.5, so shadows hit the 520 u cap. At night there is no sun: no shadows, no glare, no drain.

### 2.3 The sun (your control)

- **Azimuth θ** is in degrees in [0, 360). 0 = east, 90 = north (ahead), counter-clockwise is positive. Light comes **from** θ, and shadows point toward θ + 180°.
- **Drag.** A horizontal drag anywhere on screen changes the target by Δθ = −(dx / viewportCssWidth) × 310° × sensitivity. Sensitivity defaults to 1.0 (range 0.6-1.5). Dragging right turns the sun clockwise, and all shadows swing clockwise too. A setting inverts this. Vertical motion is ignored.
- **Following the finger.** While the finger is down, θ follows the target at up to **600°/s** (300°/s with reduced motion).
- **Catch.** Touch-down sets the angular velocity ω to 0 instantly.
- **Inertia.** On release, ω = the average angular velocity over the last 80 ms of drag. If the finger did not move in the last 50 ms, ω = 0. ω is clamped to ±360°/s. Each tick, θ += ω·dt and ω *= e^(−3.5·dt) (0.9433354 per 60 Hz tick). Inertia stops when |ω| < 5°/s. A full-speed flick travels about 103°.
- **Detents.** Each time θ crosses a multiple of 15°, you get a click sound, a 5 ms haptic, and a flash on that dial tick. Detents are feedback only; there is no magnetic snap.
- **Keyboard.** Left/A turns counter-clockwise and Right/D turns clockwise, at 180°/s.
- **Sun glyph.** A cast ray from Nubs' screen position in direction θ meets a rounded rectangle inset 26 CSS px from the world viewport edges (plus safe-area insets). The sun glyph sits at that point. A small sun pointer (an 8 px triangle) also rides Nubs' chill ring toward θ, so the direction stays visible even when the thumb covers the glyph.

### 2.4 Shadows

Sun vector **u** = (cos θ, sin θ). Caster parts come in three types:

- **Prism** (convex footprint F, height h). Shadow length L = min(h / tan ε, **520**). The shadow is the convex hull of F ∪ (F − u·L). Logic test for a point p: shaded iff the segment [p, p + u·L] intersects F. This is exactly equivalent to the hull test.
- **Slab** (floating convex F between heights z0 and z1: stall roofs, arch lintels). Shadow = hull(F − u·R(z0) ∪ F − u·R(z1)), where R(z) = min(z / tan ε, 520). Logic test: p + u·R(z) ∈ F for z ∈ {z0, (z0+z1)/2, z1}.
- **Disc** (floating circle with center c, radius r, height z: tree canopies). Shadow = disc at c − u·R(z). Logic test: |p + u·R(z) − c| ≤ r.

Other rules:

- **Clouds and balloons** are discs or ellipses at altitude. Their offset cap is **900** (instead of 520), so at dawn their shadows land far off-screen.
- **Union.** Overlapping shadows do not get darker; all shadows are equal.

### 2.5 Nubs and Chill

- **Body:** radius r = 11 u, plus a 7.5 u head drawn above. Nubs walks the trail centerline (or the fork branch he picked) and never collides with anything; the trail is always clear.
- **Coverage samples:** five ground points at the center and ±5.5 u along x and y.
- **Lit weight per sample:** 0 if shaded and not in glare, 1 if lit, +1 extra if inside a glare spot (glare ignores shade). **f** = (sum of weights) / 5, so f ∈ [0, 2].
- **Chill** runs from 0 to max (100; 130 with Snowball) and starts at max.
  - dChill/dt = **−55·f + 30·max(0, 1 − f)**. Full sun takes Nubs from 100 to 0 in 1.82 s; glare is twice as fast.
  - **Gentle tuning** applies to lifetime runs 0, 1 and 2: the drain coefficient is 40 instead of 55.
  - At night Chill regenerates at +30/s regardless of f, so the next dawn always starts at max.
- **Visual size** s = 0.6 + 0.4·Chill/max. This is visual only; the logic samples never shrink.
- **Death:** Chill ≤ 0 during daylight. It is the only fail state.

### 2.6 Trail

- **Control points** are spaced every 120 u in y. x(i+1) = clamp(x(i) + U(−70, 70) + 0.15·(180 − x(i)), 80, 280). The curve is uniform Catmull-Rom. Because the control points are evenly spaced in y, y is exactly linear in the spline parameter, so the trail is a function x = trailX(y).
- **Nubs' progress variable is y.** dy/dt = v(day) during daylight and v(day)·8/nightLength at night. Night distance is always 8·v, so charms never change the time↔y mapping.
- **Shape:** half-width 15 u, drawn 30 u wide with a 2 u darker edge.
- **Straightening:** around forks and in the tutorial, control points are forced straighter (§2.9, §4).

### 2.7 Casters (shadow-casting objects)

**Placement.** Walk north from the chunk start. Each gap is spacing(day)·U(0.7, 1.3). The side switches with probability 0.6. The lateral distance from the centerline to the nearest footprint point (the trunk, for trees) is U(latMin, latMax). Rectangle kinds get a rotation of 15°·randInt(0..11); trees are not rotated. **Clearance rule:** every ground footprint stays at least 14 u from the centerline and from any fork-branch centerline. If it fails, push the caster outward 4 u at a time.

**Meadow** (odd days)

| Kind | Footprint / parts | Height | Weight |
|---|---|---|---|
| Tree | trunk prism 8×8 + canopy disc r30 | trunk 60, canopy z 75 | 40% |
| Oak | trunk prism 10×10 + canopy disc r40 | trunk 70, canopy z 90 | 15% |
| Cottage | prism 60×44 (gable roof, render only) | 75 | 15% |
| Standing Stone | prism 26×26 | 130 | 10% |
| Hedge | prism 100×16 | 40 | 10% |
| Hut | prism 36×32 (pitched roof, render only) | 55 | 10% |

**Old Town** (even days)

| Kind | Footprint / parts | Height | Weight |
|---|---|---|---|
| House | prism 56×56 (flat roof with parapet) | 110 | 20% |
| Tree | as Meadow | 60 / 75 | 20% |
| Arch | 2 post prisms 14×14 at ±32 u local x; lintel slab 78×14 | posts 90; lintel z 70-90 | 15% |
| Stall | 4 post prisms 4×4 at roof corners; roof slab 48×34 | posts 40; roof z 40-46 | 15% |
| Column (statue) | prism 24×24 | 140 | 15% |
| Wall | prism 100×14 | 50 | 15% |

- **Gate arches:** 10% of arches straddle the trail, with posts at trailX ± 32 (inner post edges 25 u from the centerline, so Nubs passes with 14 u of clearance). The lintel shades right over the trail near noon. This is the "walk under the arch at noon" moment.
- **Start hut:** every run's first caster is a Hut at y = 10 with its nearest edge 20 u to the left or right (random). Its center sits at lateral −(20 + 18) or +(20 + 18). θ0 is the direction from Nubs to the hut center, so Nubs always starts in shade.
- **Names:** each caster gets a seeded name, "the {Adj} {Noun}". Adjectives: Old, Crooked, Blue, Little, Tall, Mossy, Lonely, Grumpy, Sleepy, Red, Leaning, Fancy. Nouns by kind:

| Kind | Noun(s) |
|---|---|
| Tree | Pine, Birch, Maple, Elm |
| Oak | Oak |
| Cottage | Cottage |
| Hut | Hut, Shed |
| Standing Stone | Standing Stone, Menhir |
| Hedge | Hedge |
| House | House, Bakery, Inn |
| Arch | Arch, Gate |
| Stall | Fruit Stall, Flower Stall |
| Column | Column, Statue |
| Wall | Wall |
| Gazing ball | Gazing Ball |

### 2.8 Clouds, balloons, gazing balls

- **Cloud.** Ellipse with rx = U(60, 80) and ry = 0.66·rx, at altitude 300. Its shadow is offset by u·min(300 / tan ε, 900). Clouds ride with the trail so they can act as umbrellas:
  - 50% are **overtakers**: they spawn 350 u behind Nubs and move north at U(1.20, 1.35)·v.
  - 50% are **waiters**: they spawn 450 u ahead and move north at U(0.65, 0.80)·v.
  - Lateral drift U(−10, 10) u/s, x0 = U(60, 300), lifetime 40 s.
  - Spawn times per day are in the difficulty table (§3.1).
- **Balloon** (hot-air). Disc r18 at altitude 140. Spawns 300 u ahead, moves north at 0.9·v with x drift ±15 u/s, lifetime 30 s. It is a small, precise umbrella.
- **Gazing Ball** (Old Town only; a mirrored sphere on a pedestal).
  - The pedestal is a 10×10 prism, h 30, and counts as a normal caster.
  - The mirror sits at z 40. Its **glare spot** is a circle of r 22 centered at ball + u·min(40 / tan ε, 300), active while ε ≥ 8°. Glare moves to the sun side, the opposite of shadows, so swinging the sun to save Nubs can swing glare onto him.
  - Balls are placed U(40, 80) u from the centerline, on alternating sides.
  - The glare spot is drawn as a hot radial disc with a rotating hatched ring, so it is readable without color.

### 2.9 Forks (steering by shade)

**Schedule.** Day 1 at t = 14 s (9:21 AM) and 33 s (1:55 PM). Day 2 and later at t = 10, 24 and 38 s, scaled by Dl/50. The fork y is moved forward when needed so that [y_f − 150, y_f + 250] fits in one generation chunk.

**Geometry**
- From y_f, two branches separate with a smoothstep over 60 u to ±55 u lateral offset, hold for 130 u, and merge over 60 u (250 u in total).
- Trail control points in [y_f − 200, y_f + 300] are forced to x ∈ [140, 220] with |Δx| ≤ 20.
- One branch, chosen at random, is the **Frost Lane**:
  - 6 flakes spaced 22 u apart from y_f + 70, plus a 30% chance of an ice crystal.
  - Caster spacing on its outer side is ×1.6.
  - A faint icy ground tint (#E6F7FF at 0.35 alpha) marks it.
- The other branch is the **Safe Lane**, with normal placement.
- The island between the branches gets 1-2 small casters (tree, stone, hut or column) at y ∈ [y_f + 80, y_f + 170]. These serve both lanes.

**Choice**
- From y_f − 140 to y_f − 40, Nubs evaluates each branch at the current θ and ε. He counts which of 5 points at branch offsets y_f + {10, 20, 30, 45, 60} are shaded. The higher count is his **preview**; a tie goes to the Safe Lane.
- Two ground chevrons at the fork mouth show the preview: the chosen one glows teal and bounces, and Nubs' head turns toward it.
- At y_f − 40 the choice **locks**: a "!" bubble pops and he takes that branch.

The player steers Nubs only through shade.

### 2.10 Pickups

- **Snowflakes.**
  - Spawn in clusters every U(5, 8) s of trail-time while t ∈ [0.08·Dl, 0.92·Dl]: 3 flakes on Days 1-2, 4 flakes on Day 3 and later, 24 u apart on the centerline. Each is collected automatically within 14 u of Nubs' center.
  - **Melting:** once a flake is within 280 u ahead of Nubs (in y), it accumulates meltT while its point is lit, twice as fast in glare. At meltT ≥ 1.2 s it melts away (a steam puff). It never refreezes. A melting flake is drawn shrinking to 40% and dripping.
  - **Reward:** + Snow equal to the current multiplier, and +6 Chill.
- **Ice Crystal.** One per day at a random t ∈ [0.3·Dl, 0.7·Dl], plus the Frost Lane bonus. It melts like a flake (1.2 s budget) and gives +5·multiplier Snow and +35 Chill.
- **Frost Flowers.** At night they bloom every 60 u along the trail. Each gives +2 Snow (no multiplier). They cannot melt.

### 2.11 Frost multiplier and PHEW

- **Frost multiplier** levels run ×1 to ×5. While f = 0 (full shade), shadeTimer accumulates; every 4.0 s it adds +1 level, up to 5.
  - If f > 0 continuously for ≥ 0.15 s, the multiplier resets to ×1 and shadeTimer to 0. With Ice Heart it drops 2 levels instead.
  - The multiplier is frozen at night. It multiplies flake and crystal Snow only.
- **PHEW.** During daylight, if Chill < 15 and Nubs goes from any lit state to f = 0, it is a PHEW: +3 Snow plus the slow-mo and juice in §11. Cooldown 3 s.

### 2.12 Night

At t = Dl the sun sets: the glyph dims to 20% and a moon glyph appears at θ + 180°.
- The palette goes to night over 1.5 s.
- Crickets start, Frost Flowers bloom ahead of Nubs, and Chill refills.
- Input still turns the (hidden) sun, which sets the angle it will rise at.
- At night's end, a "DAY N" card plays, the music changes key, and the biome switches (odd days Meadow, even days Old Town).

### 2.13 Score

- **Headline:** the time reached, `Day N · h:mm AM/PM`, stored as **M = (N−1)·720 + floor(720·t/Dl)** in-game minutes.
- **Ranking:** M descending, ties broken by run Snow descending.
- **Run Snow** = Σ flakes·mult + Σ crystals·5·mult + 2·flowers + 3·PHEWs. It is added to the Snow wallet.
- **Records:** best M (endless), best M per daily date, best run Snow, longest continuous ×5 hold (s), most PHEWs in a run, and lifetime totals (runs, flakes, Snow, days survived, frost lanes, PHEWs, max day).

### 2.14 Fail state and the death line

The only fail state is Chill ≤ 0 in daylight. Nothing else can kill Nubs, and pausing (manually or by backgrounding the app) freezes everything.

The **death line** is chosen by the first cause below that matches. {time} is the death clock.

| # | Cause | Condition | Line |
|---|---|---|---|
| 1 | Glare | Glare made up ≥ 50% of the lit weight over the last 60 ticks | "Glared by the {Ball name} at {time}." |
| 2 | Long way | Σ\|Δθ\| ≥ 150° over the last 72 ticks, and Nubs had f = 0 at tick −90 | "Melted by You at {time}, swung the long way round." |
| 3 | Missed cloud | A cloud or balloon would have fully shaded Nubs at some θ within ±60° of the current θ | "Melted by You at {time}. That cloud was right there." |
| 4 | Gap | last = the most recent caster that shaded Nubs' center sample (within 5 s); next = the nearest caster ahead whose shade interval at Nubs' position 0.5 s ahead is non-empty | "Melted by You at {time}, between {last} and {next}." If only one is known: "just past {last}" or "right before {next}." |
| 5 | Fallback | None of the above | "Melted by You at {time}." |

---

## 3. Difficulty curve

### 3.1 Day table

| Day | Biome | εnoon | Walk v (u/s) | Daylight (s) | Caster spacing (u) | Lateral (u) | Cloud spawn t (s) | Balloon t (s) | Gazing balls | Flakes/cluster | Validator floor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Meadow | 48° | 70 | 50 | 55 | 16-50 | 19, 38 | 30 | none | 3 | 50 |
| 2 | Old Town | 58° | 80 | 50 | 60 | 16-55 | 8, 24, 40 | 31 | every 14 s from t=6 | 3 | 45 |
| 3 | Meadow | 66° | 90 | 50 | 65 | 18-60 | 6, 19, 32, 45 | 28 | none | 4 | 40 |
| 4 | Old Town | 72° | 100 | 50 | 70 | 18-65 | 5, 16, 27, 38, 49 | 26 | every 10 s from t=5 | 4 | 40 |
| 5 | Meadow | 76° | 110 | 50 | 75 | 20-70 | 4, 13, 22, 31, 40, 49 | 25 | none | 4 | 35 |
| 6 | Old Town | 76° | 120 | 45 | 75 | 20-70 | every 9·Dl/50 s from 4 | none | every 8 s from t=4 | 4 | 35 |
| 7+ | alternating | 76° | 130 | max(30, 50·0.9^(N−5)) | 75 | 20-70 | every 9·Dl/50 s from 4 | none | Old Town days: every 8 s | 4 | 35 |

The Frost Lane validator floor is 15 on every day.

### 3.2 The within-day wave

- **Dawn (6-8 AM):** shadows of 300-520 u. The skill is laying a far caster's long shadow along the trail at a shallow angle. About 33% of all angles shade Nubs at 6 AM.
- **Late morning to noon:** shadows shorten, so only casters within about h·cot ε can help. The skill becomes fast flick-and-catch handoffs between near casters, which often means 120-180° swings. Clouds become the long-lever umbrellas.
- **Noon** is the boss. On Day 1 its window is gentle, about 20% of angles safe. By Days 4-5, 0-10% of angles are safe from casters alone, so clouds and rescue trees carry it.
- **Afternoon and dusk** lengthen shadows again; this is relief. **Night** is a reward.

### 3.3 Fairness validator (summary; the algorithm is in the tech spec)

For every 0.1 s of Nubs' future path, the generator computes which of 360 sun angles (1° bins) shade him and how much. It then runs a dynamic program over "best achievable Chill per angle", assuming a perfect player who turns at **240°/s**.

- **Failure:** if the best achievable Chill drops below the day's floor, a **rescue tree** is inserted 20 u ahead of the failure point (alternating sides, lateral 16 u) and the chunk is revalidated. The limit is 8 rescues per chunk; after that, a parked cloud is used.
- **Lanes:** the Safe Lane uses the day's floor and the Frost Lane uses floor 15.
- **Angular-demand rule:** between 8 AM and 4 PM, no single angle bin may give full shade for 10 consecutive seconds. If one does, the caster nearest that window's midpoint is mirrored across the trail.
- **Generation never depends on player input.** Seed + charm fully determine the world.

### 3.4 Tuning baseline and bot targets

A throwaway Monte Carlo of exactly these Meadow rules and densities, with riding clouds, measured:

| Bot | Result |
|---|---|
| Idle bot (holds θ0) | Dies between 6:31 and 7:46 AM on Day 1 |
| Novice bot (200 ms reaction lag, 200°/s, prefers wide safe intervals) | Median death about Day 1, 11:30 AM (range 9:00 AM to Day 2, 7:52 AM) |
| Reactive bot (no lag, 200°/s) | Median death about Day 3, 11 AM (range Day 3, 10:27 AM to Day 5, 10:53 AM) |
| Raw validator before rescues | 2.2% of 0.1 s steps infeasible, all on Days 3-5 near noon |

Acceptance targets for `npm run sim` (200 seeds):

| Bot | Target |
|---|---|
| idle | Dies before 8:00 AM on Day 1 on at least 90% of seeds |
| novice | Median death between Day 1 10:00 AM and Day 1 2:00 PM |
| reactive | Median death between Day 3 9:00 AM and Day 4 noon |
| oracle (validator-path follower, 240°/s) | Reaches Day 8 on 100% of seeds |
| Rescues per chunk | Mean ≤ 0.6; no chunk hits the 8-rescue limit |

**Human targets:**
- First run (gentle tuning plus guide): median about Day 1, 12:30 PM, and 60% of first runs see the first night.
- After 20 runs: median about Day 2 noon.
- Top 5% of players reach Day 5.

---

## 4. Onboarding: the first 60 seconds (no text walls)

The only words shown are "drag", "NOON", "NIGHT", "DAY 2" and pop words ("PHEW!", "×2", "!").

**Title (live game).** The scene is dawn at 6:00 AM with the clock stopped. Nubs idles in the start hut's shadow, slightly sweaty. The sun auto-sways ±25° around θ0 at 0.3 Hz, so every shadow visibly swings. The logo "SHADY" is at the top. At the bottom a ghost thumb swipes left and right above the word "drag". **The first drag on the canvas starts the run.** The logo flies up and the clock starts. If the first drag happens during the sway, that θ becomes θ0.

**First-run world (lifetime runs = 0)** uses the tutorial overrides:
- **y 0-200:** the trail is straight (x = 180 for y ∈ [−120, 480]). Casters only on the left: Tree at y 60, Cottage at y 120, Tree at y 180, lateral 18-26 u. The sun starts west-ish (pointing at the start hut), so holding still mostly works. *Beat 1 (0-3 s): "ahh" and a frost ring when he first settles into shade.*
- **y 200-480:** casters only on the right: Cottage at y 240, Tree at y 300, Hut at y 360, Oak at y 420, lateral 18-26 u. This forces one big swing at about 2.9 s. *Beat 2: the first deliberate turn.* If Nubs is lit for 0.3 s and the player hasn't dragged in the last 1 s, a ghost thumb swipes in the shorter rotation direction and the dial shows an arrow. Shown at most 3 times per run, only in runs 0-1.
- **Flakes at y 330, 354, 378.** At the angle the guide suggests, they sit inside the right-side shadows. *Beat 3 (about 5 s): an arpeggio and the first Snow.*
- **Chunk 1** uses normal Day 1 generation with spacing ×0.85 and validator floor 60. The multiplier reaches ×2 at 8-12 s for most players (*beat 4: the badge pop and the cool vignette*).
- **14 s:** the first fork. Chevrons and Nubs' head-turn show the player is steering him by shade (*beat 5*).
- **19 s:** a guaranteed overtaker cloud slides in from behind. Riding it plays a whoosh (*beat 6*).
- **25 s:** NOON. The banner drops, cicadas swell, shadows are at their shortest, and the noon icon on the ruler pulses. A PHEW is likely here (*beat 7*).
- **33 s:** the second fork. **40-50 s:** dusk turns everything rose; relief. **50 s:** NIGHT, with frost flowers and crickets. **58 s:** the "DAY 2" card (*beat 8*).

**Safe-arc guide** (the strongest teaching tool). A translucent teal band on the sun's dial marks every angle that fully shades Nubs right now. A dashed outline marks the angles that will shade him 0.6 s ahead. In "Auto" mode:
- Lifetime runs 0-5: visible on Days 1-2, fading out linearly on Day 3 between 6 AM and noon.
- Runs 6-20: visible on Day 1 only.
- Runs 21+: off.

Settings also offers "Always" (the share card is marked assisted) and "Off".

**Gentle tuning** (drain 40 instead of 55) applies to lifetime runs 0-2, and the title shows no score pressure.

---

## 5. Screen flow

```
Boot (load save, ~100 ms) -> Title (live scene, clock held)
Title --first drag--> Play
Title --tray buttons--> Daily | Wardrobe | Charms | Missions | Atlas | Settings  (each has Back -> Title)
Daily --Play (try n/3)--> Play (daily seed, clock held until first drag)
Play --pause button / Esc / app hidden--> Paused --Resume--> Play
Paused --Restart--> Play (new run)    Paused --Home--> Title
Play --death--> Dying (1.1 s) --> Results (Melt Map + panel)
Results --Retry (button, tap on map, Space)--> Play (new seed, clock runs immediately)
Results --Share--> native share sheet or clipboard toast
Results --Postcard--> PNG share/download     Results --Home--> Title
Any screen on a phone held landscape (touch device, height < 500 CSS px) --> Rotate overlay (pauses)
Opening a challenge link --> Title with challenge banner "Beat Day 2 · 2:40 PM" + Play
```

- **Title layout.** Logo at the top. Live scene in the middle. Above the bottom safe area, a tray of 6 round icon buttons (Daily, Missions, Wardrobe, Charms, Atlas, Settings), 48 px each. Above the tray sits a small chip row with the current charm, your best time, and the 3 active missions as progress pips. A daily button with an unplayed day shows a dot.
- **HUD in play** (drawn in the canvas):
  - Top center: "DAY 2" in small caps over "2:40 PM" in 28 px bold tabular numerals.
  - Below that, a **time ruler** 60% of the viewport wide and 6 px tall: a dawn-to-noon-to-dusk gradient, a noon "boss" sun icon, a progress fill, a gold **PB flag** (when your best falls inside the current day) and a teal **challenge flag**.
  - Top-left: a pause button (44×44).
  - Top-right: a snowflake icon with the run Snow count and a multiplier badge "×3" (gold from ×2). The equipped charm icon sits below it; Parasol shows its remaining buffer as a ring.
  - The **chill ring** around Nubs: radius 20 u, 3 u thick, with the sun pointer on it. It fades out after 1.5 s at full Chill in full shade.
- **Dying** (1.1 s): hit-stop, then slow-mo melt, the sun turns away guiltily, and the carrot bobs in the puddle.
- **Results.**
  - The camera pulls up over 1.4 s into the **Melt Map**: the last 2000 u of trail with footprint dots colored by Chill (blue, then amber, then red), day boundaries labelled, and a puddle marker with a carrot icon.
  - The results panel (DOM) slides up from the bottom at +1.2 s:
    - the big time, a "NEW BEST" ribbon when it applies, and the death line typing in at 30 chars/s;
    - a stats row: Snow +N (wallet total), flakes collected/melted, PHEWs, longest ×5;
    - the 3 missions with progress and a "complete" stamp;
    - buttons: **Retry** (primary, full width, 64 px tall), Share, Postcard, Home.
  - Tapping the map area also retries after a 0.6 s lockout. The run's flake melody replays over the pad while the stats count up.
- **Pause overlay:** Resume, Restart, Settings, Home. The game always pauses when backgrounded and never auto-resumes.

---

## 6. Meta-progression (intrinsic: cosmetics, sidegrades, collections; no power grind)

**Snow wallet.** Snow is earned only by playing (run Snow plus mission rewards) and spent only in the Wardrobe.

**Wardrobe (v1, 3 slots, 15 items)**

| Slot | Item | Cost / condition |
|---|---|---|
| Scarf | Red | default |
| Scarf | Mint | 60 Snow |
| Scarf | Plaid | 150 Snow |
| Scarf | Rainbow | 400 Snow |
| Scarf | Gold | achievement "Seventh Sun" |
| Hat | None | default |
| Hat | Beanie | 80 Snow |
| Hat | Top Hat | 200 Snow |
| Hat | Party Cone | 300 Snow |
| Hat | Sun Visor | achievement "High Noon" |
| Hat | Crown | achievement "Solstice" |
| Nose | Carrot | default |
| Nose | Parsnip | 100 Snow |
| Nose | Candy Cane | 250 Snow |
| Nose | Pinecone | 350 Snow |

Expected income is about 25-60 Snow per run early, so the first purchase comes in 2-3 runs and the full set takes about 40-60 runs.

**Charms** (pick one or none before a run; all are sidegrades; free unlock when you first reach the listed day)

| Charm | Unlock | Upside | Downside |
|---|---|---|---|
| Parasol | Reach Day 2 | The first 1.5 s of lit exposure each day causes no drain (the buffer refills at dawn) | Frost multiplier capped at ×3 |
| Sundog | Reach Day 3 | Sensitivity ×1.25, max follow rate 750°/s, inertia cap 450°/s | Inertia friction 2.5/s (flicks overshoot more) |
| Snowball | Reach Day 4 | Max Chill 130 (starts at 130) | Regen 20/s instead of 30 |
| Long Night | Reach Day 5 | Night lasts 12 s (more frost flowers) | εnoon +3° every day (harsher noons; the generator uses the same values) |
| Ice Heart | Reach Day 6 | The multiplier drops 2 levels instead of resetting | Flakes give 0 Chill |

**Atlas.** One postcard per biome: a procedurally composed dusk vista from a fixed seed, which you can save as a PNG. Meadow unlocks after your first run; Old Town unlocks on reaching Day 2. Locked biomes show silhouettes with "Reach Day N".

**Lifetime stats page.** Runs, total days survived, best time, Snow earned, flakes, PHEWs, frost lanes, clouds ridden (s), daily days played.

---

## 7. Daily Solstice (seeded)

- **Number:** #N = days since 2026-01-01 (local calendar date) + 1. 2026-10-11 is #284.
- **Seed:** hash("shady-daily-YYYY-MM-DD"). Everyone gets the same world on the same local date.
- **Charm of the day:** [none, Parasol, Sundog, Snowball, Long Night, Ice Heart][N mod 6]. It is forced for the daily, even if not yet unlocked.
- **3 scored tries; best counts.** A try is counted once the run passes 6:30 AM (2.08 s), so an accidental instant restart doesn't use one up. After 3 tries the button reads "Practice" and those runs are unscored.
- **Gentle tuning** is never used in the daily. The guide follows the player's setting; "Always" marks the share as assisted.
- **Calendar.** A month grid of stamps. Each played day shows a sun stamp whose ray count equals the best day reached (1-5); Day 5+ gets a gold ring. There are no streak penalties. The "days played" count feeds achievements.
- **Challenge link.** Share includes a link (§9) so friends can run the same daily and see your flag on their ruler.

---

## 8. Missions and achievements

**Missions.** Three are active at once. Completing one pays Snow on the results screen; it is replaced at the next run start by the next uncompleted mission in this ordered pool. When the pool is exhausted it repeats as Tier II, Tier III and so on: numeric thresholds ×tier, Day goals +(tier−1) days, rewards ×tier.

| # | Mission | Reward |
|---|---|---|
| 1 | Reach 9:00 AM | 10 |
| 2 | Collect 10 flakes in one run | 10 |
| 3 | Reach a ×3 Frost multiplier | 15 |
| 4 | Survive a noon (reach 12:30 PM) | 20 |
| 5 | Take a Frost Lane | 15 |
| 6 | Ride a cloud's shadow for 3 s straight | 20 |
| 7 | Reach Day 2 | 30 |
| 8 | Two PHEWs in one run | 25 |
| 9 | Collect an Ice Crystal | 20 |
| 10 | Collect 30 flakes in one run | 30 |
| 11 | Hold ×5 for 8 s | 30 |
| 12 | Pass 4 gazing balls in one run with no glare contact | 30 |
| 13 | Walk under a gate arch between 11:00 AM and 1:00 PM | 30 |
| 14 | Reach Day 3 | 50 |
| 15 | Play today's Daily Solstice | 15 |

**Achievements (14).** Shown as a badge wall in the Missions screen; locked ones show riddle hints.

| Achievement | Condition | Reward |
|---|---|---|
| First Light | Finish your first run | none |
| Night Owl | Survive to your first night | none |
| High Noon | Pass noon (reach 12:30 PM) on Day 3 | Sun Visor hat |
| Solstice | Reach Day 5 | Crown hat |
| Seventh Sun | Reach Day 7 | Gold scarf |
| Phew-nomenal | 25 lifetime PHEWs | none |
| Snowdrift | Earn 1,000 lifetime Snow | none |
| Untouchable | A whole daylight (6 AM-6 PM) with total lit time < 0.5 s | none |
| Cloud Rider | 10 s continuously under one cloud's shadow | none |
| Lane Lover | 20 lifetime Frost Lanes | none |
| Long Way Round | An inertial flick of ≥ 270° that ends with Nubs in full shade | none |
| Daily Habit | Play 7 different Daily Solstices | none |
| Glare-Proof | Pass 10 gazing balls in one run with no glare contact | none |
| Collector | Own 10 cosmetics | none |

---

## 9. Scoring display and sharing

**Hour glyphs.** There is one glyph per in-game daylight hour, so 12 per day. Lit time is ∫f·dt within that hour, with glare counted double.

| Glyph | Code point | Meaning |
|---|---|---|
| Blue square | U+1F7E6 | Lit time ≤ 0.2 s |
| Yellow square | U+1F7E8 | Lit time 0.2-1.0 s |
| Fire | U+1F525 | Lit time > 1.0 s, or Chill < 25 at any moment in that hour |
| Droplet | U+1F4A7 | The hour Nubs melted |
| Crescent moon | U+1F319 | Appended after each completed day |
| Compass | U+1F9ED | Appended when the guide was set to "Always" |

The glyphs differ in shape as well as color, so the strip is colorblind-safe.

**Endless share text**
```
SHADY: Nubs made it to Day 3 · 2:40 PM
<final day's glyph strip>
Snow 112 · 4 PHEWs
Beat my run: <origin>/#c=<code>
```

**Daily share text**
```
SHADY Daily #284: Day 2 · 2:40 PM (try 2/3)
<day 1 strip><moon>
<day 2 strip ending in droplet>
<origin>/#c=<code>
```

**Challenge code.** base64url of compact JSON: `{"k":"d","d":"2026-10-11","m":1180,"s":112}` for a daily, or `{"k":"e","seed":123456789,"m":1180,"s":112}` for an endless seed. Opening the link shows a challenge banner on the Title, and the run uses that seed (a daily for another date plays as unscored practice). The teal flag on the ruler marks the target time. No server is needed.

**Postcard PNG** (1080×1920):
- Top 1400 px: the Melt Map scene rendered at high resolution, with the guilty sun in a corner.
- Bottom panel on paper #FFF8EE: "Nubs made it to" in 48 px; the time in 120 px bold; the glyph strip drawn as rounded colored shapes; "SHADY", plus "#284" for a daily; the URL.
- Shared through the Web Share API with files where supported, otherwise downloaded.

**Results melody.** Up to 32 flake-pickup notes from the run are replayed as 8th notes at 120 BPM over the pad while stats count up.

---

## 10. Visual style

**Overall look:** a soft, flat pastel diorama, top-down with a 0.25 oblique. Thick shapes, no outlines on the world, rounded UI. Everything is procedural.

**Time-of-day palette LUT.** Interpolated linearly in RGB between keyframes by clock hour; night is a separate keyframe.

| Key | Ground | Trail | Shadow color | Shadow α | Object tint (mix 25%) |
|---|---|---|---|---|---|
| 6:00 | #F6B07C | #E39468 | #5B4A8A | 0.42 | #FF9E6B |
| 9:00 | #F4D49A | #DDB07A | #4F5C8E | 0.50 | #FFE8C2 |
| 12:00 | #FFF4DC | #EAD3A6 | #4B5A73 | 0.58 | #FFFFFF |
| 15:00 | #F5CF8A | #D9A564 | #4A4F8C | 0.50 | #FFD59A |
| 18:00 | #E3829E | #C76784 | #34306B | 0.45 | #D96A8E |
| Night | #1D2247 | #2A2F5E | none | 0 | #3A4380 (mix 55%) |

In Old Town the ground uses the same LUT, multiplied by #F0E6DA. High-contrast mode adds +0.17 to shadow α.

**Materials**

| Object | Colors |
|---|---|
| Tree | canopy #6DBE7B, canopy shade #4E9A63, trunk #8A5A3C |
| Oak | canopy #5AA86E, canopy shade #3F8A57 |
| Cottage | walls #F2E6D0, side #D9C7AA, roof #D9644A, roof side #B44E3A |
| Standing Stone | #C9C3B5, side #A39C8E |
| Hedge | #5E9E5A, side #467C45 |
| Hut | wood #C08A5B, side #9C6B41, roof #8E6B4E |
| House | walls #EBD8C3, side #CDB59C, roof #6E8FB8, roof side #557299 |
| Arch | #D8C7B0, side #B7A48C |
| Stall | roof stripes #E8475A / #FFF4DC, posts #8A5A3C |
| Column | #E4DED2, side #BDB5A6 |
| Wall | #CFB79A, side #AE987D |
| Gazing ball | sphere #BFE6FF with a white specular dot; pedestal #C9C3B5 |
| Cloud | #FFFFFF at 0.55 α, 5-7 seeded overlapping circles, drawn 75 u up (oblique) |
| Balloon | envelope #FF8A5B with #FFD166 stripes, basket #8A5A3C |

**Prisms**
- Side faces on south-facing edges use the side color, lightened by 25%·max(0, n·u) toward the sun.
- The top face uses the top color.
- Top edges whose normal·u > 0.3 get a 1.5 u rim highlight (#FFFFFF at 0.6 α), so light direction reads even without the sun glyph.
- Tree canopies: a lumpy disc (5 seeded sub-circles), a lighter crescent offset 0.25·r toward the sun, drawn at 0.7 α when Nubs is within 45 u.

**Ground detail**
- Meadow: a pre-rendered 256 u tile of grass tufts (3-stroke V shapes) and tiny flower dots, drawn as black/white strokes at 6-10% α over the LUT ground.
- Old Town: a cobblestone tile of offset rounded rects (white 10% α with 6% dark joints).

**Trail.** A 30 u ribbon with a 34 u darker edge. Footprints (paired 3×5 u ellipses every 14 u) fade over 4 s; they are frosty white in shade and dark wet drips in sun.

**Nubs**
- Body circle r11 at screen (0, −8); head r7.5 at (0, −22). Snow #FFFFFF with a #CFE6FF rim on the side away from the sun.
- When shaded, he is tinted toward #C9D6F2 by the shaded fraction (he is drawn above the shadow layer).
- Coal eyes #2B2B33 look 1.5 u toward the sun and squint when lit. Carrot #FF8A2B points along the walking direction. Scarf (default #E8475A) with 2 tails on a 3-node spring chain.
- A walk bob of scaleY 1 ± 0.04 at 2.2 Hz × v/70.
- Low Chill: sweat drops below 60. Below 30 the head sinks to −17, the body becomes a teardrop (1.15 wide × 0.85 tall), and he wobbles ±4°.

**Sun mascot**
- Core disc r20 CSS px #FFE27A with a #FFC94A rim, a pre-rendered bloom sprite (#FFB547, 0.35 → 0 α, r60), and 12 ray wedges #FFD36B rotating at 10°/s.
- Sunglasses #1E1E28 with a #5A5A70 glint; mouth lines #7A3B00.
- Faces by Chill: ≥ 60 smug smile; 30-60 worried (sweat bead, flat mouth); < 30 horrified ("O" mouth, glasses slipping). On death the sun turns guiltily away (rotates 35° and slides 8 px).
- At night the moon is #E8ECFF.

**Pickups**
- Flakes: a 6-arm white star (#FFFFFF) with a #9AD8FF glow sprite and a gentle spin.
- Ice crystal: a #BDF3FF hexagonal prism, 10 u tall.
- Frost flowers: 6 petals #E6F7FF around a #9AD8FF center, with a 3-frame bloom.

**Glare spot.** Radial #FFF7C2 → #FFB000 at 0.6 α, plus a #FF6A3D hatched ring of 8 dashes rotating at 45°/s. A faint line (20% α) connects it to its ball.

**Fork chevrons.** Two 18 u chevrons on the ground. The previewed one is teal #2EC4B6 and bounces 2 u at 3 Hz.

**UI palette**

| Role | Color |
|---|---|
| Ink | #2B2140 |
| Paper | #FFF8EE |
| Accent (teal) | #2EC4B6 |
| Gold | #FFC23D |
| Danger | #FF5D5D |
| Panels | #FFFFFF at 0.92 α, 20 px radius, shadow 0 8 24 rgba(43,33,64,0.18) |
| Safe-arc guide | #2EC4B6 at 0.5 α, 6 px stroke; lookahead dashed at 0.35 α |

Chill ring colors: ≥ 50 #5AB8FF; 25-50 #FFC23D; < 25 #FF5D5D, dashed.

**Typography.** System UI stack (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`) at weight 800 for numbers with tabular-nums. The "DAY N" card uses `Georgia, 'Times New Roman', serif` italic. No font files.

---

## 11. Juice list (exact values)

Shake amplitudes are in u. Real-time durations ignore slow-mo.

1. **Drag.** Shadows sweep (inherent). Dial ticks: 24 marks every 15° along the dial path at 0.35 α, shown only while dragging; the crossed tick flashes. Detent click.
2. **Catch** (touch-down while |ω| > 90°/s). Thunk sound; the sun glyph squashes to 0.9 for 80 ms.
3. **Sizzle** (f > 0).
   - Steam particles at 30·f per second, rising 30 u/s and growing 3 → 9 u over 0.8 s.
   - A sweat drop every 0.4 s when Chill < 60.
   - Drips become wet footprints that evaporate in 1.5 s.
   - Noise sizzle; Nubs squints.
4. **Shade re-entry** (after ≥ 0.25 s lit).
   - A frost ring expands 0 → 40 u over 300 ms (white, 0.8 → 0 α).
   - An "ahh" chord; a shiver squash (scaleX 1.12 / scaleY 0.90 easing back over 140 ms); an 8 ms haptic.
5. **Frost sparkles.** While f = 0 in daylight, 2 per second spawn on the ground within 16 u of Nubs, live 1.2 s. They are the visual "you're shaded" cue.
6. **Flake pickup.**
   - The flake spirals into Nubs over 150 ms; 8 sparkle particles fly out at 60-120 u/s for 0.4 s.
   - A quantized bell; a "+N" pop (scale 0 → 1.2 → 1 over 200 ms) floating up 20 u; a 6 ms haptic.
7. **Flake melt.** The flake shrinks and drips; on melt, a 6-particle steam puff and a "tss" sound.
8. **Multiplier up.**
   - The badge pops 1 → 1.4 → 1 (300 ms, elastic); a cool blue edge vignette pulses (0.18 α, 250 ms); a two-note chime.
   - Reaching ×5 adds a 40 ms hit-stop and a gold vignette pulse.
9. **Multiplier reset.** The badge shakes ±4 px for 200 ms; a soft descending blip.
10. **PHEW.**
    - Timescale 0.4 for 350 ms. "PHEW!" pops above Nubs (scale 0 → 1.3 → 1, 250 ms, easeOutBack).
    - A frost burst of 24 particles; the sun face shows relief; a "+3" pop; haptic [10,40,10].
11. **Low Chill (< 25).**
    - A heat-haze edge vignette (#FF6A3D, 0 → 0.25 α pulsing at 1.1 Hz).
    - A heartbeat; Nubs wobbles; the chill ring turns dashed red.
12. **Noon.**
    - "NOON" banner at t = Dl/2 − 2 s (about 11:31 AM), slides from the top over 600 ms and holds 1.2 s.
    - Cicadas fade in from 0.4·Dl to 0.5·Dl and out by 0.6·Dl. The palette bleaches.
    - At 0.6·Dl, a "noon passed" sparkle on the ruler and a relieved downward sweep.
13. **Night and dawn.**
    - Sunset: the glyph sinks to 20% over 1 s; the palette goes to night over 1.5 s; crickets; frost flowers bloom as he approaches.
    - Dawn: the "DAY N" serif card slides in from the right (500 ms), holds 1 s, and slides out. 30 confetti petals; a key change; haptic [20,80,20].
14. **Cloud capture** (a floater's shadow first fully covers Nubs). A whoosh; a zoom pulse to 1.04 over 400 ms; Nubs' happy face.
15. **Fork.** On lock, a "!" bubble pop, a head turn and a chevron flash. If the Frost Lane is taken, an icy sparkle trail runs along that lane.
16. **Glare touch.** A zap; Nubs flashes white-orange; shake 2 u for 100 ms.
17. **Death.**
    - 80 ms hit-stop, then 0.3× slow-mo for 500 ms. The 600 ms melt: body circles flatten into a 1.6×0.35 ellipse puddle and the head slides down; coal eyes and carrot float.
    - Shake 6 u for 250 ms; slide whistle; the sun turns guiltily away; the carrot bobs (sin 1.2 Hz, 2 u); a puddle ripple ring.
    - Then the Melt Map pull-up over 1.4 s (easeInOutCubic, scale 1 → 0.35).
18. **New best.** A gold ribbon drops; 40 confetti; fanfare.
19. **Reduced motion.** No shake, no zoom pulses, no camera pull (the Melt Map cuts in), cards fade instead of slide, sun max rate 300°/s, inertia cap 180°/s. Slow-mo stays.

**Photosensitivity.** No full-screen flash above 0.2 α, and never more than 3 Hz.

---

## 12. Audio design (all WebAudio synthesis)

**Mix.** Master gain 0.9 → compressor (threshold −14 dB, ratio 4, attack 3 ms, release 250 ms). Buses: SFX 0.8, Music 0.6, Ambience 0.5. The music bus ducks to 60% for 1 s under the day fanfare.

**Key system.** Day 1 is in C (root C4 = 261.63 Hz). Each new day transposes up a fifth, folded into one octave: C, G, D, A, E, B, F#... The scale is major pentatonic [0, 2, 4, 7, 9]. The tempo grid is 90 BPM; one 16th note = 166.7 ms.

**SFX recipes**

| Sound | Recipe |
|---|---|
| Detent click | Triangle at 1800·2^((i mod 5)/24) Hz, gain 0 → 0.10 in 1 ms, exponential decay to 0.0001 in 30 ms. Plus a 6 ms white-noise burst through a 3 kHz highpass at gain 0.05. At most 20 per second. |
| Catch thunk | Noise → lowpass 400 Hz, gain 0.2 → 0 over 90 ms, plus a sine at 110 Hz for 60 ms. |
| Sizzle (continuous) | Looped 2 s white noise → bandpass at 2500 + 3500·min(f,1) Hz, Q 0.9 → gain 0.22·min(f,1.5), smoothed with setTargetAtTime τ = 30 ms. Plus crackle grains: 2 ms noise clicks at 20·f per second, gain 0.08. |
| Shade "ahh" | Sines at the root and fifth of octave 5 (C5 523.25 Hz + G5 783.99 Hz in key C), attack 15 ms, exponential decay 450 ms, gain 0.08 each, 5 Hz vibrato at ±3 cents. |
| Flake bell | Sine fundamental at a pentatonic note in octaves 5-6 (degree = (pickups this day + mult) mod 10), plus sines at 2.756× (gain 0.35) and 5.404× (gain 0.12). Attack 2 ms; decay 900 ms on the fundamental and 350 ms on the partials; gain 0.12. **Quantized to the next 16th note.** |
| Ice crystal | A bell triad (root, major third, fifth) arpeggiated 40 ms apart, decay 1.2 s. |
| Flake melt "tss" | Noise → 5 kHz highpass, gain 0.06, 120 ms. |
| Multiplier up | Triangle notes at the root then the fifth (octave 5), 70 ms apart, gain 0.09, decay 200 ms. At ×5, add the octave. |
| Multiplier reset | Square wave gliding 330 → 220 Hz over 120 ms through a 1200 Hz lowpass, gain 0.05. |
| PHEW | Sine with an exponential glide 400 → 900 Hz over 180 ms, gain 0.10, plus a bell at the root of octave 6. |
| Glare zap | Sawtooth 180 → 120 Hz plus noise bandpassed at 1.2 kHz, gain 0.12 → 0 over 150 ms. |
| Cloud whoosh | Pink noise → lowpass sweeping 300 → 1800 → 300 Hz over 700 ms, peak gain 0.12 at 250 ms. |
| Fork lock | Two triangle blips at 880 and 1320 Hz, 50 ms each. |
| Death | Sine sweeping exponentially 1200 → 280 Hz over 750 ms with a 6 Hz vibrato (±25 Hz depth), gain 0.12 → 0. Then a "plop": sine 180 → 60 Hz over 120 ms. |
| Day fanfare | Pluck arpeggio root-third-fifth-octave (triangle + sine), 90 ms apart, decay 400 ms. |
| New best | Day fanfare, then an octave higher, then a shimmer of 4 random high bells. |
| UI tap | Sine 660 Hz, 40 ms, gain 0.05. |

**Ambience**

| Sound | Recipe |
|---|---|
| Noon cicadas | White noise → bandpass 5200 Hz, Q 6 → gain modulated by a 30 Hz square LFO (depth 0.5) and a 0.3 Hz sine LFO. Peak gain 0.07, following the noon window. |
| Night crickets | Two sines at 4400 and 4700 Hz, panned −0.4 and +0.4. Each chirp is 3 pulses of 25 ms on/25 ms off, every 700 ± 150 ms. Gain 0.03. |
| Heartbeat (Chill < 25) | Sine at 55 Hz: "lub" for 90 ms at gain 0.25, then "dub" for 70 ms at gain 0.18, 150 ms later. Repeats every 850 ms, or 600 ms when Chill < 10. |

**Adaptive music**
- **Pad.** Every chord tone is 2 sawtooths detuned ±7 cents → lowpass, Q 0.7 → gain 0.035. The cutoff is 300 + 2200·(ε/εnoon)² Hz in daylight (warm at dawn, bright at noon) and 500 Hz at night. Chords change every 4 bars (10.67 s) through I-vi-IV-V of the day's key, with 1.5 s attack and 2 s release crossfades.
- **Pluck arpeggio** (daylight only). Triangle wave at gain 0.03, decay 180 ms, playing the current chord tones. Its density follows the Frost multiplier:

  | Multiplier | Pattern |
  |---|---|
  | ×1 | Quarter notes, each played with 50% probability |
  | ×2 | Quarter notes |
  | ×3 | 8th notes |
  | ×4 | 8th notes plus syncopated 16ths |
  | ×5 | Full 16ths with octave jumps |

  It mutes when Chill < 40, and the heartbeat takes over below 25. **A clean run audibly sounds better.**
- **Night music box.** Sine plus a 3.0× partial, an 8th-note random walk on the pentatonic scale, gain 0.04.
- **Results replay.** The recorded flake notes play as 8ths at 120 BPM over the pad.

---

## 13. Haptics (navigator.vibrate on web; Capacitor Haptics in the app)

| Event | Pattern (ms) |
|---|---|
| Detent | 5 (at least 50 ms apart) |
| Catch | 8 |
| Flake pickup | 6 |
| Ice crystal | [10, 30, 10] |
| Shade re-entry | 8 |
| Multiplier up | [8, 40, 8]; reaching ×5: [10, 30, 10, 30, 20] |
| PHEW | [10, 40, 10] |
| Glare touch | 15 |
| Fork lock | 6 |
| Low-Chill heartbeat | [12, 110, 8] every 850 ms |
| Death | [30, 60, 80] |
| New day | [20, 80, 20] |
| New best | [15, 40, 15, 40, 40] |
| UI button | 4 |

Global rules: no new pattern within 40 ms of the last (except the heartbeat). Haptics are off when the setting is off. iOS Safari has no vibrate, so the detent click and the visual tick carry that feedback on iOS web.

---

## 14. Accessibility

- **Colorblind-safe.**
  - Shade and light differ by luminance: the multiply layer darkens by 42-58%, plus frost sparkles appear only in shade, and Nubs' squint and steam show when lit.
  - Glare uses a rotating hatched ring; low Chill uses dashes; fork preview uses bouncing chevrons; share glyphs differ in shape. No information is carried by hue alone.
- **Reduced motion.** On by default when `prefers-reduced-motion: reduce` is set; also a toggle (§11.19).
- **High-contrast shadows.** A toggle adding +0.17 shadow α.
- **Handedness.** Left/right mirrors the top HUD corners (pause and Snow swap) and the results button order. Gameplay is a full-screen horizontal drag, so it is hand-neutral.
- **Controls.** Sensitivity slider 0.6-1.5; invert-drag toggle.
- **Shade guide** setting: Auto / Always / Off.
- **Playable muted.** Every audio cue has a visual counterpart:

  | Audio cue | Visual counterpart |
  |---|---|
  | Sizzle | Steam density |
  | Detents | Tick flashes |
  | Heartbeat | Vignette pulse |
  | Noon | Banner and bleach |
  | Night | Palette and moon |
  | Bell | Sparkle pop |

- **UI.** Text at least 16 CSS px; touch targets at least 48 px; DOM menus are keyboard-navigable with aria-labels and visible focus; no timers in menus; pause at any time.
- **Photosensitivity** limits as in §11.

---

## 15. Prototype v1 scope vs Later

**v1 (build all of this)**
- Endless runs with the full day/night cycle through Day 7+ (shortening days); Meadow and Old Town biomes alternating.
- All 12 caster kinds in §2.7, plus clouds, balloons and gazing balls (glare).
- Forks with preview/lock; flakes with melting; ice crystals; frost flowers; Frost multiplier; PHEW; Chill with gentle tuning.
- Seeded deterministic generation with the validator (rescues, demand rule); tutorial overrides; safe-arc guide.
- Sun control: drag, inertia, catch, detents, keyboard.
- Title (live), HUD, Pause, Dying, Melt Map + Results, Rotate overlay.
- Death line with causes; share text; challenge links; Postcard PNG.
- Daily Solstice (3 tries, calendar, charm of the day).
- Missions (15-item pool plus tiers); 14 achievements; Wardrobe (15 items); 5 charms; Atlas (2 postcards); stats page.
- Full synthesized audio and adaptive music; haptics; Settings (§14 plus volumes).
- PWA (offline, installable); localStorage save v1; debug overlay; URL params; bots; `npm run sim`; unit + e2e tests.

**Later (do not build in v1)**
- More biomes: Desert Ruins (obelisks, wind gusts), Salt Flats (windmills with rotating blade shade, cloud fleets), Harbor (sails, cranes), Moon Base (black shadows).
- Atlas landmark challenges (5 per biome).
- Ghost sun replays in challenge links (a delta-encoded θ track).
- Hall of Saves (top 10 PHEW micro-replays); auto replay-reel video via MediaRecorder; monthly Seasons (autumn leaves, blossoms).
- Sun sunglasses cosmetics; footprint styles; more charms.
- Online leaderboards and accounts; daily bot par; localization.
- Native store builds through Capacitor (the path is in the tech spec).

---

## 16. Business model stance

v1 has no monetization. The future plan is a one-time "Supporter Pack" of cosmetics. No ads between runs, no energy, no loot boxes, no streak punishment, no FOMO timers.
