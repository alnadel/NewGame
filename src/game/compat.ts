// Cross-batch contracts of the wave-3 polish, as the game layer sees them. The core, meta and UI
// batches add these APIs in parallel with this one (RunConfig.drain and endlessDrain, the SaveStore
// external-change/degraded hooks and canPersist, Ui.isModalOpen, shareBase, the dailyProgress strip
// and a nullable share base). The session reaches them only through these accessors, which call the
// real API when it is there and fall back to the previous behaviour when it is not, so this layer
// builds and runs on either side of the merge. Once every batch is in, each accessor can collapse to
// a direct call.

import * as days from '../config/days.ts';
import type { HourGlyph, RunConfig, RunResult } from '../core/index.ts';
import * as progression from '../meta/progression.ts';
import type { SaveStore } from '../meta/save.ts';
import type { SaveV1 } from '../meta/saveTypes.ts';
import * as share from '../meta/share.ts';
import type { Ui } from '../ui/types.ts';

type Unsubscribe = () => void;

/** config/days.ts endlessDrain(lifetimeRuns): the onboarding drain ramp of endless runs (K2). */
export function endlessDrainFor(lifetimeRuns: number): number | undefined {
  const fn = (days as unknown as { endlessDrain?: (runs: number) => number }).endlessDrain;
  return typeof fn === 'function' ? fn(lifetimeRuns) : undefined;
}

/** RunConfig.drain (Chill/s at f = 1; unset = the profile drain). */
export function cfgDrain(cfg: RunConfig): number | undefined {
  return (cfg as RunConfig & { drain?: number }).drain;
}

export function setCfgDrain(cfg: RunConfig, drain: number | undefined): void {
  if (drain !== undefined) (cfg as RunConfig & { drain?: number }).drain = drain;
}

/** Ui.isModalOpen(): a confirm dialog, the install sheet or the restore sheet is open. */
export function uiIsModalOpen(ui: Ui): boolean {
  const fn = (ui as Ui & { isModalOpen?: () => boolean }).isModalOpen;
  return typeof fn === 'function' ? fn.call(ui) : false;
}

interface StoreExtras {
  canPersist?: boolean;
  onExternalChange?: (cb: (save: SaveV1) => void) => Unsubscribe;
  onDegraded?: (cb: () => void) => Unsubscribe;
}

/** SaveStore.canPersist: false while a newer-version save sits on disk. */
export function storeCanPersist(store: SaveStore): boolean {
  const v = (store as unknown as StoreExtras).canPersist;
  return v === undefined ? true : v;
}

/** SaveStore.onExternalChange: another tab or instance wrote the save and this store adopted it. */
export function storeOnExternalChange(store: SaveStore, cb: (save: SaveV1) => void): Unsubscribe {
  const fn = (store as unknown as StoreExtras).onExternalChange;
  return typeof fn === 'function' ? fn.call(store, cb) : () => {};
}

/** SaveStore.onDegraded: the first failed write after boot. */
export function storeOnDegraded(store: SaveStore, cb: () => void): Unsubscribe {
  const fn = (store as unknown as StoreExtras).onDegraded;
  return typeof fn === 'function' ? fn.call(store, cb) : () => {};
}

/** meta/share.ts shareBase(): the link base for share texts, or null when there is no web address. */
export function shareBaseUrl(): string | null {
  const fn = (share as unknown as { shareBase?: () => string | null }).shareBase;
  if (typeof fn === 'function') return fn();
  return location.origin + location.pathname;
}

/** buildShare with a nullable base (no link line when null). */
export function buildShareText(result: RunResult, base: string | null, tryNumber: number | null): string {
  const build = share.buildShare as (r: RunResult, b: string | null, t?: number | null) => share.SharePayload;
  return build(result, base, tryNumber).text;
}

export interface DailyStrip {
  hourGlyphs: readonly (readonly HourGlyph[])[];
  assisted: boolean;
}

/** dailyProgress with the hour-glyph strip, so a checkpointed best keeps the glyphs of that run. */
export function dailyProgressStrip(save: SaveV1, date: string, minutes: number, snow: number, strip: DailyStrip): SaveV1 {
  const fn = progression.dailyProgress as (s: SaveV1, d: string, m: number, sn: number, st?: DailyStrip) => SaveV1;
  return fn(save, date, minutes, snow, strip);
}
