// Controls v3 driver (docs/CONTROLS_V3.md §2-§4, §11.3; CORE): the contract's exports and the C0b
// skeleton: aim help's radius table, the vane's symmetric notches, the button's act per leg (a
// lesson run's after its first full meter) and Cold Snap presses (cast on the first tick they may,
// within the 18-tick buffer).
import { describe, expect, it } from 'vitest';
import type { HeroId } from '../../src/config/heroes.ts';
import { aimRadius } from '../../src/core/drive/aim.ts';
import { createDriver, vaneNotch, type DriveControl } from '../../src/core/drive/driver.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { snapReady } from '../../src/core/sim/mechanics.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type SimState } from '../../src/core/sim/types.ts';

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

/** Trial `id` walked by the reactive bot until `hero` walks past the start beat. */
function trialTo(id: number, hero: HeroId): SimState {
  const s = createRun(campaignConfig(id));
  const bot = createBot('reactive');
  while (s.nubs.hero !== hero || s.ready > 0 || s.phase !== 'day') step(s, bot.next(s));
  return s;
}

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

describe('the button (§0.1, §3.1, §2.3 C0b)', () => {
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

  it('a Cold Snap press casts on the first tick it may within 18 ticks; later it is dropped (C0b: refusals come with C0c)', () => {
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
    // A press that never becomes legal is dropped after the buffer.
    const t = endless();
    t.nubs.frost = 0;
    d.begin(t, OPTS);
    d.fill(t, frame(), ctl({ act: 1 }));
    // It waits 18 ticks after its own (still buffered on the 18th), then drops.
    for (let i = 0; i < 18; i++) d.fill(t, frame(), ctl());
    expect(d.view.buffered).toBe(true);
    d.fill(t, frame(), ctl());
    expect(d.view.buffered).toBe(false);
    t.nubs.frost = 1;
    f = frame();
    d.fill(t, f, ctl());
    expect(f.snap).toBe(false);
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
