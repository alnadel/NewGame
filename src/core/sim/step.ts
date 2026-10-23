// step(): advances a run by exactly one 1/60 s tick (archive/TECH_SPEC §4, with V1_PLAN fixes).
//
// Order: sun → clock (+ night/dawn/noon/hour events) → sun vector and Nubs' position → world hard
// guarantee and pruning → flares (v1.6) → eclipse → snap → coverage → Chill/multiplier/PHEW/SWING/
// landing (or night regen) → pickups → buds → gates and balls passed → Dares (v1.6) → history →
// death → guide. Everything is pure arithmetic on the state. On an Elementals Trial (s.trial set) the
// relay runs after the clock, a snap input casts the walking hero's ability, every body follows its
// hero's rules (sim/heroes.ts) in place of Chill's, and either body's meter at 0 ends the run.
// The first TUNING.start.readyTicks ticks after the start are the start beat: sun and coverage only.

import { TUNING } from '../../config/tuning.ts';
import {
  DT,
  dayStartTick,
  dayTicks,
  elevation,
  hourTicks,
  nightTicks,
  noonBannerTick,
  noonPassedTick,
  scoreMinutes,
  minutesOfDay,
  TICK_HZ,
} from '../clock.ts';
import { cosD, sinD, tanD, wrapDeg } from '../dmath.ts';
import { liftElevation, paramsAt, worldYAtDayTick } from '../gen/plan.ts';
import { lowerBound, pruneWorld } from '../gen/store.ts';
import { ECLIPSE_FADE_TICKS, ECLIPSE_SEC, eclipseAt, ensureGenerated } from '../gen/world.ts';
import { levelOutcome } from '../level.ts';
import type { Caster, GazingBall } from '../objects.ts';
import { trailX } from '../trail.ts';
import { deathCause } from './deathcause.ts';
import { updateFeats } from './feats.ts';
import { updateFlare } from './flares.ts';
import { guideDue, updateGuide } from './guide.ts';
import { applyHeroDaylight, heroDeath, updateRelay } from './heroes.ts';
import { pushHistory } from './history.ts';
import { applyDaylight, applyNight, computeCoverage, hourGlyph } from './nubs.ts';
import { updateBuds, updateSnap } from './mechanics.ts';
import { updatePickups } from './pickups.ts';
import { updateSun } from './sun.ts';
import type { InputFrame, SimState } from './types.ts';

const W = TUNING.world;
const RECENT = TUNING.death.recentTicks;
/** A ball counts as passed once Nubs is beyond the reach of its glare. */
const BALL_PASS = TUNING.glare.cap + TUNING.glare.radius;
const GATE_NOON_FROM = 300;
const GATE_NOON_TO = 420;
/** 'gate' concept: Snow for walking under a gate arch fully shaded. */
const GATE_SNOW = 10;

/** Elementals duo (docs/ELEMENTALS.md §2.2): the lead walks this far left of the trail centre, the mate as far right. */
const DUO_DX = TUNING.heroes.duoDx;

/** Derives time, elevation, sun vector and Nubs' position (a duo's two bodies) from (day, dayTick, θ). */
export function syncTime(s: SimState): void {
  const daylight = s.dayTick < dayTicks(s.day);
  s.tDay = s.dayTick / TICK_HZ;
  s.tickAbs = dayStartTick(s.day) + s.dayTick;
  s.tAbs = s.tickAbs / TICK_HZ;
  s.minutes = scoreMinutes(s.day, s.dayTick);
  s.eps = daylight ? liftElevation(s.world, s.params, s.tickAbs, elevation(s.params, s.tDay)) : 0;
  s.sunUp = s.eps > 0;
  s.tanEps = s.sunUp ? tanD(s.eps) : 0;
  s.cot = s.sunUp ? 1 / s.tanEps : 0;
  s.ux = cosD(s.sun.theta);
  s.uy = sinD(s.sun.theta);
  s.nubs.y = worldYAtDayTick(s.world, s.day, s.dayTick);
  s.nubs.x = trailX(s.world.trail, s.nubs.y);
  const m = s.mate;
  if (m !== null) {
    m.y = s.nubs.y;
    m.x = s.nubs.x + DUO_DX;
    s.nubs.x -= DUO_DX;
  }
}

/** 'eclipse' concept: sets eclipseOn and the 0..1 intensity for the current absolute tick. */
function syncEclipse(s: SimState): void {
  const w = s.world;
  if (w.eclipseTick < 0) return;
  const on = eclipseAt(w, s.tickAbs);
  if (s.eclipseOn && !on) {
    // The sun comes back on the far side: every shadow flips, so the player must swing to shade.
    const sun = s.sun;
    sun.theta = wrapDeg(sun.theta + 180);
    sun.detent = Math.floor(sun.theta / TUNING.sun.detentDeg);
    sun.omega = sun.omegaRel = sun.lag = 0;
    if (sun.mode !== 'dragging') sun.mode = 'idle';
    s.ux = cosD(sun.theta);
    s.uy = sinD(sun.theta);
  }
  s.eclipseOn = on;
  if (!on) {
    s.eclipse = 0;
    return;
  }
  const t = s.tickAbs - w.eclipseTick;
  const left = ECLIPSE_SEC * TICK_HZ - t;
  const k = t < left ? t : left;
  s.eclipse = k >= ECLIPSE_FADE_TICKS ? 1 : k / ECLIPSE_FADE_TICKS;
}

/** Closes the in-game hour that just ended and emits hourEnd. */
function endHour(s: SimState, hour: number): void {
  const glyph = hourGlyph(s.hourLit / (hourTicks(s.day) * DT), s.hourHot);
  s.hourGlyphs[s.hourGlyphs.length - 1]?.push(glyph);
  s.events.push({ e: 'hourEnd', day: s.day, hour, glyph });
  s.hourLit = 0;
  s.hourHot = s.nubs.chill < TUNING.nubs.lowChill;
}

/** Advances the clock one tick and fires its transitions. */
function advanceClock(s: SimState): void {
  s.tick++;
  s.dayTick++;
  const dl = dayTicks(s.day);
  if (s.dayTick === dl + nightTicks(s.day)) {
    s.day++;
    s.dayTick = 0;
    s.params = paramsAt(s.world, s.day);
    s.phase = 'day';
    s.nubs.chill = s.nubs.maxChill;
    s.flakesToday = 0;
    s.stats.dayReached = s.day;
    s.stats.nightsReached++;
    s.hourGlyphs.push([]);
    s.hourLit = 0;
    s.hourHot = false;
    s.events.push({ e: 'dawn', day: s.day });
    return;
  }
  if (s.dayTick === dl) {
    s.phase = 'night';
    s.events.push({ e: 'nightStart', day: s.day });
  }
  if (s.dayTick === noonBannerTick(s.day)) s.events.push({ e: 'noonBanner' });
  if (s.dayTick === noonPassedTick(s.day)) s.events.push({ e: 'noonPassed' });
  const ht = hourTicks(s.day);
  if (s.dayTick <= dl && s.dayTick % ht === 0) endHour(s, s.dayTick / ht - 1);
}

/** Gate arches walked under and gazing balls left behind between prevY and Nubs' y. */
function passObjects(s: SimState, prevY: number): void {
  const y = s.nubs.y;
  const cs = s.world.casters;
  for (let i = lowerBound(cs, prevY); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y) break;
    if (!c.gate || c.y <= prevY) continue;
    const m = minutesOfDay(s.day, s.dayTick);
    const noon = s.phase === 'day' && m >= GATE_NOON_FROM && m <= GATE_NOON_TO;
    if (noon) s.stats.gateNoon = true;
    // 'gate' concept: walking under an arch fully shaded pays Snow.
    const snow = s.mods.has('gate') && s.nubs.f === 0 ? GATE_SNOW : 0;
    if (snow > 0) s.stats.snow += snow;
    s.events.push({ e: 'gateArch', noon, snow });
  }
  const bs = s.world.balls;
  for (let i = lowerBound(bs, prevY - BALL_PASS); i < bs.length; i++) {
    const b = bs[i] as GazingBall;
    if (b.y + BALL_PASS > y) break;
    if (b.y + BALL_PASS <= prevY) continue;
    const clean = !s.glaredBalls.has(b.id);
    if (clean) s.stats.ballsPassedClean++;
    s.events.push({ e: 'ballPassed', clean });
  }
}

function pushRecent(s: SimState): void {
  const o = (s.recentCount % RECENT) * 4;
  const nb = s.nubs;
  s.recent[o] = s.sun.theta;
  s.recent[o + 1] = nb.f * 5;
  s.recent[o + 2] = nb.glare * 2;
  s.recent[o + 3] = nb.glareBallId;
  s.recentCount++;
}

function die(s: SimState): void {
  s.phase = 'dead';
  // On a Trial the failed body's meter is already 0 (and a duo's other body keeps its own).
  if (s.trial === null) s.nubs.chill = 0;
  s.stats.minutes = s.minutes;
  s.hourGlyphs[s.hourGlyphs.length - 1]?.push('melt');
  const info = s.trial !== null ? heroDeath(s) : deathCause(s);
  s.death = info;
  s.events.push({ e: 'death', info });
}

/** Crossing the finish line with Chill > 0: the level ends, passed or not (CAMPAIGN_PLAN §2). */
function win(s: SimState): void {
  s.phase = 'won';
  s.stats.minutes = s.minutes;
  const level = s.level;
  if (!level) return;
  const o = levelOutcome(level, s);
  s.events.push({ e: 'levelWon', passed: o.passed, stars: o.stars, flakes: s.stats.flakes, minChill: s.stats.minChill });
}

// Scratch frame for the run-start tick (its rotation is discarded so θ stays exactly θ0).
const startFrame: InputFrame = { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };

/**
 * A start-beat tick: the sun follows the input and coverage is recomputed for the new θ, but the
 * clock, Nubs, Chill, the multiplier, pickups and the guide (θ-independent) all wait. `go` fires on
 * the last beat tick; Nubs sets off on the next one.
 */
function readyTick(s: SimState): void {
  s.ready--;
  s.tick++;
  s.ux = cosD(s.sun.theta);
  s.uy = sinD(s.sun.theta);
  computeCoverage(s);
  if (s.mate !== null) computeCoverage(s, s.mate);
  if (s.ready === 0) {
    s.lessonOn = s.cfg.lesson === true;
    s.events.push({ e: 'go' });
  }
}

/** Advances the run by one tick. s.events holds this tick's events afterwards. */
export function step(s: SimState, input: InputFrame): void {
  s.events.length = 0;
  if (s.phase === 'dead' || s.phase === 'won') return;
  let inp = input;
  if (s.phase === 'hold') {
    // Any touch (or a rotation key) starts the run with catch semantics; θ stays θ0 this tick.
    if (!input.downEdge && input.key === 0) return;
    s.phase = 'day';
    s.ready = TUNING.start.readyTicks;
    // A run created with less than the hard guarantee generated (createRun's `ahead`) pays the rest now.
    ensureGenerated(s.world, s.nubs.y + W.hardAhead);
    s.events.push({ e: 'start' });
    startFrame.down = input.down;
    startFrame.downEdge = input.downEdge;
    startFrame.upEdge = input.upEdge;
    startFrame.release = input.release;
    inp = startFrame;
  }

  updateSun(s, inp);
  if (s.ready > 0) {
    readyTick(s);
    return;
  }
  advanceClock(s);
  const prevY = s.nubs.y;
  syncTime(s);
  // Elementals: a relay's telegraph and TAG, before casting and coverage.
  if (s.trial !== null) updateRelay(s);
  const daylight = s.phase === 'day';

  ensureGenerated(s.world, s.nubs.y + W.hardAhead);
  if (s.tick % TICK_HZ === 0) pruneWorld(s.world, s.nubs.y - W.pruneBehind, s.tAbs - 2);

  updateFlare(s);
  syncEclipse(s);
  updateSnap(s, inp);
  computeCoverage(s);
  if (s.mate !== null) computeCoverage(s, s.mate);
  // Elementals: a Trial's bodies follow their heroes' rules, and night leaves hero meters unchanged.
  if (daylight) {
    if (s.trial !== null) applyHeroDaylight(s);
    else applyDaylight(s);
  } else if (s.trial === null) applyNight(s);
  updatePickups(s, daylight);
  updateBuds(s);
  passObjects(s, prevY);
  updateFeats(s);
  pushHistory(s);
  pushRecent(s);

  if (daylight && (s.nubs.chill <= 0 || (s.mate !== null && s.mate.chill <= 0))) {
    die(s);
    return;
  }
  if (s.nubs.y >= s.world.finishY) {
    win(s);
    return;
  }
  if (guideDue(s)) updateGuide(s);
}
