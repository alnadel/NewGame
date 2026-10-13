import { describe, expect, it } from 'vitest';
import { STEP_S } from '../../src/audio/theory.ts';
import { GridSlots, Pulse, RateLimiter, StepClock } from '../../src/audio/timing.ts';

describe('RateLimiter', () => {
  it('enforces the minimum gap', () => {
    const r = new RateLimiter(50, 20);
    expect(r.tryAcquire(0)).toBe(true);
    expect(r.tryAcquire(30)).toBe(false);
    expect(r.tryAcquire(49.9)).toBe(false);
    expect(r.tryAcquire(50)).toBe(true);
  });

  it('enforces the per-window cap with a sliding window', () => {
    const r = new RateLimiter(0, 3);
    expect([0, 10, 20, 30].map((t) => r.tryAcquire(t))).toEqual([true, true, true, false]);
    expect(r.tryAcquire(999)).toBe(false);
    expect(r.tryAcquire(1000)).toBe(true); // the stamp at 0 left the window
    expect(r.tryAcquire(1005)).toBe(false);
    expect(r.tryAcquire(1010)).toBe(true);
  });

  it('keeps a detent storm at ≤ 20/s and ≥ 50 ms apart', () => {
    const r = new RateLimiter(50, 20);
    const accepted: number[] = [];
    for (let t = 0; t < 3000; t += 7) if (r.tryAcquire(t)) accepted.push(t);
    for (let i = 1; i < accepted.length; i++) expect((accepted[i] as number) - (accepted[i - 1] as number)).toBeGreaterThanOrEqual(50);
    for (const t of accepted) expect(accepted.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(20);
    expect(accepted.length).toBeGreaterThan(50);
  });

  it('caps melts at 3/s and bells at 12/s', () => {
    const melts = new RateLimiter(0, 3);
    const bells = new RateLimiter(0, 12);
    let m = 0;
    let b = 0;
    for (let t = 0; t < 1000; t += 10) {
      if (melts.tryAcquire(t)) m++;
      if (bells.tryAcquire(t)) b++;
    }
    expect(m).toBe(3);
    expect(b).toBe(12);
  });

  it('reset forgets history', () => {
    const r = new RateLimiter(100, 1);
    expect(r.tryAcquire(0)).toBe(true);
    expect(r.tryAcquire(10)).toBe(false);
    r.reset();
    expect(r.tryAcquire(10)).toBe(true);
  });
});

describe('StepClock', () => {
  it('reports each 16th exactly once, in order, from a 25 ms pump with 120 ms lookahead', () => {
    const c = new StepClock();
    c.start(0.05);
    const seen: number[] = [];
    for (let now = 0; now < 10; now += 0.025) {
      c.advance(now, now + 0.12, (step, t) => {
        expect(t).toBeCloseTo(0.05 + step * STEP_S, 9);
        expect(t).toBeGreaterThanOrEqual(now);
        seen.push(step);
      });
    }
    expect(seen).toEqual(Array.from({ length: seen.length }, (_, i) => i));
    expect(seen.length).toBe(Math.ceil((10.12 - 0.05) / STEP_S));
  });

  it('never burst-schedules a backlog after a stall, and keeps the bar phase', () => {
    const c = new StepClock();
    c.start(0);
    let n = 0;
    c.advance(0, 0.12, () => n++);
    expect(n).toBe(1);
    const late: [number, number][] = [];
    c.advance(5, 5.12, (step, t) => late.push([step, t]));
    expect(late.length).toBeLessThanOrEqual(1);
    expect(c.skipped).toBeGreaterThan(25);
    for (const [step, t] of late) {
      expect(t).toBeGreaterThanOrEqual(5);
      expect(t).toBeCloseTo(step * STEP_S, 9);
    }
  });

  it('changes tempo from the next step on (chapter palettes)', () => {
    const c = new StepClock();
    c.start(0);
    const times: number[] = [];
    c.advance(0, 0.5, (step, t) => {
      times.push(t);
      if (step === 1) c.stepS = 0.125;
    });
    expect(times[0]).toBe(0);
    expect(times[1]).toBeCloseTo(STEP_S, 9);
    expect(times[2]).toBeCloseTo(STEP_S + 0.125, 9);
    expect(c.gridAtOrAfter(times[2] as number + 0.01)).toBeCloseTo(STEP_S + 0.25, 9);
  });

  it('does nothing until started', () => {
    const c = new StepClock();
    let n = 0;
    c.advance(0, 1, () => n++);
    expect(n).toBe(0);
    expect(c.running).toBe(false);
  });

  it('finds the next grid point', () => {
    const c = new StepClock();
    expect(c.gridAtOrAfter(0.1)).toBeCloseTo(STEP_S, 9); // anchored at 0 before start
    c.start(0.05);
    expect(c.gridAtOrAfter(0.05)).toBeCloseTo(0.05, 9);
    expect(c.gridAtOrAfter(0.06)).toBeCloseTo(0.05 + STEP_S, 9);
    c.advance(0, 2, () => undefined);
    expect(c.gridAtOrAfter(1.0)).toBeCloseTo(0.05 + 6 * STEP_S, 9);
  });
});

describe('GridSlots (quantized bells)', () => {
  it('spreads simultaneous pickups onto successive 16ths, then doubles up', () => {
    const c = new StepClock();
    c.start(0);
    const s = new GridSlots(2);
    const slots = [0, 1, 2, 3].map(() => s.claim(c, 1.0, 0));
    const first = c.gridAtOrAfter(1.0);
    expect(slots[0]).toBeCloseTo(first, 9);
    expect(slots[1]).toBeCloseTo(first + STEP_S, 9);
    expect(slots[2]).toBeCloseTo(first + 2 * STEP_S, 9);
    expect(slots[3]).toBeCloseTo(first + 2 * STEP_S, 9);
  });

  it('never delays a bell by more than maxPush 16ths past its own grid point', () => {
    const c = new StepClock();
    c.start(0);
    const s = new GridSlots(2);
    for (let i = 0; i < 20; i++) {
      const now = 1 + i * 0.01;
      const t = s.claim(c, now, 0);
      expect(t).toBeGreaterThanOrEqual(now - 1e-9);
      expect(t - c.gridAtOrAfter(now)).toBeLessThanOrEqual(2 * STEP_S + 1e-6);
    }
  });
});

describe('Pulse (heartbeat clock)', () => {
  /** Beat times over `seconds` of 60 fps frames. */
  const run = (p: Pulse, seconds: number, period: number, dt = 1 / 60) => {
    const beats: number[] = [];
    for (let i = 1; i * dt <= seconds; i++) if (p.tick(dt, period)) beats.push(i * dt);
    return beats;
  };

  it('is silent while off and beats at once when it starts', () => {
    const p = new Pulse();
    expect(p.tick(1 / 60, 0)).toBe(false);
    expect(p.tick(1 / 60, 0.85)).toBe(true);
    expect(p.tick(1 / 60, 0.85)).toBe(false);
  });

  it('keeps the period to within a frame', () => {
    for (const period of [0.85, 0.6]) {
      const beats = run(new Pulse(), 10, period);
      expect(beats.length).toBeGreaterThanOrEqual(Math.floor(10 / period));
      for (let i = 1; i < beats.length; i++) {
        expect((beats[i] as number) - (beats[i - 1] as number)).toBeCloseTo(period, 1);
      }
    }
  });

  it('speeds up immediately when the period shortens', () => {
    const p = new Pulse();
    p.tick(1 / 60, 0.85);
    p.tick(0.1, 0.85);
    let t = 0;
    while (!p.tick(1 / 60, 0.6)) t += 1 / 60;
    expect(t).toBeLessThan(0.6);
  });

  it('fires at most once per tick, even after a long frame', () => {
    const p = new Pulse();
    p.tick(1 / 60, 0.85);
    expect(p.tick(5, 0.85)).toBe(true);
    expect(p.tick(1 / 60, 0.85)).toBe(false);
  });

  it('restarts with a beat after being stopped', () => {
    const p = new Pulse();
    p.tick(1 / 60, 0.85);
    p.tick(1 / 60, 0);
    expect(p.tick(1 / 60, 0.85)).toBe(true);
    p.reset();
    expect(p.tick(1 / 60, 0.85)).toBe(true);
  });
});
