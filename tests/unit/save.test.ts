import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_KEEP,
  SAVE_BAK_KEY,
  SAVE_FUTURE_KEY,
  SAVE_KEY,
  SaveStore,
  defaults,
  migrate,
  sanitizeSettings,
} from '../../src/meta/save.ts';
import { createStorage, type StorageAdapter } from '../../src/platform/storage.ts';
import { addDays } from '../../src/meta/daily.ts';

const NOW = 1_760_000_000_000;

/** In-memory Web Storage stand-in; `failAfter` makes setItem throw after N successful writes. */
class FakeStorage implements Storage {
  readonly map = new Map<string, string>();
  failAfter = Infinity;
  writes = 0;
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.writes >= this.failAfter) throw new DOMException('quota', 'QuotaExceededError');
    this.writes++;
    this.map.set(key, value);
  }
}

describe('defaults', () => {
  it('builds a complete fresh save', () => {
    const s = defaults(NOW);
    expect(s.v).toBe(1);
    expect(s.createdAt).toBe(NOW);
    expect(s.settings).toEqual({
      sfx: 0.8,
      music: 0.6,
      haptics: true,
      sensitivity: 1,
      invert: false,
      reducedMotion: 'auto',
      highContrast: false,
      guide: 'auto',
    });
    expect(s.stats.runs).toBe(0);
    expect(s.stats.wallet).toBe(0);
    expect(s.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-none', nose: 'nose-carrot' });
    expect(s.unlocks.cosmetics).toEqual(['scarf-red', 'hat-none', 'nose-carrot']);
    expect(s.missions.active.map((m) => m.id)).toEqual(['reach-9am', 'flakes-10', 'mult-3']);
    expect(s.missions.cursor).toBe(3);
    expect(s.missions.tier).toBe(1);
    expect(s.daily).toEqual({});
  });

  it('round-trips through migrate unchanged', () => {
    const s = defaults(NOW);
    const r = migrate(JSON.stringify(s), NOW);
    expect(r.status).toBe('ok');
    expect(r.save).toEqual(s);
  });
});

describe('migrate', () => {
  it('treats missing data as fresh', () => {
    expect(migrate(null, NOW).status).toBe('fresh');
    expect(migrate('', NOW).status).toBe('fresh');
  });

  it('falls back to defaults on corrupted JSON and non-objects', () => {
    for (const raw of ['{"v":1,', 'not json', '[]', '42', '"str"', 'null', '{"v":"1"}', '{}', '{"v":0}']) {
      const r = migrate(raw, NOW);
      expect(r.status, raw).toBe('corrupt');
      expect(r.save).toEqual(defaults(NOW));
    }
  });

  it('flags saves from a newer version', () => {
    const r = migrate('{"v":2,"stats":{"wallet":999}}', NOW);
    expect(r.status).toBe('future');
    expect(r.save.stats.wallet).toBe(0);
  });

  it('merges a partial v1 save with defaults', () => {
    const r = migrate({ v: 1, stats: { runs: 7, wallet: 120 }, settings: { music: 0.2 } }, NOW);
    expect(r.status).toBe('ok');
    expect(r.save.stats.runs).toBe(7);
    expect(r.save.stats.wallet).toBe(120);
    expect(r.save.stats.bestMinutes).toBe(0);
    expect(r.save.settings.music).toBe(0.2);
    expect(r.save.settings.sfx).toBe(0.8);
    expect(r.save.missions.active).toHaveLength(3);
    expect(r.save.flags.installSheetShown).toBe(false);
  });

  it('clamps and type-checks every field', () => {
    const r = migrate(
      {
        v: 1,
        createdAt: -5,
        settings: { sfx: 4, music: -1, sensitivity: 0.1, reducedMotion: 'sometimes', guide: 'always', haptics: 'yes' },
        stats: { runs: 3.7, wallet: -40, bestMinutes: '900', cloudSeconds: 12.5, reachedNight: 1 },
        flags: { hintsShown: -2, installSheetShown: true },
      },
      NOW,
    );
    const s = r.save;
    expect(s.createdAt).toBe(NOW);
    expect(s.settings.sfx).toBe(1);
    expect(s.settings.music).toBe(0);
    expect(s.settings.sensitivity).toBe(0.6);
    expect(s.settings.reducedMotion).toBe('auto');
    expect(s.settings.guide).toBe('always');
    expect(s.settings.haptics).toBe(true);
    expect(s.stats.runs).toBe(3);
    expect(s.stats.wallet).toBe(0);
    expect(s.stats.bestMinutes).toBe(0);
    expect(s.stats.cloudSeconds).toBe(12.5);
    expect(s.stats.reachedNight).toBe(false);
    expect(s.flags.hintsShown).toBe(0);
    expect(s.flags.installSheetShown).toBe(true);
  });

  it('filters ids against the content catalog and repairs equipment', () => {
    const r = migrate(
      {
        v: 1,
        unlocks: { cosmetics: ['scarf-mint', 'hat-jetpack', 'scarf-mint', 42], achievements: ['solstice', 'bogus'] },
        equipped: { scarf: 'scarf-plaid', hat: 'hat-crown', nose: 'scarf-mint' },
      },
      NOW,
    );
    const s = r.save;
    // Defaults are always owned; the Solstice reward (Crown) is granted by repair.
    expect(s.unlocks.cosmetics).toEqual(['scarf-red', 'scarf-mint', 'hat-none', 'hat-crown', 'nose-carrot']);
    expect(s.unlocks.achievements).toEqual(['solstice']);
    // Plaid is not owned and a scarf can't be a nose.
    expect(s.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-crown', nose: 'nose-carrot' });
  });

  it('drops invalid missions and deals replacements', () => {
    const r = migrate(
      {
        v: 1,
        missions: {
          cursor: 5,
          tier: 1,
          active: [
            { id: 'two-phews', progress: 1, done: false },
            { id: 'nope', progress: 0, done: false },
            { id: 'two-phews', progress: 0, done: false },
            { id: 'flakes-10@2', progress: 'x', done: true },
          ],
        },
      },
      NOW,
    );
    const m = r.save.missions;
    expect(m.active).toEqual([
      { id: 'two-phews', progress: 1, done: false },
      { id: 'flakes-10@2', progress: 0, done: true },
      { id: 'reach-day-2', progress: 0, done: false },
    ]);
    expect(m.cursor).toBe(6);
  });

  it('validates daily entries and keeps only the newest 60 dates', () => {
    const daily: Record<string, unknown> = {
      '2026-02-30': { tries: 1 },
      'yesterday': { tries: 1 },
      '2026-10-11': { tries: 9, bestMinutes: 1240, bestSnow: 30, glyphs: 'x' },
    };
    for (let i = 0; i < 70; i++) daily[addDays('2025-01-01', i)] = { tries: 1 };
    const s = migrate({ v: 1, daily }, NOW).save;
    const keys = Object.keys(s.daily).sort();
    expect(keys).toHaveLength(DAILY_KEEP);
    expect(keys.at(-1)).toBe('2026-10-11');
    expect(s.daily['2026-10-11']).toEqual({ tries: 3, bestMinutes: 1240, bestSnow: 30, glyphs: 'x' });
    expect(s.daily['2026-02-30']).toBeUndefined();
  });

  it('sanitizeSettings fills defaults for junk', () => {
    expect(sanitizeSettings('nope')).toEqual(defaults(NOW).settings);
  });
});

describe('storage adapter', () => {
  it('uses memory and reports degraded without a backing store', () => {
    const s = createStorage(null);
    expect(s.degraded).toBe(true);
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });

  it('is durable with a working backing store', () => {
    const backing = new FakeStorage();
    const s = createStorage(backing);
    expect(s.degraded).toBe(false);
    s.set('k', 'v');
    expect(backing.getItem('k')).toBe('v');
  });

  it('degrades when writes start failing but keeps the value in memory', () => {
    const backing = new FakeStorage();
    const s = createStorage(backing);
    backing.failAfter = backing.writes; // every further write throws
    s.set('k', 'v');
    expect(s.degraded).toBe(true);
    expect(s.get('k')).toBe('v');
  });

  it('degrades when the probe write throws (private mode)', () => {
    const backing = new FakeStorage();
    backing.failAfter = 0;
    expect(createStorage(backing).degraded).toBe(true);
  });
});

describe('SaveStore', () => {
  let storage: StorageAdapter;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = createStorage(new FakeStorage());
  });
  afterEach(() => vi.useRealTimers());

  it('starts fresh and debounces writes by 300 ms', () => {
    const store = new SaveStore(storage, { now: () => NOW });
    expect(store.status).toBe('fresh');
    store.update((s) => {
      s.stats.wallet = 50;
    });
    expect(storage.get(SAVE_KEY)).toBeNull();
    vi.advanceTimersByTime(299);
    expect(storage.get(SAVE_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(storage.get(SAVE_KEY) as string).stats.wallet).toBe(50);
  });

  it('flush writes immediately and notifies subscribers on change', () => {
    const store = new SaveStore(storage, { now: () => NOW });
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.stats.runs));
    const next = defaults(NOW);
    next.stats.runs = 4;
    store.set(next);
    store.flush();
    expect(JSON.parse(storage.get(SAVE_KEY) as string).stats.runs).toBe(4);
    expect(seen).toEqual([4]);
  });

  it('reloads what it wrote without touching the backup', () => {
    const first = new SaveStore(storage, { now: () => NOW });
    first.update((s) => {
      s.stats.runs = 2;
    });
    first.flush();
    const second = new SaveStore(storage, { now: () => NOW });
    expect(second.status).toBe('ok');
    expect(second.get().stats.runs).toBe(2);
    second.flush();
    expect(storage.get(SAVE_BAK_KEY)).toBeNull();
  });

  it('keeps the pre-migration raw value in .bak before writing a repaired save', () => {
    const raw = JSON.stringify({ v: 1, stats: { wallet: 9 } });
    storage.set(SAVE_KEY, raw);
    const store = new SaveStore(storage, { now: () => NOW });
    expect(store.get().stats.wallet).toBe(9);
    store.flush();
    expect(storage.get(SAVE_BAK_KEY)).toBe(raw);
    expect(JSON.parse(storage.get(SAVE_KEY) as string).missions.active).toHaveLength(3);
  });

  it('never overwrites a future-version save', () => {
    const raw = JSON.stringify({ v: 3, secret: true });
    storage.set(SAVE_KEY, raw);
    const store = new SaveStore(storage, { now: () => NOW });
    expect(store.status).toBe('future');
    expect(store.degraded).toBe(true);
    expect(storage.get(SAVE_FUTURE_KEY)).toBe(raw);
    store.update((s) => {
      s.stats.wallet = 1;
    });
    vi.advanceTimersByTime(1000);
    store.flush();
    expect(storage.get(SAVE_KEY)).toBe(raw);
  });

  it('recovers from .bak when the main save is corrupt', () => {
    const good = defaults(NOW);
    good.stats.wallet = 77;
    storage.set(SAVE_BAK_KEY, JSON.stringify(good));
    storage.set(SAVE_KEY, '{"v":1,"stats":');
    const store = new SaveStore(storage, { now: () => NOW });
    expect(store.status).toBe('recovered');
    expect(store.get().stats.wallet).toBe(77);
  });

  it('preserves unreadable bytes in .bak when nothing can be recovered', () => {
    storage.set(SAVE_KEY, 'garbage');
    const store = new SaveStore(storage, { now: () => NOW });
    expect(store.status).toBe('corrupt');
    expect(store.get()).toEqual(defaults(NOW));
    store.flush();
    expect(storage.get(SAVE_BAK_KEY)).toBe('garbage');
    expect(migrate(storage.get(SAVE_KEY), NOW).status).toBe('ok');
  });

  it('reports degraded storage', () => {
    const store = new SaveStore(createStorage(null), { now: () => NOW });
    expect(store.degraded).toBe(true);
  });
});
