// Shared helpers for the Playwright specs.
import { expect, type Page } from '@playwright/test';

export interface ShadyState {
  phase: string;
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
  gust: number;
  locked: boolean;
  moonlit: boolean;
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
