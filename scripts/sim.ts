// Headless balance simulation, acceptance check and career sim (V1_PLAN §13, V1_1_PLAN §6).
//
//   node scripts/sim.ts [--seeds N] [--days D] [--bot B|all] [--profile P] [--forecast F]
//                       [--check] [--margin PTS] [--workers W]
//   node scripts/sim.ts --career N [--runs R] [--bot B] [--meta] [--workers W]
//
// Runs the real createRun/step with bot input at full speed in a pool of worker threads and prints,
// per row, death-time quantiles, melted% (flakes melted ÷ (melted + collected)), first-night share,
// median run length in real seconds, mean Snow, SWINGs per daylight minute and lit share (∫f dt ÷
// daylight seconds), plus world stats (rescues per chunk, unresolved validator failures), generation
// ms/chunk and sim µs/tick.
//
// Rows. The V1_PLAN §13 rows run on the plan mix (profile 3 with the Day Plan on). --forecast F sets
// RunConfig.forecast on every task. --check also runs idle, novice, reactive and oracle with each
// forecast forced (same seed count, same worker pool) and checks them. ADVISORY rows run the
// perception-limited human model (humanDial, A6) at comfort rungs R0-R4 and print PASS/MISS against
// the V1_1_PLAN §6 targets; they never fail --check.
//
// --check exits non-zero if a hard target fails, or passes by less than --margin percentage points
// of seeds (default 3), so a target that only just passes fails CI before a small tuning change or a
// different seed count tips it over:
//   - share targets ("≥ 90% of seeds"): the share must clear the bar by the margin (≥ 93%);
//   - median-window targets: at least 50% + margin of the seeds must die at or after the window's
//     start, and 50% + margin at or before its end (the median sits inside with room to spare).
// The oracle's 100% and the world targets (rescues per chunk ≤ 0.8, unresolved 0) have no margin.
//
// --career N plays N careers of R runs (default 40) on the comfort ladder: run seed
// hashString(`career-${c}-${r}`), run 0 at rung 0 (tutorial, lesson), then rungConfig(rung) with the
// lesson until a lessonDone, and rung = comfortAfterRun(rung, minutes) after each run. --meta folds
// every run through the meta layer's exported API (A14): beginRun before each run, applyRunResult
// after it, swapMission on slots stale ≥ 5 runs, the cheapest affordable cosmetic bought after each
// run, one Daily try per sim-day once the Daily is unlocked; `today` advances a day every 5 runs.

import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { comfortAfterRun, rungConfig, type NoonCloud, type ProfileId } from '../src/config/days.ts';
import { FORECAST_IDS, PLAN_START_DATE, type ForecastId } from '../src/config/forecasts.ts';
import { dayStartTick, dayStartY } from '../src/core/clock.ts';
import { formatScore } from '../src/core/format.ts';
import { ensureGenerated } from '../src/core/gen/world.ts';
import { hashString } from '../src/core/rng.ts';
import { BOT_KINDS, createBot, type BotKind } from '../src/core/sim/bots.ts';
import { createRun } from '../src/core/sim/create.ts';
import type { RunResult } from '../src/core/sim/events.ts';
import { headlessConfig } from '../src/core/sim/headless.ts';
import { buildRunResult } from '../src/core/sim/result.ts';
import { step } from '../src/core/sim/step.ts';
import type { RunConfig } from '../src/core/sim/types.ts';

/** One row of the report: a bot on one kind of run. */
interface Job {
  bot: BotKind;
  profile: ProfileId;
  drain?: number;
  noonCloud?: NoonCloud;
  lesson?: boolean;
  forecast?: ForecastId;
  /** Advisory comfort-rung row (PASS/MISS only, never fails --check). */
  rung?: number;
}

interface Task {
  job: number;
  seed: number;
  days: number;
  /** Pre-generate the whole world first to time generation separately from the sim. */
  timeGen: boolean;
}

interface RunOut {
  job: number;
  seed: number;
  died: boolean;
  minutes: number;
  day: number;
  flakes: number;
  flakesMelted: number;
  snow: number;
  swings: number;
  swingSnow: number;
  ticks: number;
  /** Daylight ticks with the clock running, and ∫f dt over them (s). */
  daylight: number;
  litTotal: number;
  lessonDone: boolean;
  stepMs: number;
  genMs: number;
  chunks: number;
  rescues: number;
  maxRescues: number;
  parked: number;
  unresolved: number;
}

/** A bot plays one run to death or the dawn of Day `days`. */
function playRun(cfg: RunConfig, kind: BotKind, days: number, timeGen = false): { out: Omit<RunOut, 'job' | 'seed'>; result: RunResult } {
  let genMs = 0;
  const s = createRun(cfg);
  if (timeGen) {
    const g0 = performance.now();
    ensureGenerated(s.world, dayStartY(days) + 2000);
    genMs = performance.now() - g0;
  }
  const bot = createBot(kind);
  const endTick = dayStartTick(days);
  let botMs = 0;
  let daylight = 0;
  let swingSnow = 0;
  let lessonDone = false;
  const start = performance.now();
  while (s.phase !== 'dead' && s.tickAbs < endTick) {
    const b0 = performance.now();
    const f = bot.next(s);
    botMs += performance.now() - b0;
    step(s, f);
    if (s.phase === 'day' && s.ready === 0) daylight++;
    for (const e of s.events) {
      if (e.e === 'swing') swingSnow += e.snow;
      else if (e.e === 'lessonDone') lessonDone = true;
    }
  }
  // Bot decisions are timed and subtracted, so stepMs is the cost of step() alone.
  const stepMs = performance.now() - start - botMs;
  const w = s.world.stats;
  let rescues = 0;
  let maxRescues = 0;
  let chunks = 0;
  for (const r of w.rescuesPerChunk) {
    if (r === undefined) continue;
    chunks++;
    rescues += r;
    if (r > maxRescues) maxRescues = r;
  }
  return {
    out: {
      died: s.phase === 'dead',
      minutes: s.minutes,
      day: s.day,
      flakes: s.stats.flakes,
      flakesMelted: s.stats.flakesMelted,
      snow: s.stats.snow,
      swings: s.stats.swings,
      swingSnow,
      ticks: s.tick,
      daylight,
      litTotal: s.stats.litTotal,
      lessonDone,
      stepMs,
      genMs,
      chunks,
      rescues,
      maxRescues,
      parked: w.parkedClouds,
      unresolved: w.unresolved,
    },
    result: buildRunResult(s),
  };
}

function jobConfig(j: Job, seed: number): RunConfig {
  const cfg = headlessConfig(seed, j.profile, j.drain, j.noonCloud);
  if (j.lesson !== undefined) cfg.lesson = j.lesson;
  if (j.forecast !== undefined) cfg.forecast = j.forecast;
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// Careers (also run inside workers)

interface CareerRun {
  rung: number;
  minutes: number;
  sec: number;
  missionDone: boolean;
}

interface CareerOut {
  runs: CareerRun[];
  /** --meta only: achievements unlocked and cosmetics owned at the end. */
  achievements: string[];
  owned: number;
  missing: string[];
}

/** The meta API the career harness folds runs through (A14), typed loosely: it may predate v1.1. */
interface MetaApi {
  defaults: (now?: number) => MetaSave;
  beginRun?: (save: MetaSave) => { save: MetaSave };
  applyRunResult: (save: MetaSave, result: RunResult, options: Record<string, unknown>) => { save: MetaSave; outcome: { missionsCompleted: unknown[] } };
  swapMission?: (save: MetaSave, slotId: string) => MetaSave;
  buyCosmetic: (save: MetaSave, id: string) => { ok: boolean; save?: MetaSave };
  dailyTryStarted?: (save: MetaSave, date: string) => { save: MetaSave; tryNumber: number | null };
  isDailyUnlocked?: (save: MetaSave) => boolean;
  COSMETICS: readonly { id: string; unlock: { kind: string; cost?: number } }[];
  ACHIEVEMENTS: readonly { id: string }[];
}

interface MetaSave {
  stats: { runs: number; wallet: number };
  unlocks: { cosmetics: string[]; achievements: string[] };
  missions: { active: { id: string; stale?: number; done: boolean }[] };
}

const META_NAMES = ['defaults', 'beginRun', 'applyRunResult', 'swapMission', 'buyCosmetic', 'dailyTryStarted', 'COSMETICS', 'ACHIEVEMENTS'];

async function loadMeta(): Promise<{ api: MetaApi; missing: string[] }> {
  const mods: Record<string, unknown>[] = [];
  for (const m of ['save', 'progression', 'content']) mods.push((await import(`../src/meta/${m}.ts`)) as Record<string, unknown>);
  const api: Record<string, unknown> = {};
  for (const name of [...META_NAMES, 'isDailyUnlocked']) {
    for (const mod of mods) if (name in mod) api[name] = mod[name];
  }
  return { api: api as unknown as MetaApi, missing: META_NAMES.filter((n) => !(n in api)) };
}

const CAREER_START = Date.UTC(2026, 10, 2);
const dateOf = (dayIndex: number): string => new Date(CAREER_START + dayIndex * 86_400_000).toISOString().slice(0, 10);

async function runCareer(c: number, runs: number, kind: BotKind, days: number, withMeta: boolean): Promise<CareerOut> {
  const meta = withMeta ? await loadMeta() : null;
  const api = meta?.api;
  let save = api ? api.defaults(CAREER_START) : null;
  let rung = 0;
  let tutorialDone = false;
  let lastDaily = '';
  const out: CareerOut = { runs: [], achievements: [], owned: 0, missing: meta?.missing ?? [] };
  for (let r = 0; r < runs; r++) {
    const today = dateOf(Math.floor(r / 5));
    if (api && save && api.beginRun) save = api.beginRun(save).save;
    const rc = rungConfig(rung, { tutorialDone });
    const cfg: RunConfig = { ...headlessConfig(hashString(`career-${c}-${r}`), rc.profile, rc.drain, rc.noonCloud), tutorial: rc.tutorial, lesson: rc.lesson };
    const { out: o, result } = playRun(cfg, kind, days);
    if (o.lessonDone) tutorialDone = true;
    let missionDone = false;
    if (api && save) {
      const applied = api.applyRunResult(save, result, { today, playSeconds: o.ticks / 60, rung });
      save = applied.save;
      missionDone = applied.outcome.missionsCompleted.length > 0;
      if (api.swapMission) for (const slot of save.missions.active) if (!slot.done && (slot.stale ?? 0) >= 5) save = api.swapMission(save, slot.id);
      let cheapest: { id: string; cost: number } | null = null;
      for (const item of api.COSMETICS) {
        const cost = item.unlock.cost;
        if (item.unlock.kind !== 'snow' || cost === undefined || cost > save.stats.wallet || save.unlocks.cosmetics.includes(item.id)) continue;
        if (!cheapest || cost < cheapest.cost) cheapest = { id: item.id, cost };
      }
      if (cheapest) {
        const bought = api.buyCosmetic(save, cheapest.id);
        if (bought.ok && bought.save) save = bought.save;
      }
      const unlocked = api.isDailyUnlocked ? api.isDailyUnlocked(save) : save.stats.runs >= 3;
      if (api.dailyTryStarted && unlocked && today !== lastDaily) {
        lastDaily = today;
        const tried = api.dailyTryStarted(save, today);
        save = tried.save;
        const daily: RunConfig = { ...headlessConfig(hashString(`daily-${today}`), 3), mode: 'daily', dailyDate: today, plan: today >= PLAN_START_DATE };
        const d = playRun(daily, kind, days);
        const dApplied = api.applyRunResult(save, d.result, { today, dailyTry: tried.tryNumber, playSeconds: d.out.ticks / 60 });
        save = dApplied.save;
        if (dApplied.outcome.missionsCompleted.length > 0) missionDone = true;
      }
    }
    out.runs.push({ rung, minutes: o.minutes, sec: o.ticks / 60, missionDone });
    rung = comfortAfterRun(rung, o.minutes);
  }
  if (save) {
    out.achievements = [...save.unlocks.achievements];
    out.owned = save.unlocks.cosmetics.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Worker side: answers each posted task (a run or a whole career) with its result.

type WorkerMsg = { kind: 'run'; task: Task; job: Job } | { kind: 'career'; c: number; runs: number; bot: BotKind; days: number; meta: boolean };

if (!isMainThread && workerData === 'sim') {
  parentPort?.on('message', (m: WorkerMsg) => {
    if (m.kind === 'run') {
      const { out } = playRun(jobConfig(m.job, m.task.seed), m.job.bot, m.task.days, m.task.timeGen);
      parentPort?.postMessage({ ...out, job: m.task.job, seed: m.task.seed });
    } else {
      void runCareer(m.c, m.runs, m.bot, m.days, m.meta).then((o) => parentPort?.postMessage(o));
    }
  });
}

/** Runs every message through a pool of `workers` threads (longest-first queue); results in input order. */
async function pool<T>(msgs: WorkerMsg[], workers: number): Promise<T[]> {
  const results: T[] = new Array(msgs.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(workers, msgs.length) }, async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: 'sim' });
    try {
      for (;;) {
        const i = next++;
        if (i >= msgs.length) break;
        results[i] = await new Promise<T>((resolve, reject) => {
          w.once('message', resolve);
          w.once('error', reject);
          w.postMessage(msgs[i]);
        });
        w.removeAllListeners('error');
      }
    } finally {
      await w.terminate();
    }
  });
  await Promise.all(lanes);
  return results;
}

// ---------------------------------------------------------------------------------------------
// Main side

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

const median = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);
const sum = (rs: RunOut[], f: (r: RunOut) => number): number => rs.reduce((a, r) => a + f(r), 0);
const firstNight = (rs: RunOut[]): number => rs.filter((r) => !r.died || r.minutes >= 720).length / Math.max(1, rs.length);
/** Median run length in real seconds (sim ticks / 60, the start beat included). */
const medianSec = (rs: RunOut[]): number => median(rs.map((r) => r.ticks / 60));
/** Death minutes, survivors as Infinity. */
const deathMinutes = (rs: RunOut[]): number[] => rs.map((r) => (r.died ? r.minutes : Infinity)).sort((a, b) => a - b);
const swingsPerMin = (rs: RunOut[]): number => sum(rs, (r) => r.swings) / Math.max(1e-9, sum(rs, (r) => r.daylight) / 3600);
const litShare = (rs: RunOut[]): number => sum(rs, (r) => r.litTotal) / Math.max(1e-9, sum(rs, (r) => r.daylight) / 60);
const swingSnowShare = (rs: RunOut[]): number => sum(rs, (r) => r.swingSnow) / Math.max(1, sum(rs, (r) => r.snow));
const meltedPct = (rs: RunOut[]): number => (100 * sum(rs, (r) => r.flakesMelted)) / Math.max(1, sum(rs, (r) => r.flakes + r.flakesMelted));

function clockOf(m: number, days: number): string {
  return m === Infinity ? `≥ Day ${days}` : formatScore(m);
}

function jobName(j: Job): string {
  const extra = [j.drain !== undefined ? `@${j.drain}` : '', j.noonCloud !== undefined ? ` nc${j.noonCloud}` : '', j.forecast ? ` ${j.forecast}` : ''].join('');
  return j.rung !== undefined ? `${j.bot} R${j.rung} (p${j.profile}${extra})` : `${j.bot} p${j.profile}${extra}`;
}

/** Comfort-rung rows for the human model (R0 with the lesson; R1-R4 after it). */
function rungJobs(bot: BotKind): Job[] {
  return [0, 1, 2, 3, 4].map((rung) => {
    const rc = rungConfig(rung, { tutorialDone: rung > 0 });
    return { bot, profile: rc.profile, drain: rc.drain, noonCloud: rc.noonCloud, lesson: rc.lesson, rung };
  });
}

async function careerMain(workers: number, days: number): Promise<void> {
  const careers = Number(arg('career', '20'));
  const runs = Number(arg('runs', '40'));
  const bot = arg('bot', 'humanDial') as BotKind;
  const withMeta = process.argv.includes('--meta');
  if (!BOT_KINDS.includes(bot)) throw new Error(`unknown bot ${bot}`);
  const t0 = performance.now();
  const msgs: WorkerMsg[] = Array.from({ length: careers }, (_, c) => ({ kind: 'career', c, runs, bot, days, meta: withMeta }));
  const out = await pool<CareerOut>(msgs, workers);
  const wall = (performance.now() - t0) / 1000;
  console.log(`SHADY career sim: ${careers} careers × ${runs} runs, bot ${bot}${withMeta ? ', meta' : ''}, ${workers} workers, ${wall.toFixed(1)} s\n`);
  const windows: [string, number, number][] = [
    ['runs 1-3', 0, 3],
    ['runs 4-9', 3, 9],
    ['runs 10-25', 9, 25],
    ['runs 26+', 25, runs],
  ];
  /** Run r beats the best of the (up to 10) runs before it. */
  const beatsRecent = (rs: CareerRun[], r: number): boolean => {
    if (r === 0) return false;
    let best = -1;
    for (let k = Math.max(0, r - 10); k < r; k++) best = Math.max(best, (rs[k] as CareerRun).minutes);
    return (rs[r] as CareerRun).minutes > best;
  };
  console.log('window       median run  median death        mean rung  beat recent best');
  for (const [name, a, b] of windows) {
    if (a >= runs) continue;
    const sel: { run: CareerRun; beat: boolean }[] = [];
    for (const o of out) for (let r = a; r < Math.min(b, runs); r++) sel.push({ run: o.runs[r] as CareerRun, beat: beatsRecent(o.runs, r) });
    const meanRung = sel.reduce((x, s) => x + s.run.rung, 0) / sel.length;
    console.log(
      `${name.padEnd(12)} ${`${median(sel.map((s) => s.run.sec)).toFixed(1)} s`.padEnd(11)} ${formatScore(median(sel.map((s) => s.run.minutes))).padEnd(19)} ${meanRung.toFixed(2).padEnd(10)} ${((100 * sel.filter((s) => s.beat).length) / sel.length).toFixed(1)}%`,
    );
  }
  const rungAt = (r: number): number[] => out.map((o) => (o.runs[r] as CareerRun | undefined)?.rung ?? -1).filter((x) => x >= 0);
  console.log(`\nrung by run (mean): ${Array.from({ length: Math.min(runs, 12) }, (_, r) => (rungAt(r).reduce((a, b) => a + b, 0) / Math.max(1, rungAt(r).length)).toFixed(2)).join(' ')}`);
  if (runs >= 6) {
    const std = out.filter((o) => o.runs.slice(1).every((r) => r.rung === 4)).length;
    const r6 = rungAt(5);
    console.log(`standard rung (R4) on every run from run 2: ${((100 * std) / out.length).toFixed(0)}% of careers; at run 6 ${((100 * r6.filter((x) => x >= 3).length) / r6.length).toFixed(0)}% are at R3 or above`);
  }
  const late: { beat: boolean }[] = [];
  for (const o of out) for (let r = 10; r < runs; r++) late.push({ beat: beatsRecent(o.runs, r) });
  if (late.length) console.log(`recent best beaten in runs 11+: ${((100 * late.filter((l) => l.beat).length) / late.length).toFixed(1)}% (advisory 5-15%)`);
  const mid = out.flatMap((o) => o.runs.slice(9, 25));
  if (runs >= 10 && bot.startsWith('human')) {
    const sec = median(mid.map((r) => r.sec));
    const death = median(mid.map((r) => r.minutes));
    console.log(`${sec >= 18 && death >= 240 ? 'PASS' : 'MISS'}  human runs 10-25: median run ${sec.toFixed(1)} s (≥ 18), median death ${formatScore(death)} (≥ Day 1 · 10:00 AM)`);
  }
  if (!withMeta) return;
  const missing = out[0]?.missing ?? [];
  if (missing.length) console.log(`\nmeta API missing (folded without it): ${missing.join(', ')}`);
  const withLate = out.filter((o) => o.runs.slice(30, 40).some((r) => r.missionDone)).length;
  const lastDone = out.map((o) => {
    let last = 0;
    o.runs.forEach((r, i) => {
      if (r.missionDone) last = i + 1;
    });
    return last;
  });
  console.log(`\nmeta: careers with a mission completed in runs 31-40: ${((100 * withLate) / out.length).toFixed(0)}% (advisory ≥ 80%)`);
  console.log(`meta: median last mission completion: run ${median(lastDone)} (advisory ≥ 36)`);
  const { api } = await loadMeta();
  const catalog = api.COSMETICS.length;
  console.log(`meta: catalog owned ${((100 * out.reduce((a, o) => a + o.owned, 0)) / (out.length * catalog)).toFixed(1)}% of ${catalog} (mean over careers)`);
  console.log('meta: achievements unlocked (% of careers):');
  for (const a of api.ACHIEVEMENTS) console.log(`  ${a.id.padEnd(16)} ${((100 * out.filter((o) => o.achievements.includes(a.id)).length) / out.length).toFixed(0)}%`);
}

async function main(): Promise<void> {
  const seeds = Number(arg('seeds', '100'));
  const days = Number(arg('days', '8'));
  const workers = Math.max(1, Number(arg('workers', String(Math.min(4, availableParallelism())))));
  if (process.argv.includes('--career')) return careerMain(workers, days);
  const botArg = arg('bot', 'all');
  const profileArg = arg('profile', '');
  const forced = arg('forecast', '') as ForecastId | '';
  const check = process.argv.includes('--check');
  const margin = Number(arg('margin', '3'));
  if (botArg !== 'all' && !BOT_KINDS.includes(botArg as BotKind)) throw new Error(`unknown bot ${botArg}`);
  if (forced && !FORECAST_IDS.includes(forced)) throw new Error(`unknown forecast ${forced}`);
  const fc = forced || undefined;

  const withFc = (j: Job): Job => (fc ? { ...j, forecast: fc } : j);
  let base: Job[] = [
    { bot: 'idle', profile: 3 },
    { bot: 'novice', profile: 3 },
    { bot: 'novice', profile: 0 },
    { bot: 'reactive', profile: 3 },
    { bot: 'oracle', profile: 3 },
  ].map((j) => withFc(j as Job));
  let advisory: Job[] = rungJobs('humanDial').map(withFc);
  if (botArg !== 'all') {
    base = base.filter((j) => j.bot === botArg);
    advisory = botArg === 'humanDial' || botArg === 'human' ? rungJobs(botArg).map(withFc) : [];
  }
  if (profileArg !== '') {
    const p = Number(profileArg) as ProfileId;
    base = [...new Set([...base, ...advisory].map((j) => j.bot))].map((bot) => withFc({ bot, profile: p }));
    advisory = [];
  }
  // A16: --check also loops over every forecast (idle, novice, reactive, oracle at profile 3).
  const forecastJobs: Job[] =
    check && !fc && botArg === 'all' && profileArg === ''
      ? FORECAST_IDS.flatMap((forecast) => (['idle', 'novice', 'reactive', 'oracle'] as BotKind[]).map((bot) => ({ bot, profile: 3 as ProfileId, forecast })))
      : [];
  const jobs = [...base, ...advisory, ...forecastJobs];

  const msgs: WorkerMsg[] = [];
  jobs.forEach((job, ji) => {
    for (let seed = 1; seed <= seeds; seed++) msgs.push({ kind: 'run', job, task: { job: ji, seed, days, timeGen: job.bot === 'oracle' } });
  });
  // Longest first (oracle, then reactive) keeps the pool busy to the end.
  const weight = (m: WorkerMsg): number => (m.kind === 'run' ? { oracle: 4, reactive: 3, novice: 2 }[m.job.bot as 'oracle'] ?? 1 : 1);
  msgs.sort((a, b) => weight(b) - weight(a));
  const t0 = performance.now();
  const results = await pool<RunOut>(msgs, workers);
  const wall = (performance.now() - t0) / 1000;
  const of = (ji: number): RunOut[] => results.filter((r) => r.job === ji);

  const failures: string[] = [];
  const report = (ok: boolean, what: string, got: string): void => {
    if (!ok) failures.push(what);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${got}`);
  };
  const pts = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`;
  /** A share target: `got` must reach `bar`, by at least the margin. */
  const share = (what: string, got: number, bar: number): void => {
    const m = 100 * (got - bar);
    report(m >= margin, `${what} (${margin}-point margin)`, `${(100 * got).toFixed(1)}% (${pts(m)})`);
  };
  /** A median-window target: the median death in [lo, hi] minutes, with the margin on both sides. */
  const window = (what: string, rs: RunOut[], lo: number, hi: number): void => {
    const m = median(deathMinutes(rs));
    const after = (100 * rs.filter((r) => !r.died || r.minutes >= lo).length) / rs.length - 50;
    const before = (100 * rs.filter((r) => r.died && r.minutes <= hi).length) / rs.length - 50;
    const ok = m >= lo && m <= hi && Math.min(after, before) >= margin;
    report(ok, `${what} (${margin}-point margin)`, `${clockOf(m, days)} (${pts(after)} after the start, ${pts(before)} before the end)`);
  };

  console.log(`SHADY sim: ${seeds} seeds, up to Day ${days}, ${workers} workers, ${wall.toFixed(1)} s${fc ? `, forecast ${fc} forced` : ''}\n`);
  console.log(`${'row'.padEnd(30)} ${'median'.padEnd(17)} ${'p10'.padEnd(17)} ${'p90'.padEnd(17)} night  run s  melted%  Snow   sw/min  lit%   µs/tick`);
  const rowLine = (ji: number): void => {
    const rs = of(ji);
    const dm = deathMinutes(rs);
    const q = (p: number): string => clockOf(quantile(dm, p), days);
    const ticks = sum(rs, (r) => r.ticks);
    console.log(
      `${jobName(jobs[ji] as Job).padEnd(30)} ${q(0.5).padEnd(17)} ${q(0.1).padEnd(17)} ${q(0.9).padEnd(17)} ${`${(100 * firstNight(rs)).toFixed(0)}%`.padStart(5)}  ${medianSec(rs).toFixed(1).padStart(5)}  ${meltedPct(rs).toFixed(1).padStart(7)}  ${(sum(rs, (r) => r.snow) / rs.length).toFixed(1).padStart(5)}  ${swingsPerMin(rs).toFixed(2).padStart(6)}  ${(100 * litShare(rs)).toFixed(0).padStart(4)}%  ${((1000 * sum(rs, (r) => r.stepMs)) / Math.max(1, ticks)).toFixed(1).padStart(6)}`,
    );
  };
  base.forEach((_, ji) => rowLine(ji));
  if (advisory.length) {
    console.log('ADVISORY (perception-limited human model on the comfort rungs):');
    advisory.forEach((_, i) => rowLine(base.length + i));
  }

  // World stats per world kind (profile, noon cloud, forecast); only the hard rows' kinds are checked.
  console.log('\nWorld (validator):');
  const kinds = new Map<string, { rs: RunOut[]; checked: boolean }>();
  jobs.forEach((j, ji) => {
    const key = `p${j.profile}${j.noonCloud !== undefined ? ` nc${j.noonCloud}` : ''}${j.forecast ? ` ${j.forecast}` : ''}`;
    const k = kinds.get(key) ?? { rs: [], checked: false };
    k.rs.push(...of(ji));
    if (j.rung === undefined) k.checked = true;
    kinds.set(key, k);
  });
  for (const [key, k] of kinds) {
    // Each seed's deepest run covers the most chunks.
    const bySeed = new Map<number, RunOut>();
    for (const r of k.rs) {
      const cur = bySeed.get(r.seed);
      if (!cur || r.chunks > cur.chunks) bySeed.set(r.seed, r);
    }
    const ws = [...bySeed.values()];
    const chunks = sum(ws, (r) => r.chunks);
    const perChunk = sum(ws, (r) => r.rescues) / Math.max(1, chunks);
    const unresolved = sum(ws, (r) => r.unresolved);
    const gen = ws.filter((r) => r.genMs > 0);
    const genChunks = sum(gen, (r) => r.chunks);
    console.log(
      `  ${key.padEnd(14)} ${chunks} chunks, rescues/chunk ${perChunk.toFixed(3)} max ${Math.max(0, ...ws.map((r) => r.maxRescues))}, parked clouds ${sum(ws, (r) => r.parked)}, unresolved ${unresolved}` +
        (genChunks > 0 ? `, gen+validate ${(sum(gen, (r) => r.genMs) / genChunks).toFixed(2)} ms/chunk` : '') +
        (k.checked ? '' : ' (advisory runs only)'),
    );
    if (check && k.checked) {
      if (perChunk > 0.8) failures.push(`${key} rescues per chunk ≤ 0.8`);
      if (unresolved > 0) failures.push(`${key} unresolved = 0`);
    }
  }

  if (forecastJobs.length) {
    console.log('\nForced forecasts (profile 3, the forecast on every day it fits):');
    console.log('forecast   idle < 8 AM  novice median      reactive median    oracle D8  reactive Snow  sw/min');
    for (const f of FORECAST_IDS) {
      const at = (bot: BotKind): RunOut[] => of(jobs.findIndex((j) => j.forecast === f && j.bot === bot && j.rung === undefined && j.profile === 3));
      const idle = at('idle');
      const rea = at('reactive');
      console.log(
        `${f.padEnd(10)} ${`${((100 * idle.filter((r) => r.died && r.minutes < 120).length) / idle.length).toFixed(1)}%`.padEnd(12)} ${clockOf(median(deathMinutes(at('novice'))), days).padEnd(18)} ${clockOf(median(deathMinutes(rea)), days).padEnd(18)} ${`${((100 * at('oracle').filter((r) => !r.died && r.day >= 8).length) / seeds).toFixed(0)}%`.padEnd(10)} ${(sum(rea, (r) => r.snow) / rea.length).toFixed(1).padStart(13)}  ${swingsPerMin(rea).toFixed(2)}`,
      );
    }
  }

  // Advisory targets (V1_1_PLAN §6 as amended by A2/A3): PASS/MISS, never fail --check.
  const adv: { rung: number; what: string; ok: (rs: RunOut[]) => boolean; got: (rs: RunOut[]) => string }[] = [
    { rung: 0, what: 'first night ≥ 75%', ok: (rs) => firstNight(rs) >= 0.75, got: (rs) => `${(100 * firstNight(rs)).toFixed(0)}%` },
    { rung: 1, what: 'median run ≥ 60 s', ok: (rs) => medianSec(rs) >= 60, got: (rs) => `${medianSec(rs).toFixed(1)} s` },
    { rung: 2, what: 'median run ≥ 60 s', ok: (rs) => medianSec(rs) >= 60, got: (rs) => `${medianSec(rs).toFixed(1)} s` },
    { rung: 4, what: 'median run ≥ 20 s', ok: (rs) => medianSec(rs) >= 20, got: (rs) => `${medianSec(rs).toFixed(1)} s` },
    { rung: 4, what: 'lit share ≤ 45%', ok: (rs) => litShare(rs) <= 0.45, got: (rs) => `${(100 * litShare(rs)).toFixed(0)}%` },
    { rung: 4, what: 'SWINGs ≤ 4 per minute', ok: (rs) => swingsPerMin(rs) <= 4, got: (rs) => swingsPerMin(rs).toFixed(2) },
    { rung: 4, what: 'SWING Snow ≤ 15% of run Snow', ok: (rs) => swingSnowShare(rs) <= 0.15, got: (rs) => `${(100 * swingSnowShare(rs)).toFixed(1)}%` },
  ];
  const advLines: string[] = [];
  advisory.forEach((j, i) => {
    for (const a of adv) {
      if (a.rung !== j.rung) continue;
      const rs = of(base.length + i);
      advLines.push(`  ${a.ok(rs) ? 'PASS' : 'MISS'}  ${j.bot} R${j.rung} ${a.what}: ${a.got(rs)}`);
    }
  });
  const reaJi = base.findIndex((j) => j.bot === 'reactive' && j.profile === 3);
  if (reaJi >= 0) {
    const rs = of(reaJi);
    const spm = swingsPerMin(rs);
    advLines.push(`  ${spm >= 1 && spm <= 2 ? 'PASS' : 'MISS'}  reactive p3 1.0-2.0 SWINGs per minute: ${spm.toFixed(2)} (SWING Snow ${(100 * swingSnowShare(rs)).toFixed(1)}% of run Snow)`);
  }
  if (advLines.length) {
    console.log('\nAdvisory (PASS/MISS never fails --check):');
    for (const l of advLines) console.log(l);
  }

  if (!check) return;
  console.log(`\nAcceptance (V1_PLAN §13 on ${fc ? `forecast ${fc}` : 'the plan mix'}, V1_1_PLAN §6), required margin ${margin} points:`);
  /** The hard rows of one world kind; forecast rows relax the novice window to 9:30 AM. */
  const gates = (label: string, at: (bot: BotKind, profile: ProfileId) => RunOut[], forecastRows: boolean): void => {
    const idle = at('idle', 3);
    if (idle.length) share(`${label}idle p3 dies before 8:00 AM Day 1 on ≥ 90%`, idle.filter((r) => r.died && r.minutes < 120).length / idle.length, 0.9);
    const nov3 = at('novice', 3);
    if (nov3.length) {
      if (forecastRows) window(`${label}novice p3 median death in [Day 1 9:30 AM, Day 1 3:00 PM]`, nov3, 210, 540);
      else window(`${label}novice p3 median death in [Day 1 10:00 AM, Day 1 3:00 PM]`, nov3, 240, 540);
    }
    const nov0 = at('novice', 0);
    if (nov0.length) share(`${label}novice p0 (lesson) reaches the first night on ≥ 75%`, firstNight(nov0), 0.75);
    const rea = at('reactive', 3);
    if (rea.length) window(`${label}reactive p3 median death in [Day 2 noon, Day 4 noon]`, rea, 1080, 2520);
    const ora = at('oracle', 3);
    if (ora.length) {
      const ok = ora.filter((r) => !r.died && r.day >= 8).length / ora.length;
      report(ok === 1 && days >= 8, `${label}oracle p3 reaches Day 8 on 100%`, `${(100 * ok).toFixed(0)}%${days < 8 ? ` (only simulated to Day ${days})` : ''}`);
    }
  };
  gates('', (bot, profile) => of(base.findIndex((j) => j.bot === bot && j.profile === profile)), fc !== undefined);
  for (const f of forecastJobs.length ? FORECAST_IDS : []) {
    gates(`[${f}] `, (bot, profile) => of(jobs.findIndex((j) => j.forecast === f && j.bot === bot && j.profile === profile && j.rung === undefined)), true);
  }
  const worldFails = failures.filter((f) => f.includes('rescues') || f.includes('unresolved'));
  console.log(`  ${worldFails.length ? 'FAIL' : 'PASS'}  world: rescues per chunk ≤ 0.8 and unresolved = 0 on every checked world kind${worldFails.length ? `: ${worldFails.join('; ')}` : ''}`);
  if (failures.length) {
    console.log(`\n${failures.length} target(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll targets met.');
}

if (isMainThread) await main();
