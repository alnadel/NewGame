// Save v1: defaults, validation/migration and a debounced persistent store (TECH_SPEC §12, V1_PLAN §11.5).
//
// Loading never throws and never trusts its input: every field is type-checked, clamped and filtered
// against the content catalog. A save written by a newer build is left untouched on disk.

import type { DailyEntry, MissionSlot, SaveV1, Settings } from './saveTypes.ts';
import type { StorageAdapter } from '../platform/storage.ts';
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
import { parseMissionId, refillMissions } from './missions.ts';
import { DAILY_TRIES, isDateString } from './daily.ts';

export const SAVE_KEY = 'shady.save';
export const SAVE_BAK_KEY = 'shady.save.bak';
export const SAVE_FUTURE_KEY = 'shady.save.future';
export const SAVE_VERSION = 1;
/** Daily entries kept (newest dates win). */
export const DAILY_KEEP = 60;
/** Default write debounce (ms). */
export const SAVE_DEBOUNCE_MS = 300;

const BIG = 1_000_000_000;
const MAX_GLYPHS_LENGTH = 1000;

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
  };
}

/** A brand-new save (3 missions dealt, default cosmetics owned and equipped). */
export function defaults(now: number = Date.now()): SaveV1 {
  const missions = { cursor: 0, tier: 1, active: [] as MissionSlot[] };
  refillMissions(missions);
  return {
    v: 1,
    createdAt: now,
    settings: defaultSettings(),
    stats: {
      runs: 0,
      bestMinutes: 0,
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
    },
    unlocks: { cosmetics: [...DEFAULT_COSMETICS], achievements: [] },
    equipped: { ...DEFAULT_EQUIPPED },
    missions,
    daily: {},
    flags: { hintsShown: 0, installSheetShown: false, persistRequested: false, storageWarned: false },
  };
}

/** Deep copy, so pure helpers never alias the caller's save. */
export function cloneSave(save: SaveV1): SaveV1 {
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

function sanitizeMissions(raw: unknown): SaveV1['missions'] {
  const r = rec(raw);
  const active: MissionSlot[] = [];
  if (Array.isArray(r.active)) {
    for (const item of r.active) {
      if (active.length >= ACTIVE_MISSIONS) break;
      if (!isRecord(item) || typeof item.id !== 'string' || !parseMissionId(item.id)) continue;
      if (active.some((s) => s.id === item.id)) continue;
      active.push({ id: item.id, progress: num(item.progress, 0, 0, BIG), done: bool(item.done, false) });
    }
  }
  const missions = {
    cursor: int(r.cursor, 0, 0, MISSIONS.length - 1),
    tier: int(r.tier, 1, 1, 99),
    active,
  };
  // A damaged save may have lost slots: deal replacements so there are always three. Completed
  // slots stay as they are; they are only swapped at the next run start.
  if (active.length < ACTIVE_MISSIONS) refillMissions(missions, false);
  return missions;
}

/** Validates a v1-shaped object into a well-formed SaveV1. */
function sanitize(r: Rec, now: number): SaveV1 {
  const base = defaults(now);
  const stats = rec(r.stats);
  const unlocks = rec(r.unlocks);
  const equipped = rec(r.equipped);
  const flags = rec(r.flags);

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
    v: 1,
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 && r.createdAt < 1e15 ? r.createdAt : now,
    settings: sanitizeSettings(r.settings),
    stats: {
      runs: int(stats.runs, 0, 0, BIG),
      bestMinutes: int(stats.bestMinutes, 0, 0, BIG),
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
    },
    unlocks: { cosmetics, achievements },
    equipped: eq,
    missions: sanitizeMissions(r.missions),
    daily: sanitizeDaily(r.daily),
    flags: {
      hintsShown: int(flags.hintsShown, 0, 0, BIG),
      installSheetShown: bool(flags.installSheetShown, false),
      persistRequested: bool(flags.persistRequested, false),
      storageWarned: bool(flags.storageWarned, false),
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
  save: SaveV1;
  status: Exclude<LoadStatus, 'recovered'>;
}

/**
 * Upgrades from older schemas: MIGRATIONS[i] turns a v(i+1) object into a v(i+2) object.
 * v1 is the first schema, so the list starts empty; append to it when SaveV2 ships.
 */
const MIGRATIONS: readonly ((save: Rec) => Rec)[] = [];

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

export interface SaveStoreOptions {
  key?: string;
  debounceMs?: number;
  now?: () => number;
}

/**
 * Owns the live save. `get()` returns the in-memory object (treat it as read-only outside
 * `update`); writes are debounced and `flush()` forces them (call on pagehide/hidden and run end).
 */
export class SaveStore {
  readonly status: LoadStatus;
  private current: SaveV1;
  private readonly storage: StorageAdapter;
  private readonly key: string;
  private readonly debounceMs: number;
  /** False after loading a future-version save: that save must never be overwritten. */
  private readonly writable: boolean;
  /** Raw pre-migration value to preserve in `.bak` before the first write. */
  private pendingBackup: string | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(save: SaveV1) => void>();

  constructor(storage: StorageAdapter, options: SaveStoreOptions = {}) {
    this.storage = storage;
    this.key = options.key ?? SAVE_KEY;
    this.debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
    const now = (options.now ?? Date.now)();
    const raw = storage.get(this.key);
    const loaded = migrate(raw, now);
    let status: LoadStatus = loaded.status;
    this.current = loaded.save;
    this.writable = loaded.status !== 'future';

    if (loaded.status === 'future' && raw !== null) {
      storage.set(`${this.key}.future`, raw);
    } else if (loaded.status === 'corrupt') {
      const bak = migrate(storage.get(`${this.key}.bak`), now);
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
  }

  /** True when progress will not survive this session (memory-only storage or a newer save on disk). */
  get degraded(): boolean {
    return this.storage.degraded || !this.writable;
  }

  get(): SaveV1 {
    return this.current;
  }

  /** Replaces the save (e.g. with the result of a pure progression helper) and schedules a write. */
  set(next: SaveV1): void {
    this.current = next;
    this.changed();
  }

  /** Mutates the save in place and schedules a write. */
  update(mutate: (draft: SaveV1) => void): void {
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
      this.storage.set(`${this.key}.bak`, this.pendingBackup);
      this.pendingBackup = null;
    }
    this.storage.set(this.key, JSON.stringify(this.current));
    this.dirty = false;
  }

  /** Called with the new save after every set/update. Returns an unsubscribe function. */
  subscribe(listener: (save: SaveV1) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
