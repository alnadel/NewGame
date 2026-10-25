// Controls v3 driver (docs/CONTROLS_V3.md §2-§4, §11.3; CORE): the contract's exports and the C0c
// skeleton: aim help's radius table, the vane's symmetric notches, the button's act per leg (a
// lesson run's after its first full meter), presses (buffered, refused with their reasons, the
// pre-TAG press), Cold Snap presses, Ember's arms and ignition, Sprout's jobs and the Gust governor.
import { describe, expect, it } from 'vitest';
import type { HeroId } from '../../src/config/heroes.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { aimOut, aimPlan, aimRadius, glideStep, glideTicks, handPlan, q1024, settleTarget } from '../../src/core/drive/aim.ts';
import {
  createDriver,
  NOTE_BUFFER,
  NOTE_AUTO,
  NOTE_CALM,
  NOTE_EXPIRE,
  NOTE_HANDOVER,
  NOTE_NOTCH,
  NOTE_PRESS,
  NOTE_REFUSE,
  NOTE_SETTLE,
  NOTE_WAIT_LOW,
  REFUSE_BUSY,
  REFUSE_CHARGING,
  REFUSE_FULL,
  REFUSE_LOCKED,
  REFUSE_LOW,
  REFUSE_NOTHING,
  REFUSE_WAIT,
  vaneNotch,
  type DriveControl,
  type DriveOpts,
  type Driver,
} from '../../src/core/drive/driver.ts';
import { downwind, emberDue, emberLast, emberPick, gustFloor, jobGoal, nearLast, sproutPick, targetX } from '../../src/core/drive/pick.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { EL_BURNING, EL_GONE, EL_IDLE, type ElObj, type ElState } from '../../src/core/objects.ts';
import { createBot, touchOpts } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { burnTarget, growLeft, growTarget, nextTagHero, nextTagTicks, tagLocked, weatherXAt } from '../../src/core/sim/elements.ts';
import { driveWeatherX } from '../../src/core/drive/vane.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { binOf } from '../../src/core/intervals.ts';
import { angleDiff } from '../../src/core/dmath.ts';
import { snapReady } from '../../src/core/sim/mechanics.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, type InputFrame, type SimState } from '../../src/core/sim/types.ts';

const OPTS = { aimDeg: 0, track: false, nowOnly: false, autoSnap: false, autoAct: false, reducedMotion: false };
const ctl = (o: Partial<DriveControl> = {}): DriveControl => ({ act: 0, vane: 0, vaneUp: false, rest: false, ...o });
const frame = (): InputFrame => ({ ...NO_INPUT, snap: false });
const TAP: InputFrame = { ...NO_INPUT, downEdge: true, upEdge: true };

/** An Endless run started and walked past its start beat. */
function endless(lesson = false): SimState {
  const s = createRun({ ...headlessConfig(7, 3), lesson });
  step(s, TAP);
  while (s.ready > 0) step(s, NO_INPUT);
  return s;
}

/** Trial `id` walked by the reactive bot until `hero` walks past the start beat (then `until` holds; `skip` drops the bot's verbs on those objects). */
function trialTo(id: number, hero: HeroId, until: (s: SimState) => boolean = () => true, skip: readonly number[] = []): SimState {
  const s = createRun(campaignConfig(id));
  const bot = createBot('reactive');
  while (s.nubs.hero !== hero || s.ready > 0 || s.phase !== 'day' || !until(s)) {
    const f = { ...bot.next(s) };
    const v = f.verb ?? 0;
    if (v === VERB_TAP && skip.includes(burnTarget(s, f.vx ?? 0, f.vy ?? 0))) f.verb = 0;
    if (v === VERB_HOLD && skip.includes(growTarget(s, f.vx ?? 0, f.vy ?? 0))) f.verb = 0;
    step(s, f);
    expect(s.phase).not.toBe('dead');
  }
  return s;
}

/** The driver's notes since the last clear, as [code, a] pairs (then cleared). */
function drain(d: Driver): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < d.noteN; k++) out.push([d.notes[2 * k] as number, d.notes[2 * k + 1] as number]);
  d.clearNotes();
  return out;
}

/** One driven tick with control `c`: fills a neutral frame, steps it and returns it. */
function tick(s: SimState, d: Driver, c: Partial<DriveControl> = {}): InputFrame {
  const f = frame();
  d.fill(s, f, ctl(c));
  step(s, f);
  return f;
}

const isWall = (o: ElObj): boolean => o.kind === 'bramble' || o.kind === 'gate' || o.kind === 'ice';
const objs = (s: SimState): ElObj[] => (s.el as ElState).objs;

describe('aimRadius (§4.3)', () => {
  type Ctx = Parameters<typeof aimRadius>[1];
  const ctx: Ctx = { mode: 'campaign', level: 1, rung: -1, trial: false, blind: false };
  it('schedules Standard by chapter, rung, Daily and Trials; Strong, Light and Off are the player\'s', () => {
    const deg = (o: Partial<Ctx>) => aimRadius('standard', { ...ctx, ...o }).deg;
    expect([1, 40, 41, 100, 101, 200].map((level) => deg({ level }))).toEqual([14, 14, 12, 12, 10, 10]);
    expect([0, 1, 2, 3, 4, -1].map((rung) => deg({ mode: 'endless', level: null, rung }))).toEqual([14, 14, 14, 12, 10, 10]);
    expect([deg({ mode: 'daily', level: null }), deg({ mode: 'challenge', level: null }), deg({ level: 1005, trial: true })]).toEqual([10, 10, 14]);
    expect(aimRadius('standard', ctx).track).toBe(true);
    expect(aimRadius('strong', { ...ctx, level: 150 })).toEqual({ deg: 14, track: true });
    expect(aimRadius('light', ctx)).toEqual({ deg: 8, track: false });
    expect(aimRadius('off', ctx)).toEqual({ deg: 0, track: false });
    for (const a of ['standard', 'strong', 'light'] as const) expect(aimRadius(a, { ...ctx, blind: true }).deg).toBe(0);
  });
});

describe('the vane (§3.5)', () => {
  it('rounds symmetrically: an 18 px drag (0.5 notch) is +1 east and −1 west', () => {
    expect([0.5, -0.5, 0.49, -0.49, 1.5, -1.5, 2.49, -2.49, 0].map(vaneNotch)).toEqual([1, -1, 0, -0, 2, -2, 2, -2, 0]);
  });

  it('a Gust leg accumulates drag notches, snaps them on a lift, keeps them, and starts calm on the next Gust leg', () => {
    const s = trialTo(1004, 'gust');
    const d = createDriver();
    d.begin(s, OPTS);
    d.fill(s, frame(), ctl({ vane: 0.5 }));
    expect(d.view.vane).toBe(1);
    d.fill(s, frame(), ctl({ vane: 2.4 }));
    expect(d.view.vane).toBe(2);
    d.fill(s, frame(), ctl({ vane: -1.2, vaneUp: true }));
    expect(d.view.vane).toBe(1);
    d.fill(s, frame(), ctl());
    expect(d.view.vane).toBe(1);
    d.fill(s, frame(), ctl({ vane: -0.4 }));
    expect(d.view.vane).toBe(1);
    d.fill(s, frame(), ctl({ vaneUp: true }));
    expect(d.view.vane).toBe(1);
    // A new run (or Retry) starts calm.
    d.begin(s, OPTS);
    expect(d.view.vane).toBe(0);
  });
});

describe('the button (§0.1, §3.1, §2.3)', () => {
  it('shows each element\'s act on its leg, none in the hold', () => {
    const d = createDriver();
    const acts: Partial<Record<HeroId, string>> = {};
    for (const [id, hero] of [[1001, 'ember'], [1002, 'drip'], [1003, 'sprout'], [1004, 'gust'], [1001, 'nubs']] as const) {
      const s = trialTo(id, hero);
      d.begin(s, OPTS);
      d.observe(s);
      acts[hero] = d.view.act;
    }
    expect(acts).toEqual({ nubs: 'snap', ember: 'burn', drip: 'none', sprout: 'grow', gust: 'calm' });
    const held = createRun(headlessConfig(7, 3));
    d.begin(held, OPTS);
    expect(d.view.act).toBe('none');
  });

  it('a Cold Snap press casts on the first tick it may within 18 ticks; else it is refused on the 18th (a repeat this leg adds 16)', () => {
    const s = endless();
    s.nubs.frost = 0;
    const d = createDriver();
    d.begin(s, OPTS);
    expect(d.view.act).toBe('snap');
    expect(snapReady(s)).toBe(false);
    let f = frame();
    d.fill(s, f, ctl({ act: 1 }));
    expect([f.snap, d.view.buffered]).toEqual([false, true]);
    // The meter fills 10 ticks later: the buffered press casts then.
    for (let i = 0; i < 10; i++) {
      f = frame();
      d.fill(s, f, ctl());
      expect(f.snap).toBe(false);
      step(s, f);
    }
    s.nubs.frost = 1;
    f = frame();
    d.fill(s, f, ctl());
    expect([f.snap, d.view.buffered]).toEqual([true, false]);
    expect(drain(d)).toEqual([[NOTE_BUFFER, 1], [NOTE_PRESS, 1]]);
    step(s, f);
    expect(s.snapTicks).toBeGreaterThan(0);
    // A press that never becomes legal is refused when its wait runs out.
    const t = endless();
    t.nubs.frost = 0;
    d.begin(t, OPTS);
    expect(d.view.state).toBe(5);
    d.fill(t, frame(), ctl({ act: 1 }));
    // It waits 18 ticks after its own (still buffered on the 17th), refused on the 18th.
    for (let i = 0; i < 17; i++) d.fill(t, frame(), ctl());
    expect([d.view.buffered, d.noteN]).toEqual([true, 1]);
    d.fill(t, frame(), ctl());
    expect([d.view.buffered, d.view.refuse, d.view.refuseTick]).toEqual([false, REFUSE_CHARGING, 19]);
    expect(drain(d)).toEqual([[NOTE_BUFFER, 1], [NOTE_REFUSE, REFUSE_CHARGING]]);
    t.nubs.frost = 1;
    f = frame();
    d.fill(t, f, ctl());
    expect(f.snap).toBe(false);
    // The same reason again this leg is a repeat.
    t.nubs.frost = 0;
    d.fill(t, frame(), ctl({ act: 1 }));
    for (let i = 0; i < 18; i++) d.fill(t, frame(), ctl());
    expect(drain(d)).toEqual([[NOTE_BUFFER, 1], [NOTE_REFUSE, REFUSE_CHARGING + 16]]);
  });

  it('refuses a Cold Snap with the first reason that applies: locked, wait, busy', () => {
    const d = createDriver();
    const refuse = (s: SimState): number[][] => {
      d.begin(s, OPTS);
      d.fill(s, frame(), ctl({ act: 1 }));
      for (let i = 0; i < 18; i++) d.fill(s, frame(), ctl());
      return drain(d);
    };
    // The start beat.
    const beat = createRun(headlessConfig(7, 3));
    step(beat, TAP);
    beat.nubs.frost = 1;
    expect(beat.ready).toBeGreaterThan(0);
    expect(refuse(beat)).toEqual([[NOTE_BUFFER, 1], [NOTE_REFUSE, REFUSE_WAIT]]);
    // A snap is on.
    const on = endless();
    on.nubs.frost = 1;
    step(on, { ...NO_INPUT, snap: true });
    on.nubs.frost = 1;
    expect(on.snapTicks).toBeGreaterThan(0);
    expect(refuse(on)).toEqual([[NOTE_BUFFER, 1], [NOTE_REFUSE, REFUSE_BUSY]]);
    // A TAG is due: locked, with the ticks to it on the view.
    const tag = trialTo(1001, 'nubs', (s) => tagLocked(s));
    tag.nubs.frost = 1;
    d.begin(tag, OPTS);
    expect([d.view.state, d.view.lockTicks]).toEqual([2, nextTagTicks(tag)]);
    expect(refuse(tag)).toEqual([[NOTE_BUFFER, 1], [NOTE_REFUSE, REFUSE_LOCKED]]);
  });

  it('a press on a leg with no button is dropped silently, and a buffered press does not outlive its leg', () => {
    const s = trialTo(1002, 'drip');
    const d = createDriver();
    d.begin(s, OPTS);
    d.fill(s, frame(), ctl({ act: 1 }));
    expect([d.view.buffered, d.noteN]).toEqual([false, 0]);
    // The last Ember tick's press (no pick: everything gone) never reaches the Nubs leg after the TAG.
    const t = trialTo(1001, 'ember', (s) => nextTagTicks(s) === 1);
    for (const o of objs(t)) o.state = EL_GONE;
    t.nubs.frost = 1;
    d.begin(t, OPTS);
    tick(t, d, { act: 1 });
    expect(t.nubs.hero).toBe('nubs');
    for (let i = 0; i < 18; i++) expect(tick(t, d).snap).toBe(false);
    expect(drain(d)).toEqual([[NOTE_BUFFER, 2]]);
  });

  it('a press in the last 30 ticks before a TAG into Ember is kept and arms on Ember\'s first tick', () => {
    const s = trialTo(1001, 'nubs', (s) => nextTagTicks(s) === 20);
    const d = createDriver();
    d.begin(s, OPTS);
    expect([d.view.act, d.view.incoming]).toEqual(['snap', 'burn']);
    tick(s, d, { act: 1 });
    expect(d.view.buffered).toBe(true);
    // The TAG interrupts the session's buffer; the pre-TAG press survives it.
    while (s.nubs.hero === 'nubs') {
      d.interrupt();
      tick(s, d);
    }
    expect(drain(d)).toEqual([[NOTE_BUFFER, 2]]);
    const p = emberPick(s, new Int16Array([-1, -1]));
    expect(p).toBeGreaterThanOrEqual(0);
    tick(s, d);
    expect(drain(d)).toEqual([[NOTE_PRESS, 2]]);
    expect(Array.from(d.view.queue)).toEqual([p, -1]);
    expect(d.view.buffered).toBe(false);
  });

  it('a lesson run shows no button until its first full meter, then keeps it', () => {
    const s = endless(true);
    s.nubs.frost = 0;
    const d = createDriver();
    d.begin(s, OPTS);
    expect(d.view.act).toBe('none');
    s.nubs.frost = 1;
    d.observe(s);
    expect(d.view.act).toBe('snap');
    s.nubs.frost = 0;
    d.observe(s);
    expect(d.view.act).toBe('snap');
  });
});

describe('Ember (§3.2)', () => {
  const NONE = new Int16Array([-1, -1]);
  /** Eligible for a press now: idle, `near..range` ahead, still workable, resolving to itself. */
  const eligible = (s: SimState, i: number): boolean => {
    const o = objs(s)[i] as ElObj;
    const edge = isWall(o) ? o.y - TUNING.elements.objects.wallDepth / 2 : o.y - o.r - TUNING.elements.objects.touch;
    const ahead = edge - s.nubs.y;
    return (
      o.state === EL_IDLE && (isWall(o) || o.kind === 'puddle') && ahead >= TUNING.elements.near && ahead <= TUNING.elements.range &&
      emberLast(s, i) >= 0 && burnTarget(s, targetX(s, o), o.y) === i
    );
  };

  it('picks required walls first by last working tick, a puddle only when no wall is eligible, on every tick of T1, T5 and T7', () => {
    let walls = 0;
    for (const id of [1001, 1005, 1007]) {
      const s = trialTo(id, 'ember');
      const bot = createBot('reactive');
      while (s.nubs.hero === 'ember' && s.phase === 'day') {
        const p = emberPick(s, NONE);
        const all = objs(s).map((_, i) => i).filter((i) => eligible(s, i));
        if (p < 0) expect(all).toEqual([]);
        else {
          expect(all).toContain(p);
          const wall = isWall(objs(s)[p] as ElObj);
          if (wall) walls++;
          for (const j of all) {
            if (isWall(objs(s)[j] as ElObj)) {
              expect(wall).toBe(true);
              expect(emberLast(s, j)).toBeGreaterThanOrEqual(emberLast(s, p));
            }
          }
        }
        step(s, bot.next(s));
      }
    }
    expect(walls).toBeGreaterThan(0);
    // T7's puddle on Ember's path is picked once no wall is eligible (here: the walls gone).
    const s = trialTo(1007, 'ember', (s) => eligible(s, 14));
    const p = emberPick(s, NONE);
    expect(isWall(objs(s)[p] as ElObj)).toBe(true);
    for (const o of objs(s)) if (isWall(o)) o.state = EL_GONE;
    expect(emberPick(s, NONE)).toBe(14);
  });

  it('a press arms the pick for free; the arm ignites at its moment, at a point that resolves to it', () => {
    const s = trialTo(1001, 'ember');
    const d = createDriver();
    d.begin(s, OPTS);
    const p = d.view.pick;
    expect(p).toBeGreaterThanOrEqual(0);
    const flame = s.nubs.chill;
    tick(s, d, { act: 1 });
    expect(drain(d)).toEqual([[NOTE_PRESS, 2]]);
    expect([Array.from(d.view.queue), s.nubs.chill <= flame]).toEqual([[p, -1], true]);
    let tapped = 0;
    for (let k = 0; k < 600 && tapped === 0; k++) {
      const due = emberDue(s, p, 0);
      const f = frame();
      d.fill(s, f, ctl());
      if (f.verb === VERB_TAP) {
        tapped = 1;
        expect(due).toBeLessThanOrEqual(0);
        expect(burnTarget(s, f.vx ?? 0, f.vy ?? 0)).toBe(p);
      } else expect(due).toBeGreaterThan(0);
      step(s, f);
    }
    expect(tapped).toBe(1);
    expect((objs(s)[p] as ElObj).state).toBe(EL_BURNING);
    expect(Array.from(d.view.queue)).toEqual([-1, -1]);
  });

  it('an arm pressed on each of its last three working ticks still burns (the walker one tick on): an own bramble and ice past the TAG', () => {
    // T1: b0 is Ember's own bramble; i7 lies past the TAG back to Nubs (its fire must burn out first).
    for (const i of [0, 7]) {
      for (const k of [2, 1, 0]) {
        const s = trialTo(1001, 'ember', (s) => (objs(s)[i] as ElObj).state === EL_IDLE && emberLast(s, i) < k + 1, [i]);
        expect(emberLast(s, i)).toBeGreaterThanOrEqual(0);
        expect(emberPick(s, NONE)).toBe(i);
        const d = createDriver();
        d.begin(s, OPTS);
        const f = tick(s, d, { act: 1 });
        expect(f.verb).toBe(VERB_TAP);
        expect((objs(s)[i] as ElObj).state).toBe(EL_BURNING);
      }
      // One tick later it is no longer a pick.
      const late = trialTo(1001, 'ember', (s) => emberLast(s, i) < 0, [i]);
      expect(emberPick(late, NONE)).not.toBe(i);
    }
  });

  it('two arms at most: a third press is refused "full"; with nothing in range "nothing"', () => {
    const s = trialTo(1001, 'ember');
    const d = createDriver();
    d.begin(s, OPTS);
    tick(s, d, { act: 1 });
    tick(s, d, { act: 1 });
    expect(Array.from(d.view.queue).every((i) => i >= 0)).toBe(true);
    expect(d.view.pick).toBe(-1);
    expect(drain(d)).toEqual([[NOTE_PRESS, 2], [NOTE_PRESS, 2]]);
    tick(s, d, { act: 1 });
    for (let k = 0; k < 18; k++) tick(s, d);
    expect(drain(d)).toEqual([[NOTE_BUFFER, 2], [NOTE_REFUSE, REFUSE_FULL]]);
    const t = trialTo(1001, 'ember');
    for (const o of objs(t)) o.state = EL_GONE;
    d.begin(t, OPTS);
    tick(t, d, { act: 1 });
    for (let k = 0; k < 18; k++) tick(t, d);
    expect(drain(d)).toEqual([[NOTE_BUFFER, 2], [NOTE_REFUSE, REFUSE_NOTHING]]);
  });

  it('an arm waits for Flame above its cost, then fires; an arm past its last working tick drops', () => {
    const s = trialTo(1001, 'ember', (s) => emberDue(s, 0, 0) <= 0);
    const d = createDriver();
    d.begin(s, OPTS);
    const flame = s.nubs.chill;
    s.nubs.chill = 14 * s.trial!.tune.costMul;
    expect(tick(s, d, { act: 1 }).verb ?? 0).toBe(0);
    expect(Array.from(d.view.queue)).toEqual([0, -1]);
    // The next pick costs more Flame than there is: low.
    expect(d.view.state).toBe(3);
    s.nubs.chill = flame;
    expect(tick(s, d).verb).toBe(VERB_TAP);
    // An arm whose wall the walker passes drops (here: Flame never covers it).
    const t = trialTo(1001, 'ember', (s) => emberDue(s, 0, 0) <= 0);
    d.begin(t, OPTS);
    t.nubs.chill = 1;
    tick(t, d, { act: 1 });
    expect(Array.from(d.view.queue)).toEqual([0, -1]);
    while (emberLast(t, 0) >= 0) {
      t.nubs.chill = 1;
      expect(tick(t, d).verb ?? 0).toBe(0);
    }
    t.nubs.chill = flame;
    tick(t, d);
    expect(Array.from(d.view.queue)).toEqual([-1, -1]);
  });
});

describe('Sprout (§3.3)', () => {
  const NONE = new Int16Array([-1, -1]);
  const isCrossing = (o: ElObj): boolean => o.kind === 'gap' || o.kind === 'stream';
  /** Eligible for a press now: a crossing or a treeless plot that can take Sap, starts a hold one tick on, resolving to itself. */
  const eligible = (s: SimState, i: number): boolean => {
    const o = objs(s)[i] as ElObj;
    return (
      o.state !== EL_GONE && (isCrossing(o) || (o.kind === 'plot' && o.casterId < 0)) && o.size < (isCrossing(o) ? 2 * o.r : 60) &&
      nearLast(s, o) >= 0 && growTarget(s, targetX(s, o), o.y) === i
    );
  };
  /** Sap held at `v` (the pour tests are about the jobs, not the economy). */
  const sap = (s: SimState, v = 80): void => {
    s.nubs.chill = v;
  };

  it('picks crossings by growLeft, then the nearest plot not downwind, then any plot, on every tick of T3, T6 and T7', () => {
    const seen = new Set<string>();
    for (const id of [1003, 1006, 1007]) {
      const s = trialTo(id, 'sprout');
      const bot = createBot('reactive');
      while (s.nubs.hero === 'sprout' && s.phase === 'day') {
        const el = s.el as ElState;
        const p = sproutPick(s, NONE);
        const all = el.objs.map((_, i) => i).filter((i) => eligible(s, i));
        const rank = (i: number): number => (isCrossing(el.objs[i] as ElObj) ? 0 : downwind(s, el, el.objs[i] as ElObj) ? 2 : 1);
        if (p < 0) expect(all).toEqual([]);
        else {
          expect(all).toContain(p);
          seen.add(`r${rank(p)}`);
          for (const j of all) {
            expect(rank(j)).toBeGreaterThanOrEqual(rank(p));
            if (rank(j) === rank(p) && rank(p) === 0) expect(growLeft(s, el.objs[j] as ElObj)).toBeGreaterThanOrEqual(growLeft(s, el.objs[p] as ElObj));
            if (rank(j) === rank(p) && rank(p) > 0) expect((el.objs[j] as ElObj).y).toBeGreaterThanOrEqual((el.objs[p] as ElObj).y);
          }
        }
        step(s, bot.next(s));
      }
    }
    expect([...seen].sort()).toEqual(['r0', 'r1', 'r2']);
    // T7: p428 before the nearer p420, which sits downwind of Ember's required b423.
    const s = trialTo(1007, 'sprout', (s) => sproutPick(s, NONE) === 13);
    const el = s.el as ElState;
    expect(eligible(s, 11)).toBe(true);
    expect((el.objs[11] as ElObj).y).toBeLessThan((el.objs[13] as ElObj).y);
    expect([downwind(s, el, el.objs[11] as ElObj), downwind(s, el, el.objs[13] as ElObj)]).toEqual([true, false]);
  });

  it('a press starts the pick\'s job: it pours at the site\'s point and lets go the tick after the goal', () => {
    const s = trialTo(1003, 'sprout');
    const d = createDriver();
    d.begin(s, OPTS);
    const p = d.view.pick;
    const o = objs(s)[p] as ElObj;
    expect(o.kind).toBe('gap');
    const goal = jobGoal(o);
    expect(goal).toBe(2 * o.r);
    const f = tick(s, d, { act: 1 });
    expect([f.verb, f.vx, f.vy]).toEqual([VERB_HOLD, targetX(s, o), o.y]);
    expect(drain(d)).toEqual([[NOTE_PRESS, 3]]);
    d.observe(s);
    expect([(s.el as ElState).hold, Array.from(d.view.queue), d.view.state]).toEqual([p, [p, -1], 4]);
    let size = o.size;
    for (let k = 0; k < 120; k++) {
      sap(s);
      const g = frame();
      d.fill(s, g, ctl());
      if (g.verb === VERB_RELEASE) break;
      expect(g.verb ?? 0).toBe(0);
      size = o.size;
      step(s, g);
    }
    expect([size < goal, o.size >= goal]).toEqual([true, true]);
  });

  it('queues one job, tops up a running plot by 20 to at most 60, refuses "full" and "low"', () => {
    const s = trialTo(1003, 'sprout');
    const d = createDriver();
    d.begin(s, OPTS);
    tick(s, d, { act: 1 });
    expect(d.view.pick).toBe(0);
    tick(s, d, { act: 1 });
    expect(Array.from(d.view.queue)).toEqual([1, 0]);
    tick(s, d, { act: 1 });
    for (let k = 0; k < 18; k++) {
      sap(s);
      tick(s, d);
    }
    expect(drain(d)).toEqual([[NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_BUFFER, 3], [NOTE_REFUSE, REFUSE_FULL]]);
    // A plot job (here with the crossings gone): two more presses take its goal from 20 to 60 (capped);
    // a fourth has nothing to do.
    const u = trialTo(1003, 'sprout');
    for (const x of objs(u)) if (isCrossing(x)) x.state = EL_GONE;
    d.begin(u, OPTS);
    for (let k = 0; k < 4; k++) {
      sap(u);
      tick(u, d, { act: 1 });
    }
    const o = objs(u)[0] as ElObj;
    let size = 0;
    for (let k = 0; k < 200; k++) {
      sap(u);
      const g = frame();
      d.fill(u, g, ctl());
      if (g.verb === VERB_RELEASE) break;
      size = o.size;
      step(u, g);
    }
    expect([size < 60, o.size]).toEqual([true, 60]);
    expect(drain(d)).toEqual([[NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_BUFFER, 3], [NOTE_REFUSE, REFUSE_NOTHING]]);
    // A new plot job needs Sap above 30.
    const t = trialTo(1003, 'sprout');
    for (const x of objs(t)) if (isCrossing(x)) x.state = EL_GONE;
    d.begin(t, OPTS);
    expect(d.view.pick).toBe(0);
    sap(t, 30);
    d.observe(t);
    expect(d.view.state).toBe(3);
    tick(t, d, { act: 1 });
    for (let k = 0; k < 18; k++) {
      sap(t, 30);
      tick(t, d);
    }
    expect(drain(d)).toEqual([[NOTE_BUFFER, 3], [NOTE_REFUSE, REFUSE_LOW]]);
  });

  it('drops a job whose plot already stands as a tree (a pre-empted plot that stood meanwhile)', () => {
    const s = trialTo(1003, 'sprout');
    for (const x of objs(s)) if (isCrossing(x)) x.state = EL_GONE;
    const d = createDriver();
    d.begin(s, OPTS);
    tick(s, d, { act: 1 });
    expect((s.el as ElState).hold).toBe(0);
    (objs(s)[0] as ElObj).casterId = 1;
    const f = frame();
    d.fill(s, f, ctl());
    expect([f.verb, Array.from(d.view.queue)]).toEqual([VERB_RELEASE, [-1, -1]]);
  });

  it('a queued crossing under 90 ticks of growLeft pre-empts a running plot, which takes the queue place', () => {
    // T3: p3 is the pick until g4 comes into range.
    const s = trialTo(1003, 'sprout', (s) => sproutPick(s, NONE) === 3 && s.nubs.y >= 2060, [3, 4]);
    const d = createDriver();
    d.begin(s, OPTS);
    for (let k = 0; k < 3; k++) {
      sap(s);
      tick(s, d, { act: 1 });
    }
    while (d.view.pick !== 4) {
      sap(s);
      tick(s, d);
    }
    tick(s, d, { act: 1 });
    expect(Array.from(d.view.queue)).toEqual([3, 4]);
    let f = frame();
    for (let k = 0; k < 200; k++) {
      sap(s);
      f = frame();
      d.fill(s, f, ctl());
      if (f.verb === VERB_RELEASE) break;
      expect(growLeft(s, objs(s)[4] as ElObj)).toBeGreaterThanOrEqual(TUNING.drive.sprout.urgent);
      step(s, f);
    }
    expect(f.verb).toBe(VERB_RELEASE);
    expect((objs(s)[3] as ElObj).size).toBeLessThan(60);
    expect(Array.from(d.view.queue)).toEqual([4, 3]);
    step(s, f);
    sap(s);
    expect(tick(s, d).verb).toBe(VERB_HOLD);
    expect((s.el as ElState).hold).toBe(4);
  });
});

describe('Gust (§3.5)', () => {
  /** Weather in play: an awake rain or fog object, not gone, whose far edge is not behind the walker. */
  const inPlay = (s: SimState): boolean =>
    objs(s).some((o) => (o.kind === 'rain' || o.kind === 'fog') && o.awake && o.state !== EL_GONE && o.y + TUNING.elements.weather.ryRatio * o.r >= s.nubs.y);

  it('the governor keeps the wind in the notch\'s band, one gust per 15 ticks at most, above the policy\'s Lift floor', () => {
    const s = trialTo(1004, 'gust');
    const el = s.el as ElState;
    const d = createDriver();
    d.begin(s, OPTS);
    let last = -1e9;
    let gusts = 0;
    for (let k = 0; k < 400 && s.nubs.hero === 'gust'; k++) {
      s.nubs.chill = 80;
      const n = k < 200 ? 1 : 2;
      const want = el.wind < TUNING.drive.gust.band[n]! && k - last >= 15 && inPlay(s);
      const f = frame();
      d.fill(s, f, ctl(k === 0 || k === 200 ? { vane: k === 0 ? 0.5 : 1, vaneUp: true } : {}));
      expect(d.view.vane).toBe(n);
      expect((f.verb ?? 0) === VERB_EAST).toBe(want);
      if (want) {
        last = k;
        gusts++;
      }
      step(s, f);
    }
    expect(gusts).toBeGreaterThan(4);
    d.observe(s);
    expect([d.view.vaneResting, d.view.vaneCost]).toEqual([false, 13.0 * s.trial!.tune.costMul]);
  });

  it('auto-calms at the floor (a drag sets it again), rests with no weather in play, and Calm stills a set vane only', () => {
    const s = trialTo(1004, 'gust');
    const el = s.el as ElState;
    const d = createDriver();
    d.begin(s, OPTS);
    tick(s, d, { vane: -0.5, vaneUp: true });
    s.nubs.chill = gustFloor(s, el);
    const f = tick(s, d);
    expect([f.verb ?? 0, d.view.vane]).toEqual([0, 0]);
    s.nubs.chill = 80;
    for (let k = 0; k < 15; k++) tick(s, d);
    expect(d.view.vane).toBe(0);
    tick(s, d, { vane: -1, vaneUp: true });
    expect(d.view.vane).toBe(-1);
    // The notch changes and the auto-calm (CALM a = 1).
    expect(drain(d)).toEqual([[NOTE_NOTCH, -1], [NOTE_CALM, 1], [NOTE_NOTCH, -1]]);
    // A Calm press stills it (PRESS, CALM a = 0); on a calm vane a press does nothing but CALM a = 2 (no REFUSE).
    tick(s, d, { act: 1 });
    expect([d.view.vane, d.view.state]).toEqual([0, 0]);
    tick(s, d, { act: 1 });
    expect(drain(d)).toEqual([[NOTE_PRESS, 4], [NOTE_CALM, 0], [NOTE_CALM, 2]]);
    // No weather in play: the vane keeps its notch, dimmed, and blows nothing.
    for (const o of el.objs) if (o.kind === 'rain' || o.kind === 'fog') o.state = EL_GONE;
    tick(s, d, { vane: 2, vaneUp: true });
    for (let k = 0; k < 30; k++) expect(tick(s, d).verb ?? 0).toBe(0);
    expect([d.view.vane, d.view.vaneResting, d.view.vaneCost, d.view.state]).toEqual([2, true, 0, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
// Aim help (§4): the magnet's plan, the hand-over's, the glide, and when the driver may act
// ---------------------------------------------------------------------------------------------

type Arc = readonly [number, number];
let paintTick = 1e6;
/** Every guide mask cleared; `now` set on `arcs` and `next` on `next` (default the same); a fresh guide refresh tick. */
function paint(s: SimState, arcs: readonly Arc[], next: readonly Arc[] = arcs): void {
  const g = s.guide;
  for (const m of [g.now, g.next, g.land, g.tag, g.bud, g.flake, g.flare, g.glare]) m.fill(0);
  g.flareTicks = -1;
  mark(g.now, arcs);
  mark(g.next, next);
  g.tick = paintTick++;
}
function mark(m: Uint8Array, arcs: readonly Arc[]): void {
  for (const [lo, hi] of arcs) for (let b = lo; b <= hi; b++) m[(b + 360) % 360] = 1;
}

describe('aim help: the magnet\'s target (§4.2)', () => {
  const s = endless();

  it('settles a lit sun into the nearest lasting arc within R, landing 4° inside it (at most half its width)', () => {
    paint(s, [[110, 130]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(113.5);
    expect(aimOut.kind).toBe(1);
    expect(aimPlan(s, 100, 9, false, true)).toBeNaN();
    paint(s, [[80, 90]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(86.5);
    paint(s, [[110, 113]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(111.5);
    // At the same reach the wider arc wins, then CCW.
    paint(s, [[110, 112], [88, 90]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(111);
    paint(s, [[110, 112], [80, 90]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(86.5);
    expect(settleTarget(s, 100, 14, false)).toBe(86.5);
    expect(settleTarget(s, 100, 0, false)).toBeNaN();
  });

  it('lasting shade is now ∧ next (now alone when that is empty, or on a fog level); ending shade is left alone (cut list 2)', () => {
    paint(s, [[100, 130]], [[110, 130]]);
    expect(aimPlan(s, 105, 14, false, true)).toBeNaN();
    // Lit, it settles into the lasting part.
    expect(aimPlan(s, 99, 14, false, true)).toBe(113.5);
    // Fog: guide.now only, so the edge is near and the sun goes back inside.
    expect(aimPlan(s, 100.2, 14, true, true)).toBe(103.5);
    paint(s, [[110, 130]], []);
    expect(aimPlan(s, 100, 14, false, true)).toBe(113.5);
    // During a Cold Snap with a landing: guide.land.
    paint(s, [[110, 130]]);
    mark(s.guide.land, [[140, 150]]);
    s.snapTicks = 10;
    expect(aimPlan(s, 135, 14, false, true)).toBe(143.5);
    s.snapTicks = 0;
  });

  it('honours a gold bud, a glass glint and a flare rim under the sun, and never crosses glare for Nubs', () => {
    for (const m of ['bud', 'flake', 'flare'] as const) {
      paint(s, [[110, 130]]);
      s.guide[m][100] = 1;
      if (m === 'flare') {
        expect(aimPlan(s, 100, 14, false, true)).toBe(113.5);
        s.guide.flareTicks = 30;
      }
      expect(aimPlan(s, 100, 14, false, true), m).toBeNaN();
    }
    paint(s, [[110, 130]]);
    s.guide.glare[105] = 1;
    expect(aimPlan(s, 100, 14, false, true)).toBeNaN();
    mark(s.guide.now, [[80, 90]]);
    mark(s.guide.next, [[80, 90]]);
    expect(aimPlan(s, 100, 14, false, true)).toBe(86.5);
    s.nubs.hero = 'ember';
    expect(aimPlan(s, 100, 14, false, true)).toBe(113.5);
    s.nubs.hero = 'nubs';
  });

  it('tracks a sun near its arc\'s edge back inside the same arc (never to another), only with track on', () => {
    paint(s, [[90, 108], [110, 130]]);
    expect(aimPlan(s, 110.2, 14, false, true)).toBe(113.5);
    expect(aimOut.kind).toBe(0);
    expect(aimPlan(s, 129.6, 14, false, true)).toBe(126.5);
    expect(aimPlan(s, 120, 14, false, true)).toBeNaN();
    expect(aimPlan(s, 110.2, 14, false, false)).toBeNaN();
    paint(s, [[0, 359]]);
    expect(aimPlan(s, 10, 14, false, true)).toBeNaN();
  });

  it('reads bins as binOf does: bin b covers [b − 0.5, b + 0.5)', () => {
    paint(s, [[110, 130]]);
    expect([binOf(109.49), binOf(109.5), binOf(130.49), binOf(130.5)]).toEqual([109, 110, 130, 131]);
    expect(aimPlan(s, 109.49, 14, false, true)).toBe(113.5);
    expect(aimOut.kind).toBe(1);
    expect(aimPlan(s, 109.5, 14, false, true)).toBe(113.5);
    expect(aimOut.kind).toBe(0);
    expect(aimPlan(s, 130.49, 14, false, true)).toBe(126.5);
    expect(aimOut.kind).toBe(0);
    expect(aimPlan(s, 130.5, 14, false, true)).toBe(126.5);
    expect(aimOut.kind).toBe(1);
  });

  it('in a TAG telegraph prefers T ∧ guide.tag within reach, and leaves a sun parked on guide.tag alone', () => {
    // T1: the telegraph of the TAG from Ember back to Nubs. Two arcs at the same reach: the wider wins
    // until the dashed arcs cover the other.
    const t = trialTo(1001, 'ember', (x) => tagLocked(x) && nextTagHero(x) === 'nubs');
    paint(t, [[105, 112], [140, 150]]);
    expect(aimPlan(t, 126, 14, false, true)).toBe(143.5);
    mark(t.guide.tag, [[105, 112], [130, 138]]);
    expect(aimPlan(t, 126, 14, false, true)).toBe(108.5);
    // Parked on the dashed arcs (lit or in shade): left alone.
    expect(aimPlan(t, 135, 14, false, true)).toBeNaN();
    expect(aimPlan(t, 108, 14, false, true)).toBeNaN();
  });
});

describe('aim help: the hand-over before Drip (§4.4)', () => {
  const s = endless();

  it('lands 3° inside the nearest tag ∧ now arc within 30°, else the nearest tag arc; it ignores the bud, glass and flare honour', () => {
    paint(s, [[130, 150]]);
    mark(s.guide.tag, [[120, 140]]);
    s.guide.bud[100] = 1;
    expect(handPlan(s, 100)).toBe(132.5);
    expect(aimOut.bin).toBe(130);
    paint(s, []);
    mark(s.guide.tag, [[120, 140]]);
    expect(handPlan(s, 100)).toBe(122.5);
    expect(handPlan(s, 125)).toBeNaN();
    paint(s, []);
    mark(s.guide.tag, [[135, 140]]);
    expect(handPlan(s, 100)).toBeNaN();
  });
});

describe('aim help: the glide (§4.5)', () => {
  it('eases over max(2, ⌈2|Δ|/(rate·DT)⌉) ticks, its steps summing to q1024(Δ) exactly', () => {
    for (const delta of [0.3, 1, 10.5, -37.25, 90, -179.9]) {
      const n = glideTicks(delta, 240);
      expect(n).toBe(Math.max(2, Math.ceil((120 * Math.abs(delta)) / 240)));
      let sum = 0;
      let prev = Infinity;
      for (let k = 1; k < n; k++) {
        const d = glideStep(delta, n, k);
        expect(Math.abs(d)).toBeLessThanOrEqual(prev);
        prev = Math.abs(d);
        expect(d * 1024).toBe(Math.round(d * 1024));
        sum += d;
      }
      sum += q1024(delta) - sum;
      expect(sum).toBe(q1024(delta));
    }
    expect(glideTicks(30, 180)).toBe(20);
  });
});

describe('aim help: when the driver glides (§4.1, §4.5)', () => {
  /** An Endless run past its start beat with the sun up, and a driver with a 14° radius that tracks. */
  function magnet(o: Partial<DriveOpts> = {}, lesson = false): { s: SimState; d: Driver } {
    const s = endless(lesson);
    while (!s.sunUp) step(s, NO_INPUT);
    const d = createDriver();
    d.begin(s, { ...OPTS, aimDeg: 14, track: true, ...o });
    return { s, d };
  }
  /** One tick: `arcs` painted as lasting shade (a guide refresh), Nubs kept cool, the input `p` filled by the driver and stepped. */
  function at(s: SimState, d: Driver, arcs: readonly Arc[], p: Partial<InputFrame> = {}, c: Partial<DriveControl> = {}): InputFrame {
    paint(s, arcs);
    s.nubs.chill = s.nubs.maxChill;
    const f = { ...frame(), ...p };
    d.fill(s, f, ctl(c));
    step(s, f);
    return f;
  }
  /** A stroke of `n` ticks turning `per`° each, then its lift. */
  function stroke(s: SimState, d: Driver, arcs: readonly Arc[], per: number, n: number): void {
    at(s, d, arcs, { downEdge: true, down: true, dTheta: per });
    for (let k = 1; k < n; k++) at(s, d, arcs, { down: true, dTheta: per });
    at(s, d, arcs, { upEdge: true });
  }
  /** Ticks with no hand: the frames the driver wrote that move the sun (with the tick after the lift they came on, from 1). */
  function idle(s: SimState, d: Driver, arcs: readonly Arc[], n: number): { k: number; f: InputFrame; from: number; to: number }[] {
    const out: { k: number; f: InputFrame; from: number; to: number }[] = [];
    for (let k = 1; k <= n; k++) {
      const from = s.sun.theta;
      const f = at(s, d, arcs);
      if (f.dTheta !== 0 || f.downEdge || f.upEdge) out.push({ k, f, from, to: d.view.glide });
    }
    return out;
  }

  it('finishes a stroke after the re-grip grace: one eased glide into the arc, summing to q1024(Δ), landing within 0.01°', () => {
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 12, b + 32]];
    stroke(s, d, arcs, 1, 5);
    drain(d);
    const g = idle(s, d, arcs, 60);
    expect(g.length).toBeGreaterThanOrEqual(2);
    const first = g[0]!;
    // No glide within 15 ticks of the lift.
    expect(first.k).toBe(TUNING.drive.aim.regripTicks);
    const delta = angleDiff(first.to, first.from);
    expect(g).toHaveLength(glideTicks(delta, TUNING.drive.aim.rate));
    expect(g.map((x) => [x.f.downEdge, x.f.upEdge])).toEqual(g.map((_, i) => [i === 0, i === g.length - 1]));
    expect(g.reduce((a, x) => a + x.f.dTheta, 0)).toBe(q1024(delta));
    expect(Math.abs(angleDiff(s.sun.theta, first.to))).toBeLessThan(0.01);
    const bin = binOf(s.sun.theta);
    expect(bin >= b + 12 && bin <= b + 32).toBe(true);
    expect(drain(d)).toEqual([[NOTE_SETTLE, 1]]);
  });

  it('never glides against the stroke by more than 4° until 30 ticks after the lift; one glide start per 30 ticks', () => {
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 2, b + 20]];
    stroke(s, d, arcs, -1, 5);
    const g = idle(s, d, arcs, 40);
    expect(g[0]!.k).toBe(TUNING.drive.aim.againstTicks);
    expect(angleDiff(g[0]!.to, g[0]!.from)).toBeGreaterThan(TUNING.drive.aim.againstDeg);
    // The sun lit again at once: the next glide starts 30 ticks after this one.
    const c = binOf(s.sun.theta);
    const next: Arc[] = [[c + 6, c + 20]];
    const h = idle(s, d, next, 60);
    expect(h[0]!.k + 40 - g[0]!.k).toBe(TUNING.drive.aim.gapTicks);
  });

  it('acts only within 300 ticks of the last sun move', () => {
    for (const late of [250, 310]) {
      const { s, d } = magnet();
      const b = binOf(s.sun.theta);
      stroke(s, d, [[b + 100, b + 120]], 1, 5);
      expect(idle(s, d, [[b + 100, b + 120]], late - 1)).toEqual([]);
      const g = idle(s, d, [[b + 12, b + 32]], 60);
      expect(g.length > 0).toBe(late < TUNING.drive.aim.engageTicks);
    }
  });

  it('never glides for an idle run, a press-only player or a resting finger that never moved, nor in a lesson', () => {
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 6, b + 20]];
    expect(idle(s, d, arcs, 600)).toEqual([]);
    for (let k = 0; k < 600; k++) {
      const f = at(s, d, arcs, {}, { act: k % 20 === 0 ? 1 : 0 });
      expect([f.dTheta, f.downEdge, f.upEdge]).toEqual([0, false, false]);
    }
    // A finger put down for the start tap and kept still.
    const t = createRun({ ...headlessConfig(7, 3), lesson: false });
    const e = createDriver();
    e.begin(t, { ...OPTS, aimDeg: 14, track: true });
    const c = binOf(t.sun.theta);
    at(t, e, [[c + 6, c + 20]], { downEdge: true, down: true });
    for (let k = 0; k < 600; k++) {
      const f = at(t, e, [[c + 6, c + 20]], { down: true }, { rest: k >= 18 });
      expect(f.dTheta).toBe(0);
    }
    expect(t.ready).toBe(0);
    // The first-run lesson: the pass is the player's own turn.
    const l = magnet({}, true);
    expect(l.s.lessonOn).toBe(true);
    const lb = binOf(l.s.sun.theta);
    stroke(l.s, l.d, [[lb + 12, lb + 32]], 1, 5);
    for (let k = 0; k < 60 && l.s.lessonOn; k++) expect(at(l.s, l.d, [[lb + 12, lb + 32]]).dTheta).toBe(0);
  });

  it('a touch-down cancels a glide (a re-grip within 30 ticks of the lift undoes it); a key cancels it with an upEdge', () => {
    for (const regrip of [24, 40]) {
      const { s, d } = magnet();
      const b = binOf(s.sun.theta);
      const arcs: Arc[] = [[b + 12, b + 32]];
      stroke(s, d, arcs, 1, 5);
      const before = s.sun.theta;
      const g = idle(s, d, arcs, regrip - 1);
      expect(g.length).toBeGreaterThan(0);
      const landed = s.sun.theta;
      expect(Math.abs(angleDiff(landed, before))).toBeGreaterThan(1);
      const f = at(s, d, arcs, { downEdge: true, down: true });
      expect(f.upEdge).toBe(false);
      for (let k = 0; k < 10; k++) at(s, d, arcs, { down: true });
      expect(Math.abs(angleDiff(s.sun.theta, regrip <= TUNING.drive.aim.againstTicks ? before : landed))).toBeLessThan(0.01);
    }
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 20, b + 50]];
    stroke(s, d, arcs, 2, 5);
    const g = idle(s, d, arcs, TUNING.drive.aim.regripTicks);
    expect(g).toHaveLength(1);
    expect(Number.isNaN(d.view.glide)).toBe(false);
    const f = at(s, d, arcs, { key: 1 });
    expect([f.upEdge, f.down, f.release]).toEqual([true, false, 0]);
    expect(d.view.glide).toBeNaN();
  });

  it('two strokes 200 ms apart lose at most 1° of the swing; a re-grip carries an unfinished chase on', () => {
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 14, b + 30]];
    const t0 = s.sun.theta;
    stroke(s, d, arcs, 2, 5);
    expect(idle(s, d, arcs, 12)).toEqual([]);
    stroke(s, d, arcs, 2, 5);
    expect(Math.abs(angleDiff(s.sun.theta, t0 + 20))).toBeLessThanOrEqual(1);
    // A 50° flick lifted mid-chase, caught at once: the chase goes on to the finger's target.
    const e = magnet({ aimDeg: 0 });
    const t1 = e.s.sun.theta;
    at(e.s, e.d, [], { downEdge: true, down: true, dTheta: 50 });
    at(e.s, e.d, [], { upEdge: true });
    expect(e.s.sun.mode).toBe('chasing');
    at(e.s, e.d, [], { downEdge: true, down: true });
    for (let k = 0; k < 10; k++) at(e.s, e.d, [], { down: true });
    expect(Math.abs(angleDiff(e.s.sun.theta, t1 + 50))).toBeLessThan(0.01);
  });

  it('a resting finger gets a glide with no edges, and its next move goes on from there', () => {
    const { s, d } = magnet();
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b + 12, b + 32]];
    at(s, d, arcs, { downEdge: true, down: true, dTheta: 1 });
    for (let k = 0; k < 4; k++) at(s, d, arcs, { down: true, dTheta: 1 });
    const g: InputFrame[] = [];
    let to = NaN;
    for (let k = 0; k < 40; k++) {
      const f = at(s, d, arcs, { down: true }, { rest: k >= 18 });
      if (f.dTheta !== 0) {
        g.push(f);
        if (to !== to) to = d.view.glide;
      }
    }
    expect(g.length).toBeGreaterThanOrEqual(2);
    expect(g.every((f) => f.down && !f.downEdge && !f.upEdge)).toBe(true);
    expect(Math.abs(angleDiff(s.sun.theta, to))).toBeLessThan(0.01);
    at(s, d, arcs, { down: true, dTheta: 1 });
    expect(Math.abs(angleDiff(s.sun.theta, to + 1))).toBeLessThan(0.01);
  });
});

describe('the hand-over, Auto Snap and Auto actions (§4.4, §3.1, §3.6)', () => {
  it('in the last 60 ticks before a TAG into Drip the sun glides onto the dashed arcs; before Ember it does not', () => {
    for (const [id, into] of [[1002, 'drip'], [1001, 'ember']] as const) {
      const s = trialTo(id, 'nubs', (x) => nextTagHero(x) === into && nextTagTicks(x) >= 0 && nextTagTicks(x) <= 100);
      const d = createDriver();
      d.begin(s, { ...OPTS, aimDeg: 14, track: true });
      // Turn the sun 20° off a dashed arc (before Ember: just 20°), and let go.
      const g = s.guide;
      let off = s.sun.theta + 20;
      if (into === 'drip') {
        off = -1;
        for (let b = 0; b < 360 && off < 0; b++) if (g.tag[b] === 1 && g.tag[(b + 340) % 360] === 0 && g.tag[(b + 350) % 360] === 0) off = (b + 340) % 360;
        expect(off).toBeGreaterThanOrEqual(0);
      }
      const down = frame();
      down.downEdge = down.down = true;
      down.dTheta = q1024(angleDiff(off, s.sun.theta));
      d.fill(s, down, ctl());
      step(s, down);
      const up = frame();
      up.upEdge = true;
      d.fill(s, up, ctl());
      step(s, up);
      let hand = 0;
      let landed = false;
      while (s.nubs.hero === 'nubs' && s.phase === 'day') {
        s.nubs.chill = s.nubs.maxChill;
        tick(s, d);
        if (d.view.handover) hand++;
        else if (hand > 0 && !landed) landed = s.guide.tag[binOf(s.sun.theta)] === 1;
      }
      const notes = drain(d).filter((n) => n[0] === NOTE_HANDOVER);
      if (into === 'drip') {
        expect(hand).toBeGreaterThan(0);
        expect(notes.length).toBeGreaterThanOrEqual(1);
        expect(landed).toBe(true);
      } else expect([hand, notes.length]).toEqual([0, 0]);
    }
  });

  it('Auto Snap is cut (cut list 3): touchOpts still names rungs R0-R1, and a ready snap never casts itself', () => {
    const s = endless();
    expect([0, 1, 2, 3, 4, -1].map((r) => touchOpts(s, r).autoSnap)).toEqual([true, true, false, false, false, false]);
    const d = createDriver();
    for (const [auto, chill, lit, want] of [[true, 15, 1, false], [true, 25, 1, false], [true, 15, 0, false], [false, 15, 1, false]] as const) {
      d.begin(s, { ...OPTS, autoSnap: auto });
      s.nubs.frost = 1;
      s.nubs.chill = chill;
      s.nubs.f = lit;
      expect(snapReady(s)).toBe(true);
      const f = frame();
      d.fill(s, f, ctl());
      expect(f.snap === true).toBe(want);
      expect(drain(d)).toEqual(want ? [[NOTE_AUTO, 1]] : []);
    }
  });

  it('Auto actions plays the reactive policy\'s verbs on T1 and T3 (only the sun is the player\'s)', () => {
    for (const id of [1001, 1003]) {
      const verbs = (auto: boolean): string[] => {
        const s = createRun(campaignConfig(id));
        const bot = createBot(auto ? 'reactive' : 'reactiveTouch');
        const d = createDriver();
        d.begin(s, { ...OPTS, autoAct: true });
        const out: string[] = [];
        while (s.phase !== 'dead' && s.phase !== 'won') {
          const f = { ...bot.next(s) };
          if (auto) {
            f.verb = 0;
            d.fill(s, f, ctl());
          }
          if ((f.verb ?? 0) > 0) out.push(`${s.tick}:${f.verb}:${f.vx}:${f.vy}`);
          step(s, f);
        }
        expect(s.phase).toBe('won');
        return out;
      };
      const a = verbs(true);
      expect(a.length).toBeGreaterThan(5);
      expect(a).toEqual(verbs(false));
    }
  });
});

describe('due prompts and the Ember notes (§3.2, §2.4)', () => {
  it('view.due > 0 only when the pick is the due wall: the unarmed eligible wall closest to its last working tick (T1, T5, T7, every tick)', () => {
    const NONE = new Int16Array([-1, -1]);
    let dues = 0;
    for (const id of [1001, 1005, 1007]) {
      const s = trialTo(id, 'ember');
      const bot = createBot('reactive');
      const d = createDriver();
      d.begin(s, OPTS);
      while (s.phase === 'day' && s.nubs.hero === 'ember') {
        d.observe(s);
        const p = emberPick(s, NONE);
        expect(d.view.pick).toBe(p);
        if (d.view.due > 0) {
          dues++;
          const o = objs(s)[p] as ElObj;
          expect(isWall(o)).toBe(true);
          const last = emberLast(s, p);
          expect(last).toBeLessThanOrEqual(TUNING.drive.dueTicks);
          expect(d.view.due).toBe(last <= TUNING.drive.urgentTicks ? 2 : 1);
          // No other wall the pick could be is due sooner.
          for (let i = 0; i < objs(s).length; i++) if (i !== p && isWall(objs(s)[i] as ElObj) && objs(s)[i]!.state === EL_IDLE && emberLast(s, i) >= 0 && emberPick(s, new Int16Array([p, -1])) === i) expect(emberLast(s, i)).toBeGreaterThanOrEqual(last);
        }
        step(s, bot.next(s));
      }
    }
    expect(dues).toBeGreaterThan(0);
  });

  it('an arm short of Flame notes WAIT_LOW once, then fires; an arm past its last working tick notes EXPIRE', () => {
    const s = trialTo(1001, 'ember', (x) => emberDue(x, 0, 0) <= 0);
    const d = createDriver();
    d.begin(s, OPTS);
    const flame = s.nubs.chill;
    s.nubs.chill = 1;
    tick(s, d, { act: 1 });
    s.nubs.chill = 1;
    tick(s, d);
    expect(drain(d)).toEqual([[NOTE_PRESS, 2], [NOTE_WAIT_LOW, 0]]);
    s.nubs.chill = flame;
    expect(tick(s, d).verb).toBe(VERB_TAP);
    const t = trialTo(1001, 'ember', (x) => emberDue(x, 0, 0) <= 0);
    d.begin(t, OPTS);
    t.nubs.chill = 1;
    tick(t, d, { act: 1 });
    while (emberLast(t, 0) >= 0) {
      t.nubs.chill = 1;
      tick(t, d);
    }
    t.nubs.chill = flame;
    tick(t, d);
    expect(drain(d)).toEqual([[NOTE_PRESS, 2], [NOTE_WAIT_LOW, 0], [NOTE_EXPIRE, 0]]);
  });
});

describe('the Gust vane\'s predictions (§3.5)', () => {
  it('driveWeatherX is the calm-now ghost for every notch (cut list 1): stepping the sim with the vane calm', () => {
    for (const n of [0, 1, -2]) {
      const s = trialTo(1004, 'gust', (x) => objs(x).some((o) => (o.kind === 'rain' || o.kind === 'fog') && o.awake && o.state !== EL_GONE));
      const i = objs(s).findIndex((o) => (o.kind === 'rain' || o.kind === 'fog') && o.awake && o.state !== EL_GONE);
      const o = objs(s)[i] as ElObj;
      const ticks = 90;
      const want = driveWeatherX(s, o, ticks, n);
      expect(want).toBe(weatherXAt(s, o, ticks));
      const d = createDriver();
      d.begin(s, OPTS);
      for (let k = 0; k < ticks; k++) {
        s.nubs.chill = 100;
        tick(s, d);
        expect(s.nubs.hero).toBe('gust');
      }
      expect(objs(s)[i]!.x).toBeCloseTo(want, 6);
    }
  });
});
