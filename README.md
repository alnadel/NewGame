# SHADY: Don't Melt Nubs

A one-thumb arcade game for phones and the web. **You are the sun.** Nubs the snowman walks up a
winding trail, and one horizontal drag swings the sun around him, and with it every shadow in the
world. Keep Nubs in the shade. Shadows shrink toward noon, and **noon is the boss** of every day.
Your **score is the time of day you reached**, for example "Day 2 · 2:40 PM".

Every standard run draws its own days: Meadow or Old Town, and a forecast (Clear, Breezy, Overcast,
Heat Wave, Long Shadows, Dazzle, Market Day). A comfort ladder eases new players in; the Daily
Solstice gives everyone the same world with 3 tries; challenge links carry the sender's exact rules;
the **Journey**, a 200-level campaign that teaches one idea at a time, is what Play starts.

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
| Play the next level | tap Play on the Title | Space or Enter |
| Endless run | tap Endless, or drag on the Title | ← or → on the Title |
| Retry | tap Retry | Space or Enter |
| Pause | the pause button | Esc or P |

Collect snowflakes for **Snow**, swing the shade from one shadow to the next for a **SWING**, and
spend Snow in the **Wardrobe** (for Nubs, and Sun Shades for the sun). Progress stays on the device;
Settings → Progress carries it elsewhere with a backup code.

### Journey

The Title's big **Play** button starts your next **Journey** level (Level 1 on a first launch);
**Endless** and the **Daily** sit beside it. The map button opens 200 levels in 20 chapters. A level
is a short, seeded run to a finish line with a goal (reach the finish, collect N flakes, or earn N
Snow) and up to three stars: one for passing, one for the level's flake count, one for a **cool run** (only a
few seconds in the sun, Chill never low). Results name the next star you missed. The first 40 levels each introduce one concept (clouds, glare, the SWING, forecasts,
fog, an eclipse, a moonlit night…); later levels combine them. Each chapter has its own colours, air particles and music. Passing a level unlocks the next and
pays a first-pass bonus (twice the level number in Snow). Every star counts toward the **star
rewards**: the Starry Scarf at 25 stars, then the Night Beanie (75), the Golden Carrot (150), the
Galaxy Shades (300) and the Star Crown (600). Missions and achievements count as for any run; the
Journal and bests stay endless-only. Results offer **Next level**, **Retry** and **Map**, and the
map centers the level in play and pops the stars you just earned. For testing, Settings → Testing →
**Unlock all levels (testing)** opens every tile, and `?level=N` opens a level directly.

### Menus

A first launch shows the Title with **Play** only; the other modes and menus unlock as you play.
A locked button wears a lock and says how to open it, a newly opened one a **NEW** tag. The Title's
top bar carries your **Sun Rank** (it opens the Profile), a gift when the daily reward is ready,
and your Snow. Results land the stars first, then the XP, then any rewards. The Journey's chapter
banners show each chapter's **Snow Globe**, earned by passing all ten levels; the Wardrobe counts
your collection and marks each item's rarity and what's new.

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
  meta/        save v3, progression (Journey and star rewards included), missions, Sunny Week,
               Daily, share text, challenges
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
