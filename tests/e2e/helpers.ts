// Shared helpers for the Playwright specs.
import { expect, type CDPSession, type Page } from '@playwright/test';

export interface ShadyState {
  phase: string;
  /** The start beat's ticks left (0: past it). */
  ready: number;
  day: number;
  minutes: number;
  chill: number;
  snow: number;
  theta: number;
  f: number;
  profile: number;
  /** Comfort rung of an endless ladder run, −1 otherwise. */
  rung: number;
  /** The warm-up run after the climb to standard (eased rules at rung 4). */
  warmup: boolean;
  drain: number;
  noonCloud: number;
  forecast: string;
  biome: string;
  lessonOn: boolean;
  /** Campaign (v1.2): the level id (−1 none), its concepts and the progress to the finish (0..1). */
  level: number;
  mods: string[];
  levelProgress: number;
  eclipse: number;
  locked: boolean;
  moonlit: boolean;
  /** Elementals v2 (docs/ELEMENTALS_V2.md §7.11): the walking element, the relay index, the Cold Snap charge. */
  hero: string;
  relay: number;
  charge: number;
  /** The walker's meter (s.nubs.chill), its verb, the sun held on a Trial, and ω (°/s). */
  meter: number;
  verb: 'sun' | 'burn' | 'grow' | 'steer' | 'blow';
  sunHeld: boolean;
  omega: number;
  /** Controls v3 (docs/CONTROLS_V3.md §11.8): the sun's mode and lag, and the driver's view as rendered. */
  sunMode: string;
  lag: number;
  drive: ShadyDrive;
  /** A Trial's element state (null in a Nubs run). */
  el: null | {
    dx: number;
    wind: number;
    hold: number;
    spent: number;
    /** The ticks of this run's gusts. */
    gusts: number[];
    objs: { k: string; x: number; y: number; state: number; size: number; grown: number; need: number; veiled: boolean }[];
    burns: number;
    drinks: number;
    trees: number;
    bumps: number;
  };
}

/** Controls v3: the driver's view (game/session.ts testState().drive). */
export interface ShadyDrive {
  act: 'none' | 'snap' | 'burn' | 'grow' | 'calm';
  state: number;
  /** The frost meter (snap) or the running job's size / goal (grow). */
  fill: number;
  pick: number;
  queue: number[];
  due: number;
  buffered: boolean;
  incoming: 'none' | 'snap' | 'burn' | 'grow' | 'calm';
  vane: number;
  vaneResting: boolean;
  glide: number | null;
  refuse: number;
  /** The last REFUSE note's a: the reason, + 16 on a repeat this leg (0 none). */
  refuseNote: number;
  /** The presses the driver answered (PRESS and REFUSE notes) since the page loaded. */
  answered: number;
  /** The button's press-in look on the frame drawn last. */
  down: boolean;
  aimDeg: number;
}

/** Collects console errors and page errors for the lifetime of the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function screen(page: Page): Promise<string> {
  return page.evaluate(() => window.__SHADY_TEST__?.screen() ?? 'none');
}

export async function state(page: Page): Promise<ShadyState> {
  return page.evaluate(() => window.__SHADY_TEST__!.state());
}

export async function waitForScreen(page: Page, id: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => screen(page), { timeout }).toBe(id);
}

/** Opens the game with the test hook and waits for the Title. */
export async function openGame(page: Page, query = 'test=1&seed=42'): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
}

/**
 * Hands the runs to the oracle bot from now on, before the run starts so it holds from the first
 * tick: under a loaded CPU a drag can take seconds and a fast run (profile 3, noon) melts inside
 * it, so a test that needs a run in progress keeps one however slowly the page runs. The runs stay
 * scored. Tests about the player's own input don't use it.
 */
export async function keepAlive(page: Page): Promise<void> {
  await page.evaluate(() => window.__SHADY_TEST__!.bot('oracle'));
}

/**
 * Waits until the Title's run has started (the sim left 'hold'), whichever screen it is on by then:
 * a fast run can melt inside a slow drag.
 */
export async function waitForRunStart(page: Page, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const hook = window.__SHADY_TEST__!;
          return hook.state().phase !== 'hold' && ['play', 'pause', 'dying', 'results'].includes(hook.screen());
        }),
      { timeout },
    )
    .toBe(true);
}

/** A horizontal mouse drag on the canvas starting at (x, y). */
export async function drag(page: Page, x: number, y: number, dx: number, steps = 8): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/**
 * A new player who turned on Settings → Unlock all levels (testing), which opens every v1.4 feature:
 * nothing played yet (the first endless run is still the tutorial rung with the lesson), but the
 * Title shows Endless and the tray, and a press on its canvas starts the endless run as it did
 * before the feature locks. Without it a fresh Title is Play only and the canvas plays Level 1.
 */
export const OPEN_SAVE = { v: 4, createdAt: 1, settings: { unlockAll: true } };

/** A save that has unlocked the Daily (3 lifetime runs). */
export const UNLOCKED_SAVE = JSON.stringify({ v: 1, createdAt: 1, stats: { runs: 3 } });

/** Seeds localStorage's save before the page's scripts run (every navigation of this page). */
export async function seedSave(page: Page, save: unknown): Promise<void> {
  await page.addInitScript((raw) => {
    if (!sessionStorage.getItem('shady.seeded')) {
      localStorage.setItem('shady.save', raw);
      sessionStorage.setItem('shady.seeded', '1');
    }
  }, typeof save === 'string' ? save : JSON.stringify(save));
}

/** The local date (YYYY-MM-DD) in the page, `days` from today. */
export async function pageDate(page: Page, days = 0): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const p = (x: number): string => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, days);
}

/** base64url of a challenge object, as meta/challenge.ts encodes it. */
export function challengeCode(c: object): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

/** Elementals v2: CSS px of a ground point (u) on the last drawn frame. */
export async function worldToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([wx, wy]) => window.__SHADY_TEST__!.testWorldToScreen(wx as number, wy as number), [x, y]);
}

/** Elementals v2: fast-forwards the Trial with the core reactive bot to leg `i` (or `before` ticks ahead of its TAG), then hands back to the input. */
export async function skipToLeg(page: Page, i: number, before = 0): Promise<void> {
  await page.evaluate(([n, b]) => window.__SHADY_TEST__!.testSkipToLeg(n as number, b as number), [i, before]);
}

/** Waits until the run is past its start beat (phase 'day', the ready count spent). */
export async function waitPlaying(page: Page, timeout = 10_000): Promise<void> {
  await expect.poll(async () => { const s = await state(page); return s.phase === 'day' && s.ready === 0; }, { timeout }).toBe(true);
}

/** Controls v3: button and act-key presses the input accepted. */
export async function acts(page: Page): Promise<number> {
  return page.evaluate(() => window.__SHADY_TEST__!.acts());
}

/** Controls v3: the guide's bins set now (now, next and the lasting now ∧ next). */
export async function guideBins(page: Page): Promise<{ now: number[]; next: number[]; lasting: number[] }> {
  return page.evaluate(() => window.__SHADY_TEST__!.testGuide());
}

// ---------------------------------------------------------------------------------------------
// Controls v3 (docs/CONTROLS_V3.md §12.2): real touch through CDP Input.dispatchTouchEvent, sent on a
// wall-clock schedule at 120 Hz without awaiting each call (awaiting throttles Chromium to about 20
// Hz). Each finger is a list of timed points: the first touches down, the last lifts (unless `hold`).
// ---------------------------------------------------------------------------------------------

/** A CDP session that dispatches touch (Chromium; both projects). */
export async function touchScreen(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}

/** One finger's path: timed points (ms from the start of play), touching down at the first. */
export interface Finger {
  id: number;
  pts: { t: number; x: number; y: number }[];
  /** Keep it down after its last point (a later play lifts it). */
  hold?: boolean;
}

const HZ_MS = 1000 / 120;

/** A straight stroke from (x, y) by (dx, dy) over `ms`, sampled at 120 Hz, starting at `t0` (ms). */
export function strokePts(x: number, y: number, dx: number, dy: number, ms: number, t0 = 0): Finger['pts'] {
  const n = Math.max(1, Math.round(ms / HZ_MS));
  return Array.from({ length: n + 1 }, (_, i) => ({ t: t0 + (ms * i) / n, x: x + (dx * i) / n, y: y + (dy * i) / n }));
}

/** A still press at (x, y) for `ms`, with a wobble of up to `wobble` px (deterministic), starting at `t0`. */
export function pressPts(x: number, y: number, ms: number, wobble = 0, t0 = 0): Finger['pts'] {
  const n = Math.max(1, Math.round(ms / HZ_MS));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = i === 0 || i === n ? 0 : wobble * Math.sin(i * 1.7);
    return { t: t0 + (ms * i) / n, x: x + a, y: y + a * 0.6 };
  });
}

/** The fingers each CDP session holds down between plays (a finger held through one play moves on in the next). */
const DOWN = new WeakMap<CDPSession, Map<number, { x: number; y: number; id: number }>>();

/** Plays the fingers' touches on the wall clock (all of them sent, then awaited together). */
export async function playTouch(cdp: CDPSession, fingers: Finger[]): Promise<void> {
  const evs = fingers.flatMap((f) => f.pts.map((p, k) => ({ f, k, t: p.t }))).sort((a, b) => a.t - b.t);
  let down = DOWN.get(cdp);
  if (!down) DOWN.set(cdp, (down = new Map()));
  const sent: Promise<unknown>[] = [];
  const t0 = Date.now();
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: { x: number; y: number; id: number }[]): void => {
    sent.push(cdp.send('Input.dispatchTouchEvent', { type, touchPoints }));
  };
  for (const { f, k, t } of evs) {
    const wait = t0 + t - Date.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    const p = f.pts[k]!;
    const tp = { x: p.x, y: p.y, id: f.id };
    if (k === 0 && !down.has(f.id)) {
      down.set(f.id, tp);
      send('touchStart', [...down.values()]);
    } else {
      down.set(f.id, tp);
      send('touchMove', [tp]);
    }
    if (k === f.pts.length - 1 && !f.hold) {
      down.delete(f.id);
      send('touchEnd', [tp]);
    }
  }
  await Promise.all(sent);
}

/** The world viewport's width (CSS px): a sun drag turns −dx / width · 360° (sensitivity 1). */
export async function viewWidth(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(document.getElementById('ui')!.style.getPropertyValue('--world-width')) || window.innerWidth);
}

/** The signed difference a − b of two angles (°), in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Controls v3: the action button (CSS px), whether it takes presses and its side. */
export async function button(page: Page): Promise<{ x: number; y: number; r: number; shown: boolean; side: 'right' | 'left' }> {
  return page.evaluate(() => window.__SHADY_TEST__!.button());
}

export async function runCfg(page: Page): Promise<RunCfg> {
  return page.evaluate(() => window.__SHADY_TEST__!.runCfg());
}

export interface RunCfg {
  mode: string;
  profile: number;
  tutorial: boolean;
  reducedMotion: boolean;
  seed: number;
  dailyDate: string | null;
  drain: number;
}

export interface ShadyPerf {
  frameMs: number;
  simMs: number;
  genMs: number;
  renderMs: number;
  fps: number;
  nubsLayerDraws: number;
  nubsComposes: number;
  groundPaints: number;
  dpr: number;
  govLevel: number;
  draws: number;
  fullScreenPasses: number;
  decals: number;
}

export interface PixelAB {
  mean: number;
  over3: number;
  over8: number;
  max: number;
}

export interface RenderOptions {
  mapOverlay: boolean;
  multiplyShadows: boolean;
  decor: boolean;
}

export interface MapProbe {
  sheetTop: number;
  cutRow: number;
  dpr: number;
  above: number;
  below: number;
  belowBox: number[] | null;
  png: string;
}

declare global {
  interface Window {
    __SHADY_TEST__?: {
      screen(): string;
      state(): ShadyState;
      forceDeath(): void;
      testWorldToScreen(x: number, y: number): { x: number; y: number };
      testSkipToLeg(i: number, before?: number): void;
      button(): { x: number; y: number; r: number; shown: boolean; side: 'right' | 'left' };
      acts(): number;
      testGuide(): { now: number[]; next: number[]; lasting: number[] };
      runHeadless(seed: number, ticks: number, bot: string): string;
      setTimeScale(n: number): void;
      audioState(): string;
      paused(): boolean;
      presses(): number;
      demo(name: string): void;
      nubsScreen(): { x: number; y: number };
      timeScale(): number;
      hint(): { mode: string; target: number; width: number; turn: number; lesson: boolean; shown: number };
      perf(): ShadyPerf;
      runCfg(): RunCfg;
      cameraFx(): { zoom: number; shakeX: number; shakeY: number };
      hudPb(): number;
      renderOptions(o: Partial<RenderOptions>): void;
      mapProbe(mapT: number): MapProbe | null;
      mapCallouts(): number[][];
      resultsTip(): string | null;
      campaign(): { id: number; name: string; passed: boolean; stars: number; nextId: number | null; goalLine: string } | null;
      postcard(): { ready: boolean; stageMs: number[]; bytes: number; name: string };
      pixelAB(a: Partial<RenderOptions>, b: Partial<RenderOptions>): PixelAB | null;
      bot(kind: string | null): void;
      hud(): { snow: number; left: boolean; ruler: boolean; rulerW: number; icon: boolean; stars: number };
      runStatus(): { title: string; goal: string; now: string; stars: { label: string; state: 'earned' | 'open' | 'lost' }[] } | null;
      toasts(): { kind: string; kicker: string; text: string }[];
      levelCard(): { blurb: number; lines: number; compact: boolean; chips: number; concept: boolean; k: number; h: number };
      setSnow(n: number): void;
      mech(): ShadyMech;
    };
  }
}

/** v1.5 mechanics as the renderer sees them (the test hook's mech()). */
export interface ShadyMech {
  meter: boolean;
  frost: number;
  meterX: number;
  meterY: number;
  deep: boolean;
  snapLeft: number;
  snapId: number;
  budBins: number;
  buds: number;
  snaps: number;
  /** v1.6 (game/debug.ts mech()). */
  pips: number;
  bankH: number;
  glassH: number;
  scorch: number;
  ring: boolean;
  ringFill: number;
  bleed: boolean;
  deepBins: number;
  glassBins: number;
  landBins: number;
  flareBins: number;
  flarePhase: number;
  flareLeft: number;
  flareOut: number[];
  noonHeat: number;
  badgeX: number;
  badgeY: number;
  /** The dial's centre and radius (CSS px on the canvas). */
  dialX: number;
  dialY: number;
  dialR: number;
}

export async function mech(page: Page): Promise<ShadyMech> {
  return page.evaluate(() => window.__SHADY_TEST__!.mech());
}
