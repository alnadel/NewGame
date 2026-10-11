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

export async function waitForScreen(page: Page, id: string, timeout = 5000): Promise<void> {
  await expect.poll(() => screen(page), { timeout }).toBe(id);
}

/** Opens the game with the test hook and waits for the Title. */
export async function openGame(page: Page, query = 'test=1&seed=42'): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title', 10_000);
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

/** A save that has unlocked the Daily (3 lifetime runs). */
export const UNLOCKED_SAVE = JSON.stringify({ v: 1, createdAt: 1, stats: { runs: 3 } });

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
    };
  }
}
