// Aim help and the player's hands (docs/CONTROLS_V3.md §4.1, §4.4, §4.5; the v3 review's input
// findings): turn keys get the re-grip grace and the against-the-stroke rule a finger gets, a resting
// finger's sensor jitter is no hand, and a thumb held still through a hand-off into Drip keeps the
// sun's pre-aim (the real input layer feeding the driver, as the session does).
import { describe, expect, it } from 'vitest';
import { angleDiff } from '../../src/core/dmath.ts';
import { binOf } from '../../src/core/intervals.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { createBot, createDriver, createRun, nextTagHero, nextTagTicks, NO_INPUT, step, type DriveControl, type Driver, type DriveOpts, type InputFrame, type SimState } from '../../src/core/index.ts';
import { HEROES } from '../../src/config/heroes.ts';
import { createInput, type InputHost } from '../../src/game/input.ts';

const OPTS: DriveOpts = { aimDeg: 14, track: true, nowOnly: false, autoSnap: false, autoAct: false, reducedMotion: false };
const ctl = (o: Partial<DriveControl> = {}): DriveControl => ({ act: 0, vane: 0, vaneUp: false, rest: false, ...o });
type Arc = readonly [number, number];

/** An Endless run past its start beat with the sun up. */
function endless(): SimState {
  const s = createRun({ ...headlessConfig(7, 3), lesson: false });
  step(s, { ...NO_INPUT, downEdge: true, upEdge: true });
  while (s.ready > 0 || !s.sunUp) step(s, NO_INPUT);
  return s;
}

let paintTick = 1e6;
/** One tick with `arcs` painted as lasting shade (a guide refresh) and Nubs kept cool. */
function at(s: SimState, d: Driver, arcs: readonly Arc[], p: Partial<InputFrame> = {}, c: Partial<DriveControl> = {}): void {
  const g = s.guide;
  for (const m of [g.now, g.next, g.land, g.tag, g.bud, g.flake, g.flare, g.glare]) m.fill(0);
  g.flareTicks = -1;
  for (const m of [g.now, g.next]) for (const [lo, hi] of arcs) for (let b = lo; b <= hi; b++) m[((b % 360) + 360) % 360] = 1;
  g.tick = paintTick++;
  s.nubs.chill = s.nubs.maxChill;
  const f = { ...NO_INPUT, snap: false, ...p };
  d.fill(s, f, ctl(c));
  step(s, f);
}

describe('turn keys and aim help (§4.5)', () => {
  /** The sun 3° inside an arc's edge, the next arc 24° away; key taps of 3 ticks every 15 for 4 s: the net turn. */
  function taps(aimDeg: number, key: -1 | -2): number {
    const s = endless();
    const d = createDriver();
    d.begin(s, { ...OPTS, aimDeg });
    const b = binOf(s.sun.theta);
    const arcs: Arc[] = [[b - 3, b + 10], [b - 40, b - 27]];
    const t0 = s.sun.theta;
    at(s, d, arcs, { downEdge: true, down: true, dTheta: 0.5 });
    at(s, d, arcs, { upEdge: true });
    for (let k = 0; k < 40; k++) at(s, d, arcs);
    for (let k = 0; k < 240; k++) at(s, d, arcs, { key: k % 15 < 3 ? key : 0 });
    return angleDiff(s.sun.theta, t0);
  }

  it('key taps walk the sun out of shade as far with aim help as without it (the release is a lift; the glide back waits)', () => {
    for (const key of [-1, -2] as const) {
      const off = taps(0, key);
      expect(off).toBeLessThan(-40);
      expect(Math.abs(taps(14, key) - off)).toBeLessThan(1);
    }
  });
});

describe('a resting finger (§1.2, §4.3)', () => {
  it('its sensor jitter is no hand: the sun still glides into the arc under it', () => {
    for (const jitterPx of [0, 0.05, 0.2, 1.5]) {
      const s = endless();
      const d = createDriver();
      d.begin(s, OPTS);
      const b = binOf(s.sun.theta);
      const arcs: Arc[] = [[b + 12, b + 32]];
      at(s, d, arcs, { downEdge: true, down: true, dTheta: 1 });
      for (let k = 0; k < 4; k++) at(s, d, arcs, { down: true, dTheta: 1 });
      let glides = 0;
      const per = Math.round(((jitterPx / 390) * 360) * 1024) / 1024;
      for (let k = 0; k < 96; k++) {
        at(s, d, arcs, { down: true, dTheta: k >= 18 ? (k % 2 ? per : -per) : 0 }, { rest: k >= 18 });
        if (d.view.glide === d.view.glide) glides++;
      }
      expect(glides, `jitter ${jitterPx} px`).toBeGreaterThan(0);
      expect(s.guide.now[binOf(s.sun.theta)], `jitter ${jitterPx} px lands in the arc`).toBe(1);
    }
  });
});

describe('a thumb held through a hand-off into Drip (§1.5, §4.4)', () => {
  // A DOM stand-in for the input's listeners.
  const g = globalThis as unknown as { window?: EventTarget & { innerWidth: number; innerHeight: number } };
  if (!g.window) g.window = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
  const win = g.window;
  const fire = (t: EventTarget, type: string, props: Record<string, unknown>): void => {
    const e = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
    t.dispatchEvent(e);
  };

  /** T2 to 150 ticks before its TAG into Drip; a stroke to 20° short of a dashed arc, then the thumb stays down (`jitter` px) through the TAG. */
  function holdThrough(jitter: number): { handover: number; locked: number; onArc: boolean } {
    const s = createRun(campaignConfig(1002));
    const bot = createBot('reactive');
    while (s.nubs.hero !== 'nubs' || s.ready > 0 || s.phase !== 'day' || !(nextTagHero(s) === 'drip' && nextTagTicks(s) >= 0 && nextTagTicks(s) <= 150)) step(s, { ...bot.next(s) });
    let ms = 0;
    const canvas = new EventTarget() as unknown as HTMLCanvasElement;
    const host: InputHost = {
      canvas,
      accepting: () => true,
      onPress: () => {},
      viewportWidth: () => 390,
      safeBottom: () => 0,
      drag: () => HEROES[s.nubs.hero].drag,
      act: () => 'none',
      buttonHit: () => false,
      starting: () => false,
      uPerPx: () => 0.5,
    };
    const inp = createInput(host);
    inp.now = () => ms;
    const d = createDriver();
    d.begin(s, OPTS);
    const pe = (x: number, y: number) => ({ pointerId: 1, clientX: x, clientY: y, timeStamp: ms, pointerType: 'touch', button: 0 });
    const tag = Uint8Array.from(s.guide.tag);
    let aim = -1;
    for (let b = 0; b < 360 && aim < 0; b++) if (tag[b] === 1 && tag[(b + 340) % 360] === 0 && tag[(b + 350) % 360] === 0) aim = (b + 340) % 360;
    expect(aim).toBeGreaterThanOrEqual(0);
    const px = (-angleDiff(aim, s.sun.theta) / 360) * 390;
    let x = 200;
    fire(canvas, 'pointerdown', pe(x, 400));
    let seed = 7;
    const j = (): number => {
      seed = (seed * 16807) % 2147483647;
      return ((seed / 2147483647) * 2 - 1) * jitter;
    };
    let handover = 0;
    let locked = NaN;
    let tagged = false;
    for (let k = 0; s.phase === 'day' && locked !== locked && k < 600; k++) {
      ms += 1000 / 60;
      if (k < 12) fire(win, 'pointermove', pe((x += px / 12), 400));
      else fire(win, 'pointermove', pe(x + j(), 400 + j()));
      const f = inp.takeFrames(1)[0] as InputFrame;
      s.nubs.chill = s.nubs.maxChill;
      d.fill(s, f, inp.controls()[0] as DriveControl);
      step(s, f);
      if (d.view.handover) handover++;
      for (const ev of s.events) {
        if (ev.e !== 'tag' || tagged) continue;
        tagged = true;
        inp.handoff();
        d.interrupt();
      }
      if (s.sun.locked) locked = s.sun.theta;
    }
    inp.dispose();
    return { handover, locked, onArc: tag[binOf(locked)] === 1 };
  }

  it('a still thumb with ±0.5 px of jitter gets the hand-over: the sun locks on the dashed arc', () => {
    const r = holdThrough(0.5);
    expect(r.handover).toBeGreaterThan(0);
    expect(r.onArc).toBe(true);
  });
});
