# SHADY Journey: the campaign (v1.2, retuned in v1.3; Dares and flares in v1.6, §8)

**Precedence for campaign work:** this file, then `V1_1_PLAN.md`, then `V1_PLAN.md`, then the module READMEs.

**Status: built and integrated (v1.2).** The core (`src/config/campaign.ts`, `src/config/concepts.ts`,
`src/core/level.ts`, the finish line and the behaviour concepts in the sim, `scripts/sim.ts --campaign`),
the game/render layer (campaign runs, the intro card, the HUD progress bar, the finish stamp, the
concept render signatures, `?level=N`) and the UI/meta layer (save v3, `applyRunResult` for
`'campaign'` with the three Journey achievements, the Journey screen, the Title pill, the Settings
testing toggle, the Results level variant, the Journey share text) all use the names of §2-§5 from
`src/core/index.ts`; no `V12-SHIM` stand-in remains. Decisions: the tray keeps 4 buttons (the pill
is the entry); the Results kicker reads "Level 12 · Passed". v1.3 retuned the curve, the stars and
four concepts, and gave every concept a short name of its own (`Concept.name`, "Glare") apart from
its teaching level's `title` ("Glass Garden"); §6 has the numbers.

## 1. What it is

A **campaign of 200 levels** ("Journey") beside Endless, Daily and challenges. A level is a seeded, finite run with a goal, up to 3 stars, and a set of **concepts** (gameplay modifiers). The first 40 levels each introduce exactly one new concept; levels 41-200 combine concepts with rising difficulty. The catalog and the level table are data, so adding concepts or levels later is a data change.

For testing, every level can be opened directly: a Settings toggle **"Unlock all levels (testing)"**, the URL `?level=N`, and the Journey map lists each level's concept.

## 2. Level anatomy (core contract, `src/config/campaign.ts`, exported from `src/core/index.ts`)

```ts
export type ConceptId = /* §3 ids */;
export type GoalKind = 'finish' | 'flakes' | 'snow';
export interface LevelDef {
  id: number;                 // 1..200
  chapter: number;            // 1..20 (10 levels each)
  name: string;               // short, playful: "First Shade", "Glass Garden"
  seed: number;               // hashString(`journey-${id}`)
  biome: BiomeId;
  forecast: ForecastId;       // 'clear' unless a forecast concept is active
  concepts: readonly ConceptId[];  // every active concept (the introduced one first)
  introduces: ConceptId | null;    // the new concept this level teaches (levels 1-40: always set)
  startMinute: number;        // minutes since 6:00 AM of Day 1 (0 = dawn, 360 = noon, 600 = 4 PM)
  lengthMinutes: number;      // in-game minutes to the finish line; the level never spans a night unless a night concept says so
  goal: { kind: GoalKind; target: number };  // 'finish' target 0; 'flakes' N; 'snow' N
  stars: { flakes: number; minChill: number; sunSec: number }; // +1 flakes ≥; +1 cool run: lit ≤ sunSec s and lowest Chill ≥ minChill
  drain: number;              // Chill/s at f = 1 (campaign ignores the comfort ladder)
}
export const CAMPAIGN_LEVELS: readonly LevelDef[];      // exactly 200, built by buildCampaign() at module load (pure)
export function levelDef(id: number): LevelDef | null;
export const CHAPTERS: readonly { id: number; name: string; biome: BiomeId }[]; // 20
```

- **Finish line.** The world places a `finish` caster (a gate arch skinned as a finish banner, `kind: 'finish'`, no shadow parts needed beyond the arch's) at `endY = yAtMinute(startMinute + lengthMinutes)`. Crossing `endY` with Chill > 0 ends the run: `s.phase = 'won'`, event `{ e: 'levelWon'; stars: 1|2|3; flakes; minChill }`. The validator treats the stretch after `endY` as unused.
- **Goal `flakes`/`snow`:** the run still ends at the finish line; stars/pass depend on the goal: pass = goal met at the finish (`levelWon` carries `passed: boolean`). A level failed at the finish (goal not met) emits `levelWon` with `passed: false` and `stars: 0`.
- **Stars** (computed in core, `starsFor(level, stats)`): 1 = passed; +1 if `stats.flakes ≥ stars.flakes`; +1 if `stats.litTotal ≤ stars.sunSec` and `stats.minChill ≥ stars.minChill` (§3). `RunStats` gains `minChill` (lowest Chill during daylight; 100 when never lit).
- **RunConfig** gains `level?: number` (the level id). `createRun` reads `levelDef(id)` and derives seed, profile 3, plan off, `forecast`, biome (Day 1 biome forced via a new `cfg.biome?`), `startDay 1`, `startT` from `startMinute`, `drain`, `mods = level.concepts`, and the finish line. `RunResult` gains `level?: { id; passed; stars; introduces }` and `RunMode` gains `'campaign'`.
- **Mods.** `RunConfig.mods?: readonly ConceptId[]` (part of world identity; debug runs may pass any set). `dayParams(day, profile, plan, mods)` applies each concept's `tune` on top of the forecast. Every reader goes through `paramsAt`, so the clock, the validator, the sim and the renderer agree. The sim consults `s.mods` (a `Set`) for behaviour concepts (eclipse, lock; Controls v3 retired the sun rules and gusts).

## 3. Concept catalog (`CONCEPTS: Record<ConceptId, Concept>`)

```ts
interface Concept { id: ConceptId; name: string /* short concept name: "Glare" */; title: string /* its teaching level: "Glass Garden" */; blurb: string; icon: string /* glyphs.ts id */; kind: 'teach'|'world'|'sun'|'dial'|'chill'|'sky'|'goal'; tune?: Partial<DayTuning>; level?: { biome?; forecast?; startMinute?; lengthMinutes?; goal?; drainCap?; cost? } }
```

Teaching order = level 1..40 (v1.5 order, §7: the three core mechanics in chapter 1; Controls v3, §9: Wide Open, Drought, Crowded, Moon Sun and Lowland take the five control concepts' slots 16 and 29-32). `tune` fields multiply (spacing, heightScale, cloudCount, cloudRx, clusterGap, drainMul, regenMul, walkMul), add (latMax) or override (the rest). `cost` is what the concept is worth in drain points (calibrated with `sim --campaign --tries` on the human model): the builder takes it off the level's drain, so a hard concept does not stack on the curve. Behaviour concepts are listed with their rule. v1.3 reworked the overlapping pairs: `dazzle` (was the `glare` balls under another name) became the Mirror Sun (retired by Controls v3), `thaw` (was a drain multiplier, like `ration`) now slows healing, `fleet` (was "more clouds", like `breezy`) is open country where clouds are the shade, `eclipse` now brings the sun back on the far side.

| # | id | name · title | kind | rule (cost) |
|---|---|---|---|---|
| 1 | `drag` | Sun Drag · First Shade | teach | no clouds; lesson cues on (0) |
| 2 | `flakes` | Snowflakes · Flake Trail | goal | flake goal; clusters of 4 (3) |
| 3 | `cloud` | Clouds · Umbrella | sky | waiters only (−2) |
| 4 | `noon` | Noon · High Noon | sun | 10:30 AM + 180 min, εnoon 48 (0) |
| 5 | `deep` | Deep Shade · Double Shade | teach | two or more shadows over Nubs' center while fully shaded: Chill, multiplier and frost ×2 (v1.5; on from level 5) (0) |
| 6 | `glare` | Glare · Glass Garden | world | gazing balls every 12 s (5) |
| 7 | `swing` | SWING · Hand-off | goal | goal: 1 SWING (v1.6, T6; was a Snow goal) (−4) |
| 8 | `bloom` | Sunflowers · Sun Garden | teach | buds bloom into sunflowers when the sun shines from their face (v1.5; on from level 8) (0) |
| 9 | `breezy` | Breeze · Kite Weather | sky | forecast breezy (−1) |
| 10 | `snap` | Cold Snap · Frost Cloud | teach | the frost meter and the Cold Snap (v1.5; on from level 10; that level starts with a full meter, later levels at half) (3) |
| 11 | `oldtown` | Old Town · Cobblestones | world | biome oldtown (−5) |
| 12 | `overcast` | Overcast · Grey Day | sky | forecast overcast (−6) |
| 13 | `gate` | Gates · The Gate | world | arch at the midpoint, +10 Snow fully shaded (3) |
| 14 | `long` | Long Shadows · Autumn Light | sky | forecast long (8) |
| 15 | `heat` | Heat Wave · Hot Spell | sky | forecast heat (4) |
| 16 | `sparse` | Wide Open · Big Sky | world | spacing ×1.45 (7) |
| 17 | `market` | Market Day · Stall Street | sky | forecast market, Old Town (2) |
| 18 | `sprint` | Sprint · Hurry Up | world | walk ×1.35 (13) |
| 19 | `stroll` | Stroll · Dawdle | world | walk ×0.75, drain ×1.25 (−12) |
| 20 | `giants` | Giants · Tall Timber | world | heights ×1.6 (−4) |
| 21 | `brittle` | Glass Flakes · Sugar Glass | goal | glass flake clusters (melt after 0.8 lit s), 60% of the eligible clusters; goal: save 1 cluster whole (v1.6; on from level 21); cluster gap ×0.6 (3) |
| 22 | `fleet` | Cloud Fleet · Cloud Hopping | sky | clouds ×3, spacing ×1.6 (5) |
| 23 | `thaw` | Sunburn · Thin Ice | chill | regen ×0.45 (13) |
| 24 | `frosty` | Frost · Frosty | chill | regen ×2.5 (−12) |
| 25 | `ration` | Half Tank · Rationed | chill | max Chill 50 (12) |
| 26 | `meltfast` | Quick Melt · Snatch | goal | flakes melt in 0.5 s: the flake star needs shade ahead (4) |
| 27 | `hardy` | Hardy Flakes · Snow Pile | goal | flakes never melt; flake goal; clusters of 5 (−2) |
| 28 | `flurry` | Flurry · Snow Globe | goal | clusters of 7, gap ×0.6 (−4) |
| 29 | `drought` | Drought · Cloudless | sky | no clouds (12) |
| 30 | `dense` | Crowded · Thicket | world | spacing ×0.7, latMax −10 (−7) |
| 31 | `moonlit` | Moon Sun · Moonlit | sun | εnoon 30, drain ×0.7, night palette (5) |
| 32 | `lowland` | Lowland · Short Grass | world | heights ×0.6 (11) |
| 33 | `lock` | Sun Lock · Stop and Go | dial | 1.2 s lock every 7 s; drain ≤ 40 (3) |
| 34 | `fog` | Fog · Pea Soup | teach | render: the world fades beyond 260 u (3) |
| 35 | `blind` | No Dial · Blindfold | teach | render: no safe arcs on the halo (3) |
| 36 | `eclipse` | Eclipse · Moon Shadow | sky | 6 s of f = 0 at the midpoint, then θ + 180°; drain ≤ 45 (4) |
| 37 | `sunset` | Sunset · Sunset Run | sun | 3 PM + 180 min (−16) |
| 38 | `flare` | Solar Flare · Sunspots | sky | three Heat Flares at 30/55/80% of the level (d 10, 72-tick warning); goal: parry 2 (v1.6) (4) |
| 39 | `marathon` | Marathon · The Long Walk | sun | 1080 min across a night (9) |
| 40 | `boss` | Heat Dome · Into the Dome | sun | εnoon 80, 9 AM + 360 min (12) |

**Retired (Controls v3, §9).** `dazzle` (Mirror Sun), `heavy` (Heavy Sun), `slippery` (Slippery
Sun), `clockwork` and `gusts` made the controls themselves the obstacle; they are gone from
`ConceptId`, `CONCEPTS`, `DARE_OF` and the sim. Composed levels still draw them (`DrawId`, frozen
in `RETIRED_DRAW`) and then substitute: `dazzle` → `dense`, `lowland`, `sparse`; `slippery` →
`sprint`, `sparse`, `dense`; `clockwork` → `sparse`, `dense`, `lowland`; `gusts` → `fleet`, `breezy`,
`sparse`, `dense`; `heavy` → `sprint`, `ration`, `sparse` (the first that fits; none fitting drops the
slot). Sun Lock stays.

**The curve (v1.3).** `drain = (curve(id) − Σ cost) / drainMul`, clamped to 22-55 (effective ≤ 62, ≤ the concepts' `drainCap`). `curve` is a sawtooth in effective drain points: the teaching chapters climb 28 → 34 by chapter (+1 every three levels, finales +6); composed chapters run from base − 5 up to base + 2 with the finale at base + 7, base = 37 + 0.6·(chapter − 5) (37 → 46). Lengths: teaching levels end before noon (240 minutes from dawn in chapter 1, 300 after), their finales an hour longer (300 in chapter 1, then noon); composed chapters grow 360 → 720 by chapter, their first two levels 30 minutes shorter. Time concepts keep their own windows. Levels 41-200 compose 2-3 concepts (never two of a kind except `world`, never a conflicting pair), the chapter's headline first; finales take three, led by the chapter's first concept.

**Goals and stars (v1.3).** Flake goal: 55% of the flakes the level offers; Snow goal: 0.7 Snow per flake offered (min 5). Stars: 1 for passing, +1 for flakes ≥ 65% of those offered (80% on a flake-goal level), +1 for a **cool run**: at most `stars.sunSec` seconds in the sun (22% of the level's daylight, `RunStats.litTotal`) and the lowest Chill ≥ `stars.minChill` (20% of the tank). The cool-run star is the skill star: the human model earns it on ~6% of its passes, the oracle on ~60%.

**Fairness.** `node scripts/sim.ts --campaign [--tries N]` runs the oracle, reactive and humanDial bots on all 200 levels (humanDial N times with different decision streams) and prints a per-chapter pass/stars table. Hard gates: oracle 200/200, reactive ≥ 95% of levels 1-100. Advisory: humanDial ≥ 75% of levels 1-40 and ≥ 90% of 1-10. The validator accounts for `heightScale`, `walkMul`, `maxChill`, `drainMul` and `regenMul`; `lock` and `eclipse` are not modelled (drain caps and costs cover them).

## 4. Game layer (session/render)

- `startRun('campaign', { level })` → `cfg = { seed, mode: 'campaign', profile: 3, tutorial: false, plan: false, level, mods, drain, startT, biome, forecast, lesson: level.id === 1 && !tutorialDone }`. Campaign runs never use the comfort ladder; they do count for wallet Snow, missions and achievements; they never touch endless history/bests.
- **Intro card** during `hold`: level number + name, concept icon + name + blurb ("Level 6 · Glass Garden — Glare: gazing balls throw light back. Red arcs on the dial are glare."). The first tap starts. Reuse the day-card renderer at the top of the canvas.
- **HUD:** the ruler becomes a level progress bar (start → finish, with the eclipse/gate marker when relevant); the Snow pill shows `flakes/target` for flake goals and `snow/target` for snow goals; the clock stays.
- **Finish:** crossing the line plays a short "FINISH" stamp + confetti; the run freezes; after 1.0 s Results. Failing the goal at the line shows "Not enough flakes" and the Results retry.
- **Results (campaign variant, UI contract §5):** stars with pop-in, level name, the goal line, buttons **Next level** (primary, when passed), **Retry**, **Map**, plus Share (text: "SHADY Journey · Level 12 ★★☆ — Glass Garden").
- **Death:** as today (Melt Map + tip), buttons Retry / Map.
- `?level=N` opens the level directly (debug run only when combined with other debug params; otherwise a normal campaign run). `__SHADY_TEST__.state()` gains `level`, `mods`, `levelProgress` (0..1).
- Render signatures per concept kind: fog (gradient mask over the world beyond 260 u), blind (halo arcs off), eclipse (sky dims to night over 0.5 s with stars, back over 0.5 s), lock (padlock on the halo; Controls v3: a 1.0 s countdown ring before each lock), moonlit (night palette, moon as the sun glyph), giants/lowland (nothing special; the heights speak).

## 5. UI + meta

- **Save v3:** `campaign: { stars: number[] /* index id-1, 0..3, length 200 */; unlocked: number /* highest playable level */; lastLevel: number }`, migration from v2 fills zeros/1/0. `settings.unlockAll: boolean` (default false) = testing toggle.
- `progression`: `applyRunResult` for `mode === 'campaign'`: wallet += run Snow + first-pass bonus (level.id × 2 Snow on the first pass), stars = max(old, new), `unlocked = max(unlocked, id + 1)` on pass, missions/achievements credited as for endless (no history/comfort/bests). New achievements: `journey-10` (finish chapter 1), `journey-100`, `three-star-20` (20 levels at 3 stars) with no item rewards.
- **Journey screen** (`ScreenId 'journey'`): 20 chapter sections × 10 tiles. Tile: number, stars (☆☆☆ / ★★★), concept icon for levels 1-40, lock icon when `id > unlocked && !unlockAll`. Tapping a playable tile starts it; the header shows total stars `n/600` and the chapter name. A sticky "Continue · Level N" button at the top. Scroll remembers position.
- **Title:** a primary "Journey · Level N" pill above the tray (the drag-to-start endless stays). The tray gains **Journey** (5 buttons: Journey, Daily, Missions, Wardrobe, Settings) — or keep 4 and let the pill be the entry; the UI batch decides and keeps every size ≥ 48 px at 320 px width.
- **Settings:** "Unlock all levels (testing)" toggle under a "Testing" group; the Journey map refreshes at once.
- `ResultsView` gains `campaign?: { id; name; passed; stars; nextId: number | null; goalLine: string; introduces?: {name; blurb} }`; `UiCallbacks.startRun(kind, date?, level?)` and `nextLevel()`; `ScreenId` gains `'journey'`; `Ui.showJourney(view)` is not needed (the screen reads the save + CAMPAIGN_LEVELS).
- Share text for campaign (meta/share.ts): `SHADY Journey · Level 12 ★★☆ · Glass Garden` + the link line.

## 6. v1.3 tuning (numbers)

`node scripts/sim.ts --campaign --bot all [--tries 8]`, v1.2 → v1.3. Pass % (mean stars) per chapter on the default decision stream; the last column is humanDial over 8 decision streams per level.

| ch | oracle | reactive | humanDial | humanDial ×8 |
|---|---|---|---|---|
| 1 | 100 (2.9) → 100 (2.9) | 100 (3.0) → 100 (3.0) | 90 (2.2) → 100 (2.1) | 79 → 100 |
| 2 | 100 (2.9) → 100 (2.7) | 100 (2.9) → 100 (2.9) | 70 (2.0) → 90 (1.9) | 72 → 94 |
| 3 | 100 (2.9) → 100 (2.6) | 100 (3.0) → 100 (3.0) | 60 (1.3) → 80 (1.4) | 60 → 90 |
| 4 | 100 (2.9) → 100 (2.7) | 100 (3.0) → 100 (2.9) | 40 (1.0) → 80 (1.5) | 49 → 75 |
| 5 | 100 (2.6) → 100 (2.3) | 100 (2.9) → 100 (2.9) | 50 (1.1) → 90 (1.6) | 39 → 60 |
| 6 | 100 (3.0) → 100 (2.8) | 100 (3.0) → 100 (2.8) | 40 (1.1) → 50 (1.2) | 44 → 55 |
| 7 | 100 (2.7) → 100 (2.3) | 100 (2.6) → 100 (2.6) | 50 (1.1) → 70 (1.4) | 29 → 69 |
| 8 | 100 (3.0) → 100 (2.9) | 100 (3.0) → 100 (3.0) | 40 (0.9) → 80 (1.7) | 48 → 75 |
| 9 | 100 (2.9) → 100 (2.3) | 100 (3.0) → 100 (2.8) | 20 (0.6) → 60 (1.3) | 28 → 69 |
| 10 | 100 (2.9) → 100 (2.6) | 90 (2.3) → 100 (2.7) | 20 (0.4) → 30 (0.5) | 9 → 42 |
| 11 | 100 (2.5) → 100 (2.3) | 100 (2.4) → 100 (2.4) | 30 (0.6) → 40 (0.6) | 36 → 49 |
| 12 | 100 (2.6) → 100 (2.0) | 100 (2.9) → 100 (2.6) | 50 (1.4) → 50 (1.1) | 62 → 68 |
| 13 | 100 (2.8) → 100 (2.0) | 100 (2.9) → 100 (2.4) | 10 (0.2) → 40 (0.8) | 22 → 52 |
| 14 | 100 (3.0) → 100 (2.8) | 100 (2.9) → 100 (2.9) | 10 (0.2) → 60 (1.3) | 12 → 41 |
| 15 | 100 (2.9) → 100 (2.6) | 80 (2.3) → 100 (3.0) | 0 (0.0) → 20 (0.4) | 1 → 29 |
| 16 | 100 (2.7) → 100 (2.2) | 90 (2.4) → 100 (2.6) | 10 (0.2) → 40 (0.8) | 2 → 28 |
| 17 | 100 (2.9) → 100 (2.4) | 100 (2.8) → 100 (2.8) | 20 (0.4) → 60 (1.2) | 12 → 52 |
| 18 | 100 (2.7) → 100 (2.6) | 90 (2.3) → 100 (2.8) | 40 (0.9) → 40 (0.9) | 26 → 36 |
| 19 | 100 (2.6) → 100 (1.6) | 80 (2.0) → 100 (2.1) | 0 (0.0) → 40 (0.5) | 6 → 38 |
| 20 | 100 (2.8) → 100 (2.2) | 80 (2.2) → 90 (2.1) | 20 (0.5) → 10 (0.2) | 31 → 32 |

Totals: oracle 200/200 (2.81 → 2.44 stars a level; 1-40 2.90 → 2.73); reactive 191 → 199/200, 99 → 100/100 on 1-100; humanDial 67 → 113/200, 26 → 35/40 on 1-40 (×8: 65% → 90%), 9 → 10/10 on 1-10 (×8: 79% → 100%), stars on 1-40 1.62 → 1.73 with three stars on 15 → 4 of levels 1-40 (oracle 36 → 30): the third star now takes skill. By position in a chapter (humanDial ×8): teaching levels 84-100% with the finale at 56%; composed chapters open at 60-70%, sit at ~45% and end at ~41%.

Endless: SWING `minDeg` 45 → 38 takes reactive p3 from 0.7 to 1.45 SWINGs a minute (humanDial R4 2.2, SWING Snow 6% of run Snow). The humanDial R4 median (18.1 s at 40 seeds, 17.0 s at 120) proved insensitive to gentle levers (regen +10%: +0.5 s; R4 drain −5: +1.4 s; Day-1 spacing, wave, εnoon or the validator floor: within ±0.5 s of noise), so the standard rules are unchanged: the advisory still misses.

## 7. v1.5 core mechanics in the Journey (numbers)

v1.5 (docs/V1_5_PLAN.md) teaches its three mechanics in chapter 1, each with its own level and
intro concept: **Deep Shade · Double Shade (5)**, **Sunflowers · Sun Garden (8)** and **Cold Snap ·
Frost Cloud (10, the chapter finale; it starts with a full frost meter)**. Each mechanic is off on
every level before its lesson and on from it (`mechanicsOf(id)`), so level 1 stays the pure drag
lesson. Levels 1-4, 6, 7, 9, 12 and 22-40 keep their concepts; Old Town, Gates, Long Shadows and
Heat Wave moved to 11, 13, 14 and 15, Mirror Sun … Lowland three places later (16-21). Wide Open,
Crowded and Drought (plain knob concepts) lost their teaching levels and still compose; levels
41-200 are exactly as before (composition draws from the v1.2 order). After the Cold Snap's level
every level starts with the meter at half. The `snap` concept costs 3 drain points (its finale
drains 31 instead of 34).

`node scripts/sim.ts --campaign --bot all` (v1.4 → v1.5, pass % (mean stars); the last column is
v1.5 with the oracle / reactive ignoring the mechanics, `--nomech`):

| ch | oracle | reactive | humanDial | oracle / reactive, no mechanics |
|---|---|---|---|---|
| 1 | 100 (2.9) → 100 (2.9) | 100 (3.0) → 100 (3.0) | 100 (2.1) → 100 (2.1) | 100 (2.9) / 100 (3.0) |
| 2 | 100 (2.7) → 100 (2.9) | 100 (2.9) → 100 (3.0) | 90 (1.9) → 100 (1.9) | 100 (2.8) / 100 (2.9) |
| 3 | 100 (2.6) → 100 (2.7) | 100 (3.0) → 100 (3.0) | 80 (1.4) → 80 (1.4) | 100 (2.5) / 100 (2.9) |
| 4 | 100 (2.7) → 100 (2.7) | 100 (2.9) → 100 (2.9) | 80 (1.5) → 80 (1.6) | 100 (2.7) / 100 (2.9) |
| 5 | 100 (2.3) → 100 (2.3) | 100 (2.9) → 100 (2.8) | 90 (1.6) → 90 (1.5) | 100 (2.3) / 100 (2.9) |
| 6 | 100 (2.8) → 100 (2.8) | 100 (2.8) → 100 (2.8) | 50 (1.2) → 60 (1.3) | 100 (2.8) / 100 (2.8) |
| 7 | 100 (2.3) → 100 (2.5) | 100 (2.6) → 100 (2.6) | 70 (1.4) → 80 (1.4) | 100 (2.3) / 100 (2.6) |
| 8 | 100 (2.9) → 100 (3.0) | 100 (3.0) → 100 (3.0) | 80 (1.7) → 80 (1.8) | 100 (2.9) / 100 (3.0) |
| 9 | 100 (2.3) → 100 (2.5) | 100 (2.8) → 100 (2.9) | 60 (1.3) → 60 (1.3) | 100 (2.3) / 100 (2.8) |
| 10 | 100 (2.6) → 100 (2.8) | 100 (2.7) → 100 (2.8) | 30 (0.5) → 30 (0.5) | 100 (2.7) / 100 (2.6) |
| 11 | 100 (2.3) → 100 (2.4) | 100 (2.4) → 100 (2.5) | 40 (0.6) → 60 (0.9) | 100 (2.3) / 100 (2.4) |
| 12 | 100 (2.0) → 100 (2.2) | 100 (2.6) → 100 (2.6) | 50 (1.1) → 50 (1.1) | 100 (2.0) / 100 (2.6) |
| 13 | 100 (2.0) → 100 (2.0) | 100 (2.4) → 100 (2.3) | 40 (0.8) → 50 (0.9) | 100 (2.0) / 100 (2.4) |
| 14 | 100 (2.8) → 100 (2.7) | 100 (2.9) → 100 (2.9) | 60 (1.3) → 80 (1.7) | 100 (2.8) / 100 (2.9) |
| 15 | 100 (2.6) → 100 (2.7) | 100 (3.0) → 100 (2.9) | 20 (0.4) → 40 (0.7) | 100 (2.6) / 100 (3.0) |
| 16 | 100 (2.2) → 100 (2.9) | 100 (2.6) → 100 (2.8) | 40 (0.8) → 40 (0.8) | 100 (2.2) / 100 (2.7) |
| 17 | 100 (2.4) → 100 (2.5) | 100 (2.8) → 100 (2.9) | 60 (1.2) → 80 (1.5) | 100 (2.4) / 100 (2.8) |
| 18 | 100 (2.6) → 100 (2.7) | 100 (2.8) → 100 (2.9) | 40 (0.9) → 30 (0.8) | 100 (2.6) / 100 (2.8) |
| 19 | 100 (1.6) → 100 (1.8) | 100 (2.1) → 100 (2.3) | 40 (0.5) → 40 (0.5) | 100 (1.6) / 100 (2.1) |
| 20 | 100 (2.2) → 100 (2.1) | 90 (2.1) → 80 (1.9) | 10 (0.2) → 20 (0.4) | 100 (2.2) / 90 (2.1) |

Totals: oracle 200/200 (2.56 stars a level, 1-40 2.80; v1.4 2.44 / 2.73); reactive 198/200,
100/100 on 1-100 (2.74); humanDial 125/200 (v1.4 113), 36/40 on 1-40, 10/10 on 1-10 (it now casts a
ready snap when lit under 30 Chill). With the mechanics ignored (`--nomech`) the oracle earns 2.44
stars a level and the reactive bot 2.71: blooming the buds ahead (their shadows fall on the coming
trail) and snapping buy cool runs and flakes.

## 8. v1.6 world and Dares in the Journey (numbers)

docs/V1_6_PLAN.md §2.3, §2.5, §2.6 (CORE-2); the core API is src/core/README.md §16.2.

- **Stars.** ★1 the goal, ★2 a **Dare** (finales offer two, either earns it), ★3 the cool run
  (unchanged). The flake star became the 'flakes' Dare; the 'snow' goal is retired (T6).
- **Verb goals** on the teaching levels: L5 1.5 s of deep shade, L6 every ball with a glare-free line
  passed clean minus one (at least 1), L7 1 SWING, L8 1 bloom, L10 a snap that saves 1 s, L13 the arch
  walked under shaded, L21 1 glass cluster saved, L36 shaded within 1 s of the eclipse flip, L38 parry
  2 of 3 flares. **Soft-fail**: after 2 misses a level's goal relaxes to 'finish', after 1 on
  levels 1-10 (`softFailMisses`, `relaxedGoalFor`, `RunConfig.relaxedGoal`; the save keeps the
  misses, GAME shows a tip).
- **New concepts.** `brittle` (L21) and `flare` (L38) take the places of `lowland` and `moonlit`,
  which compose from chapter 5 on. Every boss finale (50, 60, …, 200) carries `flare`: min(8,
  floor(level s / 3.2)) flares in three phases (`BOSS_PHASES`: 20-40%, 50-68%, 76-92% of the level;
  d 10, 13, 16); the validator keeps or drops each (the boss's HP is the kept count) and they cost
  no rescue rocks. The bake keeps a flare only at its data position, kept in its own job and with
  every other flare of the level (boss flares try 0.5 s shifts within ±6 s, then a fill pass per
  phase), and every flare ends at least 1 s before the finish line. L38's three flares keep 1.5 s
  between one's end and the next warning. Since fix round 2 the keep test itself asks for a parry
  from a fixed angle (≤ 4 lit hold ticks, counted tick by tick), so every kept flare, boss or lesson,
  is parried by holding any angle the dial's frost-rimmed arc names (its still arcs on L38: 19°, 18°
  and 22°).
- **Dares need their verb (fix round 3).** Review r3 found most Dares met by players who never
  sought them (reactive: flakes 71%, deep 73%, ride 63%, ring 63%, parry 65%) and some out of the
  seekers' reach (ring 0% for both human models). The offers alone cannot tell, so `node
  scripts/sim.ts --bake` now measures each level's Dare candidates with the bots (scripts/sim16/
  dares.ts): to the finish line, the players who do not seek the candidate (the reactive bot, the
  oracle playing the verb goal, humanDial) and those who do (the Feat-seeking oracle, humanFeat),
  the human models on 10 training decision streams the campaign sim never plays (`SIZE_SALTS`).
  The target sits just above the non-seekers (the reactive bot and the oracle under it, at most 2
  of 10 humanDial players at it; deep and snap ticks clear by 12 ticks and 10%; more than the goal
  where the goal counts the same thing), and a candidate needs its verb when the Feat-seeking oracle
  and ≥ 7 of 10 humanFeat players reach it (8 for the minor kinds). The candidates in order: the
  level's concepts' Dares (`DARE_OF`), then blooms / SWINGs (from L7) / snapSave in a seeded order,
  then flakes and deep; the first that needs its verb is the Dare, else a core verb the Feat-seeking
  oracle reaches, else flakes (on L1-L7 no verb is taught yet, so their flake Dares are plain). A
  finale's second Dare only where it needs its verb too (either earns the star). Measured that way,
  only blooms, SWINGs, the snap and some flake levels separate the seekers; deep, ride, clean,
  gates, flip, parry and the glass come to good shade play (or to the oracle's own flare and glass
  plans) by themselves on nearly every level, so their concepts dare a core verb; the ring Dare is
  retired (on none of the 52 levels that offered it did it need its verb). The bake stores the
  measures (`LevelBake.dares`, `dares2`) and campaign.ts `pickDare` / `sizeDare` re-derive the
  Dares from them, so the game data is a fixed point of the file. humanFeat (bots/dares.ts) now has
  a focus for every kind and turns to the Dare whose moment is now (a flare, its own snap, the flip,
  a lock or gust).
- **Teaching without walls (fix round 3).** humanDial failed the verb goals of L5, L6, L7, L10, L13,
  L21 and L38 on its first try (5/30 on L6, 6/30 on L10, 0/30 on L38) and melted on its own world of
  L36 every time. The bake now plays a teaching level's world variants (`levelSeed(id, v)`) until
  one reads (`lessonReads`: humanDial passes on its first try on 80% of the training streams, the
  oracle passes, the reactive bot finishes), confirmed on 20 fresh streams (a search over many
  worlds with one set of streams finds worlds that suit them by luck: L7's first pick read 9 of 10
  in training and 12 of 20 held out). L5, L6, L10, L13, L21, L22, L27, L30, L32, L36, L39 and L40
  play a variant; L7 found none and keeps its own (60%); L38 keeps its own world: humanDial does not
  read the flare telegraph, and the keep test makes the shade move, so a dial-follower parries by
  luck on any world (the flare's parry arc covers 10-46% of the teal before it). The soft-fail stays
  the net there.
- **The Sunflowers lesson (L8)** turns its buds to faces inside the safe teal (fix round 2), so a
  player following the dial grows one.
- **The Frost Bank ships on** (economy iteration 1, src/core/README.md §16.4-§16.5), in the Journey
  as in Endless: the meter holds two snaps (`TUNING.bank.capH`). A level starts with half a snap
  (`campaignStartH` 50), one snap on a level that dares a snap (L10 and every snapSave Dare,
  `startsWithSnap`: `teachStartH` 100). Shade pays no frost; only risky play does: a bloom grown on a
  cool, shaded Nubs banks `bloomH` 32 (nothing red-hot or in the Noon Heat, which no Journey level
  has), a saved glass cluster banks `clusterH` 80 for the next snap, and a snap cast in the white
  pours the ring in (30 a level above x1, at most 60), less across the amber, nothing red-hot. The
  gauge's lines scale with the tank, so a 'ration' level's half tank turns amber at 25 and red at
  12.5. The snapSave Dare and L10's goal count every tick a snap alone shades Nubs, never during an
  eclipse (fix round 3: a snap cast into L192/L199/L200's eclipse used to earn the Dare for free).
- **Bosses dare a parry** (review of economy iteration 2). The oracle plays the flares and the glass
  by plan, so for parry and glass Dares only the reactive bot and humanDial count as players who do
  not seek them (`ORACLE_PLANS`); humanFeat watches every flare while a parry Dare is unmet (its
  focus coin does not apply then). A boss finale offers a parry Dare beside its first one wherever
  parry needs its verb (tier 2 or 3: not free, so it cannot void the first). Re-baked: 13 of 16
  bosses offer one (L50, L70 and L200: the reactive bot parries as many as the Feat-seeking oracle),
  10 finales offer two Dares, and 82 of 200 levels dare a verb other than blooms.

`node scripts/sim.ts --campaign --bot all --tries 3` (fix round 3, bake v4; pass % and mean stars
over all 200 levels; humanDial and humanFeat × 3 decision streams, none of them a training stream):

| bot | passed | stars (1-40 / 41-200) | three stars | Dare met |
|---|---|---|---|---|
| oracle | 200/200 | 1.86 (2.02 / 1.82) | 3 | 2.0% |
| reactive | 199/200 (100/100 on 1-100) | 1.95 (2.05 / 1.92) | 6 | 3.5% |
| Feat-seeking oracle | 200/200 | 2.85 (3.00 / 2.82) | 171 | 100% |
| humanDial | 65.0% of tries (92.5% on 1-40) | 0.81 (1.14 / 0.73) | 9 | 8.7% |
| humanFeat | 74.3% of tries | 1.41 (1.73 / 1.32) | 38 | 58.0% |

Before fix round 3: oracle 2.35 stars and Dare met 50.5%, reactive 2.38 / 47.0%, humanDial 1.00 /
27.3% and 81.7% on 1-40, Feat-seeking oracle 2.79 / 91.5%, humanFeat 1.17 / 39.2%. A Dare is now
what separates the player who goes for it: the players who do not seek one earn ★2 on 2-9% of
levels, those who do on 58-100%.

Per Dare kind (each Dare counted on its own; `--tries 10`, so the human models play 10 streams;
the advisory bars are ≤ 35% for the bots that do not seek it, ≥ 85% for the Feat-seeking oracle,
≥ 50% for humanFeat):

| Dare | levels | reactive | oracle | Feat-seeking oracle | humanFeat | humanDial |
|---|---|---|---|---|---|---|
| blooms | 122 | 1% | 0% | 100% | 56% | 4% |
| snapSave | 32 | 0% | 0% | 100% | 67% | 4% |
| swings | 28 | 0% | 0% | 100% | 54% | 16% |
| flakes | 18 | 33% | 22% | 100% | 56% | 34% |
| still | 1 | 0% | 0% | 100% | 50% | 0% |

The reactive bot and the oracle are deterministic and the bake sizes each Dare above them, so
their columns hold by construction; humanFeat and humanDial play streams the bake never saw, so
theirs are held out (with `--tries 3`: 58 / 64 / 52 / 59 / 0%, the one `still` level being 3
tries; over 20 streams that level is met by 12 of 20). Flakes' non-seeker share is the first levels
(L1-L5, L7: every player collects all their flakes) and four late levels where no Dare needs its
verb.

humanDial's first try on levels 1-40 (20 held-out streams; v1.5 88.3%, before fix round 3 81.7%):
see the per-level table in V1_6_PLAN.md §6.1. Hard gates (§2.6): oracle 200/200 with the verb goals,
reactive 100% of 1-100 (teaching verb goals scored as finish), the Feat-seeking oracle ★2 on 100%
and every Dare of levels 1-10. Advisory: reactive three stars on 41-200 2.5% (≤ 50%); humanDial
passes all of levels 1-10 with the soft-fail; humanDial's mean stars on 41-200 0.73 miss the 0.95
bar, by design of the Dares (it no longer earns ★2 without seeking it; humanFeat earns 1.32 there).

## 9. Controls v3 in the Journey (docs/CONTROLS_V3.md §5.3, §9)

- **Retired:** `dazzle`, `slippery`, `clockwork`, `gusts`, `heavy` (§3). Sun Lock stays, with a 1.0 s
  countdown ring before each lock.
- **Teaching slots:** L16 Wide Open · Big Sky, L29 Drought · Cloudless, L30 Crowded · Thicket, L31 Moon
  Sun · Moonlit, L32 Lowland · Short Grass (finish goals; Dares and world variants from the bake).
- **Composed levels** keep their draws and substitute (§3); 41 composed levels changed. Levers
  (`SUB_OVERRIDE`, at most 8, each with its measurement in `campaign.ts`): L73 dense, L79 dropped,
  L80 dropped, L92 dropped, L103 sparse, L123 lowland, L164 dense, L165 dropped.
- **Names:** L85 Pine Hollow (was Slippery Sun), L94 Stop Clock (was Heavy Hands), L165 Cloudburst
  Pass (was Slick Sun).
- **Bake and goldens:** the re-bake changed only the 46 levels and `LEVEL_BAKE_RUN`; the goldens
  only campaign 32 and 100.
