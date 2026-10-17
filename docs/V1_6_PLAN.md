# SHADY v1.6: priced decisions

User feedback so far: "great concept", then "gameplay still feels shallow. core mechanics needs improvements" (which produced v1.5), and now "keep enhancing gameplay greatly before go to design". v1.6 changes gameplay only: rules, decisions, skill, systems, level structure, run structure, challenge and pacing. Visual design comes later. GAME work in this plan covers only what a player needs to read the new rules.

Where the numbers come from:
- The merged diagnosis from 7 lenses.
- 24 judged candidates.
- Skeptic verdicts on the top 7. Each skeptic ran closed-loop bots on a patched scratch copy of the code.

A number marked **measured** comes from those runs. Every other number is a starting value that CORE calibrates with `scripts/sim.ts`.

> **Integrator amendments (binding; they override the sections below where they disagree).**
> - **A1. No ruleset-15 compatibility.** The game is unreleased, so v1.6 does not keep a bit-identical v1.5 path. Drop `RunConfig.ruleset`, `RULES16_DATE`, the challenge `r` field, the dual hashing and the `sim --rules 15` gate. Keep `V16Rules`, `V16_ALL`/`V16_NONE`, `RunConfig.v16` (default all on) and `sim --off …` as kill switches and for with/without measurements (with every flag off the game should play like v1.5, but bit-identity is not required). `hashState` simply includes the new state. Goldens are regenerated once at integration, with the reason in the commit.
> - **A2. Three builders, not five.** CORE-1 (economy) and CORE-2 (world and Journey) as in §9; GAME takes §9's GAME list plus META's remaining items (mission retargets T8; the campaign soft-fail's per-level miss count as an optional save field, lossless, no save-version bump unless unavoidable). A contract agent lands §10 (minus A1) first.
> - **A3. Budget.** `npm run build:single` within 621.6 KiB + 20 KiB.

---

## 0. In one paragraph

v1.5 gave the sun three new verbs, but nothing put a price on them:
- the multiplier crashed whenever you used them;
- the frost meter filled by itself;
- flakes came free;
- the Cold Snap was a panic button;
- the Journey never asked for any of it.

v1.6 puts a price and a payoff on every second:
- **Flow Ring.** The multiplier bleeds away in idle sun, and a Cold Snap cashes it in.
- **Frost Bank.** The frost meter holds two snaps. Only risky plays earn them, and they keep overnight.
- **Brittle Flakes.** Greed sits on a different angle from safety.
- **Frost Garden.** A snap becomes a plant-and-land routine.
- **Heat Flares and Noon Heat.** Every day gets announced spikes and a boss.
- **Dares.** Every Journey level asks for the verb it teaches.

There is **no new gesture**. Drag still sets θ, swipe down still casts a snap, taps and keyboard work as today.

One frost story ties it together:

```
precision (shade) ──► Flow Ring ──► a snap cashes the ring ──┐
risk (bloom, glass cluster, fresh SWING, parry, landing) ────┼──► Frost Bank (2 snaps, kept overnight)
                                                             │          │
            Heat Flares, Noon Heat, shade gaps ◄─────────────┴── spend a snap
                                                                        │
            Frost Garden: plant under the frost cloud, land in it ──► ring + frost back
```

---

## 1. Diagnosis, and what answers it

| # | Diagnosis (merged) | v1.6 answer |
|---|---|---|
| 1 | The score measures only survival, and mastery only pays the cosmetic wallet. | **Ring**: precision becomes frost through the snap cash-in, so it becomes survival. **Bank**: risk becomes snaps. Snow is capped at x3. |
| 2 | The multiplier is out of reach (it resets after 9 lit ticks) and punishes the v1.5 verbs. | **Ring**: it bleeds instead of resetting. Growing a bud is exempt from the bleed. Tricks pump it. PHEW restores lost levels. |
| 3 | Play is following the paint, and sloppy edge-riding is cheap. | The **Ring**'s bleed scales with Σw, so edge-riding costs. **Flares** reward anticipating past the 0.6 s dial. **Brittle** adds a second target that disagrees with the teal. |
| 4 | The Chill tank sits idle, the frost meter sits full and unspent, and days have no memory. | **Bank**: cap 2, charges carry overnight, no passive income. **Noon Heat** and brittle detours spend Chill. |
| 5 | Choices are free or invisible, and the snap is a panic button that leaves the player blind. | **Brittle** puts a price on greed. The **cash-in** pays for snapping early. The **Garden** turns the snap into a routine. guide.deep, guide.flake and guide.land make the choices visible. |
| 6 | No run structure, no threat, no climax, and noon is not the boss. | **Flares** (announced 12 s or more ahead) and **Noon Heat** give each day a shape. Charges carry across days. Journey boss finales. |
| 7 | Journey levels don't ask for what they teach. | **Dares**, verb goals on teaching levels, and flare boss days. |
| 8 | Nubs is a cursor on rails, with no pattern vocabulary. | Partly: flares teach which shade is robust. A real formation vocabulary (Set Pieces) is the lead v1.7 item (§7). |

Left open on purpose:
- Daily tries 2 and 3 are still mostly memorization (the Draft, v1.7, fixes that).
- Glare still rarely matters (Lighthouse Mirrors, later).

---

## 2. The v1.6 set

Every rule below is behind its own `World.v16` flag (§5). With `RunConfig.ruleset: 15` all flags are off and the game is bit-identical to v1.5.

### 2.1 Flow Ring (the multiplier rebuilt)

**Pitch.** Your multiplier is a ring now. Shade fills it, tricks pump it, and idle sun drains it one level at a time. A Cold Snap pours the ring into your frost.

**Rules** (daylight only; frozen at night as today).

Level and charge:
- Level `nubs.mult` runs 1..5 (same meaning as today).
- Charge `nubs.ringCharge` is an integer. 5 units equal one tick of full shade.

Filling:
- A full-shade daylight tick adds +5 units (+10 in deep shade).
- Snap cover counts as full shade.

Bleeding:
- The first 6 ticks of a lit stretch are free (edge flicker).
- From the 7th lit tick, each tick costs `k[m]·Σw` units. Σw is the sum of the 5 sample weights (0..10; glare counts 2), and `k = [2, 3, 6, 12, 20]` for x1..x5.
- Purposeful exposure is exempt: there is no bleed on a tick that follows a tick where any bud grew. updateBuds runs after applyDaylight, so the rule reads the previous tick's `nubs.budGrewTick`.

Levelling up:
- Level costs are `need = [900, 1200, 1800, 2400]` for x1→x2 … x4→x5. That is 3, 4, 6 and 8 s of plain shade, 21 s from x1 to x5 with no tricks.
- When charge ≥ need, the level goes up, the remainder carries over, and the sim emits `multUp {level, reason}`.
- At x5 the charge is clamped to 0..2400 and works as x5's buffer.

Levelling down:
- When charge < 0 and m > 1: m −= 1, then charge = ¾ of the new level's need (an integer). The sim emits `multDown {from, to, cause: 'bleed'}`.
- At x1 the charge floors at 0.
- What that means in play: x5 in full sun lasts 0.4 s after the free ticks, x2 lasts 1.0 s, and edge-riding (Σw = 1) bleeds an x5 level away in 2 s.

Tricks:
- Each of these adds **+600**: a fresh SWING, a bloom, a saved glass cluster (§2.3), an own-sunflower landing (§2.4) and a flare parry (§2.5).
- Every 3rd consecutive flake or crystal taken with no `flakeMelt` in between adds **+300** (`nubs.streak`; a melt resets it).
- Each trick emits `ringTrick {kind, units}`.

Fresh SWING:
- A SWING is fresh when its new source is neither end of any SWING confirmed in the last 180 ticks.
- The record is `nubs.swFresh`, a ring of the last 8 (source id, tick) endpoint pairs.
- A SWING that isn't fresh still chains and pays Snow as today. The A→B→A farm pays nothing extra.

PHEW: sets m = max(m, `nubs.litStartMult`), the level at the stretch's first lit tick. It never adds a level above that.

Snap: cashes the ring in (§2.2).

Snow: a flake pays `round(min(m, 3)·snowMult)`, a crystal `round(5·min(m, 3)·snowMult)`. x4 and x5 pay through the cash-in, so cosmetic prices stay sane.

On ruleset 16 this replaces `mult.stepTicks`, `resetLitTicks`, `graceDeg` and `graceLitTicks`, and `multReset` is no longer emitted.

**Measured.**
- The proposal's flat 6·Σw bleed put reactive at x5 for 48-54% of daylight, so it was rejected.
- With the level-scaled curve above: reactive mean x3.34 with 16% at x5, humanDial (p0) x2.05, oracle x1.80.
- Today: reactive x1.5 with 2% at x5, humanDial x1.01-1.18.

**Teaching.**
- L2 (Flake Trail) tip: "Shade fills the ring. Idle sun drains it."
- L7 and L8: a "+ring" pop the first time a trick charges it.
- L10 intro line: "A snap pours your ring into the frost."
- Endless new-player runs (game/mechanics.ts, `NEW_PLAYER_RUNS`): a tip on the first drop from x3 or higher, and the first trick pop.

**Interactions.**

| System | How the ring interacts |
|---|---|
| SWING | Fresh SWINGs pump the ring. |
| Buds | Growing is exempt from the bleed; a bloom pumps. |
| Deep shade | Charges x2. |
| PHEW | Restores lost levels, never adds new ones. |
| Brittle flakes | A detour bleeds the ring: these flakes or your x4. |
| Flares | A parry pumps; a miss bleeds. |
| Clouds | A ride fills the ring. |
| Glare | Drains twice as fast. |
| Snap | Cashes the ring in. |

**Core state, events and tuning.**
- NubsState: `ringCharge`, `litStartMult`, `budGrewTick`, `streak`, `swFresh`, `swFreshN`.
- RunStats: `multTicks` (Σ m over daylight ticks), `x5Ticks`, `multDowns`, `ringTricks`.
- Events: `multDown`, `ringTrick`, `multUp.reason`.
- Tuning: `TUNING.ring`.
- Files:
  - nubs.ts: multiplier block, updateSwing freshness, PHEW;
  - mechanics.ts: budGrewTick, bloom trick;
  - pickups.ts: streak, Snow cap;
  - hash.ts.

**Validator.** No change: the ring never touches coverage or Chill.

**Bots.** The reactive bot (mechanics on) adds +0.5 to now-safe bins whose shading source isn't among the last two SWING endpoints, while Chill ≥ 60, so fresh SWINGs happen. The oracle is unchanged.

**Acceptance.** Command: `sim --check --seeds 40`, profile 3.
- Hard: reactive x5 share ≤ 20% of daylight; reactive mean multiplier x2.8-3.8.
- Advisory:
  - humanDial R2 Day-1 mean x1.8-2.5;
  - oracle ≥ x1.5;
  - level changes ≤ 14 a minute for humanDial and ≤ 20 for reactive (measured with the flat bleed: 13-19);
  - the gap between careful and sloppy play (reactive minus humanDial mean) ≥ 1.0 level (today about 0.4);
  - tricks are 10-30% of reactive charge income.
- Unit tests: a scripted A→B→A hand-off loop earns ≤ 1 fresh SWING per 3 s; PHEW never raises m above litStartMult.

### 2.2 Frost Bank (two snaps, earned by risk, kept overnight)

**Pitch.** Your frost meter holds two Cold Snaps. Sunflowers and daring plays fill it, it keeps overnight, and casting a snap cashes in your ring. Play it safe all day and you meet noon empty-handed.

**Rules.**

The meter:
- `nubs.frostH` is an integer in hundredths, 0..200, so a crossing is never missed.
- `nubs.frost = frostH / 100` is mirrored for readers: 1 means one snap is ready, 2 means two.
- `frostReady {charges}` fires on crossing 100 and again on crossing 200.

Income, the only sources:

| Act | Frost (hundredths) |
|---|---|
| Bloom | +30 |
| Fresh SWING (at most once per 180 ticks) | +5 |
| Glass cluster saved whole (§2.3) | +10 |
| Own-sunflower snap landing (§2.4) | +5 |
| Flare parry (§2.5) | +10 |

Nothing else pays: no passive shade income, and no deep-shade, flake, crystal or PHEW income. Anything above 200 is lost, and the sim emits `frostSpill {lostH}`.

During a snap, all income is banked in `s.snapBankH` and paid when the snap ends, at most 30 per snap. A snap therefore always nets at least 30 of cost, so there is no snap → bloom → snap loop.

`castSnap`:
- It needs frostH ≥ 100 and subtracts 100.
- Then the **cash-in**: frostH += 10·(m − 1), capped at 200. The ring returns to x1 with 0 charge.
- Events: `multDown {cause: 'snap'}` and `snapCash {level, refundH}`.
- Snapping at the mouth of a gap, while the ring is high, is cheaper than a panic snap after the ring has bled out.

Charges carry through the night and dawn.

Starting frost:
- Endless, Daily and challenge runs start at **100** (one snap). Runs with `RunConfig.lesson` start at 0.
- Journey levels start at 50.
- L10 (the Cold Snap's teaching level) starts at 100.

The snap itself is unchanged: a 3 s cloud at z 0. The Garden may extend it.

**Measured.**
- With the proposal's cluster, crystal and PHEW income, the dial-only bot (which never chases anything) filled 0.48 meters a day, against 0.29 today, because flakes and the crystal on the centerline come free.
- With bloom-only income:
  - dial-only fills 0.08 meters a day;
  - reactive median is Day 4 · 10:36 AM (+48 min) with 0.57 snaps a day;
  - timed greed beats plain play by **+306 min** mean (today about +147);
  - naive greed is −98 min;
  - a full meter sits unspent under 1% of daylight (today 14-36%).
- The cash-in, measured as a meter left at 0.1·(m − 1): reactive survival +6%, snaps +17%, humanDial unchanged. The proposal's always-on frost rate instead gave +29% survival and +66% snaps, all for experts.

**The starting charge is a v1.6 call, not measured.** Today humanDial filled 0 meters in 30 runs at p3, so the verb didn't exist for real players in Endless. The starting charge also makes "snap early to cash the ring" learnable on Day 1. It is gated below; drop it to 0 if it alone adds more than 120 min to the reactive bot.

**Teaching.**
- L10 intro: "Sunflowers fill the frost. A full pip? Swipe down."
- After the first cash-in: "Your ring poured into the frost."
- L11 and later start at half a pip.
- Endless: the first pip is full at the start, and the first bloom pops "+0.3 snap".

**Interactions.**

| System | How the bank interacts |
|---|---|
| Buds | The main income. |
| Ring | The cash-in. |
| Garden | Its income is banked and paid when the snap ends. |
| Brittle flakes | +10 per glass cluster saved. |
| Flares | +10 per parry; a snap also parries any flare. |
| Noon Heat | Where charges get spent. |
| Deep shade | No longer pays frost; keeps x2 regen and x2 ring charge. |
| Dares | 'snapSave' counts only a snap filled from income. |

**Core state, events and tuning.**
- NubsState: `frostH`, `swingFrostTick`.
- SimState: `snapBankH`.
- Events: `frostReady.charges`, `frostGain {source, amountH, charges}`, `frostSpill`, `snapCash`.
- RunStats: `frostEarnedH`, `frostSpilledH`, `snapCashH`.
- Tuning: `TUNING.bank`.
- Files:
  - mechanics.ts: `addFrostH`, castSnap;
  - nubs.ts: SWING income;
  - pickups.ts: cluster income;
  - create.ts: starting frost;
  - hash.ts.

**Validator.** No change: it ignores snaps, so every world stays survivable with zero snaps.

**Bots.**
- Reactive: spends an overflow charge at frostH ≥ 190 only when lit and Chill < 70.
- New bot options:
  - `policy: 'plain' | 'chase' | 'naive' | 'safe'`:
    - **plain**: today's reactive with mechanics;
    - **chase**: gold and glass arcs outweigh safe arcs while Chill ≥ 45, outside 9:20 AM-2:40 PM;
    - **naive**: chase all day;
    - **safe**: never chases gold, still snaps.
  - `snap: 'panic' | 'plan'`:
    - **panic** is today's rule: lit, Chill < 40, no safe bin within 45°;
    - **plan** snaps at the mouth of a gap (no now ∪ next bin within 45°, ring ≥ x3), otherwise falls back to panic.
- Oracle: snaps by its slack rule, and holds a charge for the next kept flare with d ≥ 8 while it has two.

**Acceptance.** Command: `sim --decisions --seeds 80`, profile 3, all other v1.6 rules on.
- Hard:
  - chase outlives plain by ≥ 150 min mean;
  - naive does not beat plain;
  - safe trails plain;
  - reactive sits on a full bank (200) ≤ 10% of daylight;
  - dial-only fills ≤ 0.15 meters a day from income.
- Advisory:
  - reactive 0.5-0.9 snaps a day;
  - humanDial ≥ 0.8 snaps per run at R2-R4;
  - plan outlives panic by ≥ 60 min mean;
  - chase p90 ≤ Day 7; if not, make the snap 2.5 s from Day 4.

### 2.3 Brittle Flakes (greed on a different angle from safety)

**Pitch.** Some flake clusters are glass: they melt in a blink of sun. A thin white arc on the dial shows the angles that save them, and they are never where the safe angle is. Is the detour worth it?

**Rules.**

What changes for the player:
- A glass cluster's flakes melt after **0.8 lit seconds** (x2 in glare) instead of the day's meltBudget of 1.2 (`Pickup.brittle`).
- Collecting, +6 Chill and Snow are unchanged.
- Saving a whole cluster (every flake taken, none melted) emits `clusterSaved {cluster, brittle, n, x, y}`. A glass cluster pays +10 frost and +600 ring charge; a plain cluster pays only the 3rd-flake streak.

Placement (ruleset 16):
- Flakes move **two chunks behind the casters**, like buds: `placeFlakes(w, k − 2)` inside `placeChunk(k)`, after chunk k−2's rescue rocks.
- Ids come from `FLAKE_ID_BASE`.
- The draws come from the same stream (`rngFor(seed, 'flakes', k)`) with the same cursor, so a plain cluster stands exactly where v1.5 drew it.
- When `placeChunk(k)` runs, `w.lastJob` is chunk k−2's finished validation job, so its lit rows and DP Chill rows (`job.c`) can be read directly.

The contest test (new `gen/contest.ts`), run for each candidate shift Δ ∈ {0, −0.5, +0.5, −1, +1} s of walking, keeping at least 3 s to the neighbouring clusters:
- P is the cluster's last flake, the longest exposed. Its melt window W is the 0.1 s steps while 14 < P.y − nubs.y ≤ 1.6·v. need = |W| − 8 steps (the 0.8 s budget).
- M(j) is the set of bins that shade P at step j (`gatherScene(live = false)` plus `shadeMask`, with glare bins removed).
- S_free is the most steps in W with the bin in M that a turn-limited path (18 bins a step) can get while staying on zero-lit bins under the validator's 3-step rule. It is computed with `slidingMaxCircular`, O(360) per step.
- C0 is the best Chill at the end of W plus 1.5 s, from the job's own rows. C1 is the same best with "≥ need steps in M during W" forced; the DP runs over (bin, k ≤ need), seeded from `job.c` at the start of W.
- **Contested** means all of:
  - S_free ≤ need − 2 (the safe line can't save it);
  - C1 ≥ floor + 10 (never a trap for a perfect player);
  - 12 ≤ C0 − C1 ≤ 40 (never free, never brutal);
  - the first flake is savable too.
- A cluster is eligible only if W plus 1.5 s lies inside lastJob's slots.

Quota (share of eligible clusters):
- Profile 3: 25% on Day 1, 35% from Day 2. Profile 2: half that. Profiles 0-1 and the tutorial: 0.
- None where meltBudget ≤ 0.8 or is Infinity (meltfast, hardy).
- Clusters are walked in order. When the running share is below quota and a contested shift exists, take the shift whose detour cost (C0 − C1) is nearest 25. Otherwise the cluster stays plain at its drawn spot.

Journey:
- On from L21, its teaching level (`mechanicsOf(id).brittle`).
- On levels with a flake goal or a flake Dare, the glass share is capped at (1 − target/expected) − 0.15.
- Never on L2.

Dial: `GuideState.flake` is M at the current step for the nearest alive glass flake in its melt window (one point mask per guide refresh), and all 0 otherwise.

**Measured.**
- Under the 1.2 s budget only 9% of clusters are contested where drawn, and 24% with ±1 s shifts. The proposal's quota was unreachable, and 39 of the 43 clusters its D score picked were free under the real melt rule.
- At 0.8 s, 49% of clusters have a contested shift (58% with ±1.5 s).
- 0.8 s raises the shade needed to about 0.6 s, longer than the 6 free ticks, so greed always costs the ring.

**Teaching.**
- L21, concept `brittle` ("Glass Flakes"). It takes Lowland's teaching slot; Lowland stays a composed concept.
- On L21 the glass share is 60%, the goal is "save 1 glass cluster", and the tip reads: "Glass flakes melt fast. The white arc saves them, if you can spare the sun."
- Endless: a new-player tip at the first glass window. Off on R0-R1.

**Interactions.**

| System | How glass clusters interact |
|---|---|
| Ring | A detour bleeds; a saved cluster pumps +600. |
| Bank | +10 per saved cluster. |
| Flares | Flakes melt x2 during a flare's rise and hold. |
| Glare | Glare bins are left out of M, and glare doubles the melt. |
| Day Plan | Heat pays Snow x1.5; flurry means more clusters, so more glass. |
| Buds | On their own stream; unchanged. |
| Validator | Untouched: the glass pass runs after validation and only reads its rows. |

**Core state, events and tuning.**
- Pickup: `cluster`, `ci`, `cn`, `brittle`.
- Objects: `FLAKE_ID_BASE`.
- GuideState: `flake`.
- SimState: `clusterId`, `clusterTaken`, `clusterBroken`.
- Events: `clusterSaved`.
- RunStats: `brittleSeen`, `brittleSaved`, `clustersSaved`.
- Tuning: `TUNING.brittle`.
- Files:
  - placer.ts;
  - new gen/contest.ts;
  - validator.ts (`jobRows`);
  - pickups.ts (`meltBudgetOf`);
  - guide.ts;
  - hash.ts (pickups hashed only to 600 u ahead on ruleset 16).

**Validator.** Unchanged.

**Bots.**
- Oracle: +4 Chill-equivalent per plan step on bins that shade an alive glass flake in its window, while slack ≥ 15.
- Reactive: the chase policy adds +1.5 on `guide.flake` bins while Chill ≥ 45; plain adds nothing.

**Acceptance.**
- Hard:
  - every glass cluster passes the contest test (unit test, 40 seeds × 4 days);
  - generation ≤ 3.5 ms per chunk (today 2.37);
  - rescues per chunk ≤ 0.8 and unresolved failures 0.
- Advisory:
  - at least 1.8 glass clusters per daylight minute on Day 1 and 2.5 from Day 2 (profile 3);
  - the greedy oracle saves ≥ 85% of glass flakes; plain reactive saves 30-60%; chase saves ≥ 70%;
  - novice melted share rises by ≤ 8 points;
  - a flake-aware oracle meets every flake Dare.

### 2.4 Frost Garden and Landing (the snap becomes a routine)

**Pitch.** Under the frost cloud the sun is yours. Buds grow twice as fast, every bloom stretches the snap, and landing in the sunflower you just planted is a perfect hand-off.

**Rules** (while `s.snapTicks > 0`).

Growth:
- Buds within [y − 30, y + 420] grow x2 (0.4 s). `updateBudGuide` uses the same reach. Decay is unchanged.
- During a flare's hold the higher multiplier applies (x3), never the product.

Extension:
- Each bloom adds 30 snapTicks (`snapExtend {ticks}`), at most +60 per snap (4 s in all), and never past the day's last daylight tick.

The cloud's path:
- t0 is never reset; the render fade reads it.
- Every 30 ticks, and on every extension, the snap's frozen Cloud is replaced by a new one: same id, same t0, life extended, velocity aimed at Nubs' scheduled position 30 ticks later (`worldYAtDayTick`), and x0/y0 chosen so the path stays continuous.
- This also fixes today's leak, where 4.3% of 3 s snaps let a sample out of the ellipse.

Income: banked as in §2.2.

`guide.land` (during the snap only): full-shade bins at Nubs' position, elevation and cloud positions at the snap's end (`dayTick + snapTicks`). Snap clouds are excluded; sunflowers made this run are included. guide.now and guide.next are unchanged, which keeps humanDial's calibration.

**Landing:**
- It is armed only if at least one bud bloomed during this snap.
- Within 20 ticks after `snapEnd`, Nubs must be fully shaded by a source other than the snap and stay so for 15 ticks. Then the sim emits `snapLand {chain, own, x, y}`.
- **Own landing**: the center sample's shader is a sunflower bloomed during this snap. It counts as a fresh SWING: chain +1 with the chain timer paused across the snap, Snow = chain, +5 frost and +600 ring charge.
- Any other shade gives chain +1 only.
- With no bloom during the snap there is no landing; parking pays nothing.
- PERFECT (0 lit ticks) is a cosmetic tag only. Grading by lit ticks ranks laggy players backwards.

The snap cloud no longer counts as a deep-shade source (T3).

**Measured today.**
- A bud is in reach on 81% of snap ticks, but only 4.9-6.4% of snap ticks face one.
- 2.2-2.4 buds are in reach per reactive snap.
- In the 40 ticks after snapEnd the oracle is lit 32 and reactive 22.
- Landing as first written would have fired on 50% of reactive snaps with no intent.

**Teaching.**
- L10 contextual tip at the first snap with a bud in reach: "The frost has you. The sun is free: grow a bud!"
- The LANDING! pop teaches the exit.
- The frost ring on the dial says "covered".
- Endless: the same tip in new-player runs. No authored bud placement is needed; about 2.4 buds are in reach per snap.

**Interactions.**

| System | How the Garden interacts |
|---|---|
| Bank | Refunds are banked and paid when the snap ends. |
| Ring | Refills from x1 under the snap; an own landing pumps +600. |
| Flares | A snap parries a flare; buds grow x3 in a flare's hold. |
| SWING | A landing is a SWING. |
| Noon | The +60 cap keeps a snap to at most 48% of noon. |
| Dares | Feeds the 'blooms' and 'snapSave' Dares. |

**Core state, events and tuning.**
- SimState: `snapExt`, `snapBlooms`, `landTicks`, `landHold`, `landSrc`.
- GuideState: `land`.
- Events: `snapExtend`, `snapLand`.
- RunStats: `gardenBlooms`, `snapLands`, `snapLandsOwn`.
- Tuning: `TUNING.garden`.
- Files:
  - mechanics.ts: growth, extension, re-aim;
  - nubs.ts: landing;
  - guide.ts and store.ts: a `skipSnap` option for gatherScene;
  - hash.ts.

**Validator.** No change: it ignores snaps and buds, and blooms only add shade.

**Bots.**
- Reactive: during a snap it scores gold bins only, then `guide.land` for the last 36 ticks.
- Oracle: uses budReachDeg 180 while snapping and plans the landing on guide.land.
- humanDial: unchanged.

**Acceptance.**
- Hard: no sample is lit under an active snap cloud (unit test, 40 seeds, every snap); idle and novice are unaffected.
- Advisory:
  - blooms per snap: reactive ≥ 0.8 (today about 0.2), oracle ≥ 1.2;
  - own landings on ≥ 30% of reactive snaps that bloomed;
  - lit ticks in the 40 after snapEnd: reactive ≤ 10, oracle ≤ 12;
  - ≤ 25% of the reactive bot's 11 AM-1 PM daylight under a snap.

### 2.5 Heat Flares and Noon Heat (threat, and a shape for the day)

**Pitch.** A few times a day the sun swells, then flashes, and every shadow snaps shorter for a moment. Slide to the shade that holds before the flash. Between 11 and 1 the sun bites harder: that's what your snaps are for.

**Flare rules.**

Shape and strength:
- In ticks: warning 120 (72 in the Journey), rise 18 (polynomial smoothstep 3x² − 2x³), hold 42, fall 30.
- ε_world = ε(t) + d·lift, clamped to εnoon − 2 in Endless and to 78 in the Journey.
- d = +10° on Days 2-3 and +8° from Day 4.

Schedule:
- Profile 3: none on Day 1, one in the afternoon on Day 2, two a day from Day 3 (one morning, one afternoon).
- Profiles 0-2: one afternoon flare a day from Day 3.
- The rise falls at t/Dl in [0.20, 0.32] (about 8:24-9:50 AM) or [0.68, 0.80] (about 2:10-3:36 PM), drawn from `rngFor(seed, 'flares', day)`.
- Flares are at least 8 s apart, and never at night or inside an eclipse or lock window.

Storage and readers:
- Flares live on the World (`w.flares`), not in DayParams, whose cache has no seed.
- Every ε reader calls `worldElevation(w, tickAbs)`: step syncTime, guide, the validator's stepGeometry, stepLit and stepLitLive, bots, and both deathcause callers.
- The placer keeps the base elevation; only its cloud placement reads ε, and flares avoid noon.

**Keep test.** The validator runs it, deterministically, when its job reaches the flare. The window [rise − 1 step, end] must lie inside one chunk's own slots; otherwise the flare is shifted. A flare is kept only if both hold:
- (a) **A parry exists.** A boolean DP starts from every bin at rise − 1 step, moves 18 bins a step under the 3-step rule, and finds a path with lit = 0 on at least 85% of the hold steps.
- (b) **The shade moves.** Fewer than 50% of the bins that are safe at the first hold step without the flare stay safe with it.

Otherwise the flare is shifted +0.5, −0.5, +1 and −1 s and retested, then dropped. Kept flares go through the ordinary rescue path; there is no cancel-before-rock and no prefixSteps straddle.

Parry and miss:
- A **parry** is at most 4 lit ticks during the hold. It emits `flareParry {id, snap, snow: 5}` and pays +5 Snow, +10 frost (banked if a snap is on) and +600 ring charge.
- Otherwise the sim emits `flareMiss {id, lit}`.
- The snap cloud (z 0) parries any flare.

The opportunity: during the rise and hold, buds grow x3 (0.27 s) and flakes melt x2. Parry, or bloom in the heat and take the damage now for a parasol later.

Telegraph:
- `flareWarn {id, ticks, d}` fires when the warning starts.
- During the warning, `guide.flare` holds the full-shade bins at Nubs' position, ε and clouds at the first hold tick, and `guide.flareTicks` counts down to the rise.
- **guide.next is unchanged**; it already sees the rise in its last 0.6 s.
- Kept flares appear on the HUD ruler as soon as they are decided, which the 1600 u hard horizon puts at least 12 s ahead.

**Noon Heat (tuning fix, same validator plumbing).**
- Drain × H between 11:00 AM and 1:00 PM (dayTick in [5/12, 7/12)·Dl).
- H = 1.0 on Day 1, 1.15 on Days 2-3, 1.25 from Day 4. Profiles 0-2 get each step one day later.
- Validator-aware: the DP uses a per-slot delta table, `chillDeltaTable(validatorDrain(w)·H, regen)`, keyed by (day, in window), and the oracle uses the same function.
- Endless and Daily only. It is off in the Journey, whose concept costs were calibrated without it.

**Journey.**
- L38, concept `flare` ("Solar Flare"). It takes Moon Sun's teaching slot; Moonlit stays a composed concept.
  - 3 flares at 0.30, 0.55 and 0.80 of the level, d 10, 1.2 s warnings.
  - Goal: parry 2 of 3.
  - Tip: "When the sun swells, slide to the frost-rimmed shade before the flash."
- **Boss finales** (chapters 5-20, levels 50, 60, …, 200):
  - `flare` is appended after composition, so the rng draws are unchanged.
  - n = min(8, floor(level seconds / 3.2)) flares in three phases: 0.20-0.40, 0.50-0.68 and 0.76-0.92 of the level, with d 10, 13 and 16.
  - A warning may start during the previous flare's fall.
  - n is the boss's HP.
  - The flares are stored as `LevelDef.flares {minute, d}` in a baked table. `node scripts/sim.ts --bake` shifts each flare by ±0.5 s in data until it passes the keep test, with at most 3 rescues per boss level.
  - Concept cost 4, calibrated with `--tries`.

**Measured.**

| Proposed rule | Measured result | v1.6 change |
|---|---|---|
| 2 s holds with forecast-mode next | Barely affected dial readers (mean −17 min) | Short 0.7 s hold |
| Forecast-mode next | Cost −113 min median and earned no extra parries | guide.next left unchanged; separate guide.flare mask |
| Old parry test | Met on 45% of windows with no flare at all | Parry counted from the first hold tick |
| Any flare kept | A perfect-foresight 180°/s parry existed for only 97/70/50/45/43% of flares on Days 1-5 | Keep test, and the shade must move |

With flares, rescues per chunk went 0.252 → 0.279 and the oracle still reached Day 8 on 100% of seeds.

**Teaching.** L38; a first-flare tip in Endless new-player runs; ruler marks.

**Interactions.**
- The geometry lesson: shade near a caster's base and under sunflower heads (z 48) holds. Far shadows and cloud shadows jump: a cloud's offset is 300·cot ε, 357 → 252 u when ε goes from 40° to 50°. Glare spots jump toward their balls.
- Bank: spend a snap on the flare, or parry it for +10.
- Ring: a parry pumps, a miss bleeds.
- Buds grow x3 and flakes melt x2 during the flare.
- Day Plan:
  - on 'long' days (low sun) flares bite hardest;
  - on 'heat' days the clamp limits them;
  - on 'overcast' and 'breezy' days cloud riders beware.
- Dares: 'parry'.

**Core state, events and tuning.**
- World: `flares: Flare[]`.
- gen/plan.ts: `worldElevation`, `flareLift`, `noonHeatAt`, `keptFlares`.
- SimState: `flareIdx`, `flareId`, `flarePhase`, `flareLit`, `flareTicks`.
- GuideState: `flare`, `flareTicks`.
- Events: `flareWarn`, `flareRise`, `flareParry`, `flareMiss`, `flareEnd`.
- RunStats: `flaresSeen`, `parries`.
- days.ts: `noonHeat`, `flareCount`, `flareD`.
- Tuning: `TUNING.flare`.
- Files:
  - validator.ts: ε through the world, keep test, per-slot delta table;
  - new sim/flares.ts;
  - hash.ts: kept flares within 600 u, and the active flare.

**Bots.**
- Oracle: sees flares through stepLit, weights lit hold steps x3, and keeps a snap for the largest kept flare while holding two charges.
- Reactive dial row: nothing new.
- Reactive with mechanics (`preAim`): in the last 18 ticks of a warning, if θ's bin is not in guide.flare, it targets the nearest guide.flare bin.
- humanDial: unchanged.

**Acceptance.**
- Hard:
  - 100% of kept flares pass both keep conditions (validator test);
  - the oracle parries ≥ 70% of kept flares;
  - ≥ 85% of candidates are kept on Days 2-4 (Day 5 and later reported);
  - reactive p3 dial median stays in [Day 2 noon, Day 4 noon];
  - reactive with mechanics outlives dial by ≥ 180 min;
  - oracle reaches Day 8 on 100%;
  - rescues per chunk ≤ 0.8 and within +0.1 of ruleset 15; unresolved 0;
  - campaign: the oracle passes every boss.
- Advisory:
  - plain reactive parries 25-55%, and preAim parries at least 15 points more;
  - ≥ 25% of reactive deaths fall in 11 AM-1 PM (today 2 of 16);
  - humanDial's first-night share at R3/R4 rises by ≤ 5 points.

### 2.6 Dares (Journey levels ask for what they teach)

**Pitch.** Every level dares you to use what it teaches: "Bloom 2", "Save the glass", "Parry 6 flares". One star for the goal, one for the dare, one for a cool run.

**Rules.**

Stars:
- ★1 is the goal.
- ★2 is the Dare. Finales offer two Dares, and either one earns the star; that is the real pre-run choice.
- ★3 is the cool run, unchanged: lit ≤ 22% of the level's daylight, lowest Chill ≥ 20.
- The flake star becomes the 'flakes' Dare on flake levels.
- The 'snow' goal is retired: L7's 5-Snow goal was met by 6 flakes at x1.

Verb goals (★1) on teaching levels, kept small:

| Level | Goal |
|---|---|
| L5 | 1.5 s of deep shade |
| L6 | Every ball with a glare-free line passed clean, minus one (at least 1) |
| L7 | 1 SWING |
| L8 | 1 bloom |
| L10 | A snap that saves ≥ 1 s |
| L13 | The arch walked under shaded |
| L21 | 1 glass cluster saved |
| L36 | Shaded within 1 s of the eclipse flip |
| L38 | Parry 2 of 3 flares |

Soft-fail: after 2 misses the goal relaxes to 'finish' for that level (`RunConfig.relaxedGoal`, set from the save), with a tip.

Sizing and assignment:
- Every concept has exactly one Dare (table below).
- Each target is sized from what the level actually offers on its fixed seed: buds, passable balls, glass clusters, lock and gust windows, kept flares. `node scripts/sim.ts --bake` writes these counts to `src/config/levelBake.gen.ts`, and a vitest checks the file is current, so LevelDef stays pure data.
- A composed level takes the first concept in its list that has a Dare. Every concept now has one; the fallback, a core verb (bloom N, SWING N, deep T or an earned snap) drawn from `rngFor(seed, 'dare', id)`, is there for future concepts.

Counting:
- Counters are integer ticks or counts in RunStats, so the HUD's live count and the final verdict always agree.
- `guide.deep` paints the bins where shade is deep: all 5 samples shaded and at least 2 sources over the center sample (the snap excluded). It is drawn as a darker band inside the teal wherever it is at least 3° wide. The deep goal and Dare need it to be readable.

| Dare kind | Counts | Target | Concepts |
|---|---|---|---|
| blooms | Sunflowers bloomed | clamp(round(0.35 × buds offered), 1, 4) | bloom, drought, sparse, lowland, heat |
| swings | SWINGs landed | 2 (3 on levels over 30 s) | swing, dazzle, clockwork, slippery |
| deep | Ticks in deep shade | max(90, 12% of the level's daylight ticks) | deep, dense, giants, oldtown, noon, sprint |
| snapSave | Ticks where a snap filled from income during the level is the only source over Nubs' center | 60 | snap, thaw, ration, boss |
| parry | Flares parried | ceil(0.75 × kept flares) | flare, every boss finale (as one of its two) |
| brittle | Glass clusters saved whole | max(1, ceil(0.6 × offered)) | brittle |
| flakes | Flakes collected | 80% of expected | flakes, flurry, meltfast, fog, blind |
| clean | Balls passed clean | Every ball with a baked glare-free line | glare |
| ride | Best ride ≥ 2.5 s, or ≥ 3 clouds ridden ≥ 0.5 s each | 1 | cloud, breezy, fleet, overcast |
| gates | Arch walked under in deep shade | 1 | gate, market |
| flip | Shaded within 12 ticks of the flip | 1 | eclipse |
| still | Lock or gust windows held fully shaded | Half the windows, rounded up | lock, gusts |
| ring | Reach x4 (x3 on levels of 25 s or less) | 1 | drag, long, stroll, sunset, frosty, marathon, moonlit, heavy, hardy |

hardy flakes never melt and sit on the trail, so a flake Dare there would be autopilot; hardy uses 'ring'.

**Measured.**
- Across all 200 levels, reactive three-stars 77% of levels 41-70 and 74% of 41-200.
- L7 and L8 were three-starred with 0 SWINGs and 0 blooms.
- The original Feat and the cool-run star are *positively* correlated (phi +0.36 for reactive), so Dares add intent, not tension. The real choice lives on finales.
- 72 of 160 composed levels had no Feat in the draft, hence a Dare for every concept.
- The draft's goals failed the oracle on L5-L7 and humanDial on L5, L7 and L8, hence the small targets and the soft-fail.

**Teaching.**
- The intro card names the Dare.
- The HUD goal pill counts it live (`hudGoal`), and the Pause card shows the pips.
- Results gives a next-star hint (`nextStarHint`).
- A tip appears after a soft-fail.

**Core state, events and tuning.**
- LevelDef: `goal.kind` (new kinds), `feats`, `flares`.
- Types and functions: `GoalKind`, `FeatKind`, `featValue`, `featMet`, `goalMet(…, relaxed)`, `starsFor(…, relaxed)`.
- RunStats counters: `deepTicks`, `earnedSnapSavedTicks`, `brittleSaved`, `cloudsRidden`, `gateDeep`, `flipTicks`, `lockHeld`, `lockWindows`, `gustHeld`, `gustWindows`, plus the existing `maxMult`, `ballsPassedClean` and `blooms`.
- Events: `feat {kind, value, target}` (on change), `featMet {kind}`.
- Files: new sim/feats.ts, the bake, `levelOutcome(level, s)` reads `cfg.relaxedGoal`.

**Bots.**
- Oracle Feat weights:
  - blooms: bud bonus x3;
  - swings: jump to a now-safe arc at least 38° away from a different source when slack ≥ 20 and 2 s have passed since the last SWING (needs the nearest shader per bin for the current step, a bots-only helper);
  - snapSave: holds the snap until slack < snapSlack;
  - deep: +3 on guide.deep bins while slack ≥ 12;
  - brittle as in §2.3, parry as in §2.5;
  - still, ride and flip: plan terms.
- New `humanFeat`: humanDial plus a seeded 50% focus on the level's Dare, with its own lag and aim error. humanDial itself is unchanged.

**Acceptance.** Command: `sim --campaign --bot all --tries 3`.
- Hard:
  - oracle 200/200, verb goals included;
  - reactive ≥ 95% of levels 1-100, with teaching verb goals scored as 'finish' for reactive;
  - a Feat-seeking oracle earns ★2 on ≥ 85% of levels.
- Advisory, per Dare kind: non-seeking reactive and oracle meet it on ≤ 35% of its levels; the seeking oracle on ≥ 85%; humanFeat on ≥ 50%.
- Advisory overall:
  - reactive three-star share on 41-200 ≤ 50% (today 74%);
  - humanDial passes ≥ 90% of levels 1-10 with the soft-fail;
  - humanDial mean stars on 41-200 ≥ 0.95 (today 1.07).

---

## 3. Small tuning fixes

| Id | Fix | Why |
|---|---|---|
| T1 | Noon Heat (§2.5). | Noon is the boss again; today deaths cluster at 9-10 AM. |
| T2 | Flake and crystal Snow use min(m, 3). | The ring would otherwise inflate reactive flake Snow 3.8x (measured). |
| T3 | The snap cloud is not a deep-shade source (computeCoverage and guide.deep). | Today it makes 7% of reactive and 22% of oracle deep ticks. |
| T4 | Frost in integer hundredths. | Fractional costs could leave the meter at 0.9999999. |
| T5 | The snap cloud re-aims every 30 ticks. | 4.3% of today's 3 s snaps leak a sample out of the cloud. |
| T6 | 'snow' goal retired; L7's goal is 1 SWING. | The SWING lesson needs a SWING. |
| T7 | Pickups hashed to 600 u on ruleset 16. | Flakes are now placed two chunks behind, like buds. |
| T8 | META mission retargets: 'mult-3' base 3 → 4, 'hold-x5' base 4 → 5; confirm with `sim --career 40 --meta`. | Good players now reach high ring levels. |

---

## 4. How the set fits

**The shape of a day** (Day 3, profile 3):
1. Dawn to 8:20: long shadows, buds are cheap, the ring builds.
2. Around 9 AM: a flare.
3. 11-1: Noon Heat x1.15; spend charges.
4. Around 2:50 PM: a flare.
5. Dusk is calm, and the charges carry into the night.

The plan that already wins in the sim (invest in the morning, spend at noon) becomes visible and paid.

**How the features feed each other:**
- Glass clusters, blooms, parries and landings fill the Bank.
- The Ring makes greed cost more the better you're doing: a detour at x4 bleeds 12·Σw a tick.
- The cash-in rewards snapping at a gap's mouth instead of in a panic.
- The Garden makes the snap produce the next shade and hand it off.
- Flares create the spikes worth snapping for, and offer the bloom-in-the-heat alternative.
- Dares point Journey players at each verb in turn.

No feature adds a multiplier on top of another feature's multiplier. The only frost scaling is the cash-in.

**One thumb.** No new input. Drag sets θ, swipe down or Down/S or a meter tap casts a snap (a tap casts one charge), and the keyboard is unchanged. Every new decision is *where to point* and *when to snap*.

**Determinism and Nubs' pace.**
- Every new state is an integer counter or a pure function of (config, tick); the flare lift is a polynomial.
- No feature changes Nubs' pace: worldYAtTime and worldYAtDayTick are untouched.
- The snap path, guide.land and guide.flare read Nubs' *scheduled* position.

**Fairness.**
- Every world stays survivable with zero snaps, zero blooms and zero flakes.
- Flares and Noon Heat are exact in the validator.
- Glass placement only reads validated rows.
- Ring, Bank, Garden and Dares never touch coverage or Chill.

**Dial layer budget** (GAME draws only what reads the rule):

| Layer | When | Source | Minimum look |
|---|---|---|---|
| Teal now / dashed next / red glare / gold buds | As today | now, next, glare, bud | As today |
| Deep band | Deep shade exists | guide.deep | Darker teal inside the teal, only where ≥ 3° wide |
| Glass arc | A glass cluster in its melt window | guide.flake | Thin frost-white arc just outside the ring |
| Landing | A snap is on | guide.land | Frost ring = "covered"; teal under it = where you'll be safe; hides dashed next |
| Flare | A flare warning | guide.flare, flareTicks | Rim countdown plus an outer arc segment; hides the glass arc |

---

## 5. Rulesets and versioning

- `RunConfig.ruleset?: 15 | 16`, default 16. Ruleset 15 turns every `World.v16` flag off and is **bit-identical to v1.5**. The v1.5 goldens stay as regression tests, and `sim --rules 15` reproduces v1.5's numbers, because bots key every new behaviour off `w.v16`.
- `RunConfig.v16?: Partial<V16Rules>` lets tooling switch single rules off. It is part of the world's identity, like `mechanics`.
- Daily: ruleset 16 from `RULES16_DATE` (set to the release date), the same pattern as PLAN_START_DATE; `createParJob` takes the ruleset.
- Challenge codes gain `"r":16`; a code without it plays ruleset 15.
- The Journey always plays 16.
- Retire ruleset 15 after 90 days of live links (v1.8).

---

## 6. Acceptance summary

All runs use profile 3 unless noted.

| Metric | Today (v1.5) | v1.6 target | Gate | Command |
|---|---|---|---|---|
| Reactive mean multiplier / x5 share | x1.5 / 2% | x2.8-3.8 / ≤ 20% | hard | `sim --check --seeds 40` |
| humanDial R2 Day-1 mean multiplier | x1.0-1.2 | x1.8-2.5 | advisory | same |
| Chase − plain (mean minutes) | +147 | ≥ +150 | hard | `sim --decisions --seeds 80` |
| Naive − plain / safe − plain | n/a | ≤ 0 / < 0 | hard | same |
| Plan-snap − panic-snap | n/a | ≥ +60 min | advisory | same |
| Full meter unspent | 14-36% of daylight | ≤ 10% | hard | `sim --check` |
| Dial-only meters filled from income | 0.29 a day | ≤ 0.15 | hard | same |
| Reactive snaps a day | 0.37 | 0.5-0.9 | advisory | same |
| Glass clusters per daylight minute | 0 | ≥ 1.8 (Day 1), ≥ 2.5 (Day 2+) | advisory | same |
| Blooms per snap (reactive) | ~0.2 | ≥ 0.8 | advisory | same |
| Lit ticks in the 40 after snapEnd (reactive / oracle) | 22 / 32 | ≤ 10 / ≤ 12 | advisory | same |
| Kept flares parry-feasible | n/a | 100% | hard | validator test |
| Oracle parry rate | n/a | ≥ 70% | hard | `sim --check` |
| PreAim − plain parry rate | n/a | ≥ +15 points | advisory | `sim --decisions` |
| Reactive deaths at 11 AM-1 PM | 12% | ≥ 25% | advisory | `sim --check --hours` |
| Priced moments per daylight minute, Days 2-4 (reactive): glass windows + flare warnings + snap squeezes + costly-gold moments | measure with `--rules 15` | ≥ +3 over today | advisory | `sim --decisions` |
| Reactive dial median | Day 3 · 11:33 AM | in [Day 2 noon, Day 4 noon] | hard (existing) | `sim --check` |
| Mechanics vs dial (median) | +609 min | ≥ +180 | hard (existing) | same |
| Novice p3 median / idle / oracle | Day 1 11:34 AM / dies < 8 AM / Day 8 | unchanged windows | hard (existing) | same |
| Rescues per chunk / unresolved | 0.22-0.25 / 0 | ≤ 0.8 and ≤ +0.1 / 0 | hard | same |
| Generation ms per chunk | 2.37 | ≤ 3.5 | hard | same |
| Journey oracle / reactive 1-100 | 200 / ≥ 95% | 200 (verb goals) / ≥ 95% | hard | `sim --campaign --bot all` |
| Reactive three-star share, 41-200 | 74% | ≤ 50% | advisory | same |
| humanDial mean stars, 41-200 | 1.07 | ≥ 0.95 | advisory | same |
| Career: humanDial reaching standard within 20 runs | 88% | ≥ 85% | advisory | `sim --career 40` |
| Ruleset 15 | — | identical to v1.5 output and goldens | hard | `sim --rules 15 --check --seeds 40`, vitest |

### 6.1 Gate changes (fix round 3, Journey)

Each change below is stricter than, or measures more exactly, the row it replaces; none relaxes a bar.

- **humanDial on levels 1-40**: was "passes ≥ 75% of levels 1-40", now "passes ≥ 85% of levels
  1-40 **on its first try**" (`sim --campaign`; every humanDial try there is another player's first,
  the soft-fail relaxes nothing), with a per-level line. Stricter bar, same measure; v1.5 had 88.3%.
- **Dares per kind** (§2.6 advisory): the row counted a level under every kind it dares and called
  it met when *either* of a finale's two Dares was met, so a finale's second kind was credited with
  the first's success (L190's parry Dare read "met" whenever its snap Dare was). Each Dare is now
  counted on its own, with humanDial (who does not seek it either, on streams the bake never sized
  from) shown alongside the bars. Same bars (≤ 35% / ≥ 85% / ≥ 50%), exact count.
- **Not re-specified**: "humanDial mean stars on 41-200 ≥ 0.95" now misses at 0.73 (was 0.93):
  making every Dare need its verb (review r3, J1) takes ★2 away from players who do not seek it
  (humanDial meets a Dare on 8.7% of tries, was 27.3%); the player who seeks it earns 1.32. The row
  stays as it is and reads MISS; whether the star curve should be re-specified around humanFeat is
  the integrator's call.

How the Dares are sized changed (§2.6 "Sizing and assignment"; src/core/README.md §16.2, CAMPAIGN_PLAN
§8): from the bots' measured play on each level instead of the offers. The reactive bot and the
oracle are deterministic and the bake sizes each Dare just above them, so their per-kind shares are
low by construction (blooms 1% / 0%, snapSave 0% / 0%, swings 0% / 0%, flakes 33% / 22%, the one
`still` level 0% / 0%); the held-out checks are humanFeat (≥ 50%: 56%, 67%, 54%, 56%, 50% over 10
streams the bake never played) and humanDial (4%, 4%, 16%, 34%, 0%).

humanDial's first try on the levels with a goal (20 held-out streams; the other levels of 1-40 lose
only L17 4, L18 1, L22 4, L25 1 and L39 5 runs to melting): levels 1-40 **93.6%** of 800 (v1.5 88.3%,
before this round 81.7%).

| Level | Goal | World | First try | Before |
|---|---|---|---|---|
| L2 Flake Trail | 4 flakes | own | 20/20 | – |
| L5 Double Shade | 1.5 s deep | variant 1 | 20/20 | 21/30 |
| L6 Glass Garden | 1 clean ball | variant 7 | 19/20 | 5/30 |
| L7 Hand-off | 1 SWING | own (no variant read) | 13/20 | 19/30 |
| L8 Sun Garden | 1 bloom | own | 19/20 | – |
| L10 Frost Cloud | 1 s of snap | variant 29 | 18/20 | 6/30 |
| L13 The Gate | the arch shaded | variant 2 | 15/20 | 2/6 * |
| L21 Sugar Glass | 1 glass cluster | variant 8 | 20/20 | 17/30 |
| L27 Snow Pile | 7 flakes | variant 2 | 20/20 | – |
| L36 Moon Shadow | shaded ≤ 1 s after the flip | variant 1 | 20/20 | 0/6 *, all melted |
| L38 Sunspots | parry 2 of 3 | own | 0/20 | 0/30 |

"Before": the review's 30 humanDial players at HEAD 38735c9; * this round's own 6-stream baseline.
L38 is the one lesson the bake cannot open: humanDial does not read the flare telegraph, and the keep
test requires the shade to move (its parry arcs cover 10-46% of the teal before each flare), so a
dial-follower parries by luck on any world; the soft-fail stays its net.

---

## 7. What the skeptics changed (merge log)

- **Flow Multiplier.**
  - The flat bleed became a level-scaled curve.
  - The always-on frost rate (+66% snaps, an expert-only positive loop) became the snap cash-in.
  - The SWING refund was dropped (2-3% of the bleed).
  - Only level-ups and losing x5 get effects; lower step-downs are silent.
- **Frost Bank.** Income is bloom-only plus small flat trick payments, because clusters and crystals came free. Frost is stored as integers. A starting charge was added; it is a v1.6 call and is gated.
- **Contested Placement.** The D score was replaced by a melt-rule DP and a forced-detour price, with a 0.8 s glass budget so dilemmas actually exist. The bud quotas were dropped: they added free buds. A dial arc makes the flake choice readable.
- **Snap Garden.**
  - The parking reward was dropped; landing requires planting.
  - guide.land replaces taking the snap out of guide.now, which keeps humanDial's calibration.
  - Re-issuing the cloud with a new t0 (a render bug) became path re-aiming, which also fixes the leak.
  - The extension cap is +60 ticks; growth x2 with reach 420.
- **Verb Contracts.**
  - The tension claim was dropped; Dares are intent.
  - Every concept gets a Dare.
  - Targets are sized from baked world offers; impossible or autopilot Feats (still, hold, flip ≤ 36, gates) were redefined.
  - Teaching goals are smaller and have a soft-fail.
- **Heat Flares.**
  - Flares are stored on the World.
  - guide.next is untouched (forecast-mode next cost −113 min).
  - The keep test (a parry is feasible, the shade moves) replaces cancel-before-rock.
  - Holds are short and a parry counts from the first hold tick; the bloom-in-the-heat side was added.
  - No "at dawn" ruler marks; Day 1 has no flares.
- **Set Pieces.** Deferred (see below), with the skeptic's shadow-space fix as its spec.

---

## 8. Rejected or deferred candidates

- **Named Set Pieces**: the strongest v1.7 candidate. Literal pieces lose their intent as ε climbs (measured), so it needs shadow-space authoring (h = L·tan ε), DP gates per piece, trail straightening and world versioning: about 1000 lines.
- **Nightfall Draft**: the biggest replay lever, but about 950 lines, an invasive knob-getter refactor and +3.5 days of power creep unless it ships with rising heat. v1.6 first makes the in-run decisions that boons would multiply; it is v1.7.
- **Solstice acts and rising heat**: needs the Draft. Its "noon is the boss" job is done by Noon Heat with the same per-slot table.
- **Hard Light**: the ring's Σw-scaled bleed prices edge-riding first. With Noon Heat's per-slot table it becomes a 10-line follow-up if late days stay soft.
- **Deep Map's RELAY and DEEP SWING**: more trick names on top of SWING, PHEW and COMEBACK. Only its guide.deep band ships (inside Dares).
- **Hot Hands**: pays for making Nubs sweat (against the fantasy), stacks a third multiplier and overlaps PHEW.
- **Throw and Catch**: hand speed is never the bottleneck, so it is a style layer with almost no decision value.
- **Sundial Stones**: a third aim target with no shade payoff; about 480 lines, Journey-only.
- **Lighthouse Mirrors**: confined to Old Town and dazzle days, with frozen-ball stop-gating; revisit with the flare scheduler.
- **Event Track**: three new DP step kinds. It can reuse the flare scheduler in v1.7, once flares have proven the telegraph grammar.
- **Heat Wisps**: a new damage type and a fifth dial element, and it pulls the aim away from Nubs.
- **Snowkin Escort**: about 610 lines, a convoy validator pass, and readability problems at phone scale.
- **Shade-steered Forks**: about 850 lines across 39 trailX call sites; cut twice already and depends on Hop and Set Pieces.
- **Mirror Bloom**: reaches about 12% of daylight and adds a second gold arc.
- **Hop**: breaks the pillar "You can't move him", is the first break of y = f(t), and needs a new gesture.
- **Ice currency**: a third currency that serves only the Draft.
- **Pacts**: needs the Draft, and hides the dial.
- **Almanac**: breaks "a world is a pure function of its config".

---

## 9. Implementation split

| Builder | Owns | Delivers |
|---|---|---|
| **CORE-1 (economy)** | sim/nubs.ts, sim/mechanics.ts, sim/pickups.ts, sim/create.ts, new sim/bots/econ.ts, scripts/sim16/econ.ts, the `ring`/`bank`/`garden` tuning values, their unit tests | §2.1, §2.2, §2.4, T2-T5; bot policies plain/chase/naive/safe and panic/plan; `--decisions` |
| **CORE-2 (world and Journey)** | clock.ts, gen/plan.ts, gen/validator.ts, gen/placer.ts, new gen/contest.ts, gen/world.ts, gen/store.ts, sim/guide.ts, sim/deathcause.ts, sim/step.ts (hook bodies), new sim/flares.ts, new sim/feats.ts, new sim/bots/world.ts, config/days.ts, concepts.ts, campaign.ts, levelBake.gen.ts, core/level.ts, scripts/sim16/world.ts, `--bake`/`--campaign`/`--hours`, the `brittle`/`flare` tuning values, docs/CAMPAIGN_PLAN.md | §2.3, §2.5, §2.6, T1, T6, T7; preAim, flare cost, glass terms, Feat bots, humanFeat |
| **Shared** (contract commit only; later edits by agreement) | sim/types.ts, events.ts, objects.ts, tuning.ts (block shapes), hash.ts, bots.ts (dispatch and hooks), scripts/sim.ts (flags and report registry), core/index.ts, core/README.md §16 (CORE-1 writes the economy half, CORE-2 the world half) | Shapes and stubs (§10) |
| **GAME** | src/game/**, src/render/**, src/audio/**, platform/haptics.ts, ui/labels.ts, ui/concepts.ts, e2e specs, README.md | Ring charge ring around the badge; two-pip meter (partial fill, spill, frozen pips plus a pending chip during a snap, the cash-in pour); glass glint and arc; deep band; landing frost ring and LANDING! pop; flare rim countdown, a sun cue distinct from the noon swell (no flash; reduced motion = ring only), PARRY stamp, ruler marks, boss HP notches; Noon Heat ruler band and Day-2 card line; Dare intro line, live pill, pause pips, next-star hint, soft-fail tip; Daily config passes `ruleset`; audio and haptics; MECH_TIPS for new-player runs; screenshots of every new layer at 390×844 and 360×640 |
| **META** (small) | meta/challenge.ts, meta/content.ts and missions.ts, save types | Challenge `r` field; mission retargets (T8); per-level verb-goal misses for the soft-fail; "new dare" flag on pre-v1.6 records (stars kept) |

If only one CORE builder is available, it does CORE-1's milestones and CORE-2's in the order of §11.

---

## 10. Contract (the base commit; shapes are fixed, bodies belong to the owner)

```ts
// src/core/sim/types.ts
export interface V16Rules {
  readonly ring: boolean; readonly bank: boolean; readonly garden: boolean;
  readonly brittle: boolean; readonly flares: boolean; readonly noonHeat: boolean;
}
export const V16_ALL: V16Rules;   // all true
export const V16_NONE: V16Rules;  // ruleset 15

interface RunConfig {
  ruleset?: 15 | 16;            // unset = 16; 15 = bit-identical v1.5 (old links, Dailies before RULES16_DATE)
  v16?: Partial<V16Rules>;      // tooling; part of the world's identity
  relaxedGoal?: boolean;        // campaign soft-fail (set from the save)
  brittleShare?: number;        // debug: glass quota override 0..1 (screenshots); world identity
  // startFrost: charges 0..2 on ruleset 16 (1 = one snap ready)
}

interface NubsState {
  ringCharge: number;           // integer units (5 = one full-shade tick)
  litStartMult: number;         // level at the current lit stretch's first tick (PHEW restore)
  budGrewTick: number;          // last tick a bud grew (bleed exemption on the next tick)
  streak: number;               // consecutive pickups without a melt
  readonly swFresh: Int32Array; // 16 = 8 × (source id, tick) of recent SWING endpoints
  swFreshN: number;
  frostH: number;               // 0..200 hundredths; `frost` mirrors frostH / 100
  swingFrostTick: number;       // last tick a SWING paid frost
}

interface SimState {
  snapBankH: number; snapExt: number; snapBlooms: number;
  landTicks: number; landHold: number; landSrc: number;      // landing window (−1 none), hold, source
  clusterId: number; clusterTaken: number; clusterBroken: boolean;
  flareIdx: number; flareId: number;
  flarePhase: 0 | 1 | 2 | 3 | 4;                            // none, warn, rise, hold, fall
  flareLit: number; flareTicks: number;                      // lit ticks in the hold; ticks to rise
}

interface GuideState {
  readonly deep: Uint8Array;    // deep shade now (snap excluded)
  readonly flake: Uint8Array;   // shades the nearest glass flake in its melt window
  readonly land: Uint8Array;    // during a snap: full shade at the snap's end, snap clouds excluded
  readonly flare: Uint8Array;   // during a warning: full shade at the first hold tick
  flareTicks: number;           // ticks to the rise during a warning, −1 otherwise
}

// src/core/objects.ts
export const FLAKE_ID_BASE = 0x30000000;
interface Pickup { readonly cluster: number; readonly ci: number; readonly cn: number; readonly brittle: boolean; }
export interface Flare {
  readonly id: number; readonly day: number; readonly d: number;
  warnTick: number; riseTick: number; holdTick: number; fallTick: number; endTick: number; // absolute ticks
  state: 0 | 1 | 2;             // pending, kept, dropped (decided by the validator, or by the bake)
}
// World: readonly v16: V16Rules; readonly flares: Flare[]; Mechanics gains `brittle`.

// src/core/gen/plan.ts
export function worldElevation(w: World, tickAbs: number): number;  // base ε + d·lift of a kept flare
export function flareLift(w: World, tickAbs: number): number;       // 0..1
export function noonHeatAt(w: World, day: number, dayTick: number): number;
export function keptFlares(w: World, fromTick: number, toTick: number, out: Flare[]): number;

// src/core/gen/validator.ts
export function deltaForSlot(w: World, day: number, dayTick: number): Float64Array; // Noon Heat-aware, cached
export function jobRows(job: ValidationJob): { lit: Uint8Array; c: Float64Array; slots: number; slot0Tick: number };

// src/core/sim/events.ts (additive; multReset is no longer emitted on ruleset 16)
| { e: 'multUp'; level: number; reason?: 'shade' | 'trick' | 'phew' }
| { e: 'multDown'; from: number; to: number; cause: 'bleed' | 'snap' }
| { e: 'ringTrick'; kind: 'swing' | 'bloom' | 'streak' | 'cluster' | 'land' | 'parry'; units: number }
| { e: 'frostReady'; charges?: number }
| { e: 'frostGain'; source: 'bloom' | 'swing' | 'cluster' | 'land' | 'parry' | 'cash' | 'garden'; amountH: number; charges: number }
| { e: 'frostSpill'; lostH: number }
| { e: 'snapCash'; level: number; refundH: number }
| { e: 'snapExtend'; ticks: number }
| { e: 'snapLand'; chain: number; own: boolean; x: number; y: number }
| { e: 'clusterSaved'; cluster: number; brittle: boolean; n: number; x: number; y: number }
| { e: 'flareWarn'; id: number; ticks: number; d: number }
| { e: 'flareRise'; id: number }
| { e: 'flareParry'; id: number; snap: boolean; snow: number }
| { e: 'flareMiss'; id: number; lit: number }
| { e: 'flareEnd'; id: number }
| { e: 'feat'; kind: FeatKind; value: number; target: number }
| { e: 'featMet'; kind: FeatKind }

// RunStats (optional in the type, always filled on ruleset 16)
multTicks, x5Ticks, multDowns, ringTricks, frostEarnedH, frostSpilledH, snapCashH,
gardenBlooms, snapLands, snapLandsOwn, brittleSeen, brittleSaved, clustersSaved,
flaresSeen, parries, deepTicks, earnedSnapSavedTicks, cloudsRidden, gateDeep, flipTicks,
lockHeld, lockWindows, gustHeld, gustWindows

// src/config/campaign.ts
export type GoalKind = 'finish' | 'flakes' | 'deep' | 'clean' | 'swings' | 'blooms' | 'snapSave' | 'gate' | 'brittle' | 'flip' | 'parry';
export type FeatKind = 'blooms' | 'swings' | 'deep' | 'snapSave' | 'parry' | 'brittle' | 'flakes' | 'clean' | 'ride' | 'gates' | 'flip' | 'still' | 'ring';
export interface FeatSpec { readonly kind: FeatKind; readonly target: number }
export interface LevelFlare { readonly minute: number; readonly d: number }
interface LevelDef { readonly feats: readonly FeatSpec[]; readonly flares: readonly LevelFlare[] } // feats: 1, or 2 on finales
export function featValue(kind: FeatKind, stats: LevelStats): number;
export function featMet(level: LevelDef, stats: LevelStats): boolean;   // any of the level's feats
export function goalMet(level: LevelDef, stats: LevelStats, relaxed?: boolean): boolean;
export function starsFor(level: LevelDef, stats: LevelStats, relaxed?: boolean): 0 | 1 | 2 | 3;
// concepts: 'brittle' (kind 'goal', taught at L21) and 'flare' (kind 'sky', L38); 'lowland' and 'moonlit'
// move to the end of CONCEPT_IDS (composed only). COMPOSE_ORDER is unchanged.

// src/config/days.ts: DayParams.noonHeat, flareCount, flareD. RULES16_DATE (release date).

// src/config/tuning.ts (starting values; each owner tunes its own block)
ring:    { shadeUnits: 5, deepMul: 2, freeLitTicks: 6, need: [900, 1200, 1800, 2400], bleedK: [2, 3, 6, 12, 20],
           trick: 600, streakTrick: 300, streakEvery: 3, freshTicks: 180, freshSlots: 8, snowCap: 3 },
bank:    { capH: 200, costH: 100, bloomH: 30, swingH: 5, swingEveryTicks: 180, clusterH: 10, landH: 5, parryH: 10,
           cashPerLevelH: 10, runStartH: 100, campaignStartH: 50, teachStartH: 100 },
garden:  { growMul: 2, reach: 420, extendTicks: 30, extendCapTicks: 60, bankCapH: 30, reaimTicks: 30,
           landWindowTicks: 20, landHoldTicks: 15 },
brittle: { meltBudget: 0.8, shiftsSec: [0, -0.5, 0.5, -1, 1], quotaDay1: 0.25, quotaLater: 0.35,
           marginChill: 10, costMin: 12, costMax: 40, costAim: 25, tailSec: 1.5, minGapSec: 3 },
flare:   { warnTicks: 120, warnTicksJourney: 72, riseTicks: 18, holdTicks: 42, fallTicks: 30,
           windows: [[0.20, 0.32], [0.68, 0.80]], gapSec: 8, epsMargin: 2, journeyEpsCap: 78,
           parryMaxLit: 4, keepShadedShare: 0.85, keepMovedShare: 0.5, shiftsSec: [0.5, -0.5, 1, -1],
           snow: 5, budMul: 3, meltMul: 2 },

// src/core/sim/bots.ts
export type BotKind = 'idle' | 'novice' | 'reactive' | 'oracle' | 'human' | 'humanDial' | 'humanFeat';
export interface BotOptions { policy?: 'plain' | 'chase' | 'naive' | 'safe'; snap?: 'panic' | 'plan'; preAim?: boolean; feats?: boolean }
export function createBot(kind: BotKind, salt?: number, mechanics?: boolean, opts?: BotOptions): Bot;

// Debug hooks (never called by the game loop)
export function debugFlare(s: SimState, inTicks: number, d: number): Flare; // a kept flare, skipping the keep test
export function debugRing(s: SimState, level: number, charge: number): void;

// scripts/sim.ts flags: --rules 15|16, --off ring,bank,garden,brittle,flares,noonHeat,
//   --decisions, --hours, --bake, --policy …
// meta/challenge.ts: endless code gains r?: 15 | 16 (absent = 15)
```

Notes on the contract:
- On ruleset 16, `hashState` appends the new NubsState, SimState and kept-flare fields, and hashes pickups to 600 u. Ruleset 15 hashes exactly as v1.5.
- step.ts gets fixed hook calls in the contract commit:
  - `updateFlare(s)` before syncEclipse;
  - `updateLanding(s)` inside applyDaylight after updateSwing;
  - `updateFeats(s)` after passObjects.
- `meltBudgetOf(s, p)` lands in pickups.ts already reading `p.brittle`.

---

## 11. Order of work

**Step 0. Contract commit** (CORE lead, about half a day):
- shapes, flags and stubs from §10;
- `worldElevation` returning the base ε;
- empty `w.flares`;
- ruleset-16 flags wired but rules stubbed;
- sim flags parsed.

Gate: typecheck, vitest, and `sim --rules 15 --check --seeds 10` identical to v1.5.

**Step 1. In parallel.**

CORE-1:
1. Ring, with the fresh-source bot preference and sim columns. Gate §2.1.
2. Bank and cash-in, with the policies and `--decisions`. Gate §2.2.
3. Garden and Landing, with guide.land and the re-aim. Gate §2.4.

CORE-2:
1. `worldElevation` plumbing through all 9 ε readers (still no flares, so hashes are identical), Noon Heat and the per-slot tables. Gate: the existing targets plus deaths by hour.
2. Endless flares: schedule, keep test, sim/flares.ts, guide.flare, preAim and the oracle terms. Gate §2.5.
3. Glass clusters: flakes two chunks behind on their own ids, contest.ts, quotas, guide.flake. Gate §2.3.
4. Journey: the brittle and flare concepts (L21, L38), boss finales, `--bake`, Dares and sim/feats.ts, guide.deep, Feat bots and humanFeat, soft-fail API. Gate §2.6.

Step 4 needs 2 and 3, because its Dares count flares and glass.

GAME, against the debug hooks:
1. Ring and pips (startFrost, debugRing).
2. Dial layers (deep, flake via brittleShare 1, land via startFrost 1, flare via debugFlare).
3. Flare telegraph, ruler and boss HP.
4. Dares UI.
5. Audio, haptics and tips.
6. e2e and screenshots.

META: challenge `r` and the Daily ruleset; mission retargets; soft-fail save fields.

**Step 2. Calibration** (CORE-1 and CORE-2 together, all rules on):
- runs: `sim --check --seeds 40`, `--decisions --seeds 80`, `--campaign --bot all --tries 3`, `--career 40 --meta`;
- tune only within these ranges:
  - ring bleedK at x5: 16-24;
  - ring need: ±20%;
  - bloom frost: 25-35;
  - runStartH: 0 or 100;
  - cashPerLevelH: 5-15;
  - extendCapTicks: 30-60;
  - glass meltBudget: 0.7-0.9;
  - glass quotas: 0.2-0.4;
  - flare d: 6-12;
  - holdTicks: 36-48;
  - warnTicks: 90-150;
  - Noon Heat: 1.1-1.3;
- any feature that still fails its hard gate ships with its flag off (§12).

**Step 3. Integration:**
- regenerate the ruleset-16 goldens once, with the reasons in the commit; the ruleset-15 goldens stay unchanged;
- write core/README.md §16 and update CAMPAIGN_PLAN.md;
- run the release gates.

---

## 12. Risks and kill switches

Every `V16Rules` flag can ship off on its own.

| Risk | Watch | Lever |
|---|---|---|
| The economy snowballs (experts live forever) | chase p90, reactive snaps a day | Bank cap 2, cash per level, Garden caps; trim bloom frost; 2.5 s snap from Day 4 |
| Onboarding gets harder | humanDial first-night share at R3/R4, career sim | Glass, flares and Noon Heat are already off or delayed on low profiles; lower H; turn the starting charge on |
| Noon floods with rescue rocks | rescues per chunk | Lower Noon Heat H |
| Glass generation cost | ms per chunk | 3 shifts instead of 5; test the last flake only |
| Flares break the mechanics gate | median gap | d 8/6; Endless flares off while Journey bosses stay |
| Dial clutter | screenshots | Priority rule (§4); a layer may move to a HUD cue |
| Dares feel like a checklist | humanFeat, star share | One per level, worded as a dare, never required past the soft-fail |
| Snow inflation | flake Snow per run | x3 cap (T2) |
| Ruleset-15 maintenance | — | Retire in v1.8 |

---

## 13. Release gates

- typecheck and vitest, including the contest, keep-test, snap-cover, freshness and bake-currency tests;
- `sim --check --seeds 40` (every hard target in §6);
- `sim --decisions --seeds 80` (its hard rows);
- `sim --campaign --bot all` (oracle 200/200 with verb goals; reactive ≥ 95% of levels 1-100);
- `sim --rules 15 --check --seeds 40` identical to v1.5;
- full Playwright twice, 0 failures;
- `npm run build:single` within v1.5's budget + 20 KiB;
- 60 fps on a mid phone: step() µs/tick within +10% of v1.5, guide refresh ≤ 1.5× v1.5;
- screenshots of every new dial layer and HUD element at 390×844 and 360×640 looked at.