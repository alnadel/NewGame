// Three-way merge of two saves that grew apart from a common ancestor (two tabs, or the Home Screen
// app next to its browser tab, each writing the one shared save). Used by SaveStore (save.ts); the
// result is validated by migrate() before it is used.
//
// A field one side left as it was in the ancestor takes the other side's value. A field both sides
// changed is combined by its meaning, so neither side's progress is lost:
// - counters (runs, Snow, wallet, swings, ...) add both sides' deltas: a + (l - a) + (r - a);
// - bests and maxima take the larger, flags that only turn on are OR-ed;
// - owned cosmetics and achievements keep everything either side added (and drop what one removed);
// - Daily tries and pars merge per date, the run history keeps both sides' new runs;
// - settings, outfit, the comfort rung and missions keep this instance's choice.
//
// Without a known common ancestor (the instances lost track of each other for longer than the
// stores remember), `base` is null and the saves are joined instead: the larger of each counter,
// everything either side owns, every run either side recorded. That never loses one side's
// progress to the other's, but runs both made meanwhile can count once.

import type { DailyEntry, RunRecord, Save, SaveStats, WeekState } from './saveTypes.ts';
import { DAILY_TRIES } from './daily.ts';

const ADDITIVE = [
  'runs',
  'lifetimeSnow',
  'wallet',
  'phews',
  'flakes',
  'daysSurvived',
  'dailyDaysPlayed',
  'cloudSeconds',
  'playSeconds',
  'swings',
  'sunnyWeeks',
] as const satisfies readonly (keyof SaveStats)[];

const MAXIMA = ['bestMinutes', 'easedBest', 'bestSnowRun', 'maxDay'] as const satisfies readonly (keyof SaveStats)[];

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The side that changed wins; when both changed, `both` decides, even when they ended on the same
 * value (two runs that each added 1 to `runs` must add 2).
 */
function three<T>(a: T, l: T, r: T, both: (l: T, r: T, a: T) => T): T {
  if (same(l, a)) return r;
  if (same(r, a)) return l;
  return both(l, r, a);
}

/** For `fields`: a key both sides changed keeps this instance's value. */
const keepLocal = <K, V>(_key: K, l: V): V => l;

/** Per-key three-way merge of a flat record. */
function fields<T extends object>(a: T, l: T, r: T, both: (key: keyof T, l: T[keyof T], r: T[keyof T], a: T[keyof T]) => T[keyof T]): T {
  const out = { ...l };
  for (const key of Object.keys(l) as (keyof T)[]) {
    out[key] = three(a[key], l[key], r[key], (x, y, z) => both(key, x, y, z));
  }
  return out;
}

/** What both kept, plus what either added (order: local's, then remote's additions). */
function setMerge(a: readonly string[], l: readonly string[], r: readonly string[]): string[] {
  const inA = new Set(a);
  const inL = new Set(l);
  const inR = new Set(r);
  return [...new Set([...l, ...r])].filter((x) => (inL.has(x) && inR.has(x)) || !inA.has(x));
}

/** Per-key merge of a date-keyed record; a key one side dropped (pruned, reset) stays dropped unless the other changed it. */
function mapMerge<V extends object | number>(a: Record<string, V>, l: Record<string, V>, r: Record<string, V>, both: (l: V, r: V, a: V | undefined) => V): Record<string, V> {
  const out: Record<string, V> = {};
  for (const key of new Set([...Object.keys(r), ...Object.keys(l)])) {
    const av = a[key];
    const lv = l[key];
    const rv = r[key];
    if (lv === undefined) {
      if (rv !== undefined && (av === undefined || !same(rv, av))) out[key] = rv;
    } else if (rv === undefined) {
      if (av === undefined || !same(lv, av)) out[key] = lv;
    } else if (av === undefined) {
      out[key] = both(lv, rv, undefined);
    } else {
      out[key] = three(av, lv, rv, (x, y) => both(x, y, av));
    }
  }
  return out;
}

function dailyBoth(l: DailyEntry, r: DailyEntry, a: DailyEntry | undefined): DailyEntry {
  return {
    tries: Math.min(DAILY_TRIES, Math.max(l.tries, r.tries, l.tries + r.tries - (a?.tries ?? 0))),
    bestMinutes: Math.max(l.bestMinutes, r.bestMinutes),
    bestSnow: Math.max(l.bestSnow, r.bestSnow),
    glyphs: r.bestMinutes > l.bestMinutes ? r.glyphs : l.glyphs,
  };
}

const runKey = (e: RunRecord): string => `${e.d}|${e.m}|${e.s}|${e.r}`;

/** The entries of `list` the ancestor doesn't account for (as a multiset), in order. */
function added(a: readonly RunRecord[], list: readonly RunRecord[]): RunRecord[] {
  const left = new Map<string, number>();
  for (const e of a) left.set(runKey(e), (left.get(runKey(e)) ?? 0) + 1);
  const out: RunRecord[] = [];
  for (const e of list) {
    const n = left.get(runKey(e)) ?? 0;
    if (n > 0) left.set(runKey(e), n - 1);
    else out.push(e);
  }
  return out;
}

/** Every run either side holds (as a multiset: the larger count of each), by date. */
function historyJoin(l: RunRecord[], r: RunRecord[]): RunRecord[] {
  const out = [...l, ...added(l, r)];
  out.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  return out;
}

/** Ancestor runs both sides still hold, then both sides' new runs by date; capped by validation. */
function historyMerge(a: RunRecord[], l: RunRecord[], r: RunRecord[]): RunRecord[] {
  const inL = new Map<string, number>();
  const inR = new Map<string, number>();
  for (const e of l) inL.set(runKey(e), (inL.get(runKey(e)) ?? 0) + 1);
  for (const e of r) inR.set(runKey(e), (inR.get(runKey(e)) ?? 0) + 1);
  const kept: RunRecord[] = [];
  for (const e of a) {
    const k = runKey(e);
    const nl = inL.get(k) ?? 0;
    const nr = inR.get(k) ?? 0;
    if (nl > 0 && nr > 0) {
      kept.push(e);
      inL.set(k, nl - 1);
      inR.set(k, nr - 1);
    }
  }
  const fresh = [...added(a, l), ...added(a, r)];
  // Stable: same-date runs keep local-then-remote order.
  fresh.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  return [...kept, ...fresh];
}

function weekBoth(l: WeekState, r: WeekState): WeekState {
  if (l.start !== r.start) return l.start > r.start ? l : r;
  return { start: l.start, days: l.days | r.days, paid: l.paid | r.paid, best: l.best.map((b, i) => Math.max(b, r.best[i] ?? 0)) };
}

function joinSaves(local: Save, remote: Save): Save {
  const stats = { ...local.stats };
  for (const key of [...ADDITIVE, ...MAXIMA]) stats[key] = Math.max(local.stats[key], remote.stats[key]);
  stats.reachedNight ||= remote.stats.reachedNight;
  stats.forecastNoons |= remote.stats.forecastNoons;
  const flags = { ...local.flags };
  for (const key of Object.keys(flags) as (keyof Save['flags'])[]) {
    const l = local.flags[key];
    const r = remote.flags[key];
    (flags as Record<string, boolean | number>)[key] = typeof l === 'boolean' ? l || (r as boolean) : Math.max(l, r as number);
  }
  const none = {} as Record<string, never>;
  return {
    ...local,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    stats,
    unlocks: {
      cosmetics: setMerge([], local.unlocks.cosmetics, remote.unlocks.cosmetics),
      achievements: setMerge([], local.unlocks.achievements, remote.unlocks.achievements),
    },
    daily: mapMerge(none, local.daily, remote.daily, (l, r) => ({ ...dailyBoth(l, r, l), tries: Math.max(l.tries, r.tries) })),
    pars: mapMerge(none, local.pars, remote.pars, (l, r) => Math.max(l, r)),
    history: historyJoin(local.history, remote.history),
    week: weekBoth(local.week, remote.week),
    lastPlay: local.lastPlay > remote.lastPlay ? local.lastPlay : remote.lastPlay,
    flags,
  };
}

/**
 * Merges `local` (this instance's save) and `remote` (another instance's) given `base`, the newest
 * save both are known to include, or joins them when no such save is known (null). Pure: the inputs
 * are not modified (the result may share their sub-objects; validate it with migrate() before use).
 */
export function mergeSaves(base: Save | null, local: Save, remote: Save): Save {
  if (base === null) return joinSaves(local, remote);
  return {
    v: 2,
    createdAt: three(base.createdAt, local.createdAt, remote.createdAt, (l, r) => Math.min(l, r)),
    settings: fields(base.settings, local.settings, remote.settings, keepLocal),
    stats: fields(base.stats, local.stats, remote.stats, (key, l, r, a) => {
      if ((ADDITIVE as readonly string[]).includes(key)) return Math.max(0, (l as number) + (r as number) - (a as number));
      if ((MAXIMA as readonly string[]).includes(key)) return Math.max(l as number, r as number);
      if (key === 'reachedNight') return (l as boolean) || (r as boolean);
      if (key === 'forecastNoons') return (l as number) | (r as number);
      return l;
    }),
    unlocks: {
      cosmetics: setMerge(base.unlocks.cosmetics, local.unlocks.cosmetics, remote.unlocks.cosmetics),
      achievements: setMerge(base.unlocks.achievements, local.unlocks.achievements, remote.unlocks.achievements),
    },
    equipped: fields(base.equipped, local.equipped, remote.equipped, keepLocal),
    missions: three(base.missions, local.missions, remote.missions, (l) => l),
    daily: mapMerge(base.daily, local.daily, remote.daily, dailyBoth),
    pars: mapMerge(base.pars, local.pars, remote.pars, (l, r) => Math.max(l, r)),
    history: three(base.history, local.history, remote.history, (l, r, a) => historyMerge(a, l, r)),
    week: three(base.week, local.week, remote.week, weekBoth),
    lastPlay: three(base.lastPlay, local.lastPlay, remote.lastPlay, (l, r) => (l > r ? l : r)),
    flags: fields(base.flags, local.flags, remote.flags, (key, l, r) =>
      typeof l === 'boolean' ? ((l || r) as typeof l) : key === 'hintsShown' ? (Math.max(l as number, r as number) as typeof l) : l,
    ),
  };
}
