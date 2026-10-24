// Debug and test URL parameters (V1_PLAN §14, archive/TECH_SPEC §17).

import {
  BOT_KINDS,
  COMFORT_MAX,
  dayLength,
  FORECAST_IDS,
  TRIAL_BASE,
  TRIAL_COUNT,
  V16_RULES,
  type BotKind,
  type ForecastId,
  type ProfileId,
  type V16Rules,
} from '../core/index.ts';
import { addDays, DAILY_EPOCH, isDateString, localDate } from '../meta/daily.ts';

export interface Params {
  seed: number | null;
  daily: boolean;
  date: string | null;
  day: number | null;
  /** Raw t= value: dawn | noon | dusk | HH:MM. */
  t: string | null;
  chill: number | null;
  profile: ProfileId | null;
  bot: BotKind | null;
  fast: number;
  guide: 'always' | 'off' | null;
  debug: boolean;
  mute: boolean;
  reset: boolean;
  test: boolean;
  /** Perf governor enabled (default on; ?perf=0 disables it for captures). */
  perf: boolean;
  /** Forces this forecast on every biome-eligible day (cfg.forecast; the Day Plan turns on). */
  forecast: ForecastId | null;
  /** Forces this comfort rung (0..COMFORT_MAX) for endless runs. */
  rung: number | null;
  /** Forces the Day Plan on or off (cfg.plan, A1); baselines pin ?plan=0. */
  plan: boolean | null;
  /**
   * Opens this campaign level (1..200) directly: a normal campaign run unless other debug params are
   * present. Elementals: ?trial=1..7 opens Trial n as level 1000 + n (it wins over ?level=).
   */
  level: number | null;
  /**
   * Elementals v2 (docs/ELEMENTALS_V2.md §7.1): ?elfix=1 puts a Trial's objects into every kind and
   * state (core elFixture) for art review; builds with bots only (the session's makeBot gate).
   */
  elfix: boolean;
  /** v1.6 rules switched by ?on=bank,… and ?off=flares,… (cfg.v16, over the shipped V16_SHIP); null when neither. */
  rules: Partial<V16Rules> | null;
}

/**
 * A Daily date is playable from the epoch to tomorrow (a friend's "today" may already be our
 * tomorrow). ISO dates compare as strings. Used for ?mode=daily&date= and for k:'d' challenges.
 */
export function dailyDateInBounds(date: string, today: string = localDate()): boolean {
  return isDateString(date) && date >= DAILY_EPOCH && date <= addDays(today, 1);
}

export function parseParams(search: string, today: string = localDate()): Params {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const seed = num('seed');
  const day = num('day');
  const profile = num('profile');
  const bot = q.get('bot');
  const guide = q.get('guide');
  const date = q.get('date');
  const fast = num('fast');
  const chill = num('chill');
  const rung = num('rung');
  const forecast = q.get('forecast');
  const plan = q.get('plan');
  const level = num('level');
  const trial = num('trial');
  const tn = trial !== null && trial >= 1 && trial <= TRIAL_COUNT ? TRIAL_BASE + Math.floor(trial) : null;
  let rules: { -readonly [K in keyof V16Rules]?: boolean } | null = null;
  for (const [k, v] of [['on', true], ['off', false]] as const) {
    for (const r of (q.get(k) ?? '').split(',')) if ((V16_RULES as readonly string[]).includes(r)) (rules ??= {})[r as keyof V16Rules] = v;
  }
  return {
    seed: seed === null ? null : Math.floor(Math.abs(seed)) >>> 0,
    daily: q.get('mode') === 'daily',
    date: date && dailyDateInBounds(date, today) ? date : null,
    day: day === null ? null : Math.max(1, Math.min(60, Math.floor(day))),
    t: q.get('t'),
    chill: chill === null ? null : Math.max(1, Math.min(100, chill)),
    profile: profile !== null && profile >= 0 && profile <= 3 ? (Math.floor(profile) as ProfileId) : null,
    bot: bot && (BOT_KINDS as readonly string[]).includes(bot) ? (bot as BotKind) : null,
    fast: fast === null ? 1 : Math.max(1, Math.min(16, Math.floor(fast))),
    guide: guide === 'always' || guide === 'off' ? guide : null,
    debug: q.get('debug') === '1',
    mute: q.get('mute') === '1',
    reset: q.get('reset') === '1',
    test: q.get('test') === '1',
    perf: q.get('perf') !== '0',
    forecast: forecast && (FORECAST_IDS as readonly string[]).includes(forecast) ? (forecast as ForecastId) : null,
    rung: rung !== null && rung >= 0 && rung <= COMFORT_MAX ? Math.floor(rung) : null,
    plan: plan === '1' ? true : plan === '0' ? false : null,
    level: tn ?? (level !== null && level >= 1 && level <= 200 ? Math.floor(level) : null),
    elfix: import.meta.env.MODE !== 'single' && q.get('elfix') === '1',
    rules,
  };
}

/** Seconds after dawn for a t= value on `day` (dawn, noon, dusk or a 24 h HH:MM between 6:00 and 18:00). */
export function startTFor(t: string | null, day: number): number | null {
  if (!t) return null;
  const dl = dayLength(day);
  if (t === 'dawn') return 0;
  if (t === 'noon') return dl / 2;
  if (t === 'dusk') return dl * 0.88;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]) - 360;
  const frac = Math.max(0, Math.min(719, minutes)) / 720;
  return frac * dl;
}

/**
 * True when URL params change the sim or the player — a debug start (?day, ?t, ?chill), a bot,
 * a forced profile, rung, forecast, Day Plan or v1.6 rule, fast-forward, a guide override or a Trial's
 * object fixture (?elfix=1). Such runs are not scored, saved, shared or counted as Daily tries (they work in production
 * builds for QA). ?seed, ?mode=daily&date, ?level, ?trial, ?mute, ?debug, ?test and ?perf don't make
 * a run a debug run.
 */
export function isDebugRun(p: Params): boolean {
  return (
    p.day !== null ||
    p.t !== null ||
    p.chill !== null ||
    p.profile !== null ||
    p.bot !== null ||
    p.fast > 1 ||
    p.guide !== null ||
    p.forecast !== null ||
    p.rung !== null ||
    p.plan !== null ||
    p.rules !== null ||
    p.elfix
  );
}
