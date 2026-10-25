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
  type SaveChangeSource,
} from '../../src/meta/save.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import { mergeSaves } from '../../src/meta/saveMerge.ts';
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
    expect(s.v).toBe(4);
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
      name: '',
      comfort: true,
      unlockAll: false,
      aim: 'standard',
      swingBoost: false,
      hand: 'right',
      autoAct: false,
    });
    expect(s.campaign).toEqual({ stars: Array(200).fill(0), unlocked: 1, lastLevel: 0 });
    expect(s.stats.runs).toBe(0);
    expect(s.stats.wallet).toBe(0);
    expect(s.stats).toMatchObject({ comfort: 0, playSeconds: 0, swings: 0, sunnyWeeks: 0, forecastNoons: 0 });
    expect(s.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-none', nose: 'nose-carrot', shades: 'shades-classic' });
    expect(s.unlocks.cosmetics).toEqual(['scarf-red', 'hat-none', 'nose-carrot', 'shades-classic']);
    expect(s.missions.active.map((m) => m.id)).toEqual(['reach-9am', 'flakes-10', 'survive-noon']);
    expect(s.missions.deferred).toEqual([]);
    expect(s.missions.errand).toEqual({ date: '', id: '', progress: 0, done: false });
    expect(s.history).toEqual([]);
    expect(s.pars).toEqual({});
    expect(s.week).toEqual({ start: '', days: 0, paid: 0, best: [0, 0, 0, 0, 0, 0, 0] });
    expect(s.lastPlay).toBe('');
    expect(s.flags.missionsV2).toBe(true);
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
    const r = migrate('{"v":5,"stats":{"wallet":999}}', NOW);
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
    // Saves from before the first-lesson flag still offer the lesson.
    expect(s.flags.tutorialDone).toBe(false);
    expect(migrate({ v: 1, flags: { tutorialDone: true } }, NOW).save.flags.tutorialDone).toBe(true);
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
    expect(s.unlocks.cosmetics).toEqual(['scarf-red', 'scarf-mint', 'hat-none', 'hat-crown', 'nose-carrot', 'shades-classic']);
    expect(s.unlocks.achievements).toEqual(['solstice']);
    // Plaid is not owned and a scarf can't be a nose; a v1 save gets the default shades.
    expect(s.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-crown', nose: 'nose-carrot', shades: 'shades-classic' });
    // Shades must be owned shades.
    for (const shades of ['shades-heart', 'scarf-mint', 7]) {
      expect(migrate({ v: 2, unlocks: { cosmetics: ['scarf-mint'] }, equipped: { shades } }, NOW).save.equipped.shades).toBe('shades-classic');
    }
    expect(migrate({ v: 2, unlocks: { cosmetics: ['shades-round'] }, equipped: { shades: 'shades-round' } }, NOW).save.equipped.shades).toBe('shades-round');
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
    // The gap is filled past the skill gates: Reach Day 2 (gate 390) waits in the deferred queue.
    expect(m.active).toEqual([
      { id: 'two-phews', progress: 1, done: false, stale: 0 },
      { id: 'flakes-10@2', progress: 0, done: true, stale: 0 },
      { id: 'ice-crystal', progress: 0, done: false, stale: 0 },
    ]);
    expect(m.deferred).toEqual(['reach-day-2']);
    expect(m.cursor).toBe(7);
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

  it('converts old "Hold ×5 for 8 s" progress (seconds) once, to the ×4 goal\'s unit', () => {
    const old = {
      v: 1,
      missions: {
        cursor: 9,
        tier: 1,
        active: [
          { id: 'hold-x5', progress: 3.4, done: false },
          { id: 'hold-x5@2', progress: 0.5, done: false },
          { id: 'flakes-10', progress: 7, done: false },
        ],
      },
    };
    const m = migrate(old, NOW).save;
    expect(m.missions.active).toEqual([
      { id: 'hold-x5', progress: 5, done: false, stale: 0 },
      { id: 'hold-x5@2', progress: 5, done: false, stale: 0 },
      { id: 'flakes-10', progress: 7, done: false, stale: 0 },
    ]);
    expect(m.flags.missionsV2).toBe(true);
    // Zero stays zero, done slots are left alone.
    const zero = migrate({ v: 1, missions: { active: [{ id: 'hold-x5', progress: 0 }, { id: 'hold-x5@3', progress: 12, done: true }] } }, NOW).save;
    expect(zero.missions.active.slice(0, 2)).toEqual([
      { id: 'hold-x5', progress: 0, done: false, stale: 0 },
      { id: 'hold-x5@3', progress: 12, done: true, stale: 0 },
    ]);
    // A save already in the new unit (best multiplier ×3) is never bumped, however often it loads.
    const fresh = defaults(NOW);
    fresh.missions.active[0] = { id: 'hold-x5', progress: 3, done: false, stale: 2 };
    let raw = JSON.stringify(fresh);
    for (let i = 0; i < 3; i++) {
      const again = migrate(raw, NOW);
      expect(again.save.missions.active[0]).toEqual({ id: 'hold-x5', progress: 3, done: false, stale: 2 });
      raw = JSON.stringify(again.save);
    }
  });

  it('migrates a v1 save with 10 runs and a Daily mission to v2', () => {
    const v1 = {
      v: 1,
      createdAt: 5,
      settings: { music: 0.3 },
      stats: { runs: 10, bestMinutes: 1300, bestSnowRun: 140, wallet: 77 },
      unlocks: { cosmetics: ['scarf-mint'], achievements: ['night-owl'] },
      equipped: { scarf: 'scarf-mint', hat: 'hat-none', nose: 'nose-carrot' },
      missions: {
        cursor: 2,
        tier: 2,
        active: [
          { id: 'play-daily', progress: 0, done: false },
          { id: 'mult-3@2', progress: 4, done: false },
          { id: 'flakes-10@2', progress: 12, done: false },
        ],
      },
      flags: { tutorialDone: true, missionsV2: true },
    };
    const r = migrate(JSON.stringify(v1), NOW);
    expect(r.status).toBe('ok');
    const s = r.save;
    expect(s.v).toBe(4);
    // A2: lifetime runs 10 → the standard rung.
    expect(s.stats.comfort).toBe(4);
    expect(s.settings).toMatchObject({ music: 0.3, name: '', comfort: true, unlockAll: false });
    // v2 → v3: a fresh Journey.
    expect(s.campaign).toEqual({ stars: Array(200).fill(0), unlocked: 1, lastLevel: 0 });
    expect(s.equipped).toEqual({ scarf: 'scarf-mint', hat: 'hat-none', nose: 'nose-carrot', shades: 'shades-classic' });
    // play-daily (now an errand) is replaced; the other slots keep their progress.
    expect(s.missions.active.map((m) => m.id)).toEqual(['mult-3@2', 'flakes-10@2', 'survive-noon@2']);
    expect(s.missions.active.every((m) => m.stale === 0)).toBe(true);
    expect(s.history).toEqual([]);
    expect(s.lastPlay).toBe('');
    expect(s.stats).toMatchObject({ bestMinutes: 1300, bestSnowRun: 140, wallet: 77, playSeconds: 0, swings: 0 });
    // The comfort map over lifetime runs.
    expect([0, 1, 2, 3, 4, 5, 9].map((runs) => migrate({ v: 1, stats: { runs } }, NOW).save.stats.comfort)).toEqual([0, 1, 1, 2, 3, 4, 4]);
  });

  it('migrates a v2 save to v3 with a fresh Journey and the testing toggle off', () => {
    const v2 = { v: 2, createdAt: 5, settings: { comfort: false, unlockAll: true }, stats: { runs: 7, comfort: 3, wallet: 12 }, campaign: { stars: [3, 3], unlocked: 9 } };
    const r = migrate(JSON.stringify(v2), NOW);
    expect(r.status).toBe('ok');
    expect(r.save.v).toBe(4);
    expect(r.save.stats).toMatchObject({ runs: 7, comfort: 3, wallet: 12 });
    expect(r.save.settings).toMatchObject({ comfort: false, unlockAll: false });
    expect(r.save.campaign).toEqual({ stars: Array(200).fill(0), unlocked: 1, lastLevel: 0 });
    // v1 → v2 → v3 chains.
    const fromV1 = migrate({ v: 1, stats: { runs: 10 } }, NOW).save;
    expect(fromV1.v).toBe(4);
    expect(fromV1.stats.comfort).toBe(4);
    expect(fromV1.campaign.unlocked).toBe(1);
  });

  it('clamps and repairs the Journey: stars 0..3, the unlocked level past every passed level', () => {
    const stars = Array(200).fill(0);
    stars[0] = 3;
    stars[1] = 2;
    stars[2] = 1;
    const ok = migrate({ v: 3, campaign: { stars, unlocked: 4, lastLevel: 3 }, settings: { unlockAll: true } }, NOW).save;
    expect(ok.campaign).toEqual({ stars, unlocked: 4, lastLevel: 3 });
    expect(ok.settings.unlockAll).toBe(true);
    const bad = migrate({ v: 3, campaign: { stars: [9, -1, 'x', 2.7], unlocked: 0, lastLevel: 999 } }, NOW).save.campaign;
    expect(bad.stars).toHaveLength(200);
    expect(bad.stars.slice(0, 5)).toEqual([3, 0, 0, 2, 0]);
    // Level 4 is passed, so Level 5 is playable whatever `unlocked` said.
    expect(bad.unlocked).toBe(5);
    expect(bad.lastLevel).toBe(200);
    expect(migrate({ v: 3, campaign: { stars: Array(200).fill(1), unlocked: 1 } }, NOW).save.campaign.unlocked).toBe(201);
    expect(migrate({ v: 3, campaign: { unlocked: 700 } }, NOW).save.campaign.unlocked).toBe(201);
    expect(migrate({ v: 3, campaign: 'nope' }, NOW).save.campaign).toEqual({ stars: Array(200).fill(0), unlocked: 1, lastLevel: 0 });
  });

  it('keeps Elementals v2 only when the save has them: 7 Trials of 0..3 stars and a seen mark', () => {
    // defaults() has none, and migrate keeps it that way (deep-equal).
    expect('elementals2' in defaults(NOW)).toBe(false);
    expect(migrate(JSON.stringify(defaults(NOW)), NOW).save).toEqual(defaults(NOW));
    expect(migrate(defaults(NOW), NOW).save).toEqual(defaults(NOW));
    expect('elementals2' in migrate({ v: 4, stats: { runs: 3 } }, NOW).save).toBe(false);
    const ok = migrate({ v: 4, elementals2: { stars: [3, 2, 1, 0, 0, 0, 1], seen: true } }, NOW).save;
    expect(ok.elementals2).toEqual({ stars: [3, 2, 1, 0, 0, 0, 1], seen: true });
    // Clamped to 7 entries of 0..3 and a boolean.
    const bad = migrate({ v: 4, elementals2: { stars: [9, -1, 'x', 2.7, 1, 1, 1, 1, 3, 3], seen: 'yes' } }, NOW).save;
    expect(bad.elementals2).toEqual({ stars: [3, 0, 0, 2, 1, 1, 1], seen: false });
    expect(migrate({ v: 4, elementals2: {} }, NOW).save.elementals2).toEqual({ stars: Array(7).fill(0), seen: false });
    // Not an object: dropped.
    expect('elementals2' in migrate({ v: 4, elementals2: 'nope' }, NOW).save).toBe(false);
    // The Journey never sees a Trial.
    expect(ok.campaign).toEqual(defaults(NOW).campaign);
    // A v3 save with progress upgrades with the Title pill seen (its first visit marks nothing new).
    expect(migrate({ v: 3, stats: { runs: 4 } }, NOW).save.elementals2).toEqual({ stars: Array(7).fill(0), seen: true });
    expect('elementals2' in migrate({ v: 3 }, NOW).save).toBe(false);
  });

  it("drops v1's `elementals` (its Trials were replaced) and never emits it", () => {
    const v1 = migrate({ v: 4, stats: { runs: 5 }, elementals: { stars: [3, 3, 3, 3, 3, 3, 3, 3], seen: true } }, NOW).save;
    expect('elementals' in v1).toBe(false);
    expect('elementals2' in v1).toBe(false);
    expect(v1.stats.runs).toBe(5);
    // Next to a v2 field, only the v2 field is kept.
    const both = migrate({ v: 4, elementals: { stars: [3, 3, 3, 3, 3, 3, 3, 3], seen: true }, elementals2: { stars: [1, 0, 0, 0, 0, 0, 0], seen: false } }, NOW).save;
    expect(both.elementals2).toEqual({ stars: [1, 0, 0, 0, 0, 0, 0], seen: false });
    expect(JSON.stringify(both)).not.toContain('"elementals"');
  });

  it('round-trips a rich v3 save unchanged', () => {
    const s = defaults(NOW);
    s.settings.name = 'Zoë';
    s.settings.comfort = false;
    s.stats = { ...s.stats, runs: 12, comfort: 3, playSeconds: 812.5, swings: 40, sunnyWeeks: 2, forecastNoons: 0b0011110 };
    s.equipped.shades = 'shades-round';
    s.unlocks.cosmetics.push('shades-round');
    s.missions.deferred = ['reach-day-3', 'gate-arch@2'];
    s.missions.active[1] = { ...(s.missions.active[1] as Save['missions']['active'][number]), stale: 6, progress: 3 };
    s.history = [
      { m: 400, s: 20, r: 2, d: '2026-10-11' },
      { m: 900, s: 61, r: 4, d: '2026-10-12' },
    ];
    s.pars = { '2026-10-12': 410 };
    s.week = { start: '2026-10-12', days: 0b11, paid: 0, best: [2, 1, 0, 0, 0, 0, 0] };
    s.lastPlay = '2026-10-12';
    const r = migrate(JSON.stringify(s), NOW);
    expect(r.status).toBe('ok');
    expect(r.save).toEqual(s);
  });

  it('repairs garbage in every v2 field', () => {
    const history = [
      { m: 400, s: 20, r: 2, d: '2026-10-11' },
      { m: -5, s: 1e12, r: 9, d: '2026-10-12' },
      { m: 1, s: 1, r: 1, d: 'Tuesday' },
      'junk',
      ...Array.from({ length: 40 }, (_, i) => ({ m: i, s: 0, r: 4, d: '2026-10-12' })),
    ];
    const pars: Record<string, unknown> = { nope: 3, '2026-02-30': 4, '2026-10-12': 'x', '2026-10-11': 333.7 };
    for (let i = 0; i < 20; i++) pars[addDays('2026-01-01', i)] = 100 + i;
    const s = migrate(
      {
        v: 2,
        settings: { name: '<b>Eve</b>', comfort: 'yes' },
        stats: { runs: 4, comfort: 99, playSeconds: -3, swings: 'x', sunnyWeeks: 1.5, forecastNoons: 999 },
        missions: {
          active: [{ id: 'flakes-10', progress: 3, done: false, stale: -2 }],
          deferred: ['nope', 'flakes-10', 'reach-day-3', 'reach-day-3@2', 7],
          errand: { date: '2026-10-12', id: 'e-moon', progress: 3, done: false },
        },
        history,
        pars,
        week: { start: '2026-10-12', days: 500, paid: -1, best: [1, 'x', 300] },
        lastPlay: 'yesterday',
      },
      NOW,
    ).save;
    expect(s.settings.name).toBe('');
    expect(s.settings.comfort).toBe(true);
    expect(s.stats).toMatchObject({ comfort: 4, playSeconds: 0, swings: 0, sunnyWeeks: 1, forecastNoons: 127 });
    expect(s.missions.active[0]).toEqual({ id: 'flakes-10', progress: 3, done: false, stale: 0 });
    // Unknown ids, the active mission and a second tier of a queued mission are dropped.
    expect(s.missions.deferred).toEqual(['reach-day-3']);
    expect(s.missions.errand).toEqual({ date: '', id: '', progress: 0, done: false });
    expect(s.history).toHaveLength(30);
    expect(s.history.every((e) => e.d === '2026-10-12' && e.r >= 0 && e.r <= 4)).toBe(true);
    expect(Object.keys(s.pars)).toHaveLength(14);
    expect(s.pars['2026-10-11']).toBe(333);
    expect(s.pars['2026-10-12']).toBeUndefined();
    expect(s.week).toEqual({ start: '2026-10-12', days: 127, paid: 0, best: [1, 0, 99, 0, 0, 0, 0] });
    expect(s.lastPlay).toBe('');
    expect(migrate({ v: 2, week: { start: 'soon' } }, NOW).save.week.start).toBe('');
    expect(migrate({ v: 2, settings: { name: '  Sam  ' } }, NOW).save.settings.name).toBe('Sam');
  });

  it('derives the side keys from the main key', () => {
    expect(SAVE_BAK_KEY).toBe(`${SAVE_KEY}.bak`);
    expect(SAVE_FUTURE_KEY).toBe(`${SAVE_KEY}.future`);
  });

  it('sanitizeSettings fills defaults for junk', () => {
    expect(sanitizeSettings('nope')).toEqual(defaults(NOW).settings);
  });

  it('sanitizeSettings keeps the Controls v3 fields it knows (docs/CONTROLS_V3.md §8.1) and defaults the rest', () => {
    expect(sanitizeSettings({ aim: 'light', swingBoost: true, hand: 'left', autoAct: true })).toMatchObject({ aim: 'light', swingBoost: true, hand: 'left', autoAct: true });
    expect(sanitizeSettings({ aim: 'max', swingBoost: 1, hand: 'up', autoAct: 'yes' })).toMatchObject({ aim: 'standard', swingBoost: false, hand: 'right', autoAct: false });
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

  it('retries the backing store on every write: degraded follows the latest write', () => {
    const backing = new FakeStorage();
    const s = createStorage(backing);
    backing.failAfter = backing.writes;
    s.set('k', 'memory only');
    expect(s.degraded).toBe(true);
    // The newer value lives in memory: reads must not fall back to the stale backing copy.
    backing.map.set('k', 'stale');
    expect(s.get('k')).toBe('memory only');
    backing.failAfter = Infinity;
    s.set('k', 'durable');
    expect(s.degraded).toBe(false);
    expect(backing.getItem('k')).toBe('durable');
  });

  it('reads the backing store first, so other instances\' writes are seen', () => {
    const backing = new FakeStorage();
    const s = createStorage(backing);
    s.set('k', 'mine');
    backing.map.set('k', 'theirs');
    expect(s.get('k')).toBe('theirs');
    // Falls back to memory when the backing store has nothing or throws.
    backing.map.delete('k');
    expect(s.get('k')).toBe('mine');
    backing.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(s.get('k')).toBe('mine');
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
    const raw = JSON.stringify({ v: 5, secret: true });
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

  it('cannot persist over a newer version\'s save', () => {
    storage.set(SAVE_KEY, JSON.stringify({ v: 5, stats: { runs: 40 } }));
    const store = new SaveStore(storage, { now: () => NOW, changes: null });
    expect(store.canPersist).toBe(false);
    expect(new SaveStore(createStorage(new FakeStorage()), { now: () => NOW, changes: null }).canPersist).toBe(true);
  });

  it('fires onDegraded once on the first failed write, and later writes still land', () => {
    const backing = new FakeStorage();
    const s = createStorage(backing);
    const store = new SaveStore(s, { now: () => NOW, changes: null });
    let fired = 0;
    store.onDegraded(() => fired++);
    store.update((d) => {
      d.stats.wallet = 1;
    });
    store.flush();
    expect(fired).toBe(0);
    // One write throws (quota), then storage recovers.
    const realSet = backing.setItem.bind(backing);
    let throwOnce = true;
    backing.setItem = (k: string, v: string) => {
      if (throwOnce) {
        throwOnce = false;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      realSet(k, v);
    };
    store.update((d) => {
      d.stats.wallet = 2;
    });
    store.flush();
    expect(fired).toBe(1);
    expect(store.degraded).toBe(true);
    expect(JSON.parse(backing.getItem(SAVE_KEY) as string).stats.wallet).toBe(1);
    store.update((d) => {
      d.stats.wallet = 3;
    });
    store.flush();
    expect(store.degraded).toBe(false);
    expect(JSON.parse(backing.getItem(SAVE_KEY) as string).stats.wallet).toBe(3);
    // A later failure doesn't fire again.
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    store.update((d) => {
      d.stats.wallet = 4;
    });
    store.flush();
    expect(fired).toBe(1);
  });
});

/** A change source the test drives by hand: storage events and visibility. */
class FakeChanges implements SaveChangeSource {
  storageCbs: ((key: string | null, value: string | null) => void)[] = [];
  visibleCbs: (() => void)[] = [];
  onStorage(cb: (key: string | null, value: string | null) => void): () => void {
    this.storageCbs.push(cb);
    return () => (this.storageCbs = this.storageCbs.filter((c) => c !== cb));
  }
  onVisible(cb: () => void): () => void {
    this.visibleCbs.push(cb);
    return () => (this.visibleCbs = this.visibleCbs.filter((c) => c !== cb));
  }
  storage(key: string | null, value: string | null): void {
    for (const cb of this.storageCbs) cb(key, value);
  }
  visible(): void {
    for (const cb of this.visibleCbs) cb();
  }
}

describe('SaveStore across instances (tabs, the installed app)', () => {
  let backing: FakeStorage;
  let changes: FakeChanges;
  beforeEach(() => {
    vi.useFakeTimers();
    backing = new FakeStorage();
    changes = new FakeChanges();
  });
  afterEach(() => vi.useRealTimers());

  /** What another instance would write: this one's save after a run, a purchase and a Daily try. */
  function otherInstanceSave(base: Save): Save {
    const o = structuredClone(base);
    o.stats.runs = 9;
    o.stats.wallet = 321;
    o.unlocks.cosmetics = ['scarf-red', 'scarf-mint', 'hat-none', 'hat-beanie', 'nose-carrot'];
    o.equipped.hat = 'hat-beanie';
    o.daily['2026-10-11'] = { tries: 2, bestMinutes: 700, bestSnow: 30, glyphs: 'x' };
    return o;
  }

  it('adopts a save written by another instance (storage event) without writing it back', () => {
    const store = new SaveStore(createStorage(backing), { now: () => NOW, changes });
    const seen: Save[] = [];
    store.onExternalChange((sv) => seen.push(sv));
    const writesBefore = backing.writes;
    const remote = JSON.stringify(otherInstanceSave(store.get()));
    backing.map.set(SAVE_KEY, remote);
    changes.storage(SAVE_KEY, remote);
    const got = store.get();
    expect(got.stats.runs).toBe(9);
    expect(got.stats.wallet).toBe(321);
    expect(got.unlocks.cosmetics).toContain('hat-beanie');
    expect(got.equipped.hat).toBe('hat-beanie');
    expect(got.daily['2026-10-11']?.tries).toBe(2);
    expect(seen).toHaveLength(1);
    // No echo: nothing written now, nor after the debounce.
    vi.advanceTimersByTime(1000);
    store.flush();
    expect(backing.writes).toBe(writesBefore);
    expect(backing.getItem(SAVE_KEY)).toBe(remote);
    // Other keys, removals and the same bytes again are ignored.
    changes.storage('other', remote);
    changes.storage(SAVE_KEY, null);
    changes.storage(SAVE_KEY, remote);
    expect(seen).toHaveLength(1);
  });

  it('keeps a pending local change (settings, a purchase) and the other instance\'s progress, then writes the merge', () => {
    const store = new SaveStore(createStorage(backing), { now: () => NOW, changes });
    const remoteSave = otherInstanceSave(store.get());
    remoteSave.settings.music = 0.9;
    store.update((d) => {
      d.settings.music = 0.1;
      d.settings.invert = true;
      d.unlocks.cosmetics.push('nose-cane');
      d.equipped.nose = 'nose-cane';
    });
    const remote = JSON.stringify(remoteSave);
    backing.map.set(SAVE_KEY, remote);
    changes.storage(SAVE_KEY, remote);
    const got = store.get();
    // Both changed the music volume: this instance's choice stays.
    expect(got.settings.music).toBe(0.1);
    expect(got.settings.invert).toBe(true);
    expect(got.stats.runs).toBe(9);
    expect(got.stats.wallet).toBe(321);
    // Each side's new cosmetics and outfit choices survive.
    expect(got.unlocks.cosmetics).toEqual(expect.arrayContaining(['hat-beanie', 'nose-cane']));
    expect(got.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-beanie', nose: 'nose-cane', shades: 'shades-classic' });
    const written = JSON.parse(backing.getItem(SAVE_KEY) as string) as Save;
    expect(written.settings.music).toBe(0.1);
    expect(written.stats.runs).toBe(9);
    expect(written.unlocks.cosmetics).toContain('nose-cane');
  });

  it('re-reads on becoming visible and adopts bytes changed meanwhile', () => {
    const store = new SaveStore(createStorage(backing), { now: () => NOW, changes });
    let fired = 0;
    store.onExternalChange(() => fired++);
    changes.visible();
    expect(fired).toBe(0);
    backing.map.set(SAVE_KEY, JSON.stringify(otherInstanceSave(store.get())));
    changes.visible();
    expect(fired).toBe(1);
    expect(store.get().stats.wallet).toBe(321);
    changes.visible();
    expect(fired).toBe(1);
  });

  it('ignores a newer version\'s save and garbage from other instances', () => {
    const store = new SaveStore(createStorage(backing), { now: () => NOW, changes });
    let fired = 0;
    store.onExternalChange(() => fired++);
    changes.storage(SAVE_KEY, JSON.stringify({ v: 5, stats: { runs: 99 } }));
    changes.storage(SAVE_KEY, '{nope');
    expect(fired).toBe(0);
    expect(store.get().stats.runs).toBe(0);
  });

  it('stops listening after dispose', () => {
    const store = new SaveStore(createStorage(backing), { now: () => NOW, changes });
    store.dispose();
    expect(changes.storageCbs).toHaveLength(0);
    expect(changes.visibleCbs).toHaveLength(0);
  });
});

describe('Journey progress across instances', () => {
  it('merges stars per level (the larger) and the unlocked level (the higher)', () => {
    const base = defaults(NOW);
    const local = structuredClone(base);
    local.campaign.stars[0] = 3;
    local.campaign.stars[1] = 1;
    local.campaign.unlocked = 3;
    local.campaign.lastLevel = 2;
    const remote = structuredClone(base);
    remote.campaign.stars[0] = 1;
    remote.campaign.stars[1] = 2;
    remote.campaign.stars[2] = 2;
    remote.campaign.unlocked = 4;
    remote.campaign.lastLevel = 3;
    const m = migrate(mergeSaves(base, local, remote), NOW).save;
    expect(m.campaign.stars.slice(0, 4)).toEqual([3, 2, 2, 0]);
    expect(m.campaign.unlocked).toBe(4);
    expect(m.campaign.lastLevel).toBe(2);
    // One side untouched: the other's progress is adopted as it is.
    expect(migrate(mergeSaves(base, base, remote), NOW).save.campaign).toEqual(remote.campaign);
    // No common ancestor: joined the same way.
    const j = migrate(mergeSaves(null, local, remote), NOW).save;
    expect(j.campaign.stars.slice(0, 4)).toEqual([3, 2, 2, 0]);
    expect(j.campaign.unlocked).toBe(4);
  });
});
