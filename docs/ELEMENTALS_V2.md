# SHADY Elementals v2: every element plays its own way

User request: "I was thinking the concept of different elements will have maybe different factors and
core mechanic other than just revolving around sun."

Lead direction (binding): the elementals get their own factor and their own verb, not variations on
the sun, and the game never turns into something else for a whole run. A run is still a walk to the
finish line on the fixed schedule, with the sun, the day clock and the shadows as the shared world.

This document is the **binding spec** for Elementals v2. It supersedes `docs/ELEMENTALS.md` (v1) for
all Elementals work; v1 stays in the repo as history. Three teams (CORE, ART, UI) build it in
parallel from the contract commits C0a/C0b (§7.1), and the integrator merges them. It has no open
questions. A number written here is the value to ship; the numbers calibration may move say how far
(§6.5). Review round 1 is folded in; what it changed or rejected is in §12.

---

## 0. In one paragraph

Nubs still walks the trail on the fixed schedule and you still turn the sun to keep him in shade. Now
a run is split into **legs**, and at each **Tag Stone** another element takes over the walk for its
leg. Each element brings its own factor (its meter) and its own verb (how you touch the screen):

| Element | Verb | Factor (meter) | The sun |
|---|---|---|---|
| **Nubs** (Ice) | DRAG turns the sun | Chill: shade cools, sun melts | turns (as today) |
| **Ember** (Fire) | TAP walls ahead to burn them | Flame: a burn costs it (Ember takes it back by walking through its own fire); water douses it | still turns: light is its fuel |
| **Drip** (Water) | DRAG to steer sideways | Size: shade and puddles grow him, sun and hot stones shrink him | **holds** where you left it |
| **Sprout** (Nature) | HOLD on the ground ahead to grow a plant | Sap: growing spends it, it seeps back (faster in rain); an unbridged gap is a fall | still turns: light speeds growth |
| **Gust** (Air) | SWIPE to blow wind | Lift: each swipe spends it, clear air restores it, rain and fog drain it | **holds** (Gust ignores it) |

Each element keeps at most the one sun tie the lead named (Ember's fuel, Drip's evaporation, Sprout's
growth speed); Gust has none. Most runs start and end with Nubs, so the base game frames every
element. Elements leave things behind for each other: fire melts ice into puddles that Drip drinks;
water douses fire; wind pushes rain clouds (shade for Nubs, sap for Sprout) and fog (which blinds
Ember and Sprout) and spreads fire; Sprout's trees shade Nubs and burn. The proof of concept is
**seven Elemental Trials** (ids 1001-1007, the v1 ids reused): four intros, two mixers and a finale
through all five. Duos are gone. Volt is parked.

### 0.1 What v2 keeps, replaces and removes

- **Keeps** from v1: the Trials infrastructure (`trialDef`, `trialLevel`, `anyLevelDef`, `isTrialId`,
  `levelTag`, `levelShort`, `campaignConfig`'s trial branch, `levelOutcome`'s `trialStars`), the
  relay/TAG machinery (`tagTick`, `nextTagTicks`, `nextTagHero`, `tagLocked`, `relayY`,
  `updateRelay`, the telegraph, grace and clean TAG), Nubs' trial rule, the Elementals screen, the
  Title pill, routing (`?trial=`, `openJourney('elementals')`, Results Next/Trials), the progression
  helpers, the hero arts of Ember, Sprout and Drip (adapted), the `CharArt` sprite cache, Tag Stones
  and the NEXT chip, the proof-harness approach (curated worlds, bots, audits, `--pick`).
- **Replaces**: the roster (Volt out, Gust in), the trial list, every non-Nubs hero rule, the dial's
  hero modes, the tips, the death lines, the Dares, the save field (`elementals` becomes
  `elementals2`).
- **Removes** (§8): every v1 sun-variant rule (Ember's light table, Sprout's edge band, Volt's strikes
  and dead zone, Drip's two-ended temperature), the four swipe-down abilities (BLAZE, SEED,
  THUNDERCLAP, CLOUDBURST), duos (the mate body, Harmony, the split gauge, the tether, smother), the
  green thumb, `?hero=`, `SEED_ID_BASE`, and their art, cues, audio and copy.

### 0.2 Words

| Word | Meaning |
|---|---|
| **leg** | A stretch of a Trial walked by one element, from one TAG to the next (leg 0 from go). |
| **walker** | The body on the trail, always `s.nubs`; `s.nubs.hero` names the element walking it. |
| **stretch** | The part of the trail a given element will walk (`walkerAt(s, y)`, §7.7). |
| **TAG** | The hand-off at a Tag Stone (v1 relay machinery). |
| **verb** | The element's gesture: drag-the-sun, tap, hold, steer, swipe. |
| **sun-held** | Drip's and Gust's legs: the sun takes no input and stays where it was at the TAG. |
| **life meter** | Chill, Flame, Size, Lift: 0 in daylight ends the run. Sprout's Sap is not a life meter. |
| **object** | A trial object (§3): wall, crossing, plot, puddle, stone, rain cloud, fog bank. |
| **contact edge** | Where the walker first touches an object: walls `o.y − wallDepth/2`, crossings `o.y − r`, circles `o.y − r − touch`. Every "ahead", "near", "range" and every countdown is measured to it. |
| **target** | An object the walking element's verb may act on now (§1.4). |

---

## 1. The run frame

### 1.1 Legs and the walker

- A Trial is a list of legs. `TrialDef.cast[0]` walks first; `TrialDef.relays[i] = { minute, to }`
  hands over to `to` at `tagTick(t, i) = 6 · round(tickAtMinute(minute) / 6)` (v1, unchanged).
- There is always exactly one walker. Its y is the schedule's (`worldYAtDayTick`) as always; its x is
  `trailX(y) + s.el.dx`, where `dx` is 0 except while Drip steers (§3.7).
- Every Trial ends by 5:00 PM (minute 660). Night never comes.
- **Leg lengths:** the opening leg (Nubs) ≥ 6.5 s, so Nubs plays ≥ 3.5 s before the first telegraph;
  every element leg ≥ 6.5 s; a closing Nubs leg ≥ 4 s (G0).

### 1.2 Meters, health, safe and failure (every element)

- Each element's meter lives in `nb.chill`, 0..100 (`maxChill` 100), clamped every tick.
- **At its leg's start** the meter is the element's start value (`TUNING.elements.start`, or the
  Trial's `tune.legStart` for that leg, §7.3). Meters do not carry between legs.
- **Rate**: each element's continuous rate (per second) is §2's formula; `nb.rate` holds it and the
  meter changes by `rate · DT` per tick, plus instant changes from verbs and contacts (§2, §3.3).
- **Gauge health** `heroHealth(nb) = 100 · chill / maxChill` (what the gauge and the meter pill show).
- **Steady health** `elHealth(s) = 100 · min(maxChill, chill + el.spent) / maxChill`, where
  `el.spent` is the meter Ember's taps and Gust's swipes paid this leg, less what Ember took back by
  walking through its own fire (§2.2). Spending is how those two play, so it never costs a star or
  sets off a low warning; only damage, fading and drains do. For Nubs and Drip `spent` is 0.
- **Safe** (`nb.safe`): Nubs `c === 0` (today's strict shade); Ember, Drip, Gust `rate ≥ 0`;
  Sprout: true unless an unbridged crossing within `range` has `growLeft < 0` (a bridge that will not
  be ready). It drives the clean TAG, the hot ring and the heartbeat.
- **Failure**: a life meter (Nubs, Ember, Drip, Gust) at 0 in daylight, or a fall into an unbridged
  crossing (§3.3). Sprout's Sap at 0 only stops it pouring. Taps and swipes cannot kill: they are
  refused unless the meter is greater than their cost.
- **Steady star**: `stats.minChill` holds the lowest steady health any life meter reached (it starts
  at 100). Sprout's Sap never counts.
- `lowChill` fires when a life meter's steady health crosses below `lowHealth` (25). Sap never
  drives `lowChill`, the low banner, the hot ring or the heartbeat.

### 1.3 The input model: one verb per element

Each element owns the pointer for its leg. The rule that keeps Nubs' drag intact: **a press that
starts on a target is held back from the sun until it is told apart; a tap or a hold never touches
the sun, a drag always does. A steer or a swipe is a drag, so Drip's and Gust's legs hold the sun.**

| Walker | Verb (`HEROES[h].verb`) | Pointer | Keys | Sun | Swipe down / coin |
|---|---|---|---|---|---|
| Nubs | `sun` | drag turns the sun (today) | ← → / A D turn (Shift fine) | turns | Cold Snap (today) |
| Ember | `burn` | a press on a target released ≤ 300 ms and < 12 px is a **tap** (burns it); every press that moves, lasts longer, or starts off a target turns the sun | ↑ / W burns the next target; ← → turn | turns | none |
| Sprout | `grow` | a press on a site still (< 12 px) for 220 ms is a **hold** (grows it until lifted); a second finger turns the sun meanwhile; a short still press on a site does nothing; every press that moves, or starts off a site, turns the sun | hold ↑ / W grows the next site; ← → turn | turns | none |
| Drip | `steer` | every drag slides Drip sideways, exactly with the finger | ← → / A D steer (Shift fine) | **held** | none |
| Gust | `blow` | a **swipe** (≥ 24 px sideways within 300 ms, `|dx| ≥ 1.5·|dy|`) blows one gust that way (8 Lift) | ← → / A D: one gust per press (8 Lift) | **held** | none |

- **Pause** is a DOM button over the canvas: its presses never reach the game input (unchanged).
- **The HUD coin** is the Cold Snap's and shows only while Nubs walks; `meterHit` is false otherwise,
  so the coin's area is plain world for the other verbs.
- **Edge zones** (20 px left/right, the bottom safe inset + 16 px) still ignore presses.
- The **wheel** turns the sun in `sun`, `burn` and `grow` legs (today's rule), steers in `steer` legs
  (6 u per notch, 0.15 u per pixel, at most 18 u per event) and does nothing in `blow` legs.
- **Space, Enter, Escape, P** stay the UI's. Up/W is new and is the act key of `burn` and `grow`.
- Keyboard play can turn and act at once; it is supported, never the model the gates prove (§6.3).

### 1.4 Coordinates and targeting

- A tap or hold point is the **ground point** under the finger on the last drawn frame:
  `x = (sx − ox) / S`, `y = (oy − sy) / S` (camera.ts mapping, shake included), quantized to 1/8 u
  by `input.ts` before it enters the `InputFrame`. Zoom pulses (`fx.ts`) are off while a non-Nubs
  element walks, so the mapping is the plain camera's.
- **Window:** an object is in reach of a verb only while its contact edge is at least `near` (12 u)
  and at most `range` (**340 u**) ahead of the walker. 340 u is the unobstructed minimum: the
  shortest view (600 u tall, `nubsFrac` 0.68) shows 408 u ahead, and the HUD band (`safe.top` + 64
  CSS px) hides at most 64 u of it (k 1 at 600 CSS px tall; 53 u at 1280×720, 48 u at 1280×800).
- **Eligibility:** not veiled by fog (§3.6), not gone, and:
  - Ember: an intact bramble, gate or ice wall anywhere in the window (also past the next Tag
    Stone), or a puddle on Ember's own path (`|o.x − trailX(o.y)| ≤ puddleR + touch`, 18 u) that
    Ember reaches before the next TAG. **Plots are never targets**: fire reaches them only by
    spreading (§3.4).
  - Sprout: an unbridged crossing, or a plot without a standing tree.
- **Pointer verbs** act on the eligible object whose footprint is within `reach` (32 u) of the point
  (walls and crossings: the distance to their rectangle, `trailX(o.y) ± wallHalf` by the contact
  depth; circles: centre distance minus `r`). Walls win over puddles, crossings over plots; then the
  nearest footprint; ties go to the lower object index.
- **Key verbs** act on the nearest eligible object ahead in the window, with the same priorities.
- A press that does not start on a target is a plain sun press (§7.9). There is no "nothing to burn"
  feedback: the only refusal is `fizz 'low'` (the meter cannot afford the cost).

---

## 2. The elements

### 2.1 Nubs (Ice): the base

- **Reads:** "Stay in the shade."
- **Meter:** Chill, starts 100. **Rate:** `−D·f + R·max(0, 1 − f)` with `f = c/5`, `D` the trial's
  drain (`effectiveDrain`), `R = 30`: the v1 trial path, unchanged.
- **Verb:** drag turns the sun; Cold Snap on swipe down, Down/S or the coin, one charge at the start,
  `+0.05` charge per second while `c === 0`, refused within `tagSoonTicks` (180) of a TAG and on
  every other element's leg. The charge carries across legs.
- **Objects:** rain clouds are shade (friendly; `stats.cloudRide` counts his ticks inside a rain
  footprint); a wall costs 30 Chill (bump); an unbridged **gap** is a fall; he bobs across an
  unbridged **stream** like an ice cube; puddles, stones and fog do nothing to him; flakes and
  crystals cool him as today.
- **Fails:** Chill 0 in daylight (today's death lines), a gap (§10.4), a wall that took the last Chill.
- **Reads on screen:** today's teal dial, frost-white gauge and Cold Snap coin.

### 2.2 Ember (Fire): BURN

- **Reads:** "Burn a way through."
- **Factor:** Flame 0..100, starts 80. Light refuels it, burning spends it, water douses it.
- **Rate (per s):** `refill·fs − fade·(1 − fs) − douse·[in a puddle] − rain·[under rain]`, with
  `fs = min(c, 5) / 5`, `refill 10`, `fade 4`, `douse 45`, `rain 25`. Glare counts as full light.
  Safe (`rate ≥ 0`) is `c ≥ 2` and dry.
- **Verb: TAP** a target ahead (§1.4).
  - The cost is paid at once and recorded on the object (`o.paid`) and in `el.spent`: bramble 12,
    gate 22, ice 18, puddle 8. A tap is refused (`fizz`, reason `'low'`) unless Flame is **greater**
    than the cost.
  - The object then burns for its time: bramble 54 ticks, gate 84, ice 60 (melting), puddle 30
    (drying). At the end a bramble or gate is gone, ice becomes a puddle where it stood, a puddle is
    gone (§3.4).
  - **Ember feeds on its own fire.** When Ember walks into a bramble or gate that is still burning
    from its own tap, it passes, takes `o.paid` back (`el.spent −= o.paid`), and the wall is gone
    (`{ e: 'feed' }`). So a wall tapped **just in time** costs nothing, one tapped on sight burns out
    first and costs its price, and one not tapped costs a 30 bump. Melting ice is still ice and
    bumps; ice must finish melting before contact.
  - **The windows** (`burnLeft`, `burnSweet`, §7.7): on Ember's own bramble or gate the sweet window
    opens when its contact edge is `burnTicks · 70/60` u ahead (63 u bramble, 98 u gate) and closes at
    `near` (a 0.73 s and a 1.23 s window); after that it is too late. On ice and on any wall another
    element will reach, the tap must come at least `burnTicks` before that walker's contact (the fire
    must be out); "tap now" is the last `nowTicks` (30) before that deadline.
  - **Key ↑/W** burns the nearest target ahead (walls first).
  - The drag still turns the sun: keeping Ember lit is how it refuels.
- **Objects:** see §3.3. Walls bump it (−30) unless burning; a hot stone is a snack (+12, once);
  puddles and rain douse it; an unbridged stream puts it out (fail); an unbridged gap is a fall.
- **Fails:** Flame 0 (snuffed, doused or crashed), a stream, a gap.
- **Reads on screen:**
  - the dial's go arcs in amber `#FF8A1F` with ray ticks every 6° (v1's Ember pattern, kept) where
    `c ≥ 2`: "turn the sun here to refuel";
  - the gauge: Flame, orange `#FF7A1A`, amber `#FFB347` below 60, ash `#8C8C8C` below 25; a Flame
    pill in the coin slot (flame glyph and the number);
  - **telegraphs** (§7.10): each target in the window wears a dashed ring. While Ember walks, a
    hatched **sweet band** lies across the trail from `near` to the bramble/gate band edge ahead of
    Ember; an own bramble or gate in it pulses solid ("tap now"); once inside `near` it turns red
    with a cross. Ice and walls past the Tag Stone pulse solid in their last 30 ticks and turn red
    with a cross once `burnLeft < 0`. Burning walls show flames and a shrinking arc; Ember's own
    burning walls glow (it will take the flame back). A puddle on Ember's path wears a blue douse
    chevron.

### 2.3 Drip (Water): STEER

- **Reads:** "Steer for shade and puddles."
- **Factor:** Size 0..100, starts 70. Shade and puddles grow him; sun and hot stones shrink him.
- **Rate (per s):** `grow·max(0, 1 − c/5) − evap·c/5 + rain·[under rain]`, `grow 6`, `evap 14`,
  `rain 10`. Glare doubles evaporation (c runs to 10). Safe is `rate ≥ 0`.
- **Verb: STEER.** Drag sideways: Drip follows the finger exactly (`steer` = finger dx in world u at
  the last drawn frame's scale, ignoring the invert setting). The steer moves a target offset
  `dxTarget`, clamped to ±`range` (32 u); Drip slides toward it at 220 u/s and is clamped to the lane
  each tick (§3.7). Keys steer at 90 u/s (Shift: 45 u/s); `key > 0` (Left) moves west
  (`dxTarget −=`).
- **The sun holds** for the whole leg (`s.sun.locked`): set it before the TAG so the shadows fall
  where Drip can reach them. The telegraph shows where (§4.4).
- **Objects:** a puddle is drunk on touch (+30, gone); a hot stone stings (−20, once); a stream swum
  across unbridged is a treat (+25); rain grows him; a wall costs 30 (bump); a gap is a fall; fog
  does nothing.
- **Fails:** Size 0 ("dried up" or "sizzled away"), a gap.
- **Reads on screen:** the halo's padlock (the existing `lock` art) and no go arcs; the gauge is Size
  in blue `#3FAEF7`, amber below 60, red `#FF5D3D` below 25; a Size pill; Drip's sprite scales
  `0.85 + 0.25·size/100` (contacts use the fixed radius, so the drawing stays honest); the path is
  drawn widened to ±38 u over Drip's stretch; while dragging, a small ghost dot marks `dxTarget`.

### 2.4 Sprout (Nature): GROW

- **Reads:** "Grow the way ahead."
- **Factor:** Sap 0..100, starts 80. Growing spends it; it seeps back from the roots and faster in
  rain. Not a life meter.
- **Rate (per s):** `root + rain·[under rain] − invest·[pouring into a site]`, `root 5`, `rain 15`,
  `invest 50`. Light does nothing to Sap.
- **Verb: HOLD** on a site ahead (§1.4): a **crossing** (gap or stream) not yet bridged, or a
  **plot** (a soil patch beside the trail) without a standing tree.
  - While held, Sap pours into the site at 50/s (never more than Sap holds, never past the site's
    maximum: a crossing's `need = 2·r`; a plot's `treeMax` 60).
  - **Longer hold = bigger plant.** The site's `size` is the Sap poured in.
  - **Plants take time:** a site's `grown` rises toward `size` at `grow 12`/s, ×2 while its centre is
    lit **or wet**, and ×1.5 more while wet (rain: ×3 in all), checked every 6 ticks. Growing
    continues after the hold, after the leg and whoever walks.
  - A **vine bridge** is complete when `grown ≥ need`. A **tree** stands once `grown ≥ size`,
    `size ≥ treeMin` (20) and the hold has let go: it becomes a runtime caster (§3.5), shade for
    everyone. A plot under 20 stays a sapling (no shade) until held again.
  - A hold ends when lifted, at a TAG, or when the site comes within `near` of Sprout. A new hold
    replaces the old one.
  - The drag still turns the sun: light on a growing site doubles its growth.
- **Objects:** walls bump Sap (−30, no failure); an unbridged gap or stream is the end (Sprout falls,
  or is swept away); rain feeds Sap; puddles, stones and fog do nothing to Sprout itself (fog veils
  its sites, §3.6).
- **Fails:** only crossings.
- **Reads on screen:**
  - the dial's go arcs in lime `#8BD650` with leaf dashes (v1's Sprout pattern, kept) where the
    **focus site** is lit: the held site, else the nearest growing site ahead, else the next unbridged
    crossing in the window; no focus, no arcs;
  - the gauge: Sap in green `#6CC04A` (no danger colours: Sap is not life); a Sap pill;
  - while holding: a glowing line from Sprout to the site and a ring around the site filling to its
    `need`; a growth bar under every growing site; drops on wet sites;
  - each crossing ahead: green check once bridged; red chevrons and "!" once `growLeft < 0`.

### 2.5 Gust (Air): BLOW

- **Reads:** "Blow the weather away."
- **Factor:** Lift 0..100, starts 80. Every swipe spends it; clear air restores it; rain soaks it;
  fog saps it.
- **Rate (per s):** `air·[dry and out of fog] − soak·[under rain] − fog·[in fog]`, `air 4`,
  `soak 30`, `fog 10`. Safe is dry and out of fog. Gust has no tie to the sun.
- **Verb: SWIPE.** Each swipe costs `swipe` (8) Lift (paid at once, into `el.spent`; refused with
  `fizz 'low'` unless Lift > 8) and adds `±kick` (30 u/s) to the wind (`s.el.wind`, + east), half
  inside fog (`fogMuffle` 0.5); the wind is clamped to ±45 and decays every tick by `keep` 0.98895 (a
  1.5 s time constant). One early swipe moves a rain cloud about 45 u and a fog bank about 27 u. Wind
  is **global**: it pushes every awake weather object, so clearing one cloud can blow another onto
  the trail, and every Gust leg has weather waiting on both sides that a one-way wind brings on.
  Spamming grounds Gust (2 swipes a second spends 16 Lift a second).
- **The sun holds** for the whole leg; it only matters to the element after Gust.
- **Objects:** Gust floats over walls, gaps, streams, puddles and stones; rain and fog are its world.
- **Fails:** Lift 0 ("soaked" or "lost in the fog").
- **Reads on screen:** the halo's padlock; the gauge is Lift in sky white `#F4F1FB` with a lilac rim
  `#A99CC6`, amber below 60, red below 25; a Lift pill; a **wind chip** under the HUD's top row (an
  arrow per 15 u/s of `windAt`, the breeze's share dimmed); arrival ghosts and edge markers on all
  awake weather (§3.6).

### 2.6 `TUNING.elements` (src/config/tuning.ts; replaces v1's `heroes` block)

```ts
  /**
   * Elementals v2 (docs/ELEMENTALS_V2.md §2-§4): the elements' factors, verbs and objects. Read only on
   * Trials (s.el !== null). Rates are per second; the sim applies rate · DT per tick.
   */
  elements: {
    /** Each element's meter (0..100) when its leg begins (a Trial's tune.legStart may override per leg). */
    start: { nubs: 100, ember: 80, sprout: 80, drip: 70, gust: 80 },
    /** A TAG's telegraph (ticks; no Cold Snap inside it), the incoming meter's no-fall grace and the clean-TAG window. */
    tagSoonTicks: 180,
    tagGraceTicks: 30,
    tagCleanTicks: 30,
    /** Steady health below which lowChill fires. */
    lowHealth: 25,
    /** Verbs act on objects whose contact edge is `near`..`range` u ahead, footprint within `reach` u of the point. */
    near: 12,
    range: 340,
    reach: 32,
    /** Meter a walker loses walking into a wall. */
    bump: 30,
    nubs: { income: 0.05 },
    ember: {
      refill: 10, fade: 4, douse: 45, rain: 25, stone: 12, nowTicks: 30,
      cost: { bramble: 12, gate: 22, ice: 18, puddle: 8 },
      burnTicks: { bramble: 54, gate: 84, ice: 60, puddle: 30, plot: 90 },
    },
    sprout: { root: 5, rain: 15, invest: 50, grow: 12, litMul: 2, rainMul: 1.5, treeMin: 20, treeMax: 60 },
    drip: { grow: 6, evap: 14, rain: 10, puddle: 30, stone: 20, stream: 25, range: 32, clear: 8, slide: 220, keyRate: 90, keyFine: 45 },
    gust: { air: 4, soak: 30, fog: 10, swipe: 8, kick: 30, fogMuffle: 0.5, windMax: 45, keep: 0.98895, rainGain: 1, fogGain: 0.6 },
    /** Weather drifts once the walker is within `wake` u of its y; it is gone `prune` u off the trail or `behind` u behind the walker. */
    weather: { wake: 400, prune: 420, behind: 300, ryRatio: 0.66 },
    /** Fire spreads (once, at half its burn) to burnables within reach/reachY when |windAt| ≥ spreadAt, downwind (or within `upwind` u upwind). */
    fire: { spreadAt: 15, reach: 64, reachY: 48, upwind: 8 },
    /** Object geometry (u): wall/crossing half-width and wall depth, radii, contact slack, authoring clearance, crossing radius bounds. */
    objects: { wallHalf: 38, wallDepth: 8, puddleR: 14, stoneR: 9, plotR: 16, touch: 4, clearance: 6, crossMin: 12, crossMax: 18 },
    /** The pre-TAG mask for an incoming Drip leg (§4.4): seconds sampled, tick step, lane offsets, mark thresholds. */
    tagMask: { secs: 6, step: 12, lanes: [-20, 0, 20], min: 0.5, rel: 0.8 },
  },
```

`keep` is e^(−1/90) to five places, written as a literal (no `Math.exp` in core).

### 2.7 Rates at a glance (per second; `tests/unit/elements.test.ts` pins this table)

| c | Nubs D 28 | Ember | Drip | Sprout (not pouring) | Gust (dry, no fog) |
|---|---|---|---|---|---|
| 0 | +30 | −4 | +6 | +5 | +4 |
| 1 | +18.4 | −1.2 | +2 | +5 | +4 |
| 2 | +6.8 | +1.6 | −2 | +5 | +4 |
| 3 | −4.8 | +4.4 | −6 | +5 | +4 |
| 4 | −16.4 | +7.2 | −10 | +5 | +4 |
| 5 | −28 | +10 | −14 | +5 | +4 |
| 10 | −56 | +10 | −28 | +5 | +4 |
| extra | | puddle −45, rain −25; tap −cost, feed +paid | rain +10 | rain +15, pouring −50 | rain −30, fog −10 (no `air` in either); swipe −8 |

---

## 3. World objects

### 3.1 Kinds, footprints and ids

Trial objects are **runtime trial objects** in `s.el.objs`, made at run creation from
`TrialDef.objects`. They are never part of `WorldConfig`, the generator or the validator, and Nubs
worlds never contain them.

| Kind | Where | Footprint | Burnable | Notes |
|---|---|---|---|---|
| `bramble`, `gate`, `ice` (walls) | across the trail (dx 0) | `trailX ± wallHalf` (38 u, Drip's widened path) × `wallDepth` 8 u | bramble, gate (and ice melts) | contact by y only |
| `gap`, `stream` (crossings) | across the trail | `trailX ± wallHalf` × `2·r` u along y (r 12-18) | no | a vine bridge grows on it |
| `plot` | beside the trail (`|dx|` ≈ 44) | circle `plotR` 16 | by spreading fire only, when planted | a tree grows on it |
| `puddle` | anywhere | circle `puddleR` 14 | dries | made also by melting ice |
| `stone` (hot stone) | anywhere | circle `stoneR` 9 | no | spent by the first touch |
| `rain` (rain cloud) | drifting | ellipse rx = r, ry = 0.66 r, at ground level | no | a z-0 shade proxy (§3.6) |
| `fog` (fog bank) | drifting | ellipse rx = r, ry = 0.66 r | no | no shade; blinds (§3.6) |

- **Ids:** object *i* (index after sorting by y, ties by list order) is `EL_ID_BASE + i` with
  `EL_ID_BASE = 0x50000000` (the slot `SEED_ID_BASE` held); a rain cloud's shade proxy uses its
  object's id; a plot's tree caster is `TREE_ID_BASE + i` with `TREE_ID_BASE = 0x58000000`. Both live
  in `core/objects.ts`, above `RUNTIME_ID_BASE` (the validator ignores them) and below
  `SNAP_ID_BASE`, so the code that treats ids ≥ `SNAP_ID_BASE` as the snap cloud (`gatherScene`'s
  `cloudsBelow`, `guide.ts`'s `litMask` count, `bots/dares.ts`) never mistakes them.
- **Positions:** object y is `worldYAtTick(w, tickAtMinute(m))` for its authored minute `m`; x is
  `trailX(y) + dx`. Weather x then moves (§3.6); nothing else ever moves.

### 3.2 Placement: the trial pass

`createEl(s)` runs once in `createRun` for a Trial, after the world is generated through
`finishY + hardAhead` (§7.8), so step() never generates during a Trial:
1. Build `s.el.objs` from `TrialDef.objects`, sorted by y (stable), with the fields of §7.4 at their
   defaults (`state 0`, `size 0`, `grown 0`, `paid 0`, `casterId −1`, `hit false`, `awake false`).
2. Insert one shade proxy cloud per `rain` object (§3.6).

Generated casters are **never removed**: G0 rejects a pinned seed where an authored plot, puddle or
stone circle comes within `clearance` (6 u) of a generated caster's prism part (the ground-standing
parts), and calibration resolves it with that object's `dx` (±8 u) or the salt (§6.5). Walls and
crossings span the trail, where the generator never puts a footprint. `removeCaster` (new in
`gen/store.ts`: splice from the caster list, `byId.delete`) is used only for runtime trees burned by
fire (ids ≥ `TREE_ID_BASE`). The pass is deterministic: a pure function of the TrialDef and the world.

### 3.3 Contact table (what touching an object does to each walker)

Contacts are tested every daylight tick on objects within 64 u of the walker's y, after the meter's
rate (§7.8). "Touch" for circles is `distance(walker centre, object centre) ≤ r + touch` (4 u); for
ellipses, the walker's centre inside the ellipse; walls and crossings once `y ≥` their contact edge.

| Object | Nubs | Ember | Drip | Sprout | Gust |
|---|---|---|---|---|---|
| wall, intact | −30, wall smashed | −30, smashed | −30, smashed | −30 Sap, smashed | floats over |
| bramble/gate burning from Ember's tap (`paid > 0`) | −30, smashed | **feeds**: +`paid`, wall gone | −30, smashed | −30 Sap | floats |
| bramble/gate burning from spread (`paid 0`) | −30, smashed | passes, wall gone | −30, smashed | −30 Sap | floats |
| ice, melting | −30, shattered (no puddle) | −30, shattered | −30, shattered | −30 Sap | floats |
| gap, unbridged | **falls** | **falls** | **falls** | **falls** | floats |
| stream, unbridged | bobs across | **put out** | swims: +25 | **swept away** | floats |
| crossing, bridged | crosses | crosses | crosses | crosses | floats |
| puddle | nothing | −45/s inside | drinks: +30, puddle gone | nothing | floats |
| stone | spent | +12, spent | −20, spent | spent | floats |
| rain | shade; `cloudRide` ticks | −25/s (and shade) | +10/s (and shade) | +15 Sap/s (and shade) | −30/s, no `air` |
| fog | nothing | nothing (its targets are veiled) | nothing | nothing (its sites are veiled) | −10/s, no `air`, kicks halved |

- A crossing failure (gap: every walker but Gust; stream: Ember and Sprout) sets `el.fell`, fires
  `fall` and ends the run on that tick.
- A wall or crossing acts once (`hit`), a stone once (`hit`, any walker), a puddle once for Drip.
- A smashed wall counts in `stats.bumps`; a drink in `stats.drinks`; a feed in `stats.burns` (§3.4).
- When an instant change takes a life meter to 0, that object is the death line's cause (§10.4).

### 3.4 Fire (Ember's burns, and how they spread)

- A burning object has `state 1` and `t` ticks left; it counts down every tick.
- **Spread:** on the tick `t` reaches `floor(burnTicks / 2)`, if `|windAt(s)| ≥ spreadAt` (15 u/s), a
  burning bramble, gate or plot sets alight every intact burnable (bramble, gate, planted plot) with
  `|o.y − src.y| ≤ reachY` (48 u), `|o.x − src.x| ≤ reach` (64 u) and
  `(o.x − src.x) · sign(windAt) ≥ −upwind` (8 u): downwind, or level with it. Spread fires cost
  nothing (`paid 0`) and use the object's own burn time.
- **Doused:** a burning (or melting, or drying) object whose centre is inside a rain footprint goes
  out: `state 0`, `t 0`, `paid 0` (the cost is lost; `el.spent` keeps it), `{ e: 'doused' }`. Taps on
  an object under rain are allowed and are doused on the next tick: wait for the shower to pass.
- **Burn-out** (`t` reaches 0): bramble or gate → `state 2` (gone); ice → kind `puddle`,
  `r = puddleR`, `state 0`, `paid 0`; puddle → gone; plot → gone, and its tree caster (if any) is
  removed (`removeCaster`). `{ e: 'burnOut' }`.
- `stats.burns` counts every bramble, gate or plot cleared by fire (burn-out or feed) and every ice
  wall melted.
- Vine bridges never burn; stones, crossings and weather never burn.

### 3.5 Plants (Sprout's sites)

- A crossing holds its bridge (`size`, `grown`, `need = 2·r`); a plot holds its sapling or tree
  (`size`, `grown`, `casterId`).
- Each tick, every site with `grown < size` grows by
  `grow · DT · (lit || wet ? litMul : 1) · (wet ? rainMul : 1)`, capped at `size`. `lit` and `wet`
  (bits of `o.light`) are refreshed on guide ticks (`tickAbs % 6 === 0`): `lit` is
  `pointLit(s, o.x, o.y)` (the site centre not shaded by any caster or cloud, sun up), `wet` is its
  centre inside a rain footprint. **Rain beats sun:** a wet site grows ×3, a lit one ×2, a shaded dry
  one ×1 (a rain cloud's own shade never slows the site it waters).
- A crossing's bridge completes on the tick `grown ≥ need`: `{ e: 'grown', tree: false }`.
- A plot becomes a tree on the tick `grown ≥ size`, `size ≥ treeMin`, `casterId < 0` and
  `s.el.hold` is not this plot: `insertCaster` of `makeCaster({ id: TREE_ID_BASE + i, kind: 'tree',
  name: "Sprout's Tree", parts: buildParts('tree', x, y, 0, 0, 0.5 + size / 100), side: sign(dx),
  rescue: false, gate: false, ballId: −1, … })`, `stats.trees++`, `{ e: 'grown', tree: true }`. It is a
  real caster: it shades, the guide and the death lines see it, fire removes it.
- `stats.grove` (set in `win`) counts plots whose tree still stands at the finish.

### 3.6 Weather, wind and fog

- **Wind:** `windAt(s) = s.el.wind + trial.breeze`. `s.el.wind` changes only by swipes and decays
  every tick (`wind *= keep`, then 0 once `|wind| < 0.01`). The breeze is the Trial's constant.
- **Waking:** a weather object starts moving once `walker.y ≥ o.y − wake` (400 u, 5.71 s); objects
  already within it at go are awake from go. Before that it waits at its authored x. Authors place
  weather so that, left alone, it arrives where its table row says (§5).
- **Drift:** an awake object moves `x += (o.drift + gain · windAt(s)) · DT` per tick, `gain` 1 for
  rain and 0.6 for fog. Weather only moves in x, so `objs` stays y-sorted.
- **Gone:** once `|x − trailX(o.y)| > prune` (420 u) or the walker is `behind` (300 u) past it:
  `state 2` and its proxy cloud is removed from `w.clouds`.
- **Rain shade proxy:** each rain object owns a mutable `Cloud` in `w.clouds` (the v1.6 `MutableCloud`
  precedent): `{ id, kind: 'rain', t0: tAbs at creation, life: 1e6, x0: o.x, y0: o.y, vx: 0, vy: 0,
  rx: o.r, ry: 0.66·o.r, z: 0, lumps: cloudLumps(seed, id, rx, ry) }`. The sim writes `x0 = o.x` every
  tick. At z 0 its shade lies right under it, whatever θ: **its rain and its shade fall in the same
  place.** `CloudKind` gains `'rain'`. `render/clouds.ts` `drawClouds` skips kind `'rain'` (ART draws
  the rain body; `shadowLayer` keeps the proxy's shadow).
- **Fog blinds.** Fog has no proxy and shades nothing. An object is **veiled** (`veiled(s, o)`) while
  its centre lies inside an awake fog bank's ellipse, or while a fog bank covers the trail at its own
  row (`|f.x − trailX(f.y)| < f.r`), the walker has not left its far edge (`walker.y < f.y + ry`)
  and the object lies at or beyond its near edge (`o.y ≥ f.y − ry`). Veiled objects cannot be
  tapped, held or keyed; a hold already running continues. Clearing fog is how Gust sets up the next
  element (T6, T7).
- `weatherXAt(s, o, ticks)` predicts x after `ticks` with no new swipe, looping tick by tick (at most
  600 iterations; no `pow`).
- **Arrival ghosts and edge markers** (ART): every awake weather object ahead carries a dashed ghost
  where it will be when the walker reaches its y (`weatherXAt(s, o, arriveTicks(s, o.y))`), coloured
  by `weatherGood(s, o)` (§7.7): rain over the trail in a Nubs, Drip or Sprout stretch is **green**
  (it helps whoever walks there; a green ghost that misses the trail carries an arrow toward it: "push
  me here"), rain in an Ember or Gust stretch is **red** while its ghost covers the trail, fog is red
  while it covers the trail in an Ember, Sprout or Gust stretch, anything else is white. Awake weather
  whose footprint is above the unobstructed view (under the HUD band or off-screen) shows an **edge
  marker** at the top of the play area at its x: a chevron in its ghost's colour with its drift arrow.

### 3.7 Drip's lane

- During a Drip leg the lane `[lo, hi]` at the walker's y starts at `[−range, +range]` (±32 u); for
  every **prism part** (the ground-standing parts; slabs and canopy discs float, Drip passes under
  them) whose bounds span `y ± 8`, with its bounds `x0..x1` relative to `trailX(y)`: if `x0 > 0`,
  `hi = min(hi, x0 − clear)`; if `x1 < 0`, `lo = max(lo, x1 + clear)`; if `x0 ≤ 0 ≤ x1` (a part on
  the centreline cannot exist: the generator keeps footprints ≥ 20 u from it) nothing. Pillars of a
  straddling gate arch are separate prism parts, so each counts. `clear` 8 u. The lane is never
  narrower than ±12 u (G0).
- Each tick `dx` moves toward `dxTarget` by at most `slide · DT` and is then clamped to the lane:
  trunks push Drip aside, and once they pass Drip returns to where the finger holds it
  (`dxTarget` is never clamped to the lane, only to ±`range`).
- On any other walker's leg `dxTarget = 0` and `dx` slides back at the same rate (0.15 s at most).

---

## 4. Hand-offs and interactions

### 4.1 The TAG (v1 machinery, v2 rules)

- **Telegraph** (`tagSoonTicks` = 180 ticks before): `{ e: 'tagSoon', to, ticks }`; the NEXT chip
  ("NEXT ▸ DRIP 3"); a Tag Stone decal at `relayY(s, i)`; the Cold Snap is refused (`tagLocked`).
  `guide.tag` holds where to aim the sun for the incoming element, drawn dashed outside the ring:
  - incoming Nubs: strict shade at the walker;
  - incoming Ember: `lit ≥ 2` at the walker (refuel);
  - incoming Sprout: the bins that light its leg's first unbridged crossing (else its first plot) in
    the window, at the current time;
  - incoming Drip: the leg-aggregate lane mask (§4.4), with the padlock badge "SUN HOLDS";
  - incoming Gust: no arcs (Gust ignores the sun); the chip still shows "SUN HOLDS".
- **At `tagTick`** (`updateRelay`, after `syncTime`): the walker's hero becomes `to`; its meter becomes
  its leg's start; `el.spent = 0`; `s.el.hold = −1`; `dxTarget = 0` unless `to` is Drip;
  `tagGrace = 30`, `tagWatch = 30`; `relayIdx++`, `stats.tags++`; `{ e: 'tag', from, to, index }`.
- **The sun:** from the first tick after the TAG (`updateSun` runs before `updateRelay`),
  `s.sun.locked` is `HEROES[to].sunHeld` (Drip, Gust). Locking stops a coasting sun dead (the `lock`
  concept's code path). Unlocking leaves θ where it was. `sfxRouter` plays no `lock` cue while
  `s.el !== null` (the TAG's own cue covers the hand-off).
- **The press:** on every `tag` event the session calls `input.cut(all)`. It always ends the verb
  slot (§7.9): a held-back press is dropped and an active hold sends `VERB_RELEASE` (the sim has
  already ended it). With `all` true, which the session passes only when the outgoing or incoming
  verb is `steer` or `blow`, the sun press ends too (released at 0 °/s). So a sun drag carries across
  a TAG between `sun`, `burn` and `grow` (it stays a sun press and can never turn into a tap or
  hold).
- **After the TAG:** for 30 ticks the incoming meter's continuous rate cannot be negative (instant
  contacts still apply). When the incoming element is Nubs, Ember or Drip, the TAG is **clean** if the
  walker is safe on any of those ticks (`stats.cleanTags++`, `{ e: 'tagClean' }`, the "CLEAN!" pop).
  Sprout and Gust TAGs are never clean (it would come free).

### 4.2 What carries over a TAG

| Carries | Does not carry |
|---|---|
| θ, exactly (a held leg starts where you left it) | the meter (each leg starts at its own start) |
| every world change: burnt and melted walls, puddles, dried puddles, bridges, saplings, trees, spent stones, weather positions | Drip's offset (slides back to 0) |
| the wind (decaying as always) and fires still burning | a hold (ends at the TAG) and `el.spent` |
| the Cold Snap charge, Snow, stats | the verb slot (dropped at every TAG); the sun press on a steer/blow TAG |

Cross-leg play is the point of a relay: Ember can burn or melt walls within its window past the next
Tag Stone (never puddles: those belong to whoever walks there); Sprout can plant on sites in the
next leg; Gust's late swipes clear fog off the next element's path and push rain onto it, and the
wind keeps pushing after the hand-off.

### 4.3 Interactions (exact rules; each is one line of §3)

| # | Interaction | Rule |
|---|---|---|
| I1 | Fire melts ice | A tapped ice wall melts for 60 ticks and becomes a puddle (r 14) at its centre (§3.4). |
| I2 | Fire dries puddles | Ember can dry a puddle on its own path before the next TAG: 30 ticks, then gone (§1.4, §3.4). |
| I3 | Water douses fire | Ember loses 45/s in a puddle and 25/s under rain; rain puts out any burning, melting or drying object under it (§3.3, §3.4). |
| I4 | Water grows Drip | Puddles +30 (drunk), rain +10/s, an unbridged stream +25 (§3.3). |
| I5 | Fire burns plants | Spreading fire burns a planted plot (90 ticks): the sapling or tree is gone. Plots are never tapped; bridges never burn (§3.4). |
| I6 | Wind spreads fire | With `|windAt| ≥ 15`, a burning bramble, gate or plot ignites burnables within 64 × 48 u downwind at half its burn (§3.4). |
| I7 | Wind pushes weather | Swipes and the breeze move every awake rain cloud and fog bank (§3.6). |
| I8 | Clouds are shade | A rain cloud is a z-0 shade proxy: shade for every walker (Nubs' `cloudRide`, no refuel for Ember, growth for Drip) (§3.6). |
| I9 | Rain waters plants | A wet site grows ×3 (wet counts as lit, ×1.5 more), and rain feeds Sprout +15 Sap/s (§2.4, §3.5). |
| I10 | Plants make shade | A grown tree is a real caster: shade for every walker after it stands (§3.5). |
| I11 | Stones | A hot stone feeds Ember (+12) and stings Drip (−20); one touch spends it (§3.3). |
| I12 | Fog blinds | Fog veils Ember's and Sprout's targets until it moves or is passed (§3.6). |

### 4.4 The sun before a held leg (Drip's mask)

Drip's leg is decided by the θ left at the TAG, so the arcs before it show a whole-leg answer, not
one point:
- **Samples:** the first `tagMask.secs` (6 s) of the Drip leg, every `step` (12) ticks: 30 time
  samples; at each, the lane points `trailX(y) + {−20, 0, +20}` at the walker's scheduled y for that
  tick: 90 points. Each point's 360-bin shade mask is `litMask` at that point with the sun at that
  tick, the current casters (trees included) and the rain proxies at their current x.
- **Score** per bin: the share of the 30 time samples at which at least one of the three lane points
  is shaded (`lit ≤ 1`). `guide.tag` marks bin b when `score[b] ≥ max(min, rel · best)` (0.5, 0.8).
- **When:** computed inside step(), one point per tick, starting 300 ticks before the TAG (inside the
  previous leg, which is ≥ 390 ticks), so it is complete 30 ticks before the telegraph opens, then
  refreshed cyclically (one point per tick) until the TAG so it follows trees and weather. Storage
  (`s.el.tagMask`, 90 × 360 bytes) is allocated by `createEl` on Trials with a Drip leg; the guide is
  derived state and is not hashed.
- **Proof:** G1 and G2 pass from **every** bin the mask marks at the TAG tick (§6.2, §6.4), so
  following the arcs is proven to be enough. humanEl aims at the mask during the telegraph (§6.3).

---

## 5. The seven Trials

### 5.0 Common rules

- **Ids** 1001-1007 (`TRIAL_BASE` 1000, `TRIAL_COUNT` 7). `levelDef(1001)` stays null; 1008 is no
  longer a trial (`isTrialId(1008)` false, `?trial=8` ignored). No id enters `CAMPAIGN_LEVELS`, the
  bake, `sim --campaign` or the Journey save.
- **World:** `createWorld` of the `LevelDef` built by `trialLevel(id)` (v1, unchanged: `feats: []`,
  `flares: []`, `introduces: null`, stars `{ flakes: 1e9, minChill: steady, sunSec: 1e9 }`), then the
  trial pass (§3.2). Every Trial is `forecast: 'clear'`, `concepts: []`: the trial's own objects and
  weather carry the level.
- **Run config:** `campaignConfig` adds, for trials, `mechanics: { buds: false, snap: true, deep: false,
  brittle: false }`, `v16: V16_NONE`, `startFrost: 1` (v1, unchanged).
- **Seed:** `hashString(`trial-${id}-${salt}`)`, salt pinned by `sim --trials --pick` (§6.5).
- **Stars** (`trialStars`, v1 scheme): Star 1 finish; Dare `trialDareValue(kind, stats) ≥ target`;
  Steady `stats.minChill ≥ steady` (steady health, life meters only); `two && three ? 3 : two ||
  three ? 2 : 1`.
- **Opening:** the Elementals pill opens once the first-run lesson is passed (`tutorialDone`); then
  T1-T4 (the intros) open together. T5 needs T1 and T2; T6 needs T3 and T4; T7 needs T5 and T6.
- **Roster unlocks:** Ember on passing T1, Drip T2, Sprout T3, Gust T4. Nubs is always unlocked.
- **Time:** Day 1, 14.4 minutes per second, 70 u/s; 1 minute ≈ 4.86 u of trail. `range` 340 u is
  70 minutes (4.86 s); `wake` 400 u is 82 minutes (5.71 s).
- **Authoring** (data in `TRIALS`, CORE): each object is `{ k, m, dx, r?, drift? }` (§7.3). Walls
  and crossings have `dx 0`. Weather `dx` is its offset **when it wakes** (or at go); the tables give
  the left-alone arrival `dx + effectiveDrift · min(5.71 s, seconds from go to m)` with
  `effectiveDrift = drift + gain·breeze`, which G0 recomputes.
- **Authoring rules** (all checked by G0): the intro element's first object is ≥ 2 s into its leg;
  crossings have r 12-18; each Sprout leg's first crossing reaches its contact edge ≥ `need/grow` +
  2.5 s after the TAG, and every crossing ≥ `need/grow` + 0.3 s after (the moment it is first
  holdable + 1 s); every cross-leg target (a wall past the TAG for Ember, a plot past the TAG for
  Sprout) spends ≥ 1.5 s in the window during the targeting leg; weather a Gust leg must move inside
  its own leg gives it ≥ 2 s between `max(wake, TAG)` and arrival, and hand-off weather (in the next
  stretch) wakes ≥ 4 s before the Gust leg ends.
- In the tables, "leg s" is the seconds into the leg at which the walker reaches the object's y.

### 5.1 T1 "Kindling": Ember's intro (Nubs ▸ Ember ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1001 / 7 (Summer Heat) / meadow |
| time | start 240 (10:00 AM), relays `[{340, ember}, {556, nubs}]`, length 400 (to 4:40 PM). Legs 6.9 / 15.0 / 5.8 s |
| drain (Nubs) / breeze / intro | 28 / 0 / `'ember'` |
| goal / Dare / Steady | finish / `burns ≥ 7` / 30 |
| teaches | tap a wall in the sweet band and Ember takes its fire back; light refuels; melt the ice past the Tag Stone for Nubs |

Ember's own stretch has only brambles, gates and a snack; the one ice wall is past the Tag Stone,
where melting it is a clear win (a puddle does nothing to Nubs). The melted-ice puddle that douses
Ember is T5's lesson.

| m | kind | dx | leg s |
|---|---|---|---|
| 376 | bramble | 0 | Ember 2.5 |
| 405 | bramble | 0 | Ember 4.5 |
| 434 | stone | 0 | Ember 6.5 (a snack: +12) |
| 448 | gate | 0 | Ember 7.5 |
| 477 | bramble | 0 | Ember 9.5 |
| 506 | gate | 0 | Ember 11.5 |
| 535 | bramble | 0 | Ember 13.5 |
| 580 | ice | 0 | Nubs 1.7 (in Ember's window for its last 3.2 s; melt it, or Nubs bumps it) |

### 5.2 T2 "Puddle Run": Drip's intro (Nubs ▸ Drip ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1002 / 5 (Rolling Meadows) / meadow |
| time | start 60 (7:00 AM), relays `[{160, drip}, {376, nubs}]`, length 400 (to 1:40 PM). Legs 6.9 / 15.0 / 5.8 s. Morning: long shadows for Drip. |
| drain / breeze / intro | 26 / 0 / `'drip'` |
| goal / Dare / Steady | finish / `drinks ≥ 6` / 30 |
| teaches | turn the sun to the dashed arcs before the TAG; steer into shadow and puddles; slalom round hot stones and trunks |

| m | kind | dx | leg s | | m | kind | dx | leg s |
|---|---|---|---|---|---|---|---|---|
| 189 | puddle | −18 | 2.0 | | 203 | stone | −4 | 3.0 |
| 218 | puddle | +20 | 4.0 | | 232 | stone | +10 | 5.0 |
| 246 | puddle | −8 | 6.0 | | 261 | stone | −20 | 7.0 |
| 275 | puddle | +22 | 8.0 | | 290 | stone | +14 | 9.0 |
| 304 | puddle | 0 | 10.0 | | 318 | stone | −10 | 11.0 |
| 333 | puddle | −22 | 12.0 | | 344 | stone | +24 | 12.8 |
| 354 | puddle | +12 | 13.5 | | | | | |

### 5.3 T3 "Green Bridge": Sprout's intro (Nubs ▸ Sprout ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1003 / 15 (The Long Road) / meadow |
| time | start 240, relays `[{340, sprout}, {556, nubs}]`, length 400. Legs 6.9 / 15.0 / 5.8 s. Midday: light speeds growth. |
| drain / breeze / intro | 28 / 0 / `'sprout'` |
| goal / Dare / Steady | finish / `trees ≥ 2` / 30 |
| teaches | hold on a soil patch (it cannot hurt you); hold early and long enough for a bridge; sun on a site grows it twice as fast; plant trees for Nubs' last leg |

| m | kind | dx | r (need) | leg s | first holdable / contact (s) |
|---|---|---|---|---|---|
| 369 | plot | +44 | | Sprout 2.0 | 0 (the lesson: a hold that cannot kill) |
| 408 | gap | 0 | 12 (24) | Sprout 4.7 | 0 / 4.55 (2.0 s growth, 2.55 s spare) |
| 450 | stream | 0 | 14 (28) | Sprout 7.6 | 2.78 / 7.44 |
| 476 | plot | −44 | | Sprout 9.4 | |
| 502 | gap | 0 | 16 (32) | Sprout 11.3 | 6.39 / 11.02 |
| 530 | stream | 0 | 12 (24) | Sprout 13.2 | 8.34 / 13.02 |
| 572 | plot | +44 | | Nubs 1.1 | in Sprout's window for its last 3.8 s |
| 586 | plot | −44 | | Nubs 2.1 | last 2.8 s |
| 600 | plot | +44 | | Nubs 3.1 | last 1.8 s |

Sap: 80 + 5 × 15 = 155 against 108 for the four bridges: two small trees for the Dare.

### 5.4 T4 "Weather Vane": Gust's intro (Nubs ▸ Gust ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1004 / 8 (Harbour Winds) / oldtown |
| time | start 180 (9:00 AM), relays `[{280, gust}, {496, nubs}]`, length 400 (to 3:40 PM). Legs 6.9 / 15.0 / 5.8 s |
| drain / breeze / intro | 28 / 0 / `'gust'` |
| goal / Dare / Steady | finish / `cloudRide ≥ 60` ticks / 30 |
| teaches | swipe early, the wind keeps pushing; each swipe costs Lift; one wind moves all (a one-way wind brings the waiting clouds on); fog muffles; park a rain cloud over Nubs |

| m | kind | dx (at wake) | drift u/s | r | leg s | arrives at dx (left alone) |
|---|---|---|---|---|---|---|
| 312 | rain | −100 | +20 | 55 | Gust 2.2 | +14 |
| 340 | fog | +80 | −12 | 70 | Gust 4.2 | +11 |
| 365 | rain | +110 | −24 | 60 | Gust 5.9 | −27 |
| 385 | rain (waits west) | −150 | 0 | 55 | Gust 7.3 | −150 (an east wind brings it on) |
| 400 | fog | −90 | +14 | 80 | Gust 8.3 | −10 |
| 425 | rain (waits east) | +150 | 0 | 55 | Gust 10.1 | +150 (a west wind brings it on) |
| 440 | rain | −100 | +22 | 60 | Gust 11.1 | +26 |
| 465 | rain | +100 | −20 | 65 | Gust 12.9 | −14 |
| 520 | rain (the ride) | −190 | +6 | 90 | Nubs 1.7 | −156 (wakes 4.05 s before Gust's leg ends: push it east over Nubs; its 119 u footprint gives at most 1.7 s of ride) |

### 5.5 T5 "Steam": Ember and Drip (Nubs ▸ Ember ▸ Drip ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1005 / 11 (Flurry Fields) / meadow |
| time | start 120 (8:00 AM), relays `[{216, ember}, {390, drip}, {564, nubs}]`, length 504 (to 4:24 PM). Legs 6.7 / 12.1 / 12.1 / 4.2 s |
| drain / breeze / intro | 28 / 0 / null |
| goal / Dare / Steady | finish / `drinks ≥ 4` / 25 |
| interactions | I1 melt the two ice walls in Drip's stretch from Ember's leg (puddles for Drip, no bumps); I1+I2+I3 the ice in Ember's own path melts into a puddle that douses Ember unless dried; I3 a shower crosses the gate: a burn under it is put out, so wait for it to pass; I11 the stone feeds Ember and stings Drip; then swing the sun from Ember's light to Drip's shade before the TAG |

| m | kind | dx | drift / r | leg s |
|---|---|---|---|---|
| 245 | bramble | 0 | | Ember 2.0 |
| 270 | puddle | 0 | | Ember 3.8 (dry it or be doused) |
| 296 | rain (shower) | +176 at wake | −48 / 50 | over the gate from Ember 2.5 to 4.6 s; arrives −98 (dry) |
| 296 | gate | 0 | | Ember 5.6 (sweet window after the shower: ≈ 0.8 s) |
| 320 | stone | 0 | | Ember 7.2 |
| 344 | bramble | 0 | | Ember 8.9 |
| 372 | ice | 0 | | Ember 10.8 (bump 30, melt and wade ≈ 41, or melt and dry 26) |
| 412 | ice | 0 | | Drip 1.5 (in Ember's window for its last 3.3 s) |
| 425 | puddle | −18 | | Drip 2.4 |
| 436 | ice | 0 | | Drip 3.2 (in Ember's window for its last 1.7 s) |
| 452 | stone | +10 | | Drip 4.3 |
| 474 | stone | −14 | | Drip 5.8 |
| 492 | puddle | +18 | | Drip 7.1 |
| 512 | stone | −4 | | Drip 8.5 |
| 530 | puddle | −16 | | Drip 9.7 |
| 546 | stone | +16 | | Drip 10.8 |

### 5.6 T6 "Rain Garden": Gust and Sprout (Nubs ▸ Gust ▸ Sprout ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1006 / 9 (Giant Country) / meadow |
| time | start 150 (8:30 AM), relays `[{246, gust}, {390, sprout}, {576, nubs}]`, length 490 (to 4:40 PM). Legs 6.7 / 10.0 / 12.9 / 4.4 s |
| drain / breeze / intro | 28 / 0 / null |
| goal / Dare / Steady | finish / `trees ≥ 3` / 25 |
| interactions | I7 early in Gust's leg the trail wants an east wind, late it wants west (momentum matters); I12+I7 the hand-off fog veils Sprout's first sites unless Gust blows it off; I9+I7 the garden cloud waits east of Sprout's first stretch, and the same west wind brings it on: rain feeds Sprout's Sap and grows the garden plot ×3; I10 trees shade Nubs' last leg |

| m | kind | dx | drift / r | leg s | arrives at dx (left alone) |
|---|---|---|---|---|---|
| 280 | fog | +90 at wake | −14 / 70 | Gust 2.4 | +10 |
| 300 | rain (waits east) | +130 | 0 / 55 | Gust 3.8 | +130 (a west wind before 3.8 s brings it on) |
| 312 | rain | −110 | +22 / 60 | Gust 4.6 | +16 |
| 352 | fog | −80 | +14 / 75 | Gust 7.4 | 0 |
| 360 | rain (waits west) | −150 | 0 / 55 | Gust 7.9 | −150 (an east wind brings it on) |
| 402 | fog (hand-off) | +60 | −10 / 70 | Sprout 0.8 | +3: veils Sprout's sites until Sprout passes it (Sprout 1.5 s); wakes 4.9 s before the TAG |
| 414 | rain (the garden cloud) | +120 | +6 / 85 | Sprout 1.7 | +154 (dry); wakes 4.05 s before the TAG; ~120 u of west wind puts it over Sprout and the garden plot |
| 418 | plot | +44 | | Sprout 1.9 | the garden plot |
| 464 | gap | 0 | r 14 (28) | Sprout 5.1 | contact 4.94 s |
| 500 | stream | 0 | r 16 (32) | Sprout 7.6 | holdable 2.78 / contact 7.41 |
| 520 | plot | −44 | | Sprout 9.0 | |
| 545 | gap | 0 | r 16 (32) | Sprout 10.8 | holdable 5.91 / contact 10.54 |
| 590 | plot | +44 | | Nubs 1.0 | in Sprout's window for its last 3.9 s |
| 606 | plot | −44 | | Nubs 2.1 | last 2.8 s |
| 620 | plot | +44 | | Nubs 3.1 | last 1.8 s |

Sap: 80 + 5 × 12.9 ≈ 145, + ≈ 20 from the garden rain, against 92 for the bridges: three trees with
the rain, two without (G7).

### 5.7 T7 "Five Elements": the finale (Nubs ▸ Gust ▸ Sprout ▸ Ember ▸ Drip ▸ Nubs)

| Field | Value |
|---|---|
| id / chapter / biome | 1007 / 17 (Storm Pass) / meadow |
| time | start 60 (7:00 AM), relays `[{156, gust}, {264, sprout}, {384, ember}, {498, drip}, {598, nubs}]`, length 600 (to 5:00 PM). Legs 6.7 / 7.5 / 8.3 / 7.9 / 6.9 / 4.3 s |
| drain / breeze / intro | 30 / **−16** (west) / null |
| goal / Dare / Steady | finish / `grove ≥ 4` (trees standing at the finish) / 25 |
| interactions | all of I1-I12. Gust: east first (the west-waiting cloud), then west for the hand-off (clears Sprout's fog and brings the garden cloud's rain onto Sprout and the garden plot). Sprout: four plots, Sap for four trees only with the garden rain. Ember: the breeze spreads fire west, so burning the bramble at 413 burns the tree on plot 410; a fourth tree needs Ember to take the bump instead. A shower crosses the gate at 446. Then swing the sun from Ember's light to Drip's shade. |

| m | kind | dx | drift / r | leg s | arrives at dx (left alone) |
|---|---|---|---|---|---|
| 186 | rain | +125 at wake | −4 (eff. −20) / 55 | Gust 2.1 | +11 |
| 206 | rain (waits east) | +120 | +16 (eff. 0) / 55 | Gust 3.5 | +120 (a west wind before 3.5 s brings it on) |
| 214 | fog | −110 | +30 (eff. +20.4) / 70 | Gust 4.0 | +7 |
| 236 | rain | +100 | 0 (eff. −16) / 60 | Gust 5.6 | +9 |
| 248 | rain (waits west) | −150 | +16 (eff. 0) / 55 | Gust 6.4 | −150 (an east wind brings it on) |
| 276 | fog (hand-off) | −30 | +16 (eff. +6.4) / 70 | Sprout 0.8 | +7: veils Sprout's sites until Sprout passes it (Sprout 1.5 s); wakes 4.9 s before the TAG |
| 288 | rain (the garden cloud) | +150 | +8 (eff. −8) / 80 | Sprout 1.7 | +104: waters the garden plot, misses Sprout; ~130 u of west wind puts it over both; an east wind takes it off both |
| 288 | plot | +44 | | Sprout 1.7 | the garden plot (veiled by the fog if it stays) |
| 330 | plot | −44 | | Sprout 4.6 | |
| 338 | gap | 0 | r 14 (28) | Sprout 5.1 | contact 4.94 s |
| 364 | stream | 0 | r 14 (28) | Sprout 6.9 | holdable 2.09 / contact 6.74 |
| 410 | plot | −44 | | Ember 1.8 | downwind of the bramble at 413; in Sprout's window for its last 3.1 s |
| 413 | bramble | 0 | | Ember 2.0 | |
| 416 | plot | +44 | | Ember 2.2 | upwind: safe; last 2.6 s |
| 428 | puddle | 0 | | Ember 3.1 | |
| 446 | rain (shower) | +133 at wake | −24 (eff. −40) / 55 | over the gate from Ember 0.5 to 3.3 s | −96 (dry) |
| 446 | gate | 0 | | Ember 4.3 | sweet window after the shower: ≈ 0.8 s |
| 468 | bramble | 0 | | Ember 5.8 | |
| 480 | stone | 0 | | Ember 6.7 | |
| 522 | ice | 0 | | Drip 1.7 | in Ember's window for its last 3.2 s |
| 532 | puddle | −18 | | Drip 2.4 | |
| 546 | ice | 0 | | Drip 3.3 | last 1.5 s |
| 556 | stone | +12 | | Drip 4.0 | |
| 570 | puddle | +16 | | Drip 5.0 | |
| 582 | stone | −10 | | Drip 5.8 | |

Sap: 80 + 5 × 8.3 ≈ 122, + ≈ 20 from the garden rain, against 56 for the bridges: four trees (80)
only with the rain. Chip text for T7 is "ALL FIVE ELEMENTS" (six names do not fit a 360 px chip).

---

## 6. Proving winnability

### 6.1 Harness

`scripts/sim16/trials.ts` (CORE, rewritten), registered in `sim.ts`'s SIM16 array as today:

```
node scripts/sim.ts --trials [--id 1001,…] [--check] [--pick <id>] [--salts 16] [--perf] [--workers W]
```

One row per trial: seed, salt, G0, each leg's audit margin (G1, with the Drip mask's best and worst
marked bin beside the audit's chosen bin), the path bot's verdict and lowest steady health (G2),
reactive wins of 8 (G3), humanEl's pass rate (G4), the anti-trivial runs (G5, G5b), the Dare share
(G6), the interaction runs (G7). `--perf` adds µs/tick against a Nubs run of the same length.
`--check` exits 1 on any failed gate. All tooling is in `scripts/` or in core bots, which
`build:single` drops (0 bundle bytes).

### 6.2 Audits per verb (G1): a chained, per-leg proof

The audit walks the legs in order. Before leg *L* it **replays** the trial from go with the path
bot's frames up to *L*'s TAG, then evaluates *L* on that exact world state. Inside a leg the world
evolves by the audit's own verb schedule, and contacts and the z-0 rain proxies are positional, so
rows are extracted by replaying the leg with neutral θ input and the schedule's verbs, recording per
6-tick step the walker's lit sums per bin (`gatherScene` + `litMask`, runtime casters and rain
proxies included) and its contacts.

**Plants are the one θ-dependent change** (a lit site grows ×2), so each audited leg fixes every
plant's stand tick by a bound that can only make it harder: for shade-seeking legs (Nubs, Drip) a
tree counts as shade only from its **latest** stand tick (shade growth, no rain); for Ember (which
seeks light) it counts from its **earliest** stand tick (×3 growth); bridges always use their latest
completion. The pathBot replays (G2) use the real growth. `elements.test.ts` checks both bounds on a
fixture.

**Single-pointer input.** Every DP step that contains a tap has a turn limit of 0 for 12 ticks (lift
the drag, tap, re-grab), and every step of a pour has a turn limit of 0, with ω 0 after it; the
audit never assumes a second finger.

| Leg | DP | State | Schedule (fixed before the DP) | Gate |
|---|---|---|---|---|
| Nubs | v1 turn-limited survival DP (`slidingMaxCircular`, `turnBins`), min-of-three pessimism | 360 bins × max Chill | none; Cold Snap left out | best path keeps health ≥ 20 |
| Ember | the same DP on Flame with Ember's rate table by c, minus water drains per step | 360 bins × max Flame | own brambles/gates tapped at the centre of their sweet window (moved to the first window tick after any predicted shower over the wall), cost paid then, `paid` taken back at contact; ice and walls past the TAG tapped at the latest tick that burns them out 6 ticks before that walker's contact (no later than 6 ticks before Ember's TAG); a puddle on Ember's path dried at `contactTicks = 60` when that keeps more Flame than wading it | best path keeps steady health ≥ 20 and pays every cost |
| Sprout | none: Sap does not depend on θ | Sap ledger | **latest-hold** at shade growth with no rain speed-up: each crossing poured `need` at the latest tick that still completes it with 0.3 s to spare, one hold at a time in arrival order, the first pour no earlier than TAG + 13 ticks (`HOLD_MS`) and each next one 9 ticks after the previous release; Sap = start + root + rain on the walker (weather as the path bot left it) − pours | Sap never short at a pour; every bridge completes |
| Drip | lane DP for the held θ: lanes every 2 u in the lane bounds, ≤ `slide·0.1` u a step, max Size per (step, lane, consumed bits); a puddle or stone overlapping the step carries a consumed bit (×2 states each); contacts are tested along the interpolated segment between steps | 33 lanes × bits × max Size | none | best path keeps health ≥ 20, **from every bin the guide marks at the TAG** (§4.4), on a 5° grid |
| Gust | none: global wind and momentum make the state history-dependent | | | bots only (G2, G5) |

- **θ across legs.** A Sprout leg hands the next leg every bin reachable under its turn limits (0 on
  pour steps). A leg followed by a held leg (Drip, Gust) ends at the alive end bin on a 5° grid that
  maximizes `min(held-leg margin, next-leg margin)`, restricted to the guide's marked bins before
  Drip (Gust's leg is θ-free, so the bin is the next leg's best). The path bot backtracks to that bin.
- Flakes, the Cold Snap, `cloudRide`, the clean TAG and every positive surprise are left out, so the
  audit is conservative. The printed margin is the highest health threshold each leg keeps.

### 6.3 Bots (core, trial-only; `src/core/sim/bots/elements.ts`)

**Bot input contract** (every core bot, pathBot and humanEl; the frames a single-pointer touch player
produces under §7.9):
- A **tap** ends any sun drag first (`upEdge`, release 0), waits ≥ 6 ticks (the tap's own press), then
  emits one frame with `verb 1` and its point; it sends no `downEdge` or `dTheta` (the held-back
  press, §7.9); a new sun drag starts ≥ 9 ticks later with a `downEdge`.
- A **hold** ends any sun drag first, waits 13 ticks (`HOLD_MS` 220), emits `verb 2` with its point,
  sends no `dTheta` until it emits `verb 3`, and re-grabs the sun ≥ 9 ticks after that.
- A **steer** is `steer` on frames with no `dTheta`; a **swipe** is one `verb 4/5` frame per swipe.
- Bots never use keys (keyboard play can turn and act at once; it is not what the gates prove).

The core `reactive` bot keeps its Nubs play on Nubs legs and delegates element legs to
`elPolicy(s, frame, salt)`:

| Element | Policy |
|---|---|
| Ember | taps each own bramble/gate in the middle of its sweet window (`burnSweet`), never under a shower; ice and walls past the TAG as soon as `burnLeft ≤ 30`; dries a puddle on its path at `contactTicks ≤ 60` if Flame > 30; between taps aims the sun at the centre of the `guide.now` run nearest θ |
| Sprout | holds the most urgent unbridged crossing (least `growLeft`) until its size is `need`, then plots in arrival order while Sap > 25 (in T7 it keeps the downwind plot only if Ember will bump the bramble); between holds aims at `guide.now` |
| Drip | every 6 ticks picks the lane target in `{lo..hi}` step 4 u maximizing: +30 per puddle reachable within 60 ticks at `slide`, −20 per stone it would touch, +0.2 per shaded tick over the next 30 ticks at that lane (point tests every 5 ticks) |
| Gust | every 6 ticks scores both swipe directions by the summed predicted overlap (`weatherXAt` at arrival, `|xPred − trailX| < r + 12`) of every awake object ahead that `weatherGood` marks harmful, minus the overlap of the ones it marks helpful; swipes the better way when it cuts the sum by ≥ 10 u and Lift > 20, at most once per 15 ticks; in T4 it pushes the ride cloud east once the others are past |
| Nubs | today's reactive aim on `guide.now`; during a telegraph into Drip it aims at `guide.tag`; the Cold Snap as today |

With salt > 0 the bot adds noise: aim N(0, 4°), tap timing ±6 ticks, steer ±3 u.

**humanEl** (G4, core): the humanDial model on Nubs legs and the policies above with human timing:
a 250 ± 80 ms reaction delay on every new target, plus a **first-exposure delay of 1.2 s** on each
element's first object of the run; it acts only on objects inside the window (`range`) and unveiled;
tap duration 100-300 ms before the verb frame; hold recognition 220 ms; 150 ms to re-grab the sun
after any tap or hold; tap points N(0, 10 u); hold releases ±150 ms; steer lag 200 ms with N(0, 4 u)
error; swipes 5% in the wrong direction and 10% one swipe late; during a telegraph into Drip it aims
at the nearest marked bin of `guide.tag` (N(0, 6°)). Salts 0..15.

**pathBot** (scripts): follows each audited leg's backtracked θ path and verb schedule under the input
contract; plays Gust legs with the Gust policy (salt 0).

### 6.4 Gates (the pinned seed passes all of them)

| Gate | Requirement |
|---|---|
| G0 | Placement and authoring: every authored object placed; no plot, puddle or stone within `clearance` of a generated prism part; every left-alone weather object arrives at its table's dx ±2 u; the authoring rules of §5.0 (leg lengths, the intro's first object ≥ 2 s, crossing radii, the first-crossing and every-crossing formulas, cross-leg windows ≥ 1.5 s, Gust push times); Drip's lane ≥ ±12 u everywhere in Drip legs. |
| G1 | Every audited leg passes (§6.2), Drip legs from every marked bin. |
| G2 | pathBot wins with lowest steady health ≥ 20; pathBot ending each pre-Drip leg at the **worst** marked bin also wins. |
| G3 | `reactive` wins on ≥ 7 of 8 salts. |
| G4 | humanEl passes **75-95%** on T1-T4 and 45-90% on T5-T7 (16 salts). |
| G5 | Anti-trivial: (a) `idle` (no input) fails; (b) for every element leg, pathBot with that leg's verb switched off (no taps, holds, steers or swipes there) fails; (c) T1: a tap-on-sight Ember (taps each wall as soon as it is a target) keeps a steady-health margin at least 15 lower than pathBot; (d) four spam bots, swiping east every 30 ticks, west every 30, east every 90 and west every 90 (no other Gust input), each fail in every Gust leg of T4, T6 and T7. |
| G5b | pathBot's verbs with θ fixed at the best of 36 constant angles (10° apart, no turning) fail each Trial. |
| G6 | The Dare is met on 10-60% of the G3 and G4 runs combined. |
| G7 | Mixers mix (all hard, all fail `--check`): T5 pathBot without melting the two Drip-stretch ice walls fails; T6 pathBot without Gust's swipes after the hand-off fog wakes keeps a Sprout Sap margin at least 10 lower **and** grows fewer than 3 trees; T7 pathBot planting plot 410 and burning the bramble at 413 ends with that tree gone, and without the hand-off swipes it keeps a Sprout Sap margin at least 10 lower. |

### 6.5 Seed search and calibration bounds

**Global pass first.** CORE calibrates the shared `TUNING.elements` values once, over all seven
Trials together (salt 0 and the G3/G4 bots), before any per-trial pick. Only these may move, within
±20% of §2.6: `ember.refill`, `ember.cost.*`, `sprout.root`, `sprout.rain`, `sprout.grow`,
`drip.evap`, `drip.puddle`, `gust.kick`, `gust.swipe`, `gust.soak`.

**Per-trial pick.** `--pick <id>` tries salts 0..199 in order and takes the first that passes every
gate. If none passes, it moves that trial's own levers and searches again:
- **too easy** (G5/G5b, or the top of G4, fails everywhere): the failing leg's start meter falls by 10
  (`tune.legStart`); or the object that leg ignores most moves 6 minutes earlier in its leg or 8 u
  toward the trail (weather: drift +20%); a Nubs leg that is too easy raises the drain by 2;
- **too hard** (G1-G4 fail everywhere): the leg's start meter rises by 10; the trial's `costMul` (Ember
  and Gust costs) or `evapMul` (Drip) falls by 0.1; the hardest object moves 6 minutes later or 8 u
  away; the drain falls by 2 (floor 22);
- **G6 fails on the pick:** the Dare target moves 25% toward the band.

Calibration may move only these, each change recorded in a comment beside the number: `salt`;
`drain` within ±6 of §5; `tune.legStart` within ±20 of the element's start; `tune.costMul` and
`tune.evapMul` within 0.8..1.2; object minutes `m` within ±6 (the §5.0 authoring rules still hold);
`dx` of plots, puddles, stones and weather within ±8 u; weather drift within ±20%; Dare targets within
±25%; and **one object per leg** added or removed, written into that leg's table with the reason.
**No waivers** on G1, G2 or G5/G5b; G0 has none either. A waiver on G3, G4, G6 or G7 needs the lead.

Everything else in §2-§5 is fixed. The as-built values go into the §13 record at the merge.

---

## 7. Contracts

### 7.0 Teams, ownership, branches

| Team | Owns (writes) | Never edits |
|---|---|---|
| **CORE** | `src/core/**`, `src/config/**`, `scripts/**`, `tests/golden/hashes.json`, `tests/unit/{elements,trials,golden,determinism,generator,sim,campaign,levelBake,bots}.test.ts`, `src/core/README.md` | render, audio, ui, meta, game |
| **ART** | `src/render/**`, `src/game/fx.ts`, `src/audio/**`, `src/platform/haptics.ts`, `tests/unit/{render,audio*,haptics}.test.ts`, `tests/e2e/render.spec.ts` | core, config, ui, meta, the rest of game |
| **UI** | `src/ui/**`, `src/meta/**`, `src/game/**` except `fx.ts` (`input.ts` included), `src/main.ts`, `index.html`, `vite.config.ts`, `tests/e2e/**` except `render.spec.ts`, `tests/unit/{save,saveSync,progression,ui-logic,gamify,moments,share,game,campaignGame}.test.ts`, `src/game/README.md`, `src/ui/README.md` | core, config, render, audio |

**Branches and merge:**
1. C0a and C0b land on `claude/mobile-game-web-prototype-54l0ia` (§7.1), measured with a real
   `build:single` whose size is published in the C0b commit message and in §13 before anyone branches.
2. The teams branch from C0b: `elementals2/core`, `elementals2/art`, `elementals2/ui`, each in its own
   worktree.
3. CORE lands C0c (the skeleton) on the base as soon as it passes its gates; ART and UI rebase onto it.
4. Merge order CORE, ART, UI; the integrator runs §9.7 after each merge.
5. A contract change goes through the integrator as C1, C2… on the base, with this doc updated; the
   teams rebase.
6. ART and UI may merge `elementals2/core` locally to preview real behaviour; that merge is never
   committed.

### 7.1 C0: contract, demolition, skeleton (CORE writes them, the integrator reviews them)

**C0a, demolition.** Deletes the v1 sun-variant rules and everything that reads them, in every layer
(§8 lists the code). Outside CORE files it only deletes reads and replaces them with the stub
behaviour of §7.12. Trials still load and walk as Nubs-only relays.

**C0b, contract** (no v2 behaviour; the teams branch from here):
1. `src/config/heroes.ts` and `src/config/trials.ts` complete (§7.2, §7.3), copy included, salts 0.
2. `TUNING.elements` (§2.6); v1's `heroes` block gone.
3. Types (§7.4-§7.6), `CloudKind` `'rain'`, `EL_ID_BASE`, `TREE_ID_BASE`, `removeCaster`;
   `SEED_ID_BASE` gone.
4. `src/core/sim/elements.ts` with every export of §7.7 at its final signature, as stubs returning
   neutral values (−1, 0, false, `'nubs'`), and `createEl` building `s.el` (objects at their places,
   no behaviour); `step.ts` order (§7.8) with empty `updateElements`; `create.ts` (trial world
   generated through `finishY + hardAhead`; `prepareRun` and `createRun` both build that far on
   Trials and ignore `createRun`'s `ahead` argument); `hash.ts` trial block.
5. `elFixture(s)` (core, behind the same build flag as the session's `makeBot`): puts each object
   kind into each of its states (intact, burning ×3 frames, melting, drying, half-grown and complete
   bridge, sapling, tree, wet, veiled, awake weather with ghosts on and off the trail, a burning own
   wall) so ART can draw every state before C0c.
6. Game wiring (UI-owned files, written by CORE in C0b only): `src/game/params.ts` (`?trial=1..7`,
   `?elfix=1`, `?hero=` gone); `src/game/input.ts` (the `InputHost` members of §7.9 declared; `verb`
   treated as `'sun'`); `src/game/session.ts` (`verb`, `toWorld`, `uPerPx`, `canTarget`, the §4.1 cut
   rule, `?elfix=` behind the `makeBot` gate).
7. **The test hook**: `testSkipToLeg`, `testWorldToScreen`, the `el` fields of `testState()` (§7.11)
   and their mirrors in `tests/e2e/helpers.ts`; `testSkipToLeg` uses the session's `makeBot` gate, so
   `build:single` stays bot-free.
8. The goldens: `trials` regenerated; every other key byte-identical.

**Gates for C0a+C0b:** `node scripts/golden.ts` diff touches only `trials`; typecheck; vitest (v1
hero tests removed, `trials.test.ts` reduced to the config checks); **`build:single` ≤ 782,000 B**,
measured and published (the demolition must be real: §9.3).

**C0c, skeleton** (CORE, on the base as soon as ready; counts against CORE's allowance): object
behaviour with the sun hold, verbs accepted with **no costs** (taps burn, holds pour without
spending Sap, swipes add wind), steering and the lane, weather wake, drift and rain proxies, burn-out,
growth and trees; meters run Nubs' rule for every element; a minimal `elPolicy` (tap each wall when
`burnSweet`, hold the nearest unbridged crossing until `need`, steer toward the nearest puddle ahead,
swipe away weather predicted on the trail) so `?bot=reactive` and `testSkipToLeg` exercise every
object state. Costs, feeds, contacts, fire spread, douse, veils, Sprout's safe, the guide and deaths
other than Nubs' are CORE's branch work.

### 7.2 `src/config/heroes.ts` (pure data, imports nothing)

```ts
// Elementals v2 (docs/ELEMENTALS_V2.md): the five elements, their words and their verb. Pure data.

export type HeroId = 'nubs' | 'ember' | 'drip' | 'sprout' | 'gust';
export const HERO_IDS: readonly HeroId[] = Object.freeze(['nubs', 'ember', 'drip', 'sprout', 'gust'] as HeroId[]);
/** How the walking element is played (§1.3). */
export type Verb = 'sun' | 'burn' | 'grow' | 'steer' | 'blow';
/** The candy face (render/candy.ts FACE key, kit.css face class) of an element's coin, tile and stamp. */
export type HeroFace = 'ice' | 'red' | 'blue' | 'green' | 'cloud';
/** How a run on a Trial ended (DeathInfo.heroCause; §10.4). */
export type HeroDeath = 'melt' | 'fall' | 'crash' | 'snuff' | 'douse' | 'rain' | 'swept' | 'evaporate' | 'sizzle' | 'soak' | 'fog';

export interface HeroInfo {
  readonly id: HeroId;
  readonly name: string;          // 'Ember'
  readonly element: string;       // 'Fire'
  readonly tagline: string;       // 'Burn a way through.'
  readonly rules: readonly [string, string, string];
  readonly meter: string;         // 'Flame'
  readonly verb: Verb;
  readonly verbLine: string;      // 'Tap: burn a wall'
  readonly keyLine: string;       // '↑ burns the next wall · ← → turn the sun'
  /** The sun takes no input while this element walks (Drip, Gust). */
  readonly sunHeld: boolean;
  /** Canvas glyph id (render/glyphs.ts). */
  readonly glyph: string;
  /** Gesture icon id ('g-drag' | 'g-tap' | 'g-hold' | 'g-steer' | 'g-swipe'): DOM SVGs in src/ui/icons.ts only. */
  readonly gesture: string;
  readonly face: HeroFace;
  /** Trial number (1..7) whose pass unlocks the roster tile; 0 = always (Nubs). */
  readonly intro: number;
  /** The Results recap tip after this element failed ('' for Nubs: today's recap tips). */
  readonly deathTip: string;
}

export const HEROES: Readonly<Record<HeroId, HeroInfo>>;   // values: §10.1
/**
 * Cause-specific recap tips (§10.4), keyed `'<hero>:<cause>'` or `'<cause>'`. The Results recap tip is
 * CAUSE_TIPS[`${who}:${cause}`] ?? CAUSE_TIPS[cause] ?? HEROES[who].deathTip (Nubs' melt: today's tips).
 */
export const CAUSE_TIPS: Readonly<Record<string, string>>;
```

### 7.3 `src/config/trials.ts` (pure; imports config only)

```ts
export const TRIAL_BASE = 1000;
export const TRIAL_COUNT = 7;
/** 1001..1007. */
export const TRIAL_IDS: readonly number[];
export type TrialDareKind = 'burns' | 'drinks' | 'trees' | 'grove' | 'cloudRide';

/** Trial object kinds (§3.1); EL_KINDS order is the hash index. */
export type ElKind = 'bramble' | 'gate' | 'ice' | 'gap' | 'stream' | 'plot' | 'puddle' | 'stone' | 'rain' | 'fog';
export const EL_KINDS: readonly ElKind[];

/** One authored object (§5.0). */
export interface ElPlace {
  readonly k: ElKind;
  /** The in-game minute at which the walker reaches its y. */
  readonly m: number;
  /** Lateral offset from the trail centre (u, + east); weather: at waking. 0 for walls and crossings. */
  readonly dx: number;
  /** Crossings: half-length along y (12-18); weather: rx. Omitted: the kind's TUNING radius. */
  readonly r?: number;
  /** Weather drift (u/s, + east). */
  readonly drift?: number;
}

export interface TrialRelay { readonly minute: number; readonly to: HeroId }

/** Per-trial calibration levers (§6.5); defaults { legStart: [], costMul: 1, evapMul: 1 }. */
export interface TrialTune {
  /** Start meter per leg index; 0 or absent = the element's TUNING start. */
  readonly legStart: readonly number[];
  /** Scales Ember's tap costs and Gust's swipe cost on this Trial (0.8..1.2). */
  readonly costMul: number;
  /** Scales Drip's evaporation on this Trial (0.8..1.2). */
  readonly evapMul: number;
}

export interface TrialDef {
  readonly id: number;            // 1000 + n
  readonly n: number;             // 1..7
  readonly name: string;
  readonly chapter: number;
  readonly salt: number;
  readonly seed: number;
  readonly biome: BiomeId;
  readonly forecast: ForecastId;  // 'clear' on every v2 Trial
  readonly concepts: readonly ConceptId[];  // [] on every v2 Trial
  readonly startMinute: number;
  readonly lengthMinutes: number;
  /** Nubs' drain on this Trial. */
  readonly drain: number;
  /** Elements in order of first appearance; cast[0] walks first. */
  readonly cast: readonly HeroId[];
  readonly relays: readonly TrialRelay[];
  /** The element this Trial introduces (its ghost gesture and intro tips), or null. */
  readonly intro: HeroId | null;
  /** Constant wind (u/s, + east) under Gust's (§3.6). */
  readonly breeze: number;
  readonly objects: readonly ElPlace[];
  readonly tune: TrialTune;
  readonly mech: Mechanics;       // { buds: false, snap: true, deep: false, brittle: false }
  readonly goal: { readonly kind: 'finish'; readonly target: 0 };
  readonly dare: { readonly kind: TrialDareKind; readonly target: number };
  readonly steady: number;
  readonly requires: readonly number[];
  readonly card: { readonly chip: string; readonly blurb: string; readonly goal: string; readonly stars: readonly [string, string, string]; readonly dare: string };
}

export const TRIALS: readonly TrialDef[];
export function isTrialId(id: number | undefined): boolean;        // integer 1001..1007
export function trialDef(id: number): TrialDef | null;
export function trialLevel(id: number): LevelDef | null;          // v1, unchanged
export function anyLevelDef(id: number): LevelDef | null;         // v1, unchanged
export function levelTag(id: number): string;                     // v1, unchanged
export function levelShort(id: number): string;                   // v1, unchanged
export function trialDareValue(kind: TrialDareKind, stats: LevelStats): number;
export function trialStars(t: TrialDef, stats: LevelStats, goalMet: boolean): 0 | 1 | 2 | 3;  // v1 scheme
```

`trialDareValue` maps `burns → stats.burns`, `drinks → drinks`, `trees → trees`, `grove → grove`,
`cloudRide → cloudRide` (absent counts 0). `stats.cleanTags` is still counted (the CLEAN! pop) but
is no longer a Dare.

### 7.4 Core types (`src/core/sim/types.ts`, `src/core/objects.ts`)

```ts
// InputFrame: all optional; 0 and absent mean the same; never set in a Nubs run (§9.1).
  /** Elementals v2: the element verb this tick (VERB_*). */
  verb?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** The ground point (u, quantized to 1/8) of a pointer tap (verb 1) or hold (verb 2). Read only with those verbs. */
  vx?: number;
  vy?: number;
  /** Drip: requested slide this tick (u, + east, quantized to 1/64). */
  steer?: number;
export const VERB_TAP = 1, VERB_HOLD = 2, VERB_RELEASE = 3, VERB_WEST = 4, VERB_EAST = 5, VERB_KEY_BURN = 6, VERB_KEY_HOLD = 7;

// objects.ts
export const EL_ID_BASE = 0x50000000;
export const TREE_ID_BASE = 0x58000000;
export type CloudKind = 'overtaker' | 'waiter' | 'parked' | 'snap' | 'rain';
/** ElObj.state */
export const EL_IDLE = 0, EL_BURNING = 1, EL_GONE = 2;

/** A trial object at run time (§3). Only step() writes it. */
export interface ElObj {
  readonly id: number;            // EL_ID_BASE + index
  /** 'ice' turns into 'puddle' when it melts. */
  kind: ElKind;
  /** Centre x: weather drifts, the rest never move. */
  x: number;
  readonly y: number;
  /** Puddle, stone, plot, weather: radius (weather: rx); crossing: half-length along y. */
  r: number;
  /** Weather drift (u/s); 0 for the rest. */
  readonly drift: number;
  state: 0 | 1 | 2;
  /** Burn, melt or dry ticks left (0 none). */
  t: number;
  /** Flame Ember paid for the fire now burning here (0: none, or a spread fire). */
  paid: number;
  /** Sites: Sap poured in, and growth so far (≤ size). */
  size: number;
  grown: number;
  /** Sites: bit 0 lit, bit 1 under rain (refreshed every 6 ticks while growing). */
  light: number;
  /** A plot's tree caster (−1 none). */
  casterId: number;
  /** A wall, crossing or stone already touched (it acts once). */
  hit: boolean;
  /** Weather: drifting. */
  awake: boolean;
}

/** Everything a v2 Trial adds to a run (null in every Nubs run). */
export interface ElState {
  /** The trial's objects, y-sorted; never re-sorted (weather moves only in x). */
  readonly objs: ElObj[];
  /** The walker's lateral offset (u, + east) and Drip's steer target. */
  dx: number;
  dxTarget: number;
  /** Gust's wind (u/s, + east), decaying; windAt() adds the breeze. */
  wind: number;
  /** The site a hold is pouring into (index in objs, −1 none). */
  hold: number;
  /** Meter Ember's taps and Gust's swipes paid this leg, less Ember's feeds (steady health, §1.2). */
  spent: number;
  /** The walker's contacts this tick: 1 puddle, 2 rain, 4 fog, 8 stone. */
  touch: number;
  /** Ticks since the walking element's leg began. */
  legTick: number;
  /** An unbridged crossing took the walker this tick. */
  fell: boolean;
  /** What ended the run (heroDeath's line) and the object that did (−1 none). */
  cause: HeroDeath | null;
  causeObj: number;
  /** Drip's pre-TAG mask buffer (§4.4; derived, not hashed; empty when the Trial has no Drip leg). */
  readonly tagMask: Uint8Array;
}

// SimState: v2. Nubs runs: trial null, el null.
  readonly trial: TrialDef | null;   // kept
  readonly el: ElState | null;       // new
  relayIdx: number;                  // kept
  tagGrace: number;                  // kept
  tagWatch: number;                  // kept
// removed: mate, heroAbility, heroTicks, voltLit, voltTheta, voltChain, voltTick, dripCool, harmony, heroCause

// NubsState: hero, c, rate, safe kept (v1 meaning, §1.2 for safe).
// GuideState: `lead` and `mate` removed; `tag` kept (§4.1).
// RunConfig: `hero` removed.
```

### 7.5 Events, stats, DeathInfo (`src/core/sim/events.ts`, additive except the v1 removals)

```ts
// SimEvent v2 (v1 'ability', 'abilityEnd', 'strike', 'heroPickup' removed; 'tagSoon', 'tag', 'tagClean' kept)
  | { e: 'burn'; obj: number; kind: ElKind; x: number; y: number; cost: number; spread: boolean }   // a fire, melt or drying starts
  | { e: 'burnOut'; obj: number; kind: ElKind; x: number; y: number }                              // done ('ice' already turned 'puddle')
  | { e: 'feed'; obj: number; delta: number; x: number; y: number }                                // Ember walked through its own fire
  | { e: 'doused'; obj: number; x: number; y: number }                                             // rain put a fire out
  | { e: 'fizz'; x: number; y: number; reason: 'low' }                                              // a tap or swipe the meter cannot afford
  | { e: 'bump'; obj: number; kind: ElKind; hero: HeroId; delta: number; x: number; y: number }
  | { e: 'fall'; obj: number; hero: HeroId; x: number; y: number }                                 // the death follows on this tick
  | { e: 'grow'; obj: number; on: boolean; x: number; y: number }                                  // a hold starts or ends
  | { e: 'grown'; obj: number; tree: boolean; x: number; y: number }                               // a bridge completes / a tree stands
  | { e: 'drink'; obj: number; delta: number; x: number; y: number }                               // Drip drank a puddle or swam a stream
  | { e: 'sizzle'; obj: number; hero: HeroId; delta: number; x: number; y: number }                // a hot stone: Drip −, Ember +
  | { e: 'gust'; dir: -1 | 1; wind: number; cost: number }
  | { e: 'touch'; bits: number }                                                                    // el.touch changed

// RunStats (optional, created at 0 on Trials, absent in Nubs runs; v1's blazeTicks, seeds, strikes,
// bestChain, calmTicks, harmonyTicks removed)
  burns?: number; bumps?: number; drinks?: number; trees?: number; grove?: number;
  cloudRide?: number; tags?: number; cleanTags?: number; gusts?: number;

// DeathInfo (kept fields)
  who?: HeroId;
  heroCause?: HeroDeath;
```

`RunStats.minChill` on Trials holds the lowest steady health of any life meter (§1.2);
`levelWon.minChill` carries it. The flake and crystal events fire for every walker; only Nubs' Chill
changes by them.

### 7.6 Render snapshot (`src/core/sim/snapshot.ts`)

`RenderSnap` loses `mateX`, `mateY`, `mateChill`; keeps `relay` (no blend across a TAG). The walker's
x already includes `dx`. Weather x is read from `s.el` unlerped.

### 7.7 Core API (`src/core/sim/elements.ts`, exported from `src/core/index.ts`)

```ts
/** Kept from v1 (sim/heroes.ts is reduced to these): */
export function heroHealth(nb: NubsState): number;               // 100 · chill / maxChill (the gauge)
export function heroStart(hero: HeroId): number;                 // TUNING.elements.start[hero]
export function tagTick(t: TrialDef, i: number): number;
export function nextTagTicks(s: SimState): number;
export function nextTagHero(s: SimState): HeroId | null;
export function tagLocked(s: SimState): boolean;                 // the Cold Snap only
export function relayY(s: SimState, i: number): number;

/** New: pure reads, no allocation. All countdowns are to the contact edge (§0.2). */
export function elHealth(s: SimState): number;                   // steady health (§1.2)
export function walkerAt(s: SimState, y: number): HeroId;        // the element that walks at y (relay schedule)
export function windAt(s: SimState): number;                     // el.wind + trial.breeze (0 off Trials)
export function weatherXAt(s: SimState, o: ElObj, ticks: number): number;
export function weatherGood(s: SimState, o: ElObj): -1 | 0 | 1;  // the arrival ghost's colour (§3.6)
export function arriveTicks(s: SimState, y: number): number;     // ticks until the walker reaches y (−1 behind)
export function contactTicks(s: SimState, o: ElObj): number;     // ticks until the walker reaches o's contact edge (−1 once reached)
export function needOf(o: ElObj): number;                        // crossing 2r, plot treeMax
export function bridged(o: ElObj): boolean;                      // crossing grown ≥ need
export function burnLeft(s: SimState, o: ElObj): number;         // ticks left for a tap that still works (§2.2): own bramble/gate to `near`, else to burn-out before contact
export function burnSweet(s: SimState, o: ElObj): boolean;       // a tap now is just in time (own bramble/gate in its sweet window; else 0 ≤ burnLeft ≤ nowTicks)
export function growLeft(s: SimState, o: ElObj): number;         // ticks of slack at the current growth rate before contact (< 0: late)
export function veiled(s: SimState, o: ElObj): boolean;          // fog hides it (§3.6)
export function burnTarget(s: SimState, x: number, y: number): number;  // the target a tap at (x, y) would burn now (−1 none); NaN x: the key's
export function growTarget(s: SimState, x: number, y: number): number;  // the site a hold at (x, y) would grow now (−1 none); NaN x: the key's
export function laneOf(s: SimState, out: Float64Array): void;    // Drip's lane [lo, hi] at the walker's y
export function pointLit(s: SimState, x: number, y: number): boolean;

/** Internal to core (not part of the contract): createEl, updateElements, applyElDaylight, elGuide, elTagMask, elDeath, elDead, groveCount. */
/** Debug, behind the makeBot build flag: elFixture(s) (§7.1). */
```

### 7.8 Step order and the behaviour CORE implements

```
updateSun(s, inp)              T: locked while HEROES[s.nubs.hero].sunHeld and the clock runs (§4.1)
readyTick (start beat)         unchanged
advanceClock → syncTime        unchanged (syncTime sets x = trailX(y))
T: updateRelay(s)              telegraph; at the TAG the v2 resets of §4.1
ensureGenerated / prune        unchanged (a Trial is generated through finishY + hardAhead at creation)
updateFlare → syncEclipse      unchanged (no flares or eclipse on Trials)
updateSnap(s, inp)             if (inp.snap === true && (s.trial === null || (s.nubs.hero === 'nubs' && !tagLocked(s)))) castSnap(s)
T: updateElements(s, inp)      verbs (only the walking element's, only past the start beat) → steer, lane, dx
                               → s.nubs.x = trailX(y) + dx → wind decay → weather wake/drift/prune and
                               rain proxies → fire (spread, douse, burn-out) → growth, bridges, trees
                               → one Drip-mask point (§4.4)
computeCoverage(s)             unchanged
daylight: T ? applyElDaylight(s) : applyDaylight(s);  night: T ? nothing : applyNight(s)
                               applyElDaylight: the walker's rate (§2) and tagGrace floor → meter → contacts
                               (§3.3, feeds included) → safe, minChill (steady), lowChill → Nubs' Cold Snap
                               income → clean-TAG watch → keepMemory, litTotal, hourLit, cloudRide, legTick
updatePickups → updateBuds → passObjects → updateFeats → pushHistory (T: steady health) → pushRecent
die if daylight && (s.el === null ? s.nubs.chill <= 0 : elDead(s))    elDead: el.fell || (hero ≠ sprout && chill ≤ 0)
win at finishY                 T: stats.grove = groveCount(s) first
updateGuide every 6 ticks      T: elGuide (below)
```

**Verbs** (inside `updateElements`; a verb that does not match the walking element is ignored; `vx`,
`vy` are read only with verbs 1 and 2):
- `VERB_TAP` (Ember) / `VERB_KEY_BURN`: `burnTarget(s, vx, vy)` (key: `NaN`); none → nothing;
  Flame ≤ cost·`costMul` → `fizz 'low'`; else pay (`chill −=`, `spent +=`, `o.paid =`), `state 1`,
  `t = burnTicks`, `burn`.
- `VERB_HOLD` / `VERB_KEY_HOLD` (Sprout): `growTarget(…)`; ≥ 0 → `el.hold = i`, `grow on`.
  `VERB_RELEASE` → `hold −1`, `grow off` (ignored with no hold).
- `VERB_WEST` / `VERB_EAST` (Gust): Lift ≤ swipe·`costMul` → `fizz 'low'`; else pay (`spent +=`),
  `wind += ∓/± kick · (in fog ? fogMuffle : 1)`, clamp, `gust`, `stats.gusts++`.
- `steer` (Drip): `dxTarget += steer`; `key` on a Drip leg: `dxTarget −= sign(key) · (|key| 2 ?
  keyFine : keyRate) · DT`; clamp `dxTarget` to ±`range`.

**`elGuide`** (in `guide.ts`, replacing v1's `heroGuide`; scene at the walker):
- Nubs: `now` = strict shade (`lit === 0`), `next` 0.6 s ahead (v1).
- Ember: `now[b] = lit[b] ≥ 2`; `next` the same 0.6 s ahead.
- Sprout: `now` = bins where the focus site's centre (§2.4) is not shaded (`gatherScene` +
  `shadeMask` at the site, margin 1); no focus, all 0; `next = now`.
- Drip, Gust: `now`, `next` all 0 (the dial shows the padlock).
- `g.lit`, `g.glare` at the walker with today's meaning (all legs).
- `g.tag` during a telegraph: per §4.1 (Drip's from `elTagMask`, §4.4).
- `deep`, `flake`, `flare`, `land` are 0.

**`elDeath`** builds the §10.4 line: an instant contact that took the meter to 0 names its object;
a continuous drain names the largest negative term that tick (puddle > rain > fog > light). Nubs
keeps today's `deathCause` lines unless a wall or a gap took him. `DeathInfo.cause` is `'cloud'` for
rain lines, `'plain'` for the rest (Nubs: today's).

**`hashState`** feeds, only `if (s.el !== null)`: the walker's `HERO_IDS` index, `relayIdx`,
`tagGrace`, `tagWatch`, `el.dx`, `el.dxTarget`, `el.wind`, `el.hold`, `el.spent`, `el.touch`,
`el.legTick`, `el.fell`, the cause's index (−1 none), then per object `EL_KINDS` index, `x`, `state`,
`t`, `paid`, `size`, `grown`, `light`, `casterId`, `hit`, `awake`, then the nine stats. Nubs runs feed
nothing new; `tagMask` is never hashed.

**Allocation:** none per tick in `step()`; events only when they fire; a tree's caster only when it
stands; `tagMask` once in `createEl`; scratch is module-level.

### 7.9 Input contract (`src/game/input.ts`, UI)

```ts
// InputHost additions (all optional; absent = today's behaviour)
  /** The walking element's verb now: HEROES[s.nubs.hero].verb on a Trial past the start beat, else 'sun'. */
  verb?(): Verb;
  /** CSS px → ground point (u) on the last drawn frame (§1.4); false outside the world viewport. */
  toWorld?(x: number, y: number, out: Float64Array): boolean;
  /** World units per CSS px on the last drawn frame (Drip's finger-exact steer). */
  uPerPx?(): number;
  /** True when a press at this ground point starts on a target now (core burnTarget/growTarget ≥ 0 for the verb). */
  canTarget?(wx: number, wy: number): boolean;

// Input additions
  /** Called on every 'tag' (§4.1): ends the verb slot (a held-back press is dropped; an active hold sends VERB_RELEASE); with `all`, also ends the sun press (released at 0 °/s). */
  cut(all: boolean): void;
  // releaseAll() also sends VERB_RELEASE for an active hold.
```

**Recognition** (CSS px and ms; `TAP_MS 300`, `TAP_PX 12`, `HOLD_MS 220`, `HOLD_BREAK_PX 24`,
`SWIPE_MS 300`, `SWIPE_PX 24`, `SWIPE_RATIO 1.5`):

| `verb()` | A press… | Frames |
|---|---|---|
| `sun` | today, byte for byte | today |
| `burn`, `grow` | **off target** (`canTarget` false at its point): today's sun press. **On target**: a *held-back press* in the verb slot (below) | see below |
| `steer` | every press: horizontal motion → `steer += dx · uPerPx()`, no `dTheta`, release 0 | `steer` split over the batch like `dTheta` |
| `blow` | moving ≥ 24 px sideways within 300 ms with `|dx| ≥ 1.5·|dy|` → one gust that way, then the press is spent; no `dTheta` | `verb 4` or `5` |

**Two slots on `burn` and `grow` legs.** The **sun slot** is today's press (latest pointer wins among
sun presses). The **verb slot** takes a press that starts on a target while the slot is free (a press
on a target while it is busy goes to the sun slot). A held-back press sends **nothing** to the sun
(no `downEdge`, no `dTheta`, `down` false) until it resolves:
- `burn`: released ≤ 300 ms after the press and < 12 px from it → **tap**: `verb 1` + the press
  point. No catch, no turn: a coasting sun keeps coasting.
- `grow`: still (< 12 px) for 220 ms → **hold**: `verb 2` + the press point at recognition; it stays
  a hold until that pointer lifts (`verb 3`), moves ≥ 24 px from where it was recognized (`verb 3`,
  then it becomes a sun press as below; only the Sap already poured is spent), or the sim ends it. A
  second finger meanwhile is an ordinary sun press, so two-thumb play turns the sun while growing.
  Released before 220 ms → nothing.
- Moved ≥ 12 px before resolving (either verb), or held past 300 ms in `burn` → it becomes a **sun
  press** now: `downEdge`, plus the turn it moved since the press, replacing any sun-slot press
  (latest wins).

**Keys:** `burn` Up/W press → `verb 6`; `grow` Up/W down → `verb 7`, up → `verb 3`; `steer`
Left/Right are today's `key` (the sim steers with it, `key > 0` west); `blow` Left/Right press (not
repeat) → `verb 4/5` and `key` stays 0. Down/S and the coin tap snap only while `verb()` is `sun`
(`canSnap` is also false off Nubs legs).

**Wheel:** today's turn in `sun`, `burn` and `grow`; in `steer` it adds `steer` (6 u per line-mode
notch, 0.15 u per pixel, at most ±18 u per event); ignored in `blow`.

**Frames:** a queued verb lands on the first frame of the next batch; a second verb waits for the
following batch (queue of 4). `vx`, `vy` quantized to 1/8 u, `steer` to 1/64 u. **`takeFrames` resets
`verb`, `vx`, `vy` and `steer` to 0 on every frame of every batch** (frames are reused across runs).

`recordFrame` (core) copies `verb` only when non-zero, `vx`/`vy` only when `verb` is 1 or 2, and
`steer` only when non-zero, so a Nubs replay is byte-identical to today's.

**The ghost hand** (UI's existing DOM ghost, `ui.ts` `ghost-hand`, driven by `assist.ts`): the drag
ghost and the lesson hint are off whenever `verb()` is not `sun`. On an intro Trial the same DOM ghost
performs the intro element's verb (tap, hold, steer, swipe) anchored to the first target of that
element's first leg (the session maps its ground point to CSS px each frame, as `testWorldToScreen`
does) until the first successful verb of the run. ART builds no canvas ghost.

### 7.10 Render contract (ART)

`RenderInput` and `MechView` do not change. ART reads:

| ART needs | Source |
|---|---|
| Trial, legs, breeze, intro element | `s.trial` |
| Walker element, meter, health, safe, rate | `s.nubs.hero`, `nb.chill`, `heroHealth(nb)`, `elHealth(s)` (low cue), `nb.safe`, `nb.rate` |
| Objects and their states | `s.el.objs` (kind, x, y, r, state, t, paid, size, grown, light, casterId), `veiled` |
| Drip | `s.el.dx`, `s.el.dxTarget`, `laneOf` (widened path drawn ±38 u over Drip's stretch, from `relayY`) |
| Sprout | `s.el.hold`, `needOf`, `bridged`, `growLeft` |
| Ember | `burnLeft`, `burnSweet`, `contactTicks`, `burnTarget(s, NaN, NaN)` (the key's next target, outlined) |
| Gust and weather | `windAt`, `s.el.wind`, `weatherXAt`, `weatherGood`, `arriveTicks`, `walkerAt`, `s.el.touch` |
| Sun held | `s.sun.locked` (existing padlock art) |
| Go arcs | `s.guide.now` (Nubs teal, Ember amber with ray ticks, Sprout lime with leaf dashes), `s.guide.tag` (dashed, outside) |
| TAG chip, Tag Stones | `nextTagTicks`, `nextTagHero`, `HEROES[to].sunHeld`, `relayY`, `s.relayIdx` |
| Death beat | `s.death.who`, `s.death.heroCause` |
| Words, faces, glyphs | `HEROES` |

**ART builds:**
- **Element arts** (`render/heroes.ts`, `CharArt` on Nubs' two-layer cache): Ember (flame: calm /
  feasting in full light / low / doused with steam / snuffed), Drip (droplet scaled
  `0.85 + 0.25·size/100`; leaning while steering; drinking bulge; sizzle flash; evaporated steam
  column), Sprout (seedling: calm / holding, arms up with a glow line to the site / low Sap droop /
  falling), **Gust** (new: a **kite spirit**, a diamond body with a ribbon tail on the spring chain and
  the cloud face colour, leaning with `windAt`; soaked dark and dripping; fogged squinting; grounded
  flat). The kite keeps Gust's silhouette apart from the clouds it fights. ≤ 2 live strokes each;
  state frames in the key at ≤ 8 fps.
- **Object sprites** (one cached sprite per kind and state; one `drawImage` each): bramble, gate, ice
  (intact, burning frames ×3, melting); gap and stream with a vine bridge growing across (length ∝
  `grown / need`); plot (soil, sapling ∝ `grown`; the tree itself is a caster drawn by the caster
  renderer); puddle (ripple), stone (orange glow, two shimmer frames); rain cloud (a dark cloud body
  drawn 50 u above its footprint, ≤ 1 stroke path of streaks; its shadow comes from the proxy, and
  `drawClouds` skips kind `'rain'`); fog bank (a cached radial sprite, veiling the trail beyond it at
  alpha 0.6; veiled targets drawn under it with no ring).
- **Telegraphs** of §2 and §3.6 (target rings, Ember's sweet band, tap-now pulse, too-late cross,
  burn progress and own-fire glow, douse chevron, hold ring and glow line, growth bars, wet drops,
  bridge check / red chevrons, Drip's target dot, arrival ghosts in `weatherGood` colours with the
  "push me here" arrow, edge markers, the wind chip, the SUN HOLDS badge on the NEXT chip). The
  telegraph layer is drawn **above casters' canopies and clouds**, so a target under a canopy is still
  marked.
- **The dial**: Nubs teal; Ember and Sprout as above; Drip and Gust: padlock and no arcs; the gauge is
  the walker's meter in its colours (§2), with the low-health cue from steady health 25 (never for
  Sap); the coin slot shows the Cold Snap coin on Nubs legs and a non-interactive meter pill (glyph and
  number) on the others (the pill never sets `HudState.meterShown`, so `hudMeterHit` is false off Nubs
  legs). The hot ring and heartbeat follow `nb.safe` (§1.2).
- **Camera fx** (`fx.ts`): no zoom pulses while a non-Nubs element walks (§1.4).
- **Death beats** per element and cause; the Melt Map draws no carrot for non-Nubs deaths.
- **Glyphs** (`render/glyphs.ts`): elements `nubs`, `ember`, `drip`, `sprout`, `gust`, `elementals`.
  No gesture glyphs on canvas (the one gesture icon set is UI's DOM SVGs). `volt` is removed.
- **Exports for UI:** `renderHeroPreview(canvas, hero, equipped)` (kept; Gust added).

**Events → fx, audio, haptics** (`Fx.onEvents`, `SfxRouter.route`, `hapticForEvent`; every v2 event
gets a case; `HAPTIC_PATTERNS` unchanged):

| Event | FX | Audio | Haptic |
|---|---|---|---|
| burn | flame burst on the object (ice: drip burst) | `burn` (v1 `blaze` crackle, renamed) | catch |
| burnOut | ash puff (ice → splash) | none | none |
| feed | the flame leaps into Ember, "+{n}" pop | `burn` at a higher pitch | catch |
| doused | steam puff | existing low `snapEnd` hiss | none |
| fizz | a small grey puff at the walker | existing `deny` | none |
| bump | object shatter, walker hop, "BUMP!" pop | `bump` (new: a soft thud) | crystal |
| fall | the walker drops out of view | `fall` (new: a falling slide) | (death) |
| grow on/off | glow line on/off | `grow` (v1 `seed` pluck, renamed) on start | bud |
| grown | "BRIDGE!" / "TREE!" pop, leaf burst | existing bloom chime | bloom |
| drink | splash, "+30" pop | `drink` (v1 `rain` plink, shortened) | flake |
| sizzle | Drip: steam flash; Ember: spark | existing low `snapEnd` hiss / existing flake bell | glare |
| gust | wind streaks across the view | `gust` (new: a filtered noise whoosh) | detent |
| touch | none (the walker art reads it) | rain patter while bit 2 | none |
| tagSoon / tag / tagClean | v1 (chip, TAG! stamp, CLEAN! pop) | v1; no `lock` cue on Trials | v1 |

v1's `strike` recipe and the strike pop are removed.

### 7.11 UI and meta contract

**Types** (`src/ui/types.ts`): `ScreenId` keeps `'elementals'`; `UiCallbacks` keeps `openJourney(to?)`
and `renderHeroPreview(canvas, hero)`. LEGAL transitions unchanged.

**Save** (`src/meta/saveTypes.ts`; stays `v: 4`):

```ts
/** Elementals v2 (docs/ELEMENTALS_V2.md): best stars per Trial (index n − 1, 7 entries, 0..3) and whether the screen was opened. Absent until either. */
export interface Elementals2State { stars: number[]; seen: boolean }
// Save
  elementals2?: Elementals2State;
// v1's `elementals` is removed from the type: sanitize no longer emits it (its Trials were replaced).
```

- **Sanitize:** emit `elementals2` only when the raw save has it; 7 entries of 0..3 and a boolean.
  `defaults()` and `migrate(defaults())` stay deep-equal.
- **Merge** (`mergeSaves`, `joinSaves`, `absorb`): stars max per index, `seen` is `a || b`, a missing
  side never deletes (the v1 rules, on the new field).
- **v3 upgrade:** writes `elementals2 = { stars: zeros(7), seen: true }` where v1 wrote `elementals`.

**Progression** (`src/meta/progression.ts`): the v1 helpers read `elementals2`
(`trialBest`, `trialOpen`, `heroUnlocked`, `nextOpenTrial`, `markElementalsSeen`, `elementalStars`);
`trialOpen` and the Title pill also need `tutorialDone`; `ELEMENTAL_STARS_MAX` 21; first pass +20
Snow; XP through `awardRun`; no missions, achievements or trophies. The Journey's fields never change.

**Params** (`src/game/params.ts`): `?trial=1..7`; `?elfix=1` (behind the `makeBot` gate); `?hero=`
removed.

**Session** (`src/game/session.ts`):
- `InputHost.verb`, `toWorld` and `uPerPx` (from the renderer's last view), `canTarget` (core
  `burnTarget`/`growTarget` by verb); `cut(all)` on every `tag` per §4.1; `canSnap` false off Nubs legs.
- A Trial's prepared build targets `finishY + hardAhead` (core `prepareRun` does it).
- The cue line (aria-live) announces each TAG: "{Name}'s turn: {verbLine}." plus " The sun holds."
  when `sunHeld`.
- Recap tip: the `CAUSE_TIPS` lookup of §7.2 (Nubs melting: today's recap tips).
- Pause card: "Trial 3 · Green Bridge", the walking element's tagline, then its `verbLine` and
  `keyLine`.
- `fillAudioView`: health is the walker's steady health; the sizzle and crackle only while Nubs walks
  (v1 rule).
- `game/campaign.ts` trial variants kept; Dare glyphs `burns → ember`, `drinks → drip`,
  `trees`/`grove → sprout`, `cloudRide → gust`.
- **Retry from the Tag Stone** (T1-T4): the session records each intro run's frames (core
  `recordFrame`). When the run failed in leg ≥ 1, Results offers "Retry from the Tag Stone" beside
  Retry: it replays the recorded frames headless on a fresh run of the same config up to the
  telegraph start of the TAG that began the failed leg (deterministic: the same state the player had),
  then hands control back through the session's resume path (as after Pause). Stars from that run
  count as usual.

**Tips** (`src/game/moments.ts`): `ELEMENT_TIPS: Record<HeroId, [TipOn, string][]>`, `RELAY_TIPS`
and `MIXER_TIPS: Record<number, [TipOn, string][]>` (§10.3) replace v1's HERO/RELAY/DUO tips. New
`TipOn` values: `'target'` (the walking element's first eligible object enters the window), `'low'`
(its steady health first under 40), `'water'` (Ember: first puddle or rain ahead in the window;
Sprout: first rain on Sprout or a site), `'stone'` (Drip: first stone ahead), `'plot'` (Sprout:
first plot in the window). `'tag'` means "this element's first leg begins" (at go for leg 0). Shown
until the Trial is passed (`elementals2`).

**Test hook** (`session.testState()` and helpers; mirrored in `tests/e2e/helpers.ts`; lands in C0b):

```ts
// state() keeps hero, relay, charge; replaces mate/meters with:
  meter: number;                 // s.nubs.chill
  verb: Verb;                    // HEROES[hero].verb
  sunHeld: boolean;              // s.el !== null && s.sun.locked
  theta: number; omega: number;  // s.sun.theta, s.sun.omega (the tap-leaves-the-sun-alone checks)
  el: null | {
    dx: number; wind: number; hold: number; spent: number;
    objs: { k: ElKind; x: number; y: number; state: number; size: number; grown: number; veiled: boolean }[];
    burns: number; drinks: number; trees: number; bumps: number;
  };
// runCfg() loses `hero`.
// new
  testWorldToScreen(x: number, y: number): { x: number; y: number };  // CSS px of a ground point on the last drawn frame
  testSkipToLeg(i: number): void;  // fast-forwards the Trial headless with the core reactive bot until relayIdx === i, then hands back to the input
```

**Elementals screen** (`src/ui/screens/elementals.ts`, `styles/elementals.css`): v1's layout with
five hero tiles (Nubs, Ember, Drip, Sprout, Gust; locked: "Pass T1" etc.), seven Trial tiles (two
columns, the last row single), the stars chip "n/21". The stage shows the preview, name, element
chip, tagline, three rule chips, and in place of v1's dial swatch the **verb row**: the gesture icon
(`g-tap` …, the one gesture set, DOM SVGs UI adds to `src/ui/icons.ts`), `verbLine`, then `keyLine`
in small text. Trial tiles show the cast's faces in leg order (T7: five faces). Everything else
(selection, Play, celebrate, seen) is v1.

**Title pill:** the four new faces are Ember, Drip, Sprout, Gust; shown once `tutorialDone`; NEW
until `elementals2.seen`.

### 7.12 Stubs until merge

| Team | Has from C0b (and C0c once it lands) | Works around until the others merge |
|---|---|---|
| CORE | everything | nothing: verifies headless (`sim --trials`, unit tests) |
| ART | C0b: trials load and walk; objects at their places; `?elfix=1` shows every object kind and state; the test hook. C0c: live states (the skeleton burns, pours, grows, drifts, steers); Nubs' meter rule for every walker; the arcs of every leg are Nubs' mask | previews costs, feeds, contacts, veils, fire spread and deaths by merging `elementals2/core` locally (never committed) |
| UI | C0b: the API stubs (so `canTarget` is false and every press is a sun press until C0c), `levelOutcome` gives trial stars, all copy exists, the test hook. C0c: every verb works, so gestures, keys, `cut`, the hook and e2e flows run | death lines read Nubs' until CORE's `elDeath`; the hero preview for Gust calls `renderHeroPreview(…, 'gust')`, which draws Nubs until ART lands Gust |

### 7.13 Team task lists and acceptance

**CORE:** C0a, C0b, C0c; the element rules, costs, feeds, contacts, fire, plants, weather, veils,
lane, deaths, guide and the Drip mask; hash; `--trials` (audits, pathBot, G0-G7, `--pick`, `--perf`);
core bots (`elPolicy`, humanEl, the spam and tap-on-sight variants); pin the 7 salts; the `trials`
golden; unit tests (§9.6); `src/core/README.md` §17 rewritten for v2. **Accept** when every
non-`trials` golden key is byte-identical, `sim --trials --check` passes, `bench-step` holds, and the
branch's build delta over C0b (C0c included) is ≤ 14 KiB.

**ART:** element arts and the Gust kite, object sprites, telegraphs, edge markers, dial and gauge per
element, the coin slot's meter pill, the widened path, wind chip, glyphs, death beats, fx/audio/haptic
cases, `render.spec` cases. **Accept** when the Nubs frame is unchanged (existing render specs), §9.4
and §9.5 hold, and the delta over C0b is ≤ 20 KiB.

**UI:** input slots, verbs and keys, session wiring, the ghost hand's verb mode, save/merge/progression
on `elementals2`, params, tips, pause card, cue announcements, Retry from the Tag Stone, the screen
and Title pill, e2e (§9.6), READMEs. **Accept** when every existing e2e passes, the new ones pass, and
the delta over C0b is ≤ 7 KiB.

---

## 8. What v1 code is removed, and what is kept

| File | Removed (C0a) | Kept / adapted |
|---|---|---|
| `src/config/heroes.ts` | Volt, `AbilityKind`, ability names/lines, v1 copy, `SMOTHER_TIP` | the shape of `HeroInfo` (v2 fields), `HERO_IDS` |
| `src/config/trials.ts` | the eight v1 TrialDefs, `TrialDuo`, `duo`, v1 Dare kinds | ids, `trialDef`, `trialLevel`, `anyLevelDef`, `isTrialId`, `levelTag`, `levelShort`, `trialStars` |
| `src/config/tuning.ts` | `heroes` (duoDx, snapSmother, harmonyMul, ember/sprout/volt/drip tables) | tag numbers move into `elements` |
| `src/core/objects.ts` | `SEED_ID_BASE` | its slot becomes `EL_ID_BASE` |
| `src/core/sim/heroes.ts` | `rateAt` (Ember, Sprout), `heroRates`, `safeAt`, `heroMask`, `bodyTick`, `strike`, `greenThumb`, `applyHeroDaylight`, `castHero`, `abilityHero`, `abilityBody`, `heroFlake` (non-Nubs), `heroDeath` (non-Nubs) | `heroHealth`, `heroStart`, `tagTick`, `nextTagTicks`, `nextTagHero`, `tagLocked`, `relayY`, `updateRelay` (moved into `elements.ts`) |
| `src/core/sim/guide.ts` | `heroGuide`'s duo, Volt and Drip parts, `centreWeights` | becomes `elGuide` |
| `src/core/sim/{types,events,snapshot,create,step,hash,pickups,mechanics,bots}.ts` | mate, duo positions and coverage, v1 hero fields, events, stats, the smother, v1 bot branches | the trial gate, relay fields, Nubs' trial path |
| `scripts/sim16/trials.ts` | table/duo/Drip DPs for v1 heroes, `striker`, `GATE_WAIVERS` | the module shell, variants, `--pick`, worker pool, the Nubs table DP |
| `src/render/heroes.ts` | Volt, sky bolt, Harmony tether, dial legend, Drip temperature tints, BLAZE/CLOUDBURST states | the cache, faces, blades, Ember/Sprout/Drip bodies, Tag Stones, NEXT chip, preview, tokens |
| `src/render/halo.ts` | duo arcs and split gauge, Volt dead zone and notches, Drip beads and thermometer, Harmony band colour | Ember ray ticks, Sprout leaf dashes, the tag dashes, the gauge |
| `src/render/{renderer,hud,nubs,banners}.ts` | mate sprite and pose, duo camera midpoint, Volt hot-ring rule, timed-ability coin ring | trial dispatch, coin TAG chip |
| `src/game/fx.ts`, `src/audio/{recipes,sfxRouter}.ts`, `src/platform/haptics.ts` | `ability`, `abilityEnd`, `strike`, `heroPickup` cases, the SEED sunflower fx; `strike` recipe | `blaze` → `burn`, `seed` → `grow`, `rain` → `drink`, `tag` |
| `src/game/{moments,session,params,campaign}.ts` | HERO/RELAY/DUO tips, duo tagline, smother tip, `?hero=` | trial routing, card/HUD/goal variants |
| `src/ui/screens/elementals.ts`, `src/meta/*` | dial swatches, duo stage, v1 `elementals` save field | the screen, Title pill, helpers (on `elementals2`) |
| tests | `heroes.test.ts`; v1 cases in `trials`, `determinism`, `render`, `audioRouter`, e2e `elementals` | replaced per §9.6 |

---

## 9. Invariants and gates

### 9.1 Nubs and the Journey stay identical

- Every v2 rule is gated on `s.el !== null` (implies `s.trial !== null`). In Endless, Daily,
  challenge and Journey runs the code paths are today's apart from those null checks; no new rng
  draws, ids or hash feeds; `syncTime` is untouched.
- `tests/golden/hashes.json`: only the `trials` key changes, at C0b and at CORE's merge; every other
  key is byte-identical at C0 and at every merge.
- Journey: `CAMPAIGN_LEVELS` 200 entries; `levelDef(0/201/1.5/1001)` null; `levelBakeKey`,
  `BAKE_VERSION` 4, `levelBake.gen.ts`, `FEAT_KINDS` unchanged; `sim --campaign` plays 1..200 only.
- No new concept, forecast, caster kind or biome (the tree is the catalog's `tree`); `CONCEPT_IDS`,
  `CASTER_KINDS`, `FORECAST_IDS`, `PLAN_WEIGHTS` untouched. `CloudKind` gains `'rain'`, made only on
  Trials.
- `WorldConfig`, the generator and the validator are unchanged; trial objects are runtime state; no
  generated caster is ever removed (§3.2).
- **InputFrame and replays:** the new fields are optional, reset to 0 by `takeFrames` on every frame,
  never non-zero in `sun` mode, ignored by the sim without `s.el` (and `vx`/`vy` read only with verbs 1
  and 2), and copied by `recordFrame` only when set: Nubs frames, replays and hashes are unchanged.
  Challenge codes encode no frames and do not change.

### 9.2 Determinism (src/core/README.md §1)

- Only `+ − * /`, the allowed `Math.*`, and `dmath` ports in core and config (architecture test). No
  `pow`, no `exp`: `keep` is a literal; `weatherXAt` loops.
- Sentinels −1 and −1e9, never NaN in state (`NaN` only as the "no point" argument of the target
  reads, never stored).
- Inputs enter quantized (1/8 u points, 1/64 u steer); a Trial replay with verb frames is
  bit-identical (determinism test on T5 and T7). The Drip mask (§4.4) is computed inside step() from
  state only, so bots that read it stay deterministic.
- Layering: config imports config; core imports core and config; render imports config and core;
  ui and meta import config, core and meta; game may import all but never writes the sim's state
  outside `step()`.
- No per-tick allocation in `step()`.

### 9.3 Bundle budget: 810 KiB = 829,440 B

**Where we are.** `build:single` is 797,416 B at 6b23531 against the lead's 780 KiB (798,720 B).

**What removing v1's sun-variant rules frees** (minified JS attributed per source line by the
`build --mode single --sourcemap` map at 6b23531; the CSS is untouched):

| Source | v1 bytes freed |
|---|---|
| `core/sim/heroes.ts` (all but tag helpers, relay, health, Nubs' path) | ≈ 5,900 of 7,561 |
| `core/sim/guide.ts` `heroGuide` | ≈ 1,540 |
| `render/halo.ts` duo, Volt, Drip modes and gauges | ≈ 3,150 of 17,454 |
| `render/heroes.ts` Volt, bolt, tether, legend, v1 states | ≈ 1,950 of 7,240 |
| `render/renderer.ts` duo and Volt cues | ≈ 1,140 |
| `audio/recipes.ts` + router (strike, v1 ability cases) | ≈ 1,020 |
| `game/fx.ts` ability, strike and SEED cases | ≈ 745 |
| `ui/screens/elementals.ts` dial swatches, duo stage | ≈ 500 |
| `render/hud.ts` timed-ability ring; `game/session.ts` duo bits; `game/params.ts` `?hero=` | ≈ 750 |
| **Rules and presentation freed** | **≈ 16,700 B (16.3 KiB)** |
| v1 copy and data that v2 replaces (`config/heroes.ts` 1,305 + `config/trials.ts` 3,948, v1 tips 1,271, v1 save field ≈ 400) | ≈ 6,900 B, replaced by v2's |

**The new budget is 810 KiB = 829,440 B.** Allowances are set from v1's **measured** per-feature cost
(docs/ELEMENTALS.md §5.3: CORE's hero sim +8.5 KB, ART +19.1 KB, UI +12.1 KB of which the screen
was 4.7 KB and is kept), scaled to v2's scope: CORE gains object rules, fire, plants, weather, veils,
the lane and the Drip mask (≈ 1.6× v1's rules); ART gains ten object kinds and the Gust kite but loses
the duo and Volt dial modes; UI gains the input slots and the tips but reuses the screen. Reason
(recorded by the integrator in `docs/V1_6_PLAN.md` A3 and `docs/UI_V2.md` §13 at the final merge):
"Elementals v2 (docs/ELEMENTALS_V2.md): four elements with their own verbs and factors, their world
objects (walls, crossings, plants, puddles, stones, weather, fog, fire), seven Trials; v1's
sun-variant heroes removed (≈ 16.3 KiB freed); allowances sized from v1's measured costs; shipped
feature code, not dead code."

| Step | Size gate |
|---|---|
| C0a + C0b (demolition ≈ −23,600 B, v2 config and copy ≈ +5,600, stubs, wiring and hook ≈ +2,000), measured with a real build and published before branching | ≤ 782,000 B |
| CORE branch over C0b (C0c skeleton ≈ 5 KB, costs, feeds, contacts, fire, veils, element meters, `elGuide`, the Drip mask, death lines) | ≤ +14 KiB (14,336 B) |
| ART branch over C0b (Gust kite and adapted arts, object sprites, telegraphs, edge markers, dial and pills, fx, 3 recipes) | ≤ +20 KiB (20,480 B) |
| UI branch over C0b (input slots and recognition, tips, ghost verb mode, Retry from the Tag Stone, pause card, screen verb row, cue line) | ≤ +7 KiB (7,168 B) |
| Integration reserve | 829,440 − 782,000 − 41,984 = 5,456 B (more if C0 lands lower) |
| **Release** | **`build:single` ≤ 829,440 B** |

Every commit message states its measured `build:single`. Over its allowance a team applies **its
cut list in order** before asking for anything; an amendment is only for what is left after the
whole list.

| Team | Ordered cut list |
|---|---|
| CORE | 1. `stats.gusts` and the `touch` event (ART reads `el.touch`); 2. Drip mask refresh after it completes (computed once, not cycled); 3. per-object death-line names collapse to the kind word |
| ART | 1. burn frames 3 → 1 (static flame overlay); 2. Gust state frames (soaked, fogged, grounded) → tints; 3. wind-chip arrows → one arrow and the number; 4. fog veil gradient → flat alpha; 5. Drip's drinking bulge and lean; 6. object particle flourishes (ash puff, leaf burst, steam) → the existing generic puff |
| UI | 1. Retry from the Tag Stone; 2. wheel steering on Drip legs; 3. the ghost hand's easing; 4. the cue line's verb text (the name stays) |

**Never cut** (they teach a rule): the sweet band, tap-now pulse and too-late cross; the late-bridge
chevrons; the hold ring and growth bars; the arrival ghosts in their colours and the edge markers;
the veil marking; the SUN HOLDS badge and the dashed pre-TAG arcs; the meter pills' numbers; the
ghost hand itself (its easing may go); accessibility; copy that teaches a rule. The feature is not
compiled out of `build:single`.

### 9.4 Performance and draw budget

- **Sim:** Nubs runs unchanged (`bench-step`, `bench-step --gen`: ≤ 1.10 step, ≤ 1.5 guide, as in
  v1's gate). A Trial tick ≤ 1.25× a Nubs tick (the Drip mask's one `litMask` per tick included) and a
  Trial guide refresh ≤ 1.3× (`sim --trials --perf`). If the mask breaks the tick budget, it samples
  one point every 2 ticks (starting 480 ticks before the TAG; still complete before the telegraph). A
  Trial's `createRun` on a prepared build ≤ 5 ms; unprepared ≤ 80 ms.
- **Render, Nubs frame** (`render.spec`: 390×844, DPR 1, seed 42, 9:12 AM): drawImage ≤ 190, fill
  ≤ 190, stroke ≤ 77, full-screen passes ≤ 3. Unchanged.
- **Render, Trial frames** (`?trial=1..7&test=1`, `testSkipToLeg(1)`, frozen 3 s into leg 1): the same
  ceilings. Objects one `drawImage` each from cached sprites; burn frames ≤ 3 at ≤ 8 fps; rain ≤ 1
  stroke path per cloud; fog one sprite per bank; the widened path one extra fill; telegraphs and edge
  markers ≤ 10 strokes in all. Walker layer redraws ≤ 12/s (v1 rule). No `shadowBlur`, per-frame
  gradients or new full-screen passes. T4 (oldtown) may set its fill ceiling to its measured value +
  10 if the town alone exceeds 190, recorded in §13 as v1's T3 was.

### 9.5 Accessibility

- **Every verb has keys** (§1.3), and the Pause card and the screen's verb row print them.
- **Colour is never the only channel:** wall materials have distinct shapes (thorns, planks, crystal);
  the sweet band is hatched; "tap now" pulses and "too late" carries a cross; the bridge state is a
  check or chevrons; arrival ghosts are dashed, harmful ones get a "!" over the trail and helpful ones
  a leaf or drop mark; meter pills carry their number; go arcs keep v1's patterns (Ember rays, Sprout
  leaf dashes); high contrast thickens patterns and outlines objects.
- **Reduced motion:** no flame flicker (one frame), no hop, no wind streaks, no shake or slow-mo;
  weather and fog still move (they are rules), drawn without wisps.
- **Screen reader:** each TAG is announced through the cue line (§7.11); the Elementals screen keeps
  v1's labels ("Trial 3, Green Bridge, Nubs, Sprout, 2 of 3 stars", "Gust, locked: pass Weather
  Vane").
- **Targets:** 32 u of reach is a 32 CSS px radius at 360 px wide (35 px at 390); hero tiles
  ≥ 64 px, other controls ≥ 48 px; Lilita never under 15 px.

### 9.6 Tests each team adds

**CORE:**
- `elements.test.ts`: the §2.7 table; start meters (and `tune.legStart`) and the TAG resets
  (`spent` 0); the sun lock on Drip/Gust legs and θ carried exactly; tap costs, refusal, burn times,
  burn-out results (ice → puddle); **feed**: an own bramble tapped inside its sweet window costs 0 net,
  one tapped on sight costs its price, an untapped one bumps 30; a spread fire passes without refund;
  `burnLeft`/`burnSweet`/`contactTicks` against stepping; target rules (walls before puddles, plots
  never, puddles only on Ember's own path before the TAG, footprint distance, veiled excluded);
  spread (on and off at 15 u/s, downwind only); douse by rain (a tap under a shower is lost); holds
  pour, cap, end at TAG and near; growth ×1 shade, ×2 lit, ×3 wet (wet under the cloud's own shade);
  Sap root and rain; Sprout's safe from `growLeft`; bridges and trees (caster id, scale, removal by
  fire); the contact table row by row (falls included); Drip's lane from prism parts only, the clamp
  on `dx` not `dxTarget`, slide; the key sign; wind kick, muffle, clamp, decay and the swipe cost and
  refusal; weather wake, drift, prune, the proxy cloud's shade, the veil rule; `weatherXAt` equals
  stepping; `weatherGood` by stretch; `elHealth` (Ember's spending added back, feeds subtracted);
  the Drip mask equals a direct computation; the stand-tick bounds of §6.2 on a fixture; death lines
  and causes; a Nubs-run hash unchanged; changing any `ElObj` field changes a Trial hash.
- `trials.test.ts`: config functions; `isTrialId(1008)` false; G0, G1, G2, G5 on all seven (≤ 30 s).
- `golden`: the `trials` key (reactive bot, salt 0, `hashState` every 600 ticks plus the end).
- `determinism`: T5 and T7 replays with verb frames; a Nubs replay recorded through `recordFrame`
  equals today's frames on the original seven fields.

**ART:** `render.test.ts` (element sprite keys quantize; Nubs' art unchanged; object sprite caches;
`drawClouds` skips `'rain'`); `audioRouter` (every v2 event maps to a cue or an explicit none; no
`lock` cue on Trials); `haptics.test.ts` (patterns unchanged); `render.spec` (the §9.4 Trial frames;
`?elfix=1` frames of every object state; reduced motion and high contrast on T2 and T4).

**UI:**
- `game.test.ts` (input): each verb mode's recognition and thresholds; **a tap on a target leaves θ and
  a coasting ω unchanged** (no `downEdge`, no `dTheta`); a held-back press that moves 12 px becomes a
  sun press with its turn; a hold that moves 24 px releases and becomes a sun press; a second pointer
  during a hold turns the sun and the first pointer's lift still releases the hold; presses off
  targets are today's; quantization; keys per mode (`verb 6/7/3`); `cut(false)` keeps a sun drag and drops the verb slot, `cut(true)` ends both; `cut` and `releaseAll()` release
  a hold; `takeFrames` resets the new fields every batch; **a scripted pointer and key sequence in
  `sun` mode produces frames equal to today's on the original seven fields.**
- `save`, `saveSync`, `progression`: `elementals2` sanitize, merge, upgrade, helpers, isolation from
  the Journey, the `tutorialDone` gate; v1 `elementals` no longer emitted.
- `ui-logic`, `moments` (v2 tips and triggers).
- e2e `elementals.spec.ts`: entry and lock states; T1 from the screen starts level 1001 with hero
  `nubs`, and after `testSkipToLeg(1)` hero `ember`, verb `burn`; a tap on the first wall (via
  `testWorldToScreen`) sets it burning and leaves `theta`/`omega` unchanged; ArrowUp burns the next
  wall; T2 leg 1: a drag moves `el.dx` by the finger's world distance and leaves θ unchanged,
  `sunHeld` true, ArrowLeft steers west; T3 leg 1: a 1 s press on the first plot grows it, and a 1 s
  press on the first gap grows it; T4 leg 1: a left swipe makes `el.wind < 0` and `el.spent` 8; the
  Pause button pauses on a Drip leg with no steer; the coin snaps on a Nubs leg and not on an Ember
  leg; `bot('reactive')` passes T1 and T4; Results "Trial 1", Retry, Retry from the Tag Stone (after a
  leg-1 failure it resumes at the telegraph with the same `el` state), Map; the stored save has
  `elementals2.stars`, Journey stars untouched.
- e2e range check at 360×640 and 1280×720: `testWorldToScreen` of a point 340 u ahead of the walker
  lies below the HUD band's bottom.
- `back.spec` and `layout.spec` as v1 (the screen at 360, 390 and 1280; seven tiles).

### 9.7 Release gates (the integrator, after the last merge)

1. `npm run typecheck`
2. `npm test` (architecture scan included)
3. `node scripts/golden.ts`, then `git diff tests/golden/hashes.json`: only `trials` differs from the
   base
4. `npm run sim -- --check --seeds 40`
5. `npm run sim -- --campaign --bot all --tries 3` (oracle 200/200)
6. `npm run sim -- --trials --check` (G0-G7 and G5b on all seven) and `--perf`
7. `node scripts/bench-step.ts` and `--gen`
8. `npm run e2e` on both projects
9. `npm run build:single` ≤ 829,440 B, the amendment recorded (§9.3)

Then the integrator adds a "Superseded by docs/ELEMENTALS_V2.md" line under `docs/ELEMENTALS.md`'s
title and writes this doc's §13 as-built record (merge, calibration, deviations, gate results). No
commits or pushes outside the normal merge flow. Never run `playwright install`.

---

## 10. Copy (binding; short, warm, plain)

### 10.1 Elements (`HEROES`)

| id | name | element | tagline | rules (3 chips) | meter | verbLine | keyLine | sunHeld | glyph / gesture | face | intro | deathTip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nubs | Nubs | Ice | Stay in the shade. | Shade cools · Sun melts · Drag turns the sun | Chill | Drag: turn the sun | ← → turn the sun · ↓ Cold Snap | no | nubs / g-drag | ice | 0 | (today's recap tips) |
| ember | Ember | Fire | Burn a way through. | Tap walls to burn · Light refuels · Water douses | Flame | Tap: burn a wall | ↑ burns the next wall · ← → turn the sun | no | ember / g-tap | red | 1 | Tap each wall when its ring pulses: Ember takes its own fire back. Light refuels. |
| drip | Drip | Water | Steer for shade and puddles. | Drag to steer · Puddles grow · Sun shrinks | Size | Drag: steer Drip | ← → steer | yes | drip / g-steer | blue | 2 | Before Drip's turn, set the sun on the dashed arcs, then steer into the shade. |
| sprout | Sprout | Nature | Grow the way ahead. | Hold to grow · Bridges cross gaps · Sun and rain speed it | Sap | Hold: grow a plant | Hold ↑ grows the next one · ← → turn the sun | no | sprout / g-hold | green | 3 | Start each bridge as soon as you see the gap: plants take time to grow. |
| gust | Gust | Air | Blow the weather away. | Swipe to blow · Each swipe costs Lift · Rain soaks | Lift | Swipe: blow the wind | ← → blow (each costs Lift) | yes | gust / g-swipe | cloud | 4 | Swipe early and only when you must: the wind keeps pushing, and each swipe costs Lift. |

### 10.2 Intro cards (`TrialDef.card`; kicker `levelTag(id).toUpperCase()`)

| n | title | chip | blurb (≤ 90) | goal | stars | dare |
|---|---|---|---|---|---|---|
| 1 | Kindling | NUBS ▸ EMBER ▸ NUBS | Tap each wall just before Ember gets there. Light refuels the flame. | Reach the finish | Finish · Burn all 7 · All ≥ 30 | Dare · Burn all 7 walls |
| 2 | Puddle Run | NUBS ▸ DRIP ▸ NUBS | Set the sun, then drag to steer Drip through shade and puddles. Dodge hot stones. | Reach the finish | Finish · Drink 6 · All ≥ 30 | Dare · Drink 6 puddles |
| 3 | Green Bridge | NUBS ▸ SPROUT ▸ NUBS | Hold on the ground ahead: vines bridge gaps, trees shade Nubs. Sun speeds them. | Reach the finish | Finish · Grow 2 trees · All ≥ 30 | Dare · Grow 2 trees |
| 4 | Weather Vane | NUBS ▸ GUST ▸ NUBS | Swipe to blow rain and fog off Gust's path. Each swipe costs Lift. | Reach the finish | Finish · Rain ride 1 s · All ≥ 30 | Dare · Ride a rain cloud 1 s |
| 5 | Steam | NUBS ▸ EMBER ▸ DRIP ▸ NUBS | Melt the ice for Drip: every puddle grows him. Puddles and rain douse Ember! | Reach the finish | Finish · Drink 4 · All ≥ 25 | Dare · Drink 4 puddles |
| 6 | Rain Garden | NUBS ▸ GUST ▸ SPROUT ▸ NUBS | Clear the fog for Sprout and blow the rain onto its path: rain feeds plants. | Reach the finish | Finish · Grow 3 trees · All ≥ 25 | Dare · Grow 3 trees |
| 7 | Five Elements | ALL FIVE ELEMENTS | Five elements, one day. The breeze spreads fire west: keep four trees. | Reach the finish | Finish · 4 trees standing · All ≥ 25 | Dare · Keep 4 trees standing |

The chip glyph is the intro element's glyph, or `elementals` for T5-T7. `levelCardFit` checks every
blurb at 360, 390 and 1280.

### 10.3 Tips (`moments.ts`; shown until the Trial is passed)

**ELEMENT_TIPS:**

| Element | Trigger | Text |
|---|---|---|
| ember | tag | Ember's turn! Tap a wall just before Ember reaches it. |
| ember | target | Tap when the ring pulses: Ember walks through its own fire and takes it back. |
| ember | water | Puddles and rain douse Ember, and rain puts fires out. Tap a puddle to dry it. |
| ember | low | Low flame! Turn the sun onto Ember to refuel. |
| drip | tag | Drip's turn! Drag sideways: Drip follows your finger. The sun holds. |
| drip | target | Puddles and shade grow Drip. Steer into them. |
| drip | stone | Hot stones shrink Drip. Steer around the orange glow. |
| sprout | tag | Sprout's turn! Hold on the soil patch ahead to grow a plant. |
| sprout | target | Hold on the gap now: a bridge takes time to grow. Sun on it helps. |
| sprout | plot | Hold on a soil patch to grow a tree: shade for Nubs later. |
| sprout | water | Rain gives Sprout sap and makes plants grow fast. |
| gust | tag | Gust's turn! Swipe left or right to blow the weather off the trail. |
| gust | target | Each swipe costs Lift. Swipe early: the wind keeps pushing. |
| gust | low | Low Lift! Swipe less and stay dry: clear air restores Lift. |
| nubs | tag (his second leg only) | Nubs again: drag to turn the sun and stay in shade. |

**RELAY_TIPS:** `tagSoon` (first telegraph into Drip): "Drip is next: the sun will hold. Turn it to
the dashed arcs now!"; `tagSoon` (first telegraph into Gust): "Gust is next: the sun will hold where
you leave it."; `tagSoon` (first telegraph otherwise): "Hand-off soon! The next element plays its own
way."

**MIXER_TIPS:** T5 `go`: "Melt the ice past the Tag Stone for Drip. Wait out the shower before you
burn."; T6 `go`: "Blow the fog off Sprout's path and the rain onto it: rain feeds Sprout."; T7 `go`:
"The breeze blows west and fire spreads with it. Keep four trees standing!"

### 10.4 Death lines (`elDeath`; `{time}` today's exact clock; `{Name}` the walker)

| heroCause | When | Line |
|---|---|---|
| melt | Nubs' Chill | today's lines ("Melted by You at {time}…") |
| fall | a gap (Sprout: also "the bridge wasn't ready") | {Name} fell into the gap at {time}. / Sprout fell into the gap at {time}: the bridge wasn't ready. |
| swept | an unbridged stream | Sprout was swept away by the stream at {time}: the bridge wasn't ready. / Ember fizzled out in the stream at {time}. |
| crash | a wall took the last of the meter | {Name} crashed into {a bramble wall \| a wooden gate \| an ice wall} at {time}. |
| snuff | Ember, no light | Ember's flame went out at {time}. |
| douse | Ember in a puddle | Ember was doused in a puddle at {time}. |
| rain | Ember under rain | Ember was doused by the rain at {time}. |
| evaporate | Drip in the sun | Drip dried up in the sun at {time}. |
| sizzle | Drip on a stone | Drip sizzled away on a hot stone at {time}. |
| soak | Gust under rain | Gust got soaked and grounded at {time}. |
| fog | Gust in fog | Gust got lost in the fog at {time}. |

**CAUSE_TIPS** (looked up as in §7.2):

| Key | Tip |
|---|---|
| `fall`, `swept` | Start each bridge early: hold on the gap as soon as you see it. |
| `crash` | Ember can burn walls past the Tag Stone. Clear the next stretch too. |
| `ember:crash` | Tap a wall when its ring pulses, before Ember reaches it. |
| `douse`, `rain` | Tap a puddle on Ember's path to dry it. Rain douses fire too. |
| `sizzle` | Hot stones glow orange. Steer around them. |
| `soak` | Rain soaks Gust. Push each cloud before it reaches the trail. |
| `fog` | Fog drains Gust and muffles its wind. Blow it away before Gust gets there. |

### 10.5 Other strings

| Where | Text |
|---|---|
| Title pill | "Elementals" with Ember, Drip, Sprout and Gust faces |
| Screen header / stars chip | "Elementals", "n/21" |
| Play button | "Play T3 · Green Bridge" |
| Locked trial toast / hero badge | "Pass {name} first." / "Pass T{n}" |
| Unlock toast | "{Name} joins the team!" |
| NEXT chip / sun badge | "NEXT ▸ {NAME} {s}" / "SUN HOLDS" |
| TAG announcement (cue line) | "{Name}'s turn: {verbLine}." (+ " The sun holds.") |
| Pops | "BUMP!", "BRIDGE!", "TREE!", "+30", "+{n}" (feed), "CLEAN!" |
| Stamp | "TAG!" |
| Meter pills | "Flame", "Size", "Sap", "Lift" (aria-label "{meter} {n}") |
| Wind chip | aria-label "Wind {west/east} {n}" |
| Results button | "Retry from the Tag Stone" |
| Pause card | "Trial 3 · Green Bridge", the tagline, then "{verbLine} · {keyLine}" |
| Results kicker / share | "TRIAL 3" / "SHADY Elementals · Trial 3 · Green Bridge" |
| HUD pill | "T3" |

---

## 11. Out of scope (cut, by decision)

- **Elements outside the Trials:** no element in Endless, Daily, challenges, the Journey or the
  comfort ladder; no free choice of element; no player-triggered swap.
- **Duos and Volt:** two walkers at once are gone; Volt (Storm) is parked for a later wave, with
  Umbra, Prism, Glint and Tide.
- **Free placement:** trees grow only on authored plots; walls, crossings and stones are authored;
  no generator support for any trial object.
- **Walk speed:** nothing slows or speeds the schedule (fog blinds and muffles instead).
- **v1 abilities:** no BLAZE, SEED, THUNDERCLAP or CLOUDBURST; the swipe-down is the Cold Snap's on
  Nubs legs only.
- **Extras:** no element cosmetics, Wardrobe entries, postcards, missions, achievements, trophies,
  new gamify Feature, element music layers, new particle kinds or new haptic patterns.
- **The v1.6 economy on Trials:** no Flow Ring, Frost Bank, Garden, glass, Heat Flares, Noon Heat or
  baked Dares.

---

## 12. Review decisions (round 1)

Every "must" of both reviews is resolved above; so is every "should" and "could" not listed here.
Where the reviews offered options, or where this spec chose differently, the choice and the reason:

| Item | Decision | Why |
|---|---|---|
| Taps and holds vs the sun press | Held-back press in a separate verb slot; a real second-finger sun press during a hold. Rejected: "a second pointerdown sends VERB_RELEASE" (and `begin()` releasing a hold). | The two-slot rule is the stronger fix both reviews named first; it keeps two-thumb play that the lime arcs invite. The gates still prove single-pointer play (§6.2, §6.3), so two thumbs are a bonus, never required. |
| Ember's timing | "Ember feeds on its own fire": walking through its own burning wall gives back exactly what it paid. Rejected: a reduced bump through a burning wall, and a `cost + 6` bonus. | A reduced bump keeps tapping on sight optimal. A bonus would make perfect timing a Flame source and the sun optional; at net zero, light stays Ember's fuel and timing saves 12-22 per wall. |
| Ember's Steady and low cues | Spending added back (`el.spent`), also for Gust's swipes; the hot ring still follows `safe`. | Spending is how both play; imminent danger is still shown by the hot ring and heartbeat. |
| Gust's anti-spam | 8 Lift per swipe, `windMax` 45 with `kick` 30 (not 40), waiting clouds on both sides of every Gust leg, four G5 spam bots (30- and 90-tick periods). | 40 with one swipe at the cap leaves no momentum to manage; the 90-tick bots catch economical one-way spam that Lift alone does not. |
| Sun ties the spec had added | Sap seeps back (`root` 5/s) and from rain (+15/s); Gust gets `air` 4/s in clear air; no thermals; no pre-TAG arcs for Gust. Puddles do not feed Sprout. | Each element keeps only the lead's tie. No Sprout stretch has puddles; rain alone gives the plant–water link without a new contact row. |
| T6's rain garden | The garden cloud now waits just past the Gust→Sprout TAG (Sprout 1.7 s, waking 4.05 s inside Gust's leg) over the garden plot and Sprout's walk, not over the stream. | With wake 400 u a cloud over the stream (≥ 4.5 s into Sprout's leg by the first-crossing rule) cannot wake inside Gust's leg. At the TAG its rain both feeds Sap and grows a plot ×3, and G7 makes it hard. |
| Weather wake | 400 u plus ART edge markers. Rejected: "400 u is always on screen". | The HUD band hides up to 64 u of the 408 u view, so 400 u is under the HUD on short screens; a smaller wake makes Gust's hand-offs unreachable. Edge markers keep what wakes visible. |
| Canopies over targets | The telegraph layer is drawn above canopies and clouds. Rejected: fading canopies. | Same result with no per-target fade pass and no new draw cost. |
| Drip's pre-TAG mask timing | Computed one point per tick from 300 ticks before the TAG (inside the previous leg), then cycled. Rejected: computing it during the 180-tick telegraph. | Arcs must be up when the telegraph opens; cycling keeps it current as trees and weather change. |
| Drip's touch radius | Sprite scale limited to 0.85-1.1; the contact radius stays fixed. Rejected: scaling the touch radius. | Size-dependent contacts would change the lane DP and the audit; a narrow sprite range keeps the drawing honest. |
| Retry loop | Both offered fixes: Elementals opens after `tutorialDone`, and "Retry from the Tag Stone" on the intros (first on UI's cut list). | Replaying the player's own frames is deterministic and cheap; gating on the lesson keeps first-timers on Nubs first. |
| The TAG cut | `cut(all)` on every TAG: the verb slot always ends (so a hold always releases), the sun press only on steer/blow TAGs. Replaces "cut only on steer/blow or an active hold". | Same effect for holds, and a second finger turning the sun during a hold keeps its drag across a grow→sun TAG. |
| Calibration levers | Added per-trial, per-leg levers and one object per leg; no waivers on G0, G1, G2, G5/G5b. | v1 needed levers far outside its bounds; every new lever is recorded beside its number. |
| Budget | 810 KiB with allowances from v1's measured costs and ordered cut lists, instead of 800 KiB with a 2.4 KiB reserve. | v1 overran every allowance by about 55% after cutting decoration; a budget that will be amended anyway is not a budget. |

---

## 13. As-built record

Written by the integrator at the merge: the C0b measured size, merge record, calibration (every moved
lever with its reason), deviations, gate results and the final `build:single`.
