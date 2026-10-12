// Local fallbacks for v1.1 contracts that the uiMeta batch provides (docs/V1_1_BUILD.md CC-n /
// A-n): the UI's new methods and view fields, Save v2 fields and the new meta helpers. Each one has
// the contract's exact signature and documents the real name it stands for; integration replaces
// every `V11-SHIM` with the real call or field (grep -rn V11-SHIM src tests must come back empty)
// and deletes this file. On the v1.0 UI the new methods are absent and the calls are skipped.

import type { Challenge } from '../meta/challenge.ts';
import type { ApplyRunOptions } from '../meta/progression.ts';
import type { SaveV1, Settings } from '../meta/saveTypes.ts';
import { copyText, type ShareOutcome } from '../platform/share.ts';
import type { DayPlan, NoonCloud } from '../render/shims.ts';
import type { ChallengeBanner, ResultsView, Ui, UiCallbacks } from '../ui/types.ts';
import type { Equipped } from '../meta/content.ts';
import type { ProfileId } from '../core/index.ts';

// V11-SHIM: CC-11 — `type CueId` from src/ui/types.ts.
export type CueId = 'keep-shade' | 'drag' | 'shade-found' | 'melting';

// V11-SHIM: CC-11 — `Ui.setRunPreview`, `Ui.showCue`, `Ui.setPostcard` (call them on `ui` directly).
export interface UiV11 {
  setRunPreview?(p: DayPlan | null): void;
  showCue?(id: CueId | null, dir?: -1 | 1): void;
  setPostcard?(thumbUrl: string | null): void;
}
export function uiV11(ui: Ui): UiV11 {
  return ui as Ui & UiV11;
}

// V11-SHIM: CC-11 — UiCallbacks gains `swapMission(slotId)`, the Wardrobe preview's `subject`, and
// (A11) the Postcard pill's `sharePostcard()` (this batch's proposal: shareFiles({ file, text })).
export type UiCallbacksV11 = Omit<UiCallbacks, 'renderWardrobePreview'> & {
  renderWardrobePreview(canvas: HTMLCanvasElement, equipped: Equipped, subject?: 'nubs' | 'sun'): void;
  swapMission(slotId: string): void;
  sharePostcard(): Promise<ShareOutcomeV11>;
};

// V11-SHIM: CC-11 — ChallengeBanner adds `name?` and `warmup?`.
export type ChallengeBannerV11 = ChallengeBanner & { name?: string; warmup?: boolean };

// V11-SHIM: CC-11 — ResultsView adds `tip?`, `warmupFor?` and `challengeName?`.
export type ResultsViewV11 = ResultsView & { tip?: string; warmupFor?: { minutes: number; name: string }; challengeName?: string };

// V11-SHIM: CC-9 — `Settings.comfort` (default true) and `Settings.name` ('' = none).
export function comfortOn(st: Settings): boolean {
  return (st as Settings & { comfort?: boolean }).comfort ?? true;
}
export function playerName(st: Settings): string {
  return (st as Settings & { name?: string }).name ?? '';
}

// V11-SHIM: CC-9/A2 — `SaveStats.comfort` (0..4; a v1 save migrates from its lifetime runs).
export function comfortStat(save: SaveV1): number {
  const c = (save.stats as SaveV1['stats'] & { comfort?: number }).comfort;
  if (c !== undefined) return c;
  const r = save.stats.runs;
  return r <= 0 ? 0 : ([1, 1, 2, 3, 4][Math.min(r, 5) - 1] as number);
}

// V11-SHIM: CC-9 — `Save.history: RunRecord[]` (last 30 finished non-debug endless runs).
interface RunRecord {
  m: number;
  s: number;
  r: number;
  d: string;
}
function historyOf(save: SaveV1): RunRecord[] {
  return (save as SaveV1 & { history?: RunRecord[] }).history ?? [];
}

// V11-SHIM: CC-10 — ApplyRunOptions adds `challengeTarget?`, `playSeconds?` and `rung?`.
export type ApplyRunOptionsV11 = ApplyRunOptions & { challengeTarget?: number; playSeconds?: number; rung?: number };

// V11-SHIM: CC-10/A16 — `recentBest(save)`: max m over the last 10 history entries (rung 0 runs
// ignored); stats.bestMinutes while history has fewer than 3 entries.
export function recentBest(save: SaveV1): number {
  const h = historyOf(save);
  if (h.length < 3) return save.stats.bestMinutes;
  let best = 0;
  for (let i = Math.max(0, h.length - 10); i < h.length; i++) {
    const e = h[i] as RunRecord;
    if (e.r !== 0 && e.m > best) best = e.m;
  }
  return best;
}

/** Length of save.history (V11-SHIM: CC-9; read `save.history.length`). */
export function historyLength(save: SaveV1): number {
  return historyOf(save).length;
}

// V11-SHIM: CC-10 — `MILESTONES` and `nextMilestone(save)`.
const MILESTONES = [180, 390, 720, 1110, 1440, 1830, 2880, 4320, 6480];
export function nextMilestone(save: SaveV1): number | null {
  const r = recentBest(save);
  for (const m of MILESTONES) if (m > r) return m;
  return null;
}

// V11-SHIM: CC-8/A1 — Challenge k 'e' carries `p`, `dr`, `nc`, `pl` (decoded with the legacy rules:
// no p → { p 3, dr 55, nc 0, pl 0 }; p without pl → pl = p === 3 ? 1 : 0) and both kinds `n?`.
export interface ChallengeRules {
  p: ProfileId;
  dr: number;
  nc: NoonCloud;
  pl: 0 | 1;
  n: string;
}
export function challengeRules(c: Challenge): ChallengeRules {
  const x = c as Challenge & { p?: ProfileId; dr?: number; nc?: NoonCloud; pl?: 0 | 1; n?: string };
  if (x.p === undefined) return { p: 3, dr: 55, nc: 0, pl: 0, n: x.n ?? '' };
  return { p: x.p, dr: x.dr ?? 55, nc: x.nc ?? 0, pl: x.pl ?? (x.p === 3 ? 1 : 0), n: x.n ?? '' };
}

// V11-SHIM: CC-10 — `swapMission(save, slotId): Save` from src/meta/progression.ts (that slot's id
// moves to deferred and the next eligible mission is dealt at once). The v1.0 meta has no stale
// slots, so nothing is swapped here.
export function swapMission(save: SaveV1, _slotId: string): SaveV1 {
  return save;
}

// V11-SHIM: CC-13 — `ShareOutcome` adds 'saved' and `shareFiles({ file, text })` lands in
// src/platform/share.ts: the native sheet with the file when it can take one (called before any
// await), else the file is downloaded and the text copied ('saved').
export type ShareOutcomeV11 = ShareOutcome | 'saved';
export function shareFiles(p: { file: File; text: string }): Promise<ShareOutcomeV11> {
  const files = [p.file];
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files }) === true) {
    return navigator.share({ files, text: p.text }).then(
      (): ShareOutcomeV11 => 'shared',
      (err: unknown) => (err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : saveFile(p)),
    );
  }
  return saveFile(p);
}
function saveFile(p: { file: File; text: string }): Promise<ShareOutcomeV11> {
  const url = URL.createObjectURL(p.file);
  const a = document.createElement('a');
  a.href = url;
  a.download = p.file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return copyText(p.text).then((): ShareOutcomeV11 => 'saved');
}

// V11-SHIM: CC-9/CC-10 — `Save.pars` (Snowbot par minutes by date, the latest 14) and
// `setDailyPar(save, date, minutes): Save` from src/meta/progression.ts.
type SaveWithPars = SaveV1 & { pars?: Record<string, number> };
export function dailyPar(save: SaveV1, date: string): number | undefined {
  return (save as SaveWithPars).pars?.[date];
}
export function setDailyPar(save: SaveV1, date: string, minutes: number): SaveV1 {
  const pars: Record<string, number> = { ...((save as SaveWithPars).pars ?? {}), [date]: minutes };
  const keep = Object.keys(pars).sort().slice(-14);
  return { ...save, pars: Object.fromEntries(keep.map((d) => [d, pars[d] as number])) } as SaveV1;
}
