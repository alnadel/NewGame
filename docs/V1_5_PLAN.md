# SHADY v1.5: deeper core mechanics

User feedback: "gameplay still feels shallow. core mechanics needs improvements".

## 1. Why it feels shallow

The only verb is turning the sun, Nubs walks on his own, and the halo dial paints the answer (solid
teal = the angles that shade him). Play collapses to "keep the needle in the teal". There is no
trade-off to weigh, no resource to spend, nothing to plan ahead for, and the sun is only ever the
enemy. Concepts (fog, gusts, eclipse…) change parameters, not decisions.

## 2. Three mechanics (one thumb still plays everything)

**A. Sunflower buds: the sun also builds shade (planning, two goals at once).**
Buds stand beside the trail ahead of Nubs. Each faces one direction. Shine the sun from that
direction (within ±20°) for about a second and it blooms into a tall sunflower: a new shade caster
that stays for the rest of the run, plus Snow. Growth fades when the sun turns away. The dial shows
the angles that grow a bud in gold beside the teal safe angles. The decision: aim for safety now, or
spend a moment lit to plant shade for later, or find the angle that does both (where gold meets
teal). Buds never face the start azimuth θ0 (so an idle sun can't grow them) and worlds stay
solvable without them (the validator ignores buds; blooms only add shade).

**B. Cold Snap: a resource you spend (timing).**
A frost meter fills from full shade, flakes, SWINGs and blooms (TUNING.frost). When full, a snap
(swipe down anywhere, tap the meter, or Down/S) drops a frosty cloud that rides over Nubs for
TUNING.frost.snapSec: full shade, no matter where the sun points. Save it for noon (the boss), a
glare gauntlet, or a gap with no shadow; or burn it to keep a multiplier alive.

**C. Deep shade: precision pays (mastery).**
When Nubs is fully shaded and his center is inside two or more shadows (two casters, a caster and a
cloud…), he is in deep shade: Chill regenerates ×2, the multiplier charges ×2 and the frost meter
fills ×2. Overlaps are narrower angles than plain shade, so skilled players hunt them.

Together: where to point (safe / plant / deep / protect flakes), when to spend (snap), what to
plan (which buds to grow for the stretch ahead). Every mode has them. In the Journey they are taught
early (each by its own level with an intro card and tips) and stay on afterwards; levels before
their teaching level don't have them, so level 1 stays the pure basic lesson.

## 3. Contract (on the base commit; shapes fixed, bodies are the CORE builder's)

- `Bud { id, x, y, face, grow 0..1, state 0|1, casterId }` (objects.ts); `World.buds` sorted by y;
  `queryBuds(world, y0, y1, out)`. A bloomed bud adds a caster of kind `'sunflower'` to the world
  (core adds the kind: a thin stem prism plus a big disc head high up) and sets `casterId`.
- `InputFrame.snap?: boolean`: a Cold Snap request this tick (game/input.ts produces it).
- `NubsState.frost` (0..1), `NubsState.deep`; `SimState.snapTicks`, `SimState.snapCloudId` (the snap's
  cloud is a normal Cloud in `world.clouds`, so shadows, coverage and rendering already see it).
- `GuideState.bud` (360 bins): angles that grow a bud within reach now (gold arcs).
- Events: `budGrow {id,x,y,grow}` (throttled, for feedback), `bloom {id,x,y,snow}`, `frostReady`,
  `snap {x,y,cloudId}`, `snapEnd`, `deepEnter`.
- `RunStats.blooms`, `.snaps`, `.deepSeconds` (optional in the type; core always fills them).
- `TUNING.buds`, `TUNING.frost`, `TUNING.deep` (starting values; CORE tunes them).
- Added by CORE (additive, src/core/README.md §15): `World.mech: Mechanics {buds, snap, deep}` and
  `mechanicsOf(levelId)` (Journey: deep shade from level 5, Sunflowers 8, Cold Snap 10; all on
  elsewhere), `RunConfig.mechanics?` and `RunConfig.startFrost?` (debug), `debugBloom(s, id?)`;
  concepts `deep`, `bloom`, `snap` (`TEACH_LEVELS` 40, `teachLevel(id)`, `MECHANIC_CONCEPTS`);
  `CloudKind` `'snap'` (the snap cloud: z 0, rides with Nubs for `SNAP_TICKS`); the `'sunflower'`
  caster (parts `[prism stem, disc head]`, `SUNFLOWER`), id `RUNTIME_ID_BASE + (bud.id −
  BUD_ID_BASE)` in `bud.casterId`; `SNAP_ID_BASE`; `budFacing(b, θ)`; `NubsState.deepTick`;
  `createBot(kind, salt, mechanics = true)`.

## 4. Ownership

| Builder | Owns |
|---|---|
| CORE | src/core/**, src/config/**, scripts/**, core unit tests, tests/golden, docs/CAMPAIGN_PLAN.md, src/core/README.md |
| GAME | src/game/**, src/render/**, src/audio/**, src/platform/haptics.ts, src/ui/concepts.ts, src/ui/labels.ts (cue text), additive missions/trophies in src/meta/content.ts + missions.ts, e2e specs, README.md |

## 5. Goals per builder

**CORE.** Implement A-C in the sim (deterministic, no allocation per tick), bud placement in the
generator (rhythm: a bud every ~4-7 s of walking on average, more on later days; faces chosen so
blooming is a real choice and never θ0 near the start), the `'sunflower'` caster kind, guide.bud,
the snap cloud, deep-shade detection (count shadow sources over the center sample), stats, hash
coverage (hashState must include the new state so replays/goldens catch drift), bots that use the
mechanics (oracle and reactive should bloom useful buds and snap well; idle/novice must not get
easier: keep `sim --check` targets), campaign: concepts that teach each mechanic early in the Journey
(the level table may be rebalanced; keep 200 levels and the oracle/reactive gates), endless tuning so
a human using the mechanics well clearly outlives one who doesn't. Regenerate goldens once, with the
reason in the commit. Report the new numbers.

**GAME.** Make the mechanics readable and satisfying: bud art (closed bud with a clear "light from
here" mark on its sun side), growth feedback (glow ring filling, rising tick), bloom (sunflower pops
up and turns to the sun; its head tracks the sun azimuth), gold arcs on the dial from guide.bud,
the frost meter (HUD; glows when ready; tappable), the snap gesture (swipe down anywhere; must not
disturb normal horizontal drags; Down/S key; meter tap), the snap cloud's look (frosty, snowflakes
falling, fades out at the end), deep shade (darker halo ring, a subtle sparkle, "DEEP" pop on first
entry), audio + haptics for budGrow/bloom/frostReady/snap/snapEnd/deepEnter, intro cards and
contextual tips when a mechanic is taught, Results stats (blooms, snaps), 2-3 missions and trophies
that use them (additive in meta content), concept icons. Works at 60 fps on a mid phone; nothing
allocates per frame.

## 6. Gates

Same as v1.4: typecheck; vitest; `sim --check --seeds 40` (all targets); `sim --campaign --bot
all` (oracle 200/200, reactive ≥ 95 % of 1-100); full Playwright twice with 0 failures (fix specs at
their cause); `npm run build:single` (budget +15 KiB over 594 KiB). Screenshots looked at.
