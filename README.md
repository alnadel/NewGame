# SHADY: Don't Melt Nubs

A one-thumb arcade game for phones and the web. **You are the sun.** Nubs the snowman walks up a
winding trail, and one horizontal drag swings the sun around him, and with it every shadow in the
world. Keep Nubs in the shade. Shadows shrink toward noon, and **noon is the boss** of every day.
Your **score is the time of day you reached**, for example "Day 2 · 2:40 PM".

Every standard run draws its own days: Meadow or Old Town, and a forecast (Clear, Breezy, Overcast,
Heat Wave, Long Shadows, Dazzle, Market Day). A comfort ladder eases new players in; the Daily
Solstice gives everyone the same world with 3 tries; challenge links carry the sender's exact rules;
the **Journey** is a 200-level campaign that teaches one idea at a time.

TypeScript, Vite, Canvas 2D and WebAudio, with **no runtime dependencies**. Installs as a PWA,
works offline, and keeps the seams open for Capacitor shells.

- Live build: <https://alnadel.github.io/NewGame/>
- Docs: [campaign plan](docs/CAMPAIGN_PLAN.md) (v1.2, the Journey), then [v1.1 plan](docs/V1_1_PLAN.md),
  then [v1 plan](docs/V1_PLAN.md) (rules, URL parameters in §14), then the module guides; design in
  [GDD](docs/GDD.md); history in [docs/archive](docs/archive/README.md).

## How to play

| | Touch | Keyboard and mouse |
|---|---|---|
| Turn the sun | drag left or right anywhere | ← → or A D (Shift for fine turns), the wheel, or a mouse drag |
| Start or retry | drag on the Title, or tap Retry | Space or Enter |
| Pause | the pause button | Esc or P |

Collect snowflakes for **Snow**, swing the shade from one shadow to the next for a **SWING**, and
spend Snow in the **Wardrobe** (for Nubs, and Sun Shades for the sun). Progress stays on the device;
Settings → Backup carries it elsewhere.

### Journey

The **Journey** pill on the Title opens a map of 200 levels in 20 chapters. A level is a short,
seeded run to a finish line with a goal (reach the finish, collect N flakes, or earn N Snow) and up
to three stars: one for passing, one for the level's flake count, one for keeping Chill above its
bar. The first 40 levels each introduce one concept (clouds, glare, the SWING, forecasts, fog, an
eclipse, a moonlit night…); later levels combine them. Passing a level unlocks the next and pays a
first-pass bonus (twice the level number in Snow); stars, missions and achievements are kept as for
any run, while the Journal and bests stay endless-only. The map's tiles name the concept they teach,
"Continue · Level N" picks up where you left off, and Results offer **Next level**, **Retry** and
**Map**. For testing, Settings → Testing → **Unlock all levels (testing)** opens every tile, and
`?level=N` opens a level directly.

## Commands

Node **22.18+** (scripts run through Node's type stripping); Playwright's Chromium for e2e.

```sh
npm ci                              # install (dev dependencies only)
npm run dev                         # dev server (also on your LAN)
npm run build                       # typecheck, then dist/ with sw.js
npm run build:single                # one self-contained dist-single/index.html
npm run typecheck && npm test       # tsc and the unit tests (Vitest)
npm run sim -- --check --seeds 40   # headless bots vs the difficulty targets (exits 1 on a miss)
npm run e2e                         # Playwright, mobile and desktop Chromium
npm run golden                      # rewrite tests/golden/hashes.json (deliberate sim changes only)
npm run icons                       # public/icons from the SVG art
node scripts/gen-og.ts              # public/og.png, the link-preview card (after a build)
```

`npm run sim` also takes `--bot`, `--profile`, `--forecast <id>`, `--days`, `--workers` and
`--career N --runs R [--meta]` (comfort-ladder careers folded through the meta layer). For e2e with
a preinstalled browser: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run e2e`. Dev pages:
`/ui-lab.html` (every screen and state with sample data) and `/audio-lab.html` (every sound).

## Structure

```
src/
  main.ts      boot: save, audio, haptics, UI, renderer, session, service worker
  config/      tuning, the day table, the comfort ladder, forecasts (pure data)
  core/        deterministic simulation: clock, sun, shadows, Day Plan, generation and its
               validator, SWING, bots, replays, hashes
  game/        session and run lifecycle, loop, input, camera, fx, governor, params, test hook
  render/      Canvas 2D: ground, shadows, casters, Nubs, HUD, Melt Map, postcard
  audio/       synthesized WebAudio
  ui/          DOM screens (Title, Journey map, Results, Daily, Missions, Journal, Wardrobe, Settings)
  meta/        save v3, progression (Journey included), missions, errands, Sunny Week, Daily, share
               text, challenges
  platform/    storage, haptics, share, lifecycle, PWA, safe areas
tests/         unit (Vitest), e2e (Playwright), golden hashes
scripts/       sim.ts, golden.ts, gen-icons.ts, gen-og.ts, inline-build.mjs
```

Imports follow V1_PLAN §2.1 (`tests/unit/architecture.test.ts` enforces it): config → core →
meta → render/audio/ui → game, with platform as a seam any layer but core and config may use.
Module guides: [core](src/core/README.md), [game](src/game/README.md), [ui](src/ui/README.md),
[audio](src/audio/README.md).

## Deploy

Settings → Pages → Source: **GitHub Actions**, then push to `main`: `.github/workflows/ci.yml`
runs typecheck, unit tests, the sim check, the single-file build and e2e, and deploys `dist/` only
when they pass. The Pages build sets `VITE_SHARE_URL` (challenge links and the link-preview card
point at the published game); other builds use `.env`. After deploying a new card, check it in the
Facebook Sharing Debugger, the X card validator, iMessage, WhatsApp and Discord.

All art is procedural and all sound synthesized; no runtime dependencies. Built with
[Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org),
[Vitest](https://vitest.dev) and [Playwright](https://playwright.dev).
