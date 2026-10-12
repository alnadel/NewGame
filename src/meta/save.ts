// Save v2: defaults, validation/migration and a debounced persistent store (V1_PLAN §11.5,
// V1_1_PLAN UM1).
//
// Loading never throws and never trusts its input: every field is type-checked, clamped and filtered
// against the content catalog. A save written by a newer build is left untouched on disk.

import type { DailyEntry, ErrandState, MissionSlot, RunRecord, Save, Settings, WeekState } from './saveTypes.ts';
import type { StorageAdapter } from '../platform/storage.ts';
import { onPageVisible } from '../platform/lifecycle.ts';
import {
  ACHIEVEMENTS,
  ACTIVE_MISSIONS,
  COSMETIC_SLOTS,
  COSMETICS,
  DEFAULT_COSMETICS,
  DEFAULT_EQUIPPED,
  MISSIONS,
  getAchievement,
  getCosmetic,
  isAchievementId,
  isCosmeticId,
} from './content.ts';
import { getErrand, parseMissionId, refillMissions } from './missions.ts';
import { sanitizeName } from './challenge.ts';
import { DAILY_TRIES, isDateString } from './daily.ts';
import { COMFORT_MAX } from '../core/index.ts';

export const SAVE_KEY = 'shady.save';
/** Suffixes of the side keys every store keeps next to its main key. */
const BAK_SUFFIX = '.bak';
const FUTURE_SUFFIX = '.future';
/** The pre-migration / unreadable raw save, kept for recovery. */
export const SAVE_BAK_KEY = `${SAVE_KEY}${BAK_SUFFIX}`;
/** A save written by a newer build, copied aside and never overwritten. */
export const SAVE_FUTURE_KEY = `${SAVE_KEY}${FUTURE_SUFFIX}`;
export const SAVE_VERSION = 2;
/** Daily entries kept (newest dates win). */
export const DAILY_KEEP = 60;
/** Snowbot pars kept (newest dates win). */
export const PARS_KEEP = 14;
/** Endless runs kept in the history (oldest dropped first). */
export const HISTORY_KEEP = 30;
/** Default write debounce (ms). */
export const SAVE_DEBOUNCE_MS = 300;

const BIG = 1_000_000_000;
const MAX_GLYPHS_LENGTH = 1000;
const MAX_MINUTES = 1_000_000;
const MAX_SNOW = 10_000_000;

export function defaultSettings(): Settings {
  return {
    sfx: 0.8,
    music: 0.6,
    haptics: true,
    sensitivity: 1,
    invert: false,
    reducedMotion: 'auto',
    highContrast: false,
    guide: 'auto',
    name: '',
    comfort: true,
  };
}

/** An empty errand (a date's errand is created on its first run or view). */
export function emptyErrand(): ErrandState {
  return { date: '', id: '', progress: 0, done: false };
}

export function emptyWeek(): WeekState {
  return { start: '', days: 0, paid: 0, best: [0, 0, 0, 0, 0, 0, 0] };
}

/** The comfort rung a v1 save starts v1.1 on, from its lifetime runs (A2). */
export function comfortFromRuns(runs: number): number {
  return runs <= 0 ? 0 : ([1, 1, 2, 3, 4][Math.min(runs, 5) - 1] as number);
}

/** A brand-new save (3 missions dealt, default cosmetics owned and equipped). */
export function defaults(now: number = Date.now()): Save {
  const missions = { cursor: 0, tier: 1, active: [] as MissionSlot[], deferred: [] as string[], errand: emptyErrand() };
  refillMissions(missions, 0);
  return {
    v: 2,
    createdAt: now,
    settings: defaultSettings(),
    stats: {
      runs: 0,
      bestMinutes: 0,
      easedBest: 0,
      bestSnowRun: 0,
      lifetimeSnow: 0,
      wallet: 0,
      phews: 0,
      flakes: 0,
      daysSurvived: 0,
      maxDay: 0,
      dailyDaysPlayed: 0,
      cloudSeconds: 0,
      reachedNight: false,
      comfort: 0,
      playSeconds: 0,
      swings: 0,
      sunnyWeeks: 0,
      forecastNoons: 0,
    },
    unlocks: { cosmetics: [...DEFAULT_COSMETICS], achievements: [] },
    equipped: { ...DEFAULT_EQUIPPED },
    missions,
    daily: {},
    pars: {},
    history: [],
    week: emptyWeek(),
    lastPlay: '',
    flags: {
      hintsShown: 0,
      tutorialDone: false,
      installSheetShown: false,
      persistRequested: false,
      storageWarned: false,
      missionsV2: true,
    },
  };
}

/** Deep copy, so pure helpers never alias the caller's save. */
export function cloneSave(save: Save): Save {
  return structuredClone(save);
}

// ---------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rec(v: unknown): Rec {
  return isRecord(v) ? v : {};
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Clamps and type-checks settings; unknown or invalid fields take their defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = rec(raw);
  const d = defaultSettings();
  return {
    sfx: num(r.sfx, d.sfx, 0, 1),
    music: num(r.music, d.music, 0, 1),
    haptics: bool(r.haptics, d.haptics),
    sensitivity: num(r.sensitivity, d.sensitivity, 0.6, 1.5),
    invert: bool(r.invert, d.invert),
    reducedMotion: pick(r.reducedMotion, ['auto', 'on', 'off'] as const, d.reducedMotion),
    highContrast: bool(r.highContrast, d.highContrast),
    guide: pick(r.guide, ['auto', 'always', 'off'] as const, d.guide),
    name: typeof r.name === 'string' ? sanitizeName(r.name) : d.name,
    comfort: bool(r.comfort, d.comfort),
  };
}

/** Keeps the newest `keep` daily entries (ISO dates sort lexicographically). Mutates and returns `daily`. */
export function pruneDaily(daily: Record<string, DailyEntry>, keep: number = DAILY_KEEP): Record<string, DailyEntry> {
  const dates = Object.keys(daily).sort();
  for (let i = 0; i < dates.length - keep; i++) delete daily[dates[i] as string];
  return daily;
}

function sanitizeDaily(raw: unknown): Record<string, DailyEntry> {
  const out: Record<string, DailyEntry> = {};
  for (const [date, value] of Object.entries(rec(raw))) {
    if (!isDateString(date) || !isRecord(value)) continue;
    out[date] = {
      tries: int(value.tries, 0, 0, DAILY_TRIES),
      bestMinutes: int(value.bestMinutes, 0, 0, BIG),
      bestSnow: int(value.bestSnow, 0, 0, BIG),
      glyphs: typeof value.glyphs === 'string' ? value.glyphs.slice(0, MAX_GLYPHS_LENGTH) : '',
    };
  }
  return pruneDaily(out);
}

/**
 * Progress of an undone 'hold-x5' slot from a save written before the polish wave. The mission was
 * "Hold ×5 for 8 s" (progress = seconds held at ×5) and is now "Reach a ×4 multiplier" (progress =
 * the best multiplier level). Any held seconds mean ×5 was reached, so they become level 5; zero
 * stays zero. Saves carrying `flags.missionsV2` already use the new unit and are left alone.
 */
export const HOLD_X5_MIGRATED_PROGRESS = 5;

function sanitizeErrand(raw: unknown): ErrandState {
  const r = rec(raw);
  if (typeof r.date !== 'string' || !isDateString(r.date) || typeof r.id !== 'string' || !getErrand(r.id)) return emptyErrand();
  return { date: r.date, id: r.id, progress: num(r.progress, 0, 0, BIG), done: bool(r.done, false) };
}

/** `best`: the player's recent best, for dealing replacement slots past the skill gates. */
function sanitizeMissions(raw: unknown, legacyUnits: boolean, best: number): Save['missions'] {
  const r = rec(raw);
  const active: MissionSlot[] = [];
  if (Array.isArray(r.active)) {
    for (const item of r.active) {
      if (active.length >= ACTIVE_MISSIONS) break;
      if (!isRecord(item) || typeof item.id !== 'string') continue;
      const parsed = parseMissionId(item.id);
      if (!parsed) continue;
      if (active.some((s) => s.id === item.id)) continue;
      const done = bool(item.done, false);
      let progress = num(item.progress, 0, 0, BIG);
      if (legacyUnits && !done && parsed.def.id === 'hold-x5' && progress > 0) progress = HOLD_X5_MIGRATED_PROGRESS;
      active.push({ id: item.id, progress, done, stale: int(item.stale, 0, 0, BIG) });
    }
  }
  // One queued entry per mission, never one that is active.
  const deferred: string[] = [];
  for (const id of Array.isArray(r.deferred) ? r.deferred : []) {
    const def = typeof id === 'string' ? parseMissionId(id)?.def.id : undefined;
    if (def === undefined || active.some((s) => s.id === id) || deferred.some((d) => parseMissionId(d)?.def.id === def)) continue;
    deferred.push(id as string);
  }
  const missions = {
    cursor: int(r.cursor, 0, 0, MISSIONS.length - 1),
    tier: int(r.tier, 1, 1, 99),
    active,
    deferred,
    errand: sanitizeErrand(r.errand),
  };
  // A damaged save (or a v1 'play-daily' slot, now an errand) leaves a gap: deal replacements so
  // there are always three. Completed slots stay as they are until the next run starts.
  if (active.length < ACTIVE_MISSIONS) refillMissions(missions, best, false);
  return missions;
}

function sanitizeHistory(raw: unknown): RunRecord[] {
  const out: RunRecord[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!isRecord(e) || typeof e.d !== 'string' || !isDateString(e.d)) continue;
    out.push({ m: int(e.m, 0, 0, MAX_MINUTES), s: int(e.s, 0, 0, MAX_SNOW), r: int(e.r, COMFORT_MAX, 0, COMFORT_MAX), d: e.d });
  }
  return out.slice(-HISTORY_KEEP);
}

function sanitizeWeek(raw: unknown): WeekState {
  const r = rec(raw);
  if (typeof r.start !== 'string' || !isDateString(r.start)) return emptyWeek();
  const best = Array.isArray(r.best) ? r.best : [];
  return {
    start: r.start,
    days: int(r.days, 0, 0, 127),
    paid: int(r.paid, 0, 0, 7),
    best: Array.from({ length: 7 }, (_, i) => int(best[i], 0, 0, 99)),
  };
}

/** Keeps the newest `keep` pars. Mutates and returns `pars`. */
export function prunePars(pars: Record<string, number>, keep: number = PARS_KEEP): Record<string, number> {
  const dates = Object.keys(pars).sort();
  for (let i = 0; i < dates.length - keep; i++) delete pars[dates[i] as string];
  return pars;
}

function sanitizePars(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [date, value] of Object.entries(rec(raw))) {
    if (isDateString(date) && typeof value === 'number' && Number.isFinite(value)) out[date] = int(value, 0, 0, MAX_MINUTES);
  }
  return prunePars(out);
}

/**
 * The best score of the recent endless runs: the max over the last 10 history entries (tutorial
 * runs ignored), or the all-time best while the history holds fewer than 3 runs. Missions are
 * gated on it, the gold ruler flag shows it and the Journal frames runs against it.
 */
export function recentBest(save: Pick<Save, 'history' | 'stats'>): number {
  const h = save.history;
  if (h.length < 3) return save.stats.bestMinutes;
  let best = 0;
  for (let i = Math.max(0, h.length - 10); i < h.length; i++) {
    const e = h[i] as RunRecord;
    if (e.r !== 0 && e.m > best) best = e.m;
  }
  return best;
}

/** Validates a v2-shaped object into a well-formed Save. */
function sanitize(r: Rec, now: number): Save {
  const base = defaults(now);
  const stats = rec(r.stats);
  const unlocks = rec(r.unlocks);
  const equipped = rec(r.equipped);
  const flags = rec(r.flags);
  const runs = int(stats.runs, 0, 0, BIG);
  const bestMinutes = int(stats.bestMinutes, 0, 0, BIG);
  const history = sanitizeHistory(r.history);

  const achievementSet = new Set(Array.isArray(unlocks.achievements) ? unlocks.achievements.filter(isAchievementId) : []);
  const achievements = ACHIEVEMENTS.filter((a) => achievementSet.has(a.id)).map((a) => a.id);

  const owned = new Set<string>(DEFAULT_COSMETICS);
  if (Array.isArray(unlocks.cosmetics)) for (const id of unlocks.cosmetics) if (isCosmeticId(id)) owned.add(id);
  // Repair: an unlocked achievement always grants its cosmetic.
  for (const id of achievements) {
    const reward = getAchievement(id)?.reward;
    if (reward) owned.add(reward);
  }
  const cosmetics = COSMETICS.filter((c) => owned.has(c.id)).map((c) => c.id);

  const eq = { ...base.equipped };
  for (const slot of COSMETIC_SLOTS) {
    const id = equipped[slot];
    if (typeof id === 'string' && owned.has(id) && getCosmetic(id)?.slot === slot) eq[slot] = id;
  }

  return {
    v: 2,
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 && r.createdAt < 1e15 ? r.createdAt : now,
    settings: sanitizeSettings(r.settings),
    stats: {
      runs,
      bestMinutes,
      easedBest: int(stats.easedBest, 0, 0, BIG),
      bestSnowRun: int(stats.bestSnowRun, 0, 0, BIG),
      lifetimeSnow: int(stats.lifetimeSnow, 0, 0, BIG),
      wallet: int(stats.wallet, 0, 0, BIG),
      phews: int(stats.phews, 0, 0, BIG),
      flakes: int(stats.flakes, 0, 0, BIG),
      daysSurvived: int(stats.daysSurvived, 0, 0, BIG),
      maxDay: int(stats.maxDay, 0, 0, BIG),
      dailyDaysPlayed: int(stats.dailyDaysPlayed, 0, 0, BIG),
      cloudSeconds: num(stats.cloudSeconds, 0, 0, BIG),
      reachedNight: bool(stats.reachedNight, false),
      comfort: int(stats.comfort, comfortFromRuns(runs), 0, COMFORT_MAX),
      playSeconds: num(stats.playSeconds, 0, 0, BIG),
      swings: int(stats.swings, 0, 0, BIG),
      sunnyWeeks: int(stats.sunnyWeeks, 0, 0, BIG),
      forecastNoons: int(stats.forecastNoons, 0, 0, 127),
    },
    unlocks: { cosmetics, achievements },
    equipped: eq,
    // Saves without the flag predate the polish-wave mission units: convert them once.
    missions: sanitizeMissions(r.missions, !bool(flags.missionsV2, false), recentBest({ history, stats: { ...base.stats, bestMinutes } })),
    daily: sanitizeDaily(r.daily),
    pars: sanitizePars(r.pars),
    history,
    week: sanitizeWeek(r.week),
    lastPlay: typeof r.lastPlay === 'string' && isDateString(r.lastPlay) ? r.lastPlay : '',
    flags: {
      hintsShown: int(flags.hintsShown, 0, 0, BIG),
      tutorialDone: bool(flags.tutorialDone, false),
      installSheetShown: bool(flags.installSheetShown, false),
      persistRequested: bool(flags.persistRequested, false),
      storageWarned: bool(flags.storageWarned, false),
      missionsV2: true,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------------------------

/**
 * - `fresh`: nothing stored yet.
 * - `ok`: a valid save (possibly repaired by validation).
 * - `recovered`: the main save was unreadable; the `.bak` copy was used.
 * - `corrupt`: unreadable and no usable backup; defaults are used.
 * - `future`: written by a newer build; defaults are used in memory and the stored save is never overwritten.
 */
export type LoadStatus = 'fresh' | 'ok' | 'recovered' | 'corrupt' | 'future';

export interface MigrateResult {
  save: Save;
  status: Exclude<LoadStatus, 'recovered'>;
}

/**
 * Upgrades from older schemas: MIGRATIONS[i] turns a v(i+1) object into a v(i+2) object; sanitize
 * then fills every field the old schema lacked with its default.
 * - v1 → v2: the comfort rung from lifetime runs (A2). Its 'play-daily' slots no longer parse (the
 *   Daily is an errand now), so sanitize deals replacements.
 */
const MIGRATIONS: readonly ((save: Rec) => Rec)[] = [
  (v1) => {
    const stats = rec(v1.stats);
    return { ...v1, v: 2, stats: { ...stats, comfort: comfortFromRuns(int(stats.runs, 0, 0, BIG)) } };
  },
];

/** Parses (if a string) and validates raw save data. Never throws. */
export function migrate(raw: unknown, now: number = Date.now()): MigrateResult {
  if (raw === null || raw === undefined || raw === '') return { save: defaults(now), status: 'fresh' };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { save: defaults(now), status: 'corrupt' };
    }
  }
  if (!isRecord(obj)) return { save: defaults(now), status: 'corrupt' };
  let version = obj.v;
  if (typeof version === 'number' && version > SAVE_VERSION) return { save: defaults(now), status: 'future' };
  let current: Rec = obj;
  while (typeof version === 'number' && Number.isInteger(version) && version >= 1 && version < SAVE_VERSION) {
    const step = MIGRATIONS[version - 1];
    if (!step) break;
    current = step(current);
    version = current.v;
  }
  if (version !== SAVE_VERSION) return { save: defaults(now), status: 'corrupt' };
  return { save: sanitize(current, now), status: 'ok' };
}

// ---------------------------------------------------------------------------------------------
// SaveStore
// ---------------------------------------------------------------------------------------------

/**
 * Where a store hears about other instances (another tab, the installed app and its browser tab):
 * `storage` events for writes made elsewhere, and the page becoming visible again (some browsers
 * deliver no storage event to a background tab, so the store re-reads then). Injected in tests.
 */
export interface SaveChangeSource {
  onStorage(cb: (key: string | null, newValue: string | null) => void): () => void;
  onVisible(cb: () => void): () => void;
}

/** The browser's sources: window 'storage' events and platform/lifecycle onPageVisible. */
function browserChangeSource(): SaveChangeSource | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    onStorage(cb) {
      const listener = (e: StorageEvent): void => cb(e.key, e.newValue);
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
    onVisible: (cb) => onPageVisible(cb),
  };
}

export interface SaveStoreOptions {
  key?: string;
  debounceMs?: number;
  now?: () => number;
  /** Change notifications from other instances; defaults to the browser's (none outside a page). */
  changes?: SaveChangeSource | null;
}

/**
 * Owns the live save. `get()` returns the in-memory object (treat it as read-only outside
 * `update`); writes are debounced and `flush()` forces them (call on pagehide/hidden and run end).
 *
 * Several instances can share one origin (two tabs, or the Home Screen app next to its browser
 * tab on Android). A save written by another instance is adopted (`onExternalChange`) instead of
 * being overwritten later by this one's stale copy: with nothing pending here it replaces the
 * in-memory save without writing; with a local change pending, the other instance's progress is
 * taken and only this instance's settings and outfit are kept, then written back at once.
 */
export class SaveStore {
  readonly status: LoadStatus;
  private current: Save;
  private readonly storage: StorageAdapter;
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly now: () => number;
  /** False after loading a future-version save: that save must never be overwritten. */
  private readonly writable: boolean;
  /** Raw pre-migration value to preserve in `.bak` before the first write. */
  private pendingBackup: string | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The raw bytes last read from or written to the main key (to spot writes made elsewhere). */
  private lastRaw: string | null;
  private degradedNotified = false;
  private readonly listeners = new Set<(save: Save) => void>();
  private readonly externalListeners = new Set<(save: Save) => void>();
  private readonly degradedListeners = new Set<() => void>();
  private readonly detach: (() => void)[] = [];

  constructor(storage: StorageAdapter, options: SaveStoreOptions = {}) {
    this.storage = storage;
    this.key = options.key ?? SAVE_KEY;
    this.debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.now = options.now ?? Date.now;
    const now = this.now();
    const raw = storage.get(this.key);
    this.lastRaw = raw;
    const loaded = migrate(raw, now);
    let status: LoadStatus = loaded.status;
    this.current = loaded.save;
    this.writable = loaded.status !== 'future';

    if (loaded.status === 'future' && raw !== null) {
      storage.set(`${this.key}${FUTURE_SUFFIX}`, raw);
    } else if (loaded.status === 'corrupt') {
      const bak = migrate(storage.get(`${this.key}${BAK_SUFFIX}`), now);
      if (bak.status === 'ok') {
        this.current = bak.save;
        status = 'recovered';
      } else {
        // Keep the unreadable bytes around for manual recovery.
        this.pendingBackup = raw;
        this.dirty = true;
      }
    } else if (loaded.status === 'ok' && JSON.stringify(loaded.save) !== raw) {
      // Validation changed something (older build, repaired field): keep the original in .bak.
      this.pendingBackup = raw;
      this.dirty = true;
    }
    this.status = status;

    const source = options.changes === undefined ? browserChangeSource() : options.changes;
    if (source) {
      this.detach.push(
        source.onStorage((key, value) => {
          if (key === this.key && value !== null) this.adopt(value);
        }),
        source.onVisible(() => this.reread()),
      );
    }
  }

  /** True when progress will not survive this session (memory-only storage or a newer save on disk). */
  get degraded(): boolean {
    return this.storage.degraded || !this.writable;
  }

  /** False when a save from a newer version of the game is on disk: nothing may be written over it. */
  get canPersist(): boolean {
    return this.writable;
  }

  get(): Save {
    return this.current;
  }

  /** Replaces the save (e.g. with the result of a pure progression helper) and schedules a write. */
  set(next: Save): void {
    this.current = next;
    this.changed();
  }

  /** Mutates the save in place and schedules a write. */
  update(mutate: (draft: Save) => void): void {
    mutate(this.current);
    this.changed();
  }

  /** Writes now if anything changed since the last write. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || !this.writable) return;
    if (this.pendingBackup !== null) {
      this.storage.set(`${this.key}${BAK_SUFFIX}`, this.pendingBackup);
      this.pendingBackup = null;
    }
    const raw = JSON.stringify(this.current);
    this.storage.set(this.key, raw);
    this.lastRaw = raw;
    this.dirty = false;
    if (this.storage.degraded && !this.degradedNotified) {
      this.degradedNotified = true;
      for (const cb of [...this.degradedListeners]) cb();
    }
  }

  /** Called with the new save after every set/update. Returns an unsubscribe function. */
  subscribe(listener: (save: Save) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Called after this store adopted a save written by another instance (a storage event on its key,
   * or a re-read on becoming visible that found different bytes). Push it to the UI and re-apply
   * its settings. Returns an unsubscribe function.
   */
  onExternalChange(cb: (save: Save) => void): () => void {
    this.externalListeners.add(cb);
    return () => this.externalListeners.delete(cb);
  }

  /** Called once, on the first write after boot that didn't reach durable storage. */
  onDegraded(cb: () => void): () => void {
    this.degradedListeners.add(cb);
    return () => this.degradedListeners.delete(cb);
  }

  /** Writes anything pending and stops listening for other instances. */
  dispose(): void {
    this.flush();
    for (const off of this.detach.splice(0)) off();
    this.listeners.clear();
    this.externalListeners.clear();
    this.degradedListeners.clear();
  }

  /** Visibility re-read: adopt the stored save if another instance changed it meanwhile. */
  private reread(): void {
    const raw = this.storage.get(this.key);
    if (raw !== null && raw !== this.lastRaw) this.adopt(raw);
  }

  private adopt(raw: string): void {
    if (raw === this.lastRaw) return;
    const remote = migrate(raw, this.now());
    // A newer build's save (or garbage) is never adopted: this instance keeps what it has.
    if (remote.status !== 'ok') return;
    this.lastRaw = raw;
    if (!this.dirty) {
      this.current = remote.save;
    } else {
      // A local change is pending: keep the other instance's progress (runs, wallet, cosmetics,
      // Daily tries) and only this instance's settings and outfit (where the remote owns it).
      const merged = remote.save;
      merged.settings = { ...this.current.settings };
      for (const slot of COSMETIC_SLOTS) {
        const id = this.current.equipped[slot];
        if (merged.unlocks.cosmetics.includes(id)) merged.equipped[slot] = id;
      }
      this.current = merged;
      this.flush();
    }
    for (const cb of [...this.externalListeners]) cb(this.current);
  }

  private changed(): void {
    this.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    for (const listener of this.listeners) listener(this.current);
  }
}
