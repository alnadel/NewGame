# SHADY Journey: the campaign (v1.2)

**Precedence for campaign work:** this file, then `V1_1_PLAN.md`, then `V1_PLAN.md`, then the module READMEs.

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
  stars: { flakes: number; minChill: number }; // star 2: flakes ≥; star 3: lowest Chill ≥ (finish is star 1)
  drain: number;              // Chill/s at f = 1 (campaign ignores the comfort ladder)
}
export const CAMPAIGN_LEVELS: readonly LevelDef[];      // exactly 200, built by buildCampaign() at module load (pure)
export function levelDef(id: number): LevelDef | null;
export const CHAPTERS: readonly { id: number; name: string; biome: BiomeId }[]; // 20
```

- **Finish line.** The world places a `finish` caster (a gate arch skinned as a finish banner, `kind: 'finish'`, no shadow parts needed beyond the arch's) at `endY = yAtMinute(startMinute + lengthMinutes)`. Crossing `endY` with Chill > 0 ends the run: `s.phase = 'won'`, event `{ e: 'levelWon'; stars: 1|2|3; flakes; minChill }`. The validator treats the stretch after `endY` as unused.
- **Goal `flakes`/`snow`:** the run still ends at the finish line; stars/pass depend on the goal: pass = goal met at the finish (`levelWon` carries `passed: boolean`). A level failed at the finish (goal not met) emits `levelWon` with `passed: false` and `stars: 0`.
- **Stars** (computed in core, `starsFor(level, stats)`): 1 = passed; +1 if `stats.flakes ≥ stars.flakes`; +1 if `stats.minChill ≥ stars.minChill`. `RunStats` gains `minChill` (lowest Chill during daylight; 100 when never lit).
- **RunConfig** gains `level?: number` (the level id). `createRun` reads `levelDef(id)` and derives seed, profile 3, plan off, `forecast`, biome (Day 1 biome forced via a new `cfg.biome?`), `startDay 1`, `startT` from `startMinute`, `drain`, `mods = level.concepts`, and the finish line. `RunResult` gains `level?: { id; passed; stars; introduces }` and `RunMode` gains `'campaign'`.
- **Mods.** `RunConfig.mods?: readonly ConceptId[]` (part of world identity; debug runs may pass any set). `dayParams(day, profile, plan, mods)` applies each concept's `tune` on top of the forecast. Every reader goes through `paramsAt`, so the clock, the validator, the sim and the renderer agree. The sim consults `s.mods` (a `Set`) for behaviour concepts (sun rules, eclipse, lock, gusts).

## 3. Concept catalog (`CONCEPTS: Record<ConceptId, Concept>`)

```ts
interface Concept { id: ConceptId; name: string; blurb: string; icon: string /* glyphs.ts id */; kind: 'teach'|'world'|'sun'|'chill'|'sky'|'goal'; tune?: Partial<DayTuning>; }
```

Teaching order = level 1..40. `tune` fields multiply/override the day row (spacing, latMax, heightScale, cloudCount, cloudRx, ballEvery, flakesPerCluster, meltBudget, drainMul, regenMul, maxChill, sunFollow, sunFriction, walkMul). Behaviour concepts are listed with their rule.

| # | id | name | what it does |
|---|---|---|---|
| 1 | `drag` | First Shade | Meadow, dawn, 360 min, drain 35, no clouds. Teaches the drag (lesson cues on). |
| 2 | `flakes` | Flake Trail | goal flakes 8; clusters of 4. |
| 3 | `cloud` | Umbrella | 3 clouds, waiters only; blurb "Clouds are moving shade." |
| 4 | `noon` | High Noon | starts 10:30 AM, 180 min, εnoon 48. |
| 5 | `oldtown` | Old Town | biome oldtown. |
| 6 | `glare` | Glass Garden | gazing balls every 12 s. |
| 7 | `swing` | SWING! | goal snow 20 (SWING Snow counts); blurb explains the hand-off. |
| 8 | `gate` | The Gate | a gate arch at the midpoint; passing under it at ≥ full shade gives +10 Snow. |
| 9 | `breezy` | Breezy | forecast breezy. |
| 10 | `long` | Long Shadows | forecast long. |
| 11 | `heat` | Heat Wave | forecast heat. |
| 12 | `overcast` | Overcast | forecast overcast. |
| 13 | `dazzle` | Dazzle | forecast dazzle (Meadow). |
| 14 | `market` | Market Day | forecast market (Old Town). |
| 15 | `sprint` | Sprint | walkMul 1.35. |
| 16 | `stroll` | Stroll | walkMul 0.75, drainMul 1.25. |
| 17 | `giants` | Giants | heightScale 1.6 (long shadows, big casters). |
| 18 | `lowland` | Lowland | heightScale 0.6. |
| 19 | `sparse` | Wide Open | spacing ×1.45. |
| 20 | `dense` | Crowded | spacing ×0.7, latMax −10. |
| 21 | `drought` | Drought | cloudCount 0. |
| 22 | `fleet` | Cloud Fleet | cloudCount ×3, cloudRx ×0.8. |
| 23 | `thaw` | Thin Ice | drainMul 1.4. |
| 24 | `frosty` | Frosty | regenMul 2.5, maxChill 100. |
| 25 | `ration` | Rationed | maxChill 50 (Chill starts at 50). |
| 26 | `meltfast` | Quick Melt | meltBudget 0.5 s. |
| 27 | `hardy` | Hardy Flakes | meltBudget ∞ (flakes never melt); goal flakes 15. |
| 28 | `flurry` | Flurry | flakesPerCluster 7, cluster spacing ×0.6. |
| 29 | `heavy` | Heavy Sun | sun follow 220°/s, no coasting (friction ∞). |
| 30 | `slippery` | Slippery Sun | friction 0.35/s (coasts a long way; catch it). |
| 31 | `clockwork` | Clockwork | θ snaps to 30° steps on release (detent magnet). |
| 32 | `gusts` | Gusts | every 8 s a 2 s gust turns the sun at ±25°/s (seeded direction); the HUD shows a wind glyph during a gust. |
| 33 | `lock` | Sun Lock | every 7 s the sun locks for 1.2 s (no input); the halo shows a padlock; level drain ≤ 40. |
| 34 | `fog` | Fog | render: the world fades out beyond 260 u ahead; the guide's `next` arcs are hidden. |
| 35 | `blind` | No Dial | render: the halo's safe arcs are hidden (sun pointer stays). |
| 36 | `eclipse` | Eclipse | at startMinute + 50% of the level, 6 s of full shade everywhere (f = 0; sim), the sky darkens, stars; blurb "Rest in the dark, then it's back." |
| 37 | `sunset` | Sunset Run | startMinute 540 (3 PM), length 180: into dusk; finish at 6 PM. |
| 38 | `moonlit` | Moonlit | the level runs at night with a **moon sun**: elevation curve εnoon 30°, drainMul 0.5, night palette with moon shadows (render reuses v1.1 night moon shadows); flakes glow. |
| 39 | `marathon` | Marathon | lengthMinutes 1080 (crosses one night; Chill refills at night as usual). |
| 40 | `boss` | Heat Dome | εnoon 80, start 9 AM, 360 min; drain 55. |

Levels 41-200: `buildCampaign()` composes 2-3 concepts per level (never two of the same `kind` except `world`), 10 per chapter, each chapter themed (CHAPTERS names, alternating biome), difficulty rising by a chapter curve: drain 40 → 55, lengthMinutes 360 → 720, star thresholds scaling with length. Every level is deterministic from its id. Forecast concepts only on fitting biomes. `boss`-type levels end each chapter (level 10, 20, … 200 introduce nothing but combine the chapter's concepts at full drain).

**Fairness.** Every level must be survivable by the oracle bot: `node scripts/sim.ts --campaign` runs the oracle, reactive and humanDial bots on all 200 levels and reports pass rates; hard gate: oracle passes 200/200, reactive passes ≥ 90% of levels 1-100; advisory: humanDial passes ≥ 70% of levels 1-40. The validator must account for `heightScale`, `walkMul`, `maxChill`, `drainMul` and `regenMul` (the DP uses the level's drain/regen/max). `lock`, `gusts` and `eclipse` are not modelled: lock/gust levels cap drain at 40 and the eclipse only helps.

## 4. Game layer (session/render)

- `startRun('campaign', { level })` → `cfg = { seed, mode: 'campaign', profile: 3, tutorial: false, plan: false, level, mods, drain, startT, biome, forecast, lesson: level.id === 1 && !tutorialDone }`. Campaign runs never use the comfort ladder; they do count for wallet Snow, missions and achievements; they never touch endless history/bests.
- **Intro card** during `hold`: level number + name, concept icon + name + blurb ("Level 6 · Glass Garden — Glare: gazing balls throw light back. Red arcs on the dial are glare."). The first tap starts. Reuse the day-card renderer at the top of the canvas.
- **HUD:** the ruler becomes a level progress bar (start → finish, with the eclipse/gate marker when relevant); the Snow pill shows `flakes/target` for flake goals and `snow/target` for snow goals; the clock stays.
- **Finish:** crossing the line plays a short "FINISH" stamp + confetti; the run freezes; after 1.0 s Results. Failing the goal at the line shows "Not enough flakes" and the Results retry.
- **Results (campaign variant, UI contract §5):** stars with pop-in, level name, the goal line, buttons **Next level** (primary, when passed), **Retry**, **Map**, plus Share (text: "SHADY Journey · Level 12 ★★☆ — Glass Garden").
- **Death:** as today (Melt Map + tip), buttons Retry / Map.
- `?level=N` opens the level directly (debug run only when combined with other debug params; otherwise a normal campaign run). `__SHADY_TEST__.state()` gains `level`, `mods`, `levelProgress` (0..1).
- Render signatures per concept kind: fog (gradient mask over the world beyond 260 u), blind (halo arcs off), eclipse (sky dims to night over 0.5 s with stars, back over 0.5 s), gusts (wind streaks in the gust direction, only during gusts), lock (padlock on the halo), moonlit (night palette, moon as the sun glyph), giants/lowland (nothing special; the heights speak).

## 5. UI + meta

- **Save v3:** `campaign: { stars: number[] /* index id-1, 0..3, length 200 */; unlocked: number /* highest playable level */; lastLevel: number }`, migration from v2 fills zeros/1/0. `settings.unlockAll: boolean` (default false) = testing toggle.
- `progression`: `applyRunResult` for `mode === 'campaign'`: wallet += run Snow + first-pass bonus (level.id × 2 Snow on the first pass), stars = max(old, new), `unlocked = max(unlocked, id + 1)` on pass, missions/achievements credited as for endless (no history/comfort/bests). New achievements: `journey-10` (finish chapter 1), `journey-100`, `three-star-20` (20 levels at 3 stars) with no item rewards.
- **Journey screen** (`ScreenId 'journey'`): 20 chapter sections × 10 tiles. Tile: number, stars (☆☆☆ / ★★★), concept icon for levels 1-40, lock icon when `id > unlocked && !unlockAll`. Tapping a playable tile starts it; the header shows total stars `n/600` and the chapter name. A sticky "Continue · Level N" button at the top. Scroll remembers position.
- **Title:** a primary "Journey · Level N" pill above the tray (the drag-to-start endless stays). The tray gains **Journey** (5 buttons: Journey, Daily, Missions, Wardrobe, Settings) — or keep 4 and let the pill be the entry; the UI batch decides and keeps every size ≥ 48 px at 320 px width.
- **Settings:** "Unlock all levels (testing)" toggle under a "Testing" group; the Journey map refreshes at once.
- `ResultsView` gains `campaign?: { id; name; passed; stars; nextId: number | null; goalLine: string; introduces?: {name; blurb} }`; `UiCallbacks.startRun(kind, date?, level?)` and `nextLevel()`; `ScreenId` gains `'journey'`; `Ui.showJourney(view)` is not needed (the screen reads the save + CAMPAIGN_LEVELS).
- Share text for campaign (meta/share.ts): `SHADY Journey · Level 12 ★★☆ · Glass Garden` + the link line.

## 6. Ownership for the build

- **core:** `src/config/campaign.ts` (catalog + builder), `src/core/**` (mods in params, finish line, won phase, minChill, stars, sun/eclipse/lock/gust behaviour, moon sun, validator support), `scripts/sim.ts --campaign [--level N]`, core tests (`campaign.test.ts`: 200 levels, determinism, every concept's tune applies, finish/stars/goal, oracle passes a sample), goldens.
- **gameRender:** session campaign mode, intro card, HUD, finish stamp, render signatures, `?level=`, test hook, e2e (`campaign.spec.ts`: open level 6 via `?level=6&test=1`, finish via a bot at `?fast=`, Results shows stars, Next level starts 7; unlock-all toggle shows every tile playable).
- **uiMeta:** save v3, progression, Journey screen, Title entry, Settings toggle, Results campaign variant, share text, docs (this file's status, README, V1_1_PLAN pointer), unit tests.

Cross-batch contracts are the exact names in §2, §4 and §5. Batches that need a missing name write a `// V12-SHIM` fallback; integration removes them all.
