// Debug and test URL parameters (V1_PLAN §14, TECH_SPEC §17).

import { BOT_KINDS, dayLength, type BotKind, type ProfileId } from '../core/index.ts';
import { isDateString } from '../meta/daily.ts';

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
}

export function parseParams(search: string): Params {
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
  return {
    seed: seed === null ? null : Math.floor(Math.abs(seed)) >>> 0,
    daily: q.get('mode') === 'daily',
    date: date && isDateString(date) ? date : null,
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
 * a forced profile, fast-forward or a guide override. Such runs are not scored, saved, shared or
 * counted as Daily tries (they work in production builds for QA). ?seed, ?mode=daily&date, ?mute,
 * ?debug, ?test and ?perf don't make a run a debug run.
 */
export function isDebugRun(p: Params): boolean {
  return p.day !== null || p.t !== null || p.chill !== null || p.profile !== null || p.bot !== null || p.fast > 1 || p.guide !== null;
}
