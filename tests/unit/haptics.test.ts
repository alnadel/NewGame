import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../../src/core/sim/events.ts';
import {
  HAPTIC_PATTERNS,
  NullHaptics,
  WebVibrateHaptics,
  createHaptics,
  hapticForEvent,
  isDetentHapticStep,
  webVibrateBackend,
} from '../../src/platform/haptics.ts';

/** WebVibrateHaptics on a fake backend, clock and timer. */
function setup(opts: { enabled?: boolean; ready?: boolean } = {}) {
  const calls: { at: number; pattern: number | number[] }[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  let ready = opts.ready ?? true;
  const h = new WebVibrateHaptics({
    enabled: opts.enabled ?? true,
    backend: { vibrate: (pattern) => calls.push({ at: now, pattern }), ready: () => ready },
    now: () => now,
    schedule: (fn, ms) => timers.push({ at: now + ms, fn }),
  });
  return {
    h,
    calls,
    patterns: () => calls.map((c) => c.pattern),
    at(t: number) {
      now = t;
      // Fire due timers in order, as the event loop would.
      for (let i = 0; i < timers.length; i++) {
        const timer = timers[i] as { at: number; fn: () => void };
        if (timer.at <= now) {
          timers.splice(i--, 1);
          timer.fn();
        }
      }
    },
    setReady(r: boolean) {
      ready = r;
    },
  };
}

describe('patterns', () => {
  it('match GDD §13', () => {
    expect(HAPTIC_PATTERNS).toEqual({
      detent: 5,
      catch: 8,
      flake: 6,
      crystal: [10, 30, 10],
      shade: 8,
      multUp: [8, 40, 8],
      multMax: [10, 30, 10, 30, 20],
      phew: [10, 40, 10],
      glare: 15,
      heartbeat: [12, 110, 8],
      death: [30, 60, 80],
      day: [20, 80, 20],
      best: [15, 40, 15, 40, 40],
      ui: 4,
      tick: 6,
    });
  });
});

describe('hapticForEvent', () => {
  const info = { day: 1, tDay: 1, minutes: 14, time: '6:14 AM', x: 0, y: 0, cause: 'plain' as const, line: '' };
  it('maps SimEvents to haptic names', () => {
    const cases: [SimEvent, string | null][] = [
      [{ e: 'detent', dir: 1, index: 3 }, 'detent'],
      [{ e: 'catch', omega: 200 }, 'catch'],
      [{ e: 'flake', mult: 1, degree: 0, x: 0, y: 0, snow: 1 }, 'flake'],
      [{ e: 'crystal', mult: 1, x: 0, y: 0, snow: 5 }, 'crystal'],
      [{ e: 'shadeEnter', litFor: 0.4 }, 'shade'],
      [{ e: 'shadeEnter', litFor: 0.1 }, null],
      [{ e: 'multUp', level: 2 }, 'multUp'],
      [{ e: 'multUp', level: 5 }, 'multMax'],
      [{ e: 'phew' }, 'phew'],
      [{ e: 'glareTouch', ballId: 1 }, 'glare'],
      [{ e: 'death', info }, 'death'],
      [{ e: 'dawn', day: 2 }, 'day'],
      [{ e: 'lowChill' }, null],
      [{ e: 'start' }, null],
      [{ e: 'flakeMelt', x: 0, y: 0 }, null],
      [{ e: 'flower', x: 0, y: 0, snow: 2 }, null],
      [{ e: 'nightStart', day: 1 }, null],
      [{ e: 'hourEnd', day: 1, hour: 2, glyph: 'warm' }, null],
    ];
    for (const [ev, name] of cases) expect(hapticForEvent(ev)).toBe(name);
  });
});

describe('isDetentHapticStep (every 45°)', () => {
  it('recognises the boundary crossed in either direction, across the wrap', () => {
    expect(isDetentHapticStep(3, 1)).toBe(true); // 44° → 46°: crossed 45°
    expect(isDetentHapticStep(4, 1)).toBe(false); // crossed 60°
    expect(isDetentHapticStep(2, -1)).toBe(true); // 46° → 44°: crossed 45°
    expect(isDetentHapticStep(3, -1)).toBe(false); // crossed 60°
    expect(isDetentHapticStep(0, 1)).toBe(true); // 359° → 1°
    expect(isDetentHapticStep(23, -1)).toBe(true); // 1° → 359°
    const up = Array.from({ length: 24 }, (_, i) => isDetentHapticStep(i, 1)).filter(Boolean);
    expect(up).toHaveLength(8);
  });
});

describe('WebVibrateHaptics gating', () => {
  it('plays named patterns, copying arrays', () => {
    const t = setup();
    t.h.play('crystal');
    expect(t.patterns()).toEqual([[10, 30, 10]]);
    expect(t.calls[0]?.pattern).not.toBe(HAPTIC_PATTERNS.crystal);
  });

  it('does nothing when disabled, unsupported or before user activation', () => {
    const off = setup({ enabled: false });
    off.h.play('death');
    expect(off.calls).toHaveLength(0);
    off.h.setEnabled(true);
    off.h.play('death');
    expect(off.calls).toHaveLength(1);

    const locked = setup({ ready: false });
    locked.h.play('flake');
    expect(locked.calls).toHaveLength(0);
    locked.setReady(true);
    locked.h.play('flake');
    expect(locked.calls).toHaveLength(1);

    const none = new WebVibrateHaptics({ backend: null });
    expect(none.supported).toBe(false);
    none.play('death');
  });

  it('drops light patterns inside the 40 ms global gap', () => {
    const t = setup();
    t.h.play('flake');
    t.at(20);
    t.h.play('catch');
    t.at(39);
    t.h.play('ui');
    t.at(40);
    t.h.play('glare');
    expect(t.patterns()).toEqual([6, 15]);
  });

  it('exempts the heartbeat from the gap', () => {
    const t = setup();
    t.h.play('flake');
    t.at(5);
    t.h.play('heartbeat');
    expect(t.patterns()).toEqual([6, [12, 110, 8]]);
  });

  it('defers important patterns to the end of the gap; the highest rank wins', () => {
    const t = setup();
    t.h.play('flake');
    t.at(10);
    t.h.play('multUp');
    t.at(15);
    t.h.play('death');
    t.at(20);
    t.h.play('crystal'); // lower than the pending death: ignored
    expect(t.calls).toHaveLength(1);
    t.at(40);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]).toEqual({ at: 40, pattern: [30, 60, 80] });
  });

  it('drops a deferred pattern if haptics are switched off meanwhile', () => {
    const t = setup();
    t.h.play('flake');
    t.at(10);
    t.h.play('day');
    t.h.setEnabled(false);
    t.at(50);
    expect(t.calls).toHaveLength(1);
  });

  it('detents: only on 45° boundaries, never above 300°/s', () => {
    const t = setup();
    t.h.detent(4, 1, 100);
    expect(t.calls).toHaveLength(0);
    t.h.detent(3, 1, 301);
    expect(t.calls).toHaveLength(0);
    t.h.detent(3, 1, -300);
    expect(t.patterns()).toEqual([5]);
  });

  it('detents: at least 50 ms apart and at most 8 per second', () => {
    const t = setup();
    let fired = 0;
    for (let ms = 0; ms < 2000; ms += 10) {
      t.at(ms);
      const before = t.calls.length;
      t.h.detent(3, 1, 0);
      fired += t.calls.length - before;
    }
    const times = t.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(50);
    for (const at of times) expect(times.filter((u) => u > at - 1000 && u <= at).length).toBeLessThanOrEqual(8);
    expect(fired).toBe(16);
  });

  it('a SWING ticks at most once per 300 ms (CC-4)', () => {
    const t = setup();
    const swing = { e: 'swing' as const, deg: 60, chain: 1, snow: 1, x: 0, y: 0 };
    expect(hapticForEvent(swing)).toBe('tick');
    for (const at of [0, 100, 250, 320, 500, 700]) {
      t.at(at);
      t.h.onEvents([swing], 0);
    }
    expect(t.calls.map((c) => c.at)).toEqual([0, 320, 700]);
  });

  it('onEvents forwards a frame of SimEvents with the sun speed', () => {
    const t = setup();
    t.h.onEvents([{ e: 'detent', dir: 1, index: 6 }], 120);
    t.at(100);
    t.h.onEvents([{ e: 'detent', dir: 1, index: 9 }, { e: 'flakeMelt', x: 0, y: 0 }], 500);
    t.at(200);
    t.h.onEvents([{ e: 'multUp', level: 5 }], 0);
    expect(t.patterns()).toEqual([5, [10, 30, 10, 30, 20]]);
  });
});

describe('platform selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses NullHaptics where navigator.vibrate is missing (iOS Safari)', () => {
    vi.stubGlobal('navigator', {});
    expect(webVibrateBackend()).toBeNull();
    const h = createHaptics(true);
    expect(h).toBeInstanceOf(NullHaptics);
    expect(h.supported).toBe(false);
    expect(h.enabled).toBe(true);
    h.play('death');
    h.detent(3, 1, 0);
    h.onEvents([{ e: 'phew' }], 0);
  });

  it('wraps navigator.vibrate, swallowing errors and waiting for user activation', () => {
    const vibrate = vi.fn(() => {
      throw new Error('blocked');
    });
    const nav = { vibrate, userActivation: { hasBeenActive: false } };
    vi.stubGlobal('navigator', nav);
    const backend = webVibrateBackend();
    expect(backend).not.toBeNull();
    expect(backend?.ready()).toBe(false);
    nav.userActivation.hasBeenActive = true;
    expect(backend?.ready()).toBe(true);
    expect(() => backend?.vibrate([10, 20])).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith([10, 20]);
    expect(createHaptics(false)).toBeInstanceOf(WebVibrateHaptics);
  });
});
