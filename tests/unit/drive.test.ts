// Controls v3 driver (docs/CONTROLS_V3.md §2-§4, §11.3; CORE): the contract's exports and the C0c
// skeleton: aim help's radius table, the vane's symmetric notches, the button's act per leg (a
// lesson run's after its first full meter), presses (buffered, refused with their reasons, the
// pre-TAG press), Cold Snap presses, Ember's arms and ignition, Sprout's jobs and the Gust governor.
import { describe, expect, it } from 'vitest';
import type { HeroId } from '../../src/config/heroes.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { aimRadius } from '../../src/core/drive/aim.ts';
import {
  createDriver,
  NOTE_PRESS,
  NOTE_REFUSE,
  REFUSE_BUSY,
  REFUSE_CHARGING,
  REFUSE_FULL,
  REFUSE_LOCKED,
  REFUSE_LOW,
  REFUSE_NOTHING,
  REFUSE_WAIT,
  vaneNotch,
  type DriveControl,
  type Driver,
} from '../../src/core/drive/driver.ts';
import { downwind, emberDue, emberLast, emberPick, gustFloor, jobGoal, nearLast, sproutPick, targetX } from '../../src/core/drive/pick.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { EL_BURNING, EL_GONE, EL_IDLE, type ElObj, type ElState } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { burnTarget, growLeft, growTarget, nextTagTicks, tagLocked } from '../../src/core/sim/elements.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
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
    expect([f.snap, d.view.buffered, d.noteN, d.notes[0], d.notes[1]]).toEqual([true, false, 1, 1, 1]);
    d.clearNotes();
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
    expect([d.view.buffered, d.noteN]).toEqual([true, 0]);
    d.fill(t, frame(), ctl());
    expect([d.view.buffered, d.view.refuse, d.view.refuseTick]).toEqual([false, REFUSE_CHARGING, 19]);
    expect(drain(d)).toEqual([[NOTE_REFUSE, REFUSE_CHARGING]]);
    t.nubs.frost = 1;
    f = frame();
    d.fill(t, f, ctl());
    expect(f.snap).toBe(false);
    // The same reason again this leg is a repeat.
    t.nubs.frost = 0;
    d.fill(t, frame(), ctl({ act: 1 }));
    for (let i = 0; i < 18; i++) d.fill(t, frame(), ctl());
    expect(drain(d)).toEqual([[NOTE_REFUSE, REFUSE_CHARGING + 16]]);
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
    expect(refuse(beat)).toEqual([[NOTE_REFUSE, REFUSE_WAIT]]);
    // A snap is on.
    const on = endless();
    on.nubs.frost = 1;
    step(on, { ...NO_INPUT, snap: true });
    on.nubs.frost = 1;
    expect(on.snapTicks).toBeGreaterThan(0);
    expect(refuse(on)).toEqual([[NOTE_REFUSE, REFUSE_BUSY]]);
    // A TAG is due: locked, with the ticks to it on the view.
    const tag = trialTo(1001, 'nubs', (s) => tagLocked(s));
    tag.nubs.frost = 1;
    d.begin(tag, OPTS);
    expect([d.view.state, d.view.lockTicks]).toEqual([2, nextTagTicks(tag)]);
    expect(refuse(tag)).toEqual([[NOTE_REFUSE, REFUSE_LOCKED]]);
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
    expect(drain(d)).toEqual([]);
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
    expect(drain(d)).toEqual([]);
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
    expect(drain(d)).toEqual([[NOTE_REFUSE, REFUSE_FULL]]);
    const t = trialTo(1001, 'ember');
    for (const o of objs(t)) o.state = EL_GONE;
    d.begin(t, OPTS);
    tick(t, d, { act: 1 });
    for (let k = 0; k < 18; k++) tick(t, d);
    expect(drain(d)).toEqual([[NOTE_REFUSE, REFUSE_NOTHING]]);
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
    tick(t, d, { act: 1 });
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
    expect(drain(d)).toEqual([[NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_REFUSE, REFUSE_FULL]]);
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
    expect(drain(d)).toEqual([[NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_PRESS, 3], [NOTE_REFUSE, REFUSE_NOTHING]]);
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
    expect(drain(d)).toEqual([[NOTE_REFUSE, REFUSE_LOW]]);
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
    // A Calm press stills it; on a calm vane a press does nothing.
    expect(drain(d)).toEqual([]);
    tick(s, d, { act: 1 });
    expect([d.view.vane, d.view.state]).toEqual([0, 0]);
    tick(s, d, { act: 1 });
    expect(drain(d)).toEqual([[NOTE_PRESS, 4]]);
    // No weather in play: the vane keeps its notch, dimmed, and blows nothing.
    for (const o of el.objs) if (o.kind === 'rain' || o.kind === 'fog') o.state = EL_GONE;
    tick(s, d, { vane: 2, vaneUp: true });
    for (let k = 0; k < 30; k++) expect(tick(s, d).verb ?? 0).toBe(0);
    expect([d.view.vane, d.view.vaneResting, d.view.vaneCost, d.view.state]).toEqual([2, true, 0, 1]);
  });
});
