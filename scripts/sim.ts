// Headless balance simulation, acceptance check and career sim (V1_PLAN §13, V1_1_PLAN §6).
//
//   node scripts/sim.ts [--seeds N] [--days D] [--bot B|all] [--profile P] [--forecast F] [--check] [--margin PTS] [--workers W] [--mech]
//   node scripts/sim.ts --career N [--runs R] [--bot B] [--meta] [--workers W]
//   node scripts/sim.ts --campaign [--level N,…] [--bot oracle|reactive|humanDial|all] [--tries N] [--workers W] [--nomech]
//   v1.6 (docs/V1_6_PLAN.md): [--off ring,bank,garden,brittle,flares,noonHeat] on any of the above;
//   [--policy plain|chase|naive|safe] [--hours] on the report; the modes --decisions and --bake.
//
// Runs the real createRun/step with bot input at full speed in a pool of worker threads and prints,
// per row, death-time quantiles, melted%, first-night share, median run seconds, mean Snow, SWINGs
// per daylight minute and lit share, plus world stats (rescues per chunk, unresolved validator
// failures), generation ms/chunk and sim µs/tick.
//
// v1.5 core mechanics: the V1_PLAN §13 reactive target is defined for the bot that reads guide.now
// and guide.next, so its rows (plan mix and forced forecasts) run the reactive bot dial-only
// (createBot(…, mechanics false), "reactive p3 dial"); a "reactive p3" row plays the same bot using
// the mechanics (gold arcs, Cold Snaps) and must outlive the dial-only row by ≥ 180 minutes (hard).
// The mechanics table prints blooms, snaps, frost meters filled, deep shade and buds passed per
// daylight minute and per day. --mech adds an oracle row that ignores the mechanics.
//
// Rows: the V1_PLAN §13 rows on the plan mix, idle p0 for the lesson's floor (CO4); --check adds
// idle/novice/reactive/oracle with each forecast forced. ADVISORY rows (humanDial at rungs R0-R4)
// print PASS/MISS against V1_1_PLAN §6 and never fail --check. --check exits non-zero when a hard
// target fails or passes by less than --margin points of seeds (default 3): a share must clear its
// bar by the margin, a median window needs 50% + margin of the seeds on each side of each edge. The
// oracle's 100% and the world targets (rescues per chunk ≤ 0.8, unresolved 0) have no margin.
//
// --campaign plays the Journey (CAMPAIGN_PLAN §3): oracle, reactive and humanDial on every level
// (humanDial --tries times, each with its own decision stream), each level's outcome, a per-chapter
// pass/stars table and the gates (hard: oracle 200/200, reactive ≥ 95% of 1-100; advisory: humanDial
// ≥ 75% of 1-40 and ≥ 90% of 1-10). Exit 1 on a hard miss. --nomech: the bots ignore the v1.5 core
// mechanics (to measure what using them is worth).
//
// --career N plays N careers of R runs (default 40) on the comfort ladder (run seed
// hashString(`career-${c}-${r}`), rungConfig/comfortAfterRun between runs). --meta folds every run
// through the meta API (A14): beginRun, applyRunResult, stale missions swapped, the cheapest
// affordable cosmetic bought, one Daily try per sim-day once unlocked; a sim-day is 5 runs.
//
// v1.6 report registry (scripts/sim16/registry.ts): --off switches v1.6 rules off on every row
// (RunConfig.v16); the economy module (sim16/econ.ts, CORE-1: --policy, --decisions) and the world
// module (sim16/world.ts, CORE-2: --hours, --bake) add per-run metrics gathered in the workers,
// their tables and gates after the v1.5 report, and their own modes.

import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { CAMPAIGN_LEVELS, featMet, LEVEL_COUNT, SOFT_FAIL_MISSES, type LevelDef } from '../src/config/campaign.ts';
import { comfortAfterRun, isWarmup, rungConfig, type ComfortPrev, type ProfileId } from '../src/config/days.ts';
import { FORECAST_IDS, PLAN_START_DATE, type ForecastId } from '../src/config/forecasts.ts';
import { TUNING } from '../src/config/tuning.ts';
import { dayStartTick, dayStartY } from '../src/core/clock.ts';
import { formatScore } from '../src/core/format.ts';
import { ensureGenerated } from '../src/core/gen/world.ts';
import { hashString } from '../src/core/rng.ts';
import { BUD_ID_BASE } from '../src/core/objects.ts';
import { BOT_KINDS, BOT_POLICIES, createBot, type BotKind, type BotOptions, type BotPolicy } from '../src/core/sim/bots.ts';
import { createRun } from '../src/core/sim/create.ts';
import type { RunResult } from '../src/core/sim/events.ts';
import { headlessConfig } from '../src/core/sim/headless.ts';
import { campaignConfig, levelProgress } from '../src/core/level.ts';
import { buildRunResult } from '../src/core/sim/result.ts';
import { step } from '../src/core/sim/step.ts';
import { V16_RULES, type RunConfig, type SimState, type V16Rules } from '../src/core/sim/types.ts';
import { ECON } from './sim16/econ.ts';
import type { Sim16Collector, Sim16Ctx, Sim16Job, Sim16Module, Sim16Row } from './sim16/registry.ts';
import { WORLD } from './sim16/world.ts';

/** The v1.6 report modules (scripts/sim16/registry.ts). */
const SIM16: readonly Sim16Module[] = [ECON, WORLD];

/** One row of the report: a bot on one kind of run. */
type Job = Sim16Job;

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
  /** v1.5: blooms, snaps, frost meters filled, seconds of deep shade, buds Nubs walked past. */
  blooms: number;
  snaps: number;
  frostReady: number;
  deepSec: number;
  budsPassed: number;
  /** v1.6: the report modules' metrics (scripts/sim16). */
  m: Record<string, number>;
}

/** A bot plays one run to death or the dawn of Day `days`. */
function playRun(cfg: RunConfig, kind: BotKind, days: number, timeGen = false, mech = true, opts: BotOptions = {}): { out: Omit<RunOut, 'job' | 'seed'>; result: RunResult } {
  let genMs = 0;
  const s = createRun(cfg);
  if (timeGen) {
    const g0 = performance.now();
    ensureGenerated(s.world, dayStartY(days) + 2000);
    genMs = performance.now() - g0;
  }
  const bot = createBot(kind, 0, mech, opts);
  const cols: Sim16Collector[] = [];
  for (const mod of SIM16) if (mod.collector) cols.push(mod.collector());
  const endTick = dayStartTick(days);
  let botMs = 0;
  let daylight = 0;
  let swingSnow = 0;
  let lessonDone = false;
  let frostReady = 0;
  let budPassed = -1;
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
      else if (e.e === 'frostReady') frostReady++;
    }
    if (s.tick % 30 === 0) {
      // Buds are y-sorted with rising ids: the last one at or behind Nubs counts every bud passed.
      for (const b of s.world.buds) {
        if (b.y > s.nubs.y) break;
        if (b.id - BUD_ID_BASE > budPassed) budPassed = b.id - BUD_ID_BASE;
      }
    }
    if (cols.length > 0) {
      // v1.6 collectors are timed with the bot, so stepMs stays the cost of step() alone.
      const c0 = performance.now();
      for (const c of cols) c.tick(s);
      botMs += performance.now() - c0;
    }
  }
  // Bot decisions are timed and subtracted, so stepMs is the cost of step() alone.
  const stepMs = performance.now() - start - botMs;
  const { flakes, flakesMelted, snow, swings, litTotal } = s.stats;
  const mechOut = { blooms: s.stats.blooms ?? 0, snaps: s.stats.snaps ?? 0, frostReady, deepSec: s.stats.deepSeconds ?? 0, budsPassed: budPassed + 1 };
  const m: Record<string, number> = {};
  for (const c of cols) c.finish(s, m);
  const out = { died: s.phase === 'dead', minutes: s.minutes, day: s.day, flakes, flakesMelted, snow, swings, swingSnow, ticks: s.tick, daylight, litTotal, lessonDone, stepMs, genMs, ...mechOut, m };
  return { out: { ...out, ...worldStats(s) }, result: buildRunResult(s) };
}

/** Chunks generated, rescues (total and the most in one chunk), parked clouds and unresolved failures of a run's world. */
function worldStats(s: SimState): { chunks: number; rescues: number; maxRescues: number; parked: number; unresolved: number } {
  const w = s.world.stats;
  const per = w.rescuesPerChunk.filter((r): r is number => r !== undefined);
  return { chunks: per.length, rescues: per.reduce((a, r) => a + r, 0), maxRescues: Math.max(0, ...per), parked: w.parkedClouds, unresolved: w.unresolved };
}

// ---------------------------------------------------------------------------------------------
// Campaign levels (also run inside workers)

interface LevelOut {
  id: number;
  /** The bot, or its v1.6 variant's label ('oracle+feats': the Feat-seeking oracle). */
  bot: string;
  phase: string;
  passed: boolean;
  stars: number;
  /** v1.6: a Dare of the level met at the finish (star 2), and its first Dare's kind. */
  featMet: boolean;
  dare: string;
  /** The bot's seed salt (the try). */
  salt: number;
  flakes: number;
  snow: number;
  minChill: number;
  /** Where the run ended: the level's progress 0..1 (1 at the finish line). */
  progress: number;
  ms: number;
  rescues: number;
  chunks: number;
  unresolved: number;
}

/**
 * A bot plays one campaign level to its finish line (or Nubs melts). v1.6: `opts` (the
 * Feat-seeking oracle: feats), `label` names the variant, and `relaxed` scores the goal as 'finish'
 * (the reactive bot on the teaching levels' verb goals, docs/V1_6_PLAN.md §2.6).
 */
function playLevel(id: number, kind: BotKind, salt: number, mech = true, v16?: Partial<V16Rules>, opts: BotOptions = {}, label?: string, relaxed = false): LevelOut {
  const t0 = performance.now();
  // Level 1 is the first run's lesson level (the session turns the lesson on until it is passed).
  const base: Partial<RunConfig> = { lesson: id === 1, ...(v16 ? { v16 } : {}), ...(relaxed ? { relaxedGoal: true } : {}) };
  const s = createRun(campaignConfig(id, base));
  const bot = createBot(kind, salt, mech, opts);
  // A level is at most 1080 minutes (one and a half days, ~6000 ticks).
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < 8000) step(s, bot.next(s));
  const r = buildRunResult(s).level;
  const { flakes, snow, minChill } = s.stats;
  const { rescues, chunks, unresolved } = worldStats(s);
  const lv = CAMPAIGN_LEVELS[id - 1] as LevelDef;
  const met = s.phase === 'won' && featMet(lv, s.stats);
  return { id, bot: label ?? kind, phase: s.phase, passed: r?.passed ?? false, stars: r?.stars ?? 0, featMet: met, dare: lv.feats[0]?.kind ?? '', salt, flakes, snow, minChill, progress: levelProgress(s), ms: performance.now() - t0, rescues, chunks, unresolved };
}

/** True when level `l`'s goal is a teaching verb goal (the reactive bot scores it as 'finish'). */
function verbGoal(l: LevelDef): boolean {
  return l.introduces !== null && l.goal.kind !== 'finish' && l.goal.kind !== 'flakes';
}

function jobConfig(j: Job, seed: number): RunConfig {
  const cfg = headlessConfig(seed, j.profile, j.drain, j.noonCloud);
  if (j.lesson !== undefined) cfg.lesson = j.lesson;
  if (j.forecast !== undefined) cfg.forecast = j.forecast;
  if (j.v16 !== undefined) cfg.v16 = j.v16;
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// Careers (also run inside workers)

interface CareerRun {
  rung: number;
  /** The warm-up run (rung 4, eased rules) after the climb from R3. */
  warmup: boolean;
  minutes: number;
  sec: number;
  missionDone: boolean;
}

interface CareerOut {
  runs: CareerRun[];
  /** --meta only: achievements unlocked and cosmetics owned at the end. */
  achievements: string[];
  owned: number;
}

/** The meta API the career harness folds runs through (A14), loaded only for --meta. */
type Meta = typeof import('../src/meta/save.ts') & typeof import('../src/meta/progression.ts') & typeof import('../src/meta/content.ts');

async function loadMeta(): Promise<Meta> {
  const [save, progression, content] = await Promise.all([import('../src/meta/save.ts'), import('../src/meta/progression.ts'), import('../src/meta/content.ts')]);
  return { ...save, ...progression, ...content };
}

const CAREER_START = Date.UTC(2026, 10, 2);
const dateOf = (dayIndex: number): string => new Date(CAREER_START + dayIndex * 86_400_000).toISOString().slice(0, 10);

async function runCareer(c: number, runs: number, kind: BotKind, days: number, withMeta: boolean, v16?: Partial<V16Rules>): Promise<CareerOut> {
  const api = withMeta ? await loadMeta() : null;
  let save = api ? api.defaults(CAREER_START) : null;
  let rung = 0;
  let prev: ComfortPrev | null = null;
  let prevRung = -1;
  let tutorialDone = false;
  let lastDaily = '';
  const out: CareerOut = { runs: [], achievements: [], owned: 0 };
  for (let r = 0; r < runs; r++) {
    const today = dateOf(Math.floor(r / 5));
    if (api && save) save = api.beginRun(save).save;
    const rc = rungConfig(rung, { tutorialDone, warmup: isWarmup(rung, prevRung) });
    const cfg: RunConfig = { ...headlessConfig(hashString(`career-${c}-${r}`), rc.profile, rc.drain, rc.noonCloud), tutorial: rc.tutorial, lesson: rc.lesson };
    if (v16) cfg.v16 = v16;
    const { out: o, result } = playRun(cfg, kind, days);
    if (o.lessonDone) tutorialDone = true;
    let missionDone = false;
    if (api && save) {
      const applied = api.applyRunResult(save, result, { today, playSeconds: o.ticks / 60, rung, warmup: rc.warmup });
      save = applied.save;
      missionDone = applied.outcome.missionsCompleted.length > 0;
      for (const slot of save.missions.active) if (!slot.done && (slot.stale ?? 0) >= 5) save = api.swapMission(save, slot.id);
      // The cheapest affordable Snow cosmetic not owned yet.
      const owned = save.unlocks.cosmetics as readonly string[];
      const wallet = save.stats.wallet;
      const cost = (i: (typeof api.COSMETICS)[number]): number => (i.unlock.kind === 'snow' ? i.unlock.cost : Infinity);
      const buy = api.COSMETICS.filter((i) => cost(i) <= wallet && !owned.includes(i.id)).sort((a, b) => cost(a) - cost(b))[0];
      const bought = buy ? api.buyCosmetic(save, buy.id) : null;
      if (bought?.ok && bought.save) save = bought.save;
      if (api.isDailyUnlocked(save) && today !== lastDaily) {
        lastDaily = today;
        const tried = api.dailyTryStarted(save, today);
        const daily: RunConfig = { ...headlessConfig(hashString(`daily-${today}`), 3), mode: 'daily', dailyDate: today, plan: today >= PLAN_START_DATE };
        if (v16) daily.v16 = v16;
        const d = playRun(daily, kind, days);
        const dApplied = api.applyRunResult(tried.save, d.result, { today, dailyTry: tried.tryNumber, playSeconds: d.out.ticks / 60 });
        save = dApplied.save;
        if (dApplied.outcome.missionsCompleted.length > 0) missionDone = true;
      }
    }
    out.runs.push({ rung, warmup: rc.warmup, minutes: o.minutes, sec: o.ticks / 60, missionDone });
    const next = comfortAfterRun(rung, o.minutes, prev);
    prev = rc.warmup ? null : { rung, minutes: o.minutes };
    prevRung = rung;
    rung = next;
  }
  if (save) {
    out.achievements = [...save.unlocks.achievements];
    out.owned = save.unlocks.cosmetics.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Worker side: answers each posted task (a run or a whole career) with its result.

type WorkerMsg =
  | { kind: 'run'; task: Task; job: Job }
  | { kind: 'career'; c: number; runs: number; bot: BotKind; days: number; meta: boolean; v16?: Partial<V16Rules> }
  | { kind: 'level'; id: number; bot: BotKind; salt: number; mech: boolean; v16?: Partial<V16Rules>; opts?: BotOptions; label?: string; relaxed?: boolean };

if (!isMainThread && workerData === 'sim') {
  parentPort?.on('message', (m: WorkerMsg) => {
    if (m.kind === 'run') {
      const { out } = playRun(jobConfig(m.job, m.task.seed), m.job.bot, m.task.days, m.task.timeGen, !m.job.noMech, m.job.opts);
      parentPort?.postMessage({ ...out, job: m.task.job, seed: m.task.seed });
    } else if (m.kind === 'level') {
      parentPort?.postMessage(playLevel(m.id, m.bot, m.salt, m.mech, m.v16, m.opts, m.label, m.relaxed));
    } else {
      void runCareer(m.c, m.runs, m.bot, m.days, m.meta, m.v16).then((o) => parentPort?.postMessage(o));
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
/** Share of runs that reach 11:00 AM on Day 1: the comfort ladder steps down below it (COMFORT_STEPS.down). */
const past11 = (rs: RunOut[]): number => rs.filter((r) => !r.died || r.minutes >= 300).length / Math.max(1, rs.length);
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

/**
 * v1.5 mechanics table (--mech): per row, per daylight minute and per day reached, blooms, snaps,
 * frost meters filled and buds passed, deep shade's share of daylight, and the median death against
 * the same bot's no-mechanics row.
 */
function mechTable(rows: { j: Job; rs: RunOut[] }[], days: number): void {
  console.log('\nCore mechanics (v1.5): per daylight minute | per day reached');
  console.log(`${'row'.padEnd(30)} ${'blooms'.padEnd(12)} ${'snaps'.padEnd(12)} ${'frost full'.padEnd(12)} ${'buds passed'.padEnd(12)} deep%  median death (vs no mech)`);
  for (const { j, rs } of rows) {
    const min = sum(rs, (r) => r.daylight) / 3600;
    const dayCount = sum(rs, (r) => r.day - 1 + (r.died ? r.minutes % 720 : 720) / 720);
    const per = (f: (r: RunOut) => number): string => `${(sum(rs, f) / Math.max(1e-9, min)).toFixed(2)} | ${(sum(rs, f) / Math.max(1e-9, dayCount)).toFixed(2)}`.padEnd(12);
    const twin = rows.find((o) => o.j.bot === j.bot && o.j.profile === j.profile && !o.j.noMech !== !j.noMech && o.j.rung === j.rung && o.j.forecast === j.forecast);
    const vs = twin && !j.noMech ? ` (no mech ${clockOf(median(deathMinutes(twin.rs)), days)})` : '';
    console.log(
      `${jobName(j).padEnd(30)} ${per((r) => r.blooms)} ${per((r) => r.snaps)} ${per((r) => r.frostReady)} ${per((r) => r.budsPassed)} ${`${((100 * sum(rs, (r) => r.deepSec)) / Math.max(1e-9, min * 60)).toFixed(1)}`.padStart(5)}  ${clockOf(median(deathMinutes(rs)), days)}${vs}`,
    );
  }
}

function jobName(j: Job): string {
  if (j.label !== undefined) return j.label;
  const extra = [j.drain !== undefined ? `@${j.drain}` : '', j.noonCloud !== undefined ? ` nc${j.noonCloud}` : '', j.forecast ? ` ${j.forecast}` : ''].join('');
  const o = j.opts;
  const opt = o ? [o.policy, o.snap, o.preAim ? 'preAim' : undefined, o.feats ? 'feats' : undefined].filter((x) => x !== undefined).map((x) => ` ${x}`).join('') : '';
  const nm = (j.noMech ? (j.bot === 'reactive' ? ' dial' : ' no mech') : '') + opt;
  return j.rung !== undefined ? `${j.bot} R${j.rung} (p${j.profile}${extra})${nm}` : `${j.bot} p${j.profile}${extra}${nm}`;
}

// ---------------------------------------------------------------------------------------------
// v1.6 flags (docs/V1_6_PLAN.md §10, amendment A1: no --rules)

/** --off ring,bank,…: the v1.6 rules switched off on every row ({} when none). */
function offArg(): Partial<V16Rules> {
  const raw = arg('off', '');
  const off: { -readonly [K in keyof V16Rules]?: boolean } = {};
  if (raw === '') return off;
  for (const name of raw.split(',')) {
    if (!(V16_RULES as readonly string[]).includes(name)) throw new Error(`unknown v1.6 rule ${name} (one of ${V16_RULES.join(', ')})`);
    off[name as keyof V16Rules] = false;
  }
  return off;
}

/** --policy plain|chase|naive|safe: the reactive rows' policy (null when unset). */
function policyArg(): BotPolicy | null {
  const raw = arg('policy', '');
  if (raw === '') return null;
  if (!(BOT_POLICIES as readonly string[]).includes(raw)) throw new Error(`unknown policy ${raw} (one of ${BOT_POLICIES.join(', ')})`);
  return raw as BotPolicy;
}

/** Applies --off to a job (its own v16 keys win). */
function withOff(j: Job, off: Partial<V16Rules>): Job {
  return Object.keys(off).length === 0 ? j : { ...j, v16: { ...off, ...j.v16 } };
}

/** "" or ", v1.6 off: ring, bank" for the report headers. */
function offNote(off: Partial<V16Rules>): string {
  const names = Object.keys(off);
  return names.length === 0 ? '' : `, v1.6 off: ${names.join(', ')}`;
}

/** The finished runs of job `ji` as the v1.6 modules see them. */
function rowOf(j: Job, rs: RunOut[]): Sim16Row {
  return { name: jobName(j), job: j, runs: rs.map((r) => ({ seed: r.seed, died: r.died, minutes: r.minutes, day: r.day, ticks: r.ticks, daylight: r.daylight, m: r.m })) };
}

/** Plays every job on seeds 1..seeds in the pool; one row per job, in order. */
async function runRows(jobs: readonly Job[], seeds: number, days: number, workers: number): Promise<Sim16Row[]> {
  const msgs: WorkerMsg[] = [];
  jobs.forEach((job, ji) => {
    for (let seed = 1; seed <= seeds; seed++) msgs.push({ kind: 'run', job, task: { job: ji, seed, days, timeGen: job.bot === 'oracle' } });
  });
  const results = await pool<RunOut>(msgs, workers);
  return jobs.map((j, ji) => rowOf(j, results.filter((r) => r.job === ji)));
}

/** The v1.6 context handed to the report modules (failures land in `failures`). */
function sim16Ctx(o: { seeds: number; days: number; workers: number; check: boolean; margin: number; off: Partial<V16Rules>; policy: BotPolicy | null }, failures: string[]): Sim16Ctx {
  return {
    ...o,
    hours: process.argv.includes('--hours'),
    run: (jobs) => runRows(jobs.map((j) => withOff(j, o.off)), o.seeds, o.days, o.workers),
    fail: (what) => {
      failures.push(what);
    },
  };
}

/** Comfort-rung rows for the human model (R0 with the lesson; R1-R4 after it). */
function rungJobs(bot: BotKind): Job[] {
  return [0, 1, 2, 3, 4].map((rung) => {
    const rc = rungConfig(rung, { tutorialDone: rung > 0 });
    return { bot, profile: rc.profile, drain: rc.drain, noonCloud: rc.noonCloud, lesson: rc.lesson, rung };
  });
}

async function careerMain(workers: number, days: number, off: Partial<V16Rules>): Promise<void> {
  const careers = Number(arg('career', '20'));
  const runs = Number(arg('runs', '40'));
  const bot = arg('bot', 'humanDial') as BotKind;
  const withMeta = process.argv.includes('--meta');
  if (!BOT_KINDS.includes(bot)) throw new Error(`unknown bot ${bot}`);
  const t0 = performance.now();
  const v16 = Object.keys(off).length > 0 ? off : undefined;
  const msgs: WorkerMsg[] = Array.from({ length: careers }, (_, c) => ({ kind: 'career', c, runs, bot, days, meta: withMeta, ...(v16 ? { v16 } : {}) }));
  const out = await pool<CareerOut>(msgs, workers);
  const wall = (performance.now() - t0) / 1000;
  console.log(`SHADY career sim: ${careers} careers × ${runs} runs, bot ${bot}${withMeta ? ', meta' : ''}${offNote(off)}, ${workers} workers, ${wall.toFixed(1)} s\n`);
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
  // The climb to standard (fix round 2): how often careers enter R4, and how the first run there goes.
  let promotions = 0;
  const firstAt4: CareerRun[] = [];
  for (const o of out) {
    o.runs.forEach((run, i) => {
      if (run.rung === 4 && (i === 0 || (o.runs[i - 1] as CareerRun).rung !== 4)) {
        promotions++;
        firstAt4.push(run);
      }
    });
  }
  const at4 = out.flatMap((o) => o.runs.filter((r) => r.rung === 4 && !r.warmup));
  const by20 = out.filter((o) => o.runs.slice(0, 20).some((r) => r.rung === 4)).length;
  if (firstAt4.length > 0) {
    console.log(
      `climb to standard: ${(promotions / out.length).toFixed(2)} entries into R4 per career; first run there (warm-up) median ${median(firstAt4.map((r) => r.sec)).toFixed(1)} s, ${((100 * firstAt4.filter((r) => r.sec < 15).length) / firstAt4.length).toFixed(0)}% under 15 s; standard runs median ${at4.length ? median(at4.map((r) => r.sec)).toFixed(1) : '–'} s; ${((100 * by20) / out.length).toFixed(0)}% of careers reach R4 within 20 runs`,
    );
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
  const api = await loadMeta();
  const catalog = api.COSMETICS.length;
  console.log(`meta: catalog owned ${((100 * out.reduce((a, o) => a + o.owned, 0)) / (out.length * catalog)).toFixed(1)}% of ${catalog} (mean over careers)`);
  console.log('meta: achievements unlocked (% of careers):');
  for (const a of api.ACHIEVEMENTS) console.log(`  ${a.id.padEnd(16)} ${((100 * out.filter((o) => o.achievements.includes(a.id)).length) / out.length).toFixed(0)}%`);
}

/** The --campaign rows: the v1.5 bots, and v1.6's Feat-seeking oracle and humanFeat (docs/V1_6_PLAN.md §2.6). */
const CAMPAIGN_BOTS: readonly string[] = ['oracle', 'reactive', 'humanDial', 'oracle+feats', 'humanFeat'];

async function campaignMain(workers: number, off: Partial<V16Rules>): Promise<void> {
  const levelArg = arg('level', '');
  const botArg = arg('bot', 'all');
  // --tries N: the human models play each level N times (another player's decisions each try).
  const tries = Math.max(1, Number(arg('tries', '1')));
  const bots: string[] = botArg === 'all' ? [...CAMPAIGN_BOTS] : botArg.split(',');
  const kindOf = (b: string): BotKind => (b === 'oracle+feats' ? 'oracle' : (b as BotKind));
  for (const b of bots) if (!BOT_KINDS.includes(kindOf(b))) throw new Error(`unknown bot ${b}`);
  const ids = levelArg !== '' ? levelArg.split(',').map(Number) : Array.from({ length: LEVEL_COUNT }, (_, i) => i + 1);
  for (const id of ids) if (!CAMPAIGN_LEVELS[id - 1]) throw new Error(`unknown level ${id}`);
  const msgs: WorkerMsg[] = [];
  const mech = !process.argv.includes('--nomech');
  const v16 = Object.keys(off).length > 0 ? off : undefined;
  for (const id of ids) {
    for (const bot of bots) {
      const l = CAMPAIGN_LEVELS[id - 1] as LevelDef;
      const extra = { ...(v16 ? { v16 } : {}), ...(bot === 'oracle+feats' ? { opts: { feats: true }, label: bot } : {}), ...(bot === 'reactive' && verbGoal(l) ? { relaxed: true } : {}) };
      for (let t = 0; t < (bot.startsWith('human') ? tries : 1); t++) msgs.push({ kind: 'level', id, bot: kindOf(bot), salt: t, mech, ...extra });
    }
  }
  const t0 = performance.now();
  const outs = await pool<LevelOut>(msgs, workers);
  const wall = (performance.now() - t0) / 1000;
  const of = (bot: string, lo = 1, hi = LEVEL_COUNT): LevelOut[] => outs.filter((o) => o.bot === bot && o.id >= lo && o.id <= hi);
  console.log(`SHADY Journey sim: ${ids.length} level(s) × ${bots.join('/')}${tries > 1 ? ` (human ×${tries})` : ''}${mech ? '' : ', bots ignore the v1.5 mechanics'}${offNote(off)}, ${workers} workers, ${wall.toFixed(1)} s\n`);
  const cell = (rs: LevelOut[]): string => {
    const o = rs[0];
    if (!o) return '-'.padEnd(22);
    const mark = o.passed ? `${'★'.repeat(o.stars)}${'☆'.repeat(3 - o.stars)}` : o.phase === 'won' ? 'goal✗' : `melt ${(100 * o.progress).toFixed(0)}%`;
    const n = rs.length > 1 ? `${rs.filter((r) => r.passed).length}/${rs.length} ` : '';
    return `${n}${mark}${o.featMet ? 'D' : ' '} f${o.flakes} c${Math.max(0, o.minChill).toFixed(0)}`.padEnd(22);
  };
  console.log(`${'lvl'.padEnd(4)} ${'name'.padEnd(18)} ${'start+len'.padEnd(9)} ${'goal'.padEnd(12)} ${'dare'.padEnd(14)} ${'drain'.padEnd(5)} ${bots.map((b) => b.padEnd(22)).join(' ')} concepts`);
  for (const id of ids) {
    const l = CAMPAIGN_LEVELS[id - 1] as LevelDef;
    const goal = l.goal.kind === 'finish' ? 'finish' : `${l.goal.kind} ${l.goal.target}`;
    const dare = l.feats.map((f) => `${f.kind} ${f.target}`).join('|');
    console.log(
      `${String(id).padEnd(4)} ${l.name.padEnd(18)} ${`${l.startMinute}+${l.lengthMinutes}`.padEnd(9)} ${goal.padEnd(12)} ${dare.padEnd(14)} ${String(l.drain).padEnd(5)} ${bots.map((b) => cell(of(b, id, id))).join(' ')} ${l.concepts.join(',')}`,
    );
  }
  const pct = (rs: LevelOut[]): number => (100 * rs.filter((o) => o.passed).length) / Math.max(1, rs.length);
  const meanStars = (rs: LevelOut[]): number => rs.reduce((a, o) => a + o.stars, 0) / Math.max(1, rs.length);
  console.log('\nSummary:');
  for (const bot of bots) {
    const rs = of(bot);
    console.log(
      `  ${bot.padEnd(13)} passed ${pct(rs).toFixed(1)}% of ${rs.length}, stars ${meanStars(rs).toFixed(2)}/level (1-40: ${meanStars(of(bot, 1, 40)).toFixed(2)}, 41-200: ${meanStars(of(bot, 41, 200)).toFixed(2)}), 3-star ${rs.filter((o) => o.stars === 3).length}, Dare met ${((100 * rs.filter((o) => o.featMet).length) / Math.max(1, rs.length)).toFixed(1)}%, melted ${rs.filter((o) => o.phase === 'dead').length}, goal missed ${rs.filter((o) => o.phase === 'won' && !o.passed).length}, ${(rs.reduce((a, o) => a + o.ms, 0) / Math.max(1, rs.length)).toFixed(0)} ms/level`,
    );
  }
  // Per chapter: pass % and mean stars for each bot (the chapter ramp).
  console.log(`\n  ${'chapter'.padEnd(8)} ${bots.map((b) => `${b} pass ★`.padEnd(20)).join(' ')}`);
  for (let c = 1; c <= LEVEL_COUNT / 10; c++) {
    if (!ids.some((id) => Math.ceil(id / 10) === c)) continue;
    console.log(`  ${String(c).padEnd(8)} ${bots.map((b) => `${pct(of(b, c * 10 - 9, c * 10)).toFixed(0)}% ${meanStars(of(b, c * 10 - 9, c * 10)).toFixed(2)}`.padEnd(20)).join(' ')}`);
  }
  // v1.6 Dares by kind (a level counts under its first Dare's kind): met share per bot.
  const dareKinds = [...new Set(ids.map((id) => String((CAMPAIGN_LEVELS[id - 1] as LevelDef).feats[0]?.kind ?? '')))].filter((k) => k !== '');
  console.log(`\n  Dares met by kind (levels whose first Dare it is): ${bots.map((b) => b.padEnd(13)).join(' ')}`);
  for (const k of dareKinds) {
    const levels = ids.filter((id) => (CAMPAIGN_LEVELS[id - 1] as LevelDef).feats[0]?.kind === k);
    const cellK = (b: string): string => {
      const rs = outs.filter((o) => o.bot === b && levels.includes(o.id));
      return `${((100 * rs.filter((o) => o.featMet).length) / Math.max(1, rs.length)).toFixed(0)}%`.padEnd(13);
    };
    console.log(`  ${k.padEnd(10)} ${String(levels.length).padStart(3)} levels                          ${bots.map(cellK).join(' ')}`);
  }
  const worlds = new Map<number, LevelOut>();
  for (const o of outs) if (!worlds.has(o.id) || o.chunks > (worlds.get(o.id) as LevelOut).chunks) worlds.set(o.id, o);
  const ws = [...worlds.values()];
  const chunks = ws.reduce((a, o) => a + o.chunks, 0);
  console.log(`  worlds: ${chunks} chunks, rescues/chunk ${(ws.reduce((a, o) => a + o.rescues, 0) / Math.max(1, chunks)).toFixed(3)}, unresolved ${ws.reduce((a, o) => a + o.unresolved, 0)}`);

  // Gates (CAMPAIGN_PLAN §3 "Fairness", docs/V1_6_PLAN.md §2.6).
  const failures: string[] = [];
  const line = (hard: boolean, ok: boolean, what: string, got: string): void => {
    if (hard && !ok) failures.push(what);
    console.log(`  ${ok ? 'PASS' : hard ? 'FAIL' : 'MISS'}  ${what}: ${got}`);
  };
  const gate = (hard: boolean, what: string, bot: string, hi: number, bar: number): void => {
    if (!bots.includes(bot)) return;
    const rs = of(bot, 1, hi);
    const p = pct(rs);
    const failed = [...new Set(rs.filter((o) => !o.passed).map((o) => o.id))];
    line(hard, rs.length > 0 && p >= 100 * bar, what, `${p.toFixed(1)}% of ${rs.length}${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`);
  };
  console.log('\nGates:');
  gate(true, 'oracle passes every level (verb goals included)', 'oracle', LEVEL_COUNT, 1);
  gate(true, 'reactive passes ≥ 95% of levels 1-100 (teaching verb goals scored as finish)', 'reactive', 100, 0.95);
  if (bots.includes('oracle+feats')) {
    const rs = of('oracle+feats');
    const p = rs.filter((o) => o.passed && o.featMet).length / Math.max(1, rs.length);
    const missed = rs.filter((o) => !(o.passed && o.featMet)).map((o) => o.id);
    line(true, p >= 0.85, 'the Feat-seeking oracle earns ★2 (goal and a Dare) on ≥ 85% of levels', `${(100 * p).toFixed(1)}%${missed.length ? ` (missed: ${missed.join(', ')})` : ''}`);
  }
  gate(false, 'humanDial passes ≥ 75% of levels 1-40 (advisory)', 'humanDial', 40, 0.75);
  if (bots.includes('humanDial')) {
    // The soft-fail: the player retries the level (the tries in order); a try after two goal misses
    // on it scores its goal as 'finish'. A level counts as passed when one of its tries passes.
    let pass = 0;
    let n = 0;
    let triesPassed = 0;
    let tries = 0;
    for (let id = 1; id <= Math.min(10, LEVEL_COUNT); id++) {
      if (!ids.includes(id)) continue;
      n++;
      let misses = 0;
      let ok = false;
      for (const o of [...of('humanDial', id, id)].sort((a, b) => a.salt - b.salt)) {
        tries++;
        const p = o.passed || (misses >= SOFT_FAIL_MISSES && o.phase === 'won');
        if (p) triesPassed++;
        else if (o.phase === 'won') misses++;
        if (p) ok = true;
      }
      if (ok) pass++;
    }
    line(false, n > 0 && pass >= 0.9 * n, 'humanDial passes ≥ 90% of levels 1-10 with the soft-fail (advisory)', `${((100 * pass) / Math.max(1, n)).toFixed(1)}% of ${n} levels (${((100 * triesPassed) / Math.max(1, tries)).toFixed(1)}% of ${tries} tries)`);
    const ms = meanStars(of('humanDial', 41, 200));
    line(false, ms >= 0.95, 'humanDial mean stars on 41-200 ≥ 0.95 (advisory)', ms.toFixed(2));
  }
  if (bots.includes('reactive')) {
    const rs = of('reactive', 41, 200);
    const three = rs.filter((o) => o.stars === 3).length / Math.max(1, rs.length);
    line(false, three <= 0.5, 'reactive three-star share on 41-200 ≤ 50% (advisory)', `${(100 * three).toFixed(1)}%`);
  }
  // Per Dare kind (advisory): non-seeking reactive and oracle ≤ 35%, the seeking oracle ≥ 85%, humanFeat ≥ 50%.
  for (const k of dareKinds) {
    const levels = ids.filter((id) => (CAMPAIGN_LEVELS[id - 1] as LevelDef).feats.some((f) => f.kind === k));
    const share = (b: string): number => {
      const rs = outs.filter((o) => o.bot === b && levels.includes(o.id));
      return rs.length ? rs.filter((o) => o.featMet).length / rs.length : NaN;
    };
    const parts = [
      ['reactive', share('reactive'), (v: number) => v <= 0.35],
      ['oracle', share('oracle'), (v: number) => v <= 0.35],
      ['oracle+feats', share('oracle+feats'), (v: number) => v >= 0.85],
      ['humanFeat', share('humanFeat'), (v: number) => v >= 0.5],
    ] as const;
    const shown = parts.filter(([, v]) => !Number.isNaN(v));
    if (shown.length === 0) continue;
    const ok = shown.every(([, v, f]) => f(v));
    console.log(`  ${ok ? 'PASS' : 'MISS'}  Dare '${k}' (${levels.length} levels; advisory): ${shown.map(([b, v]) => `${b} ${(100 * v).toFixed(0)}%`).join(', ')}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} gate(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll hard gates met.');
}

async function main(): Promise<void> {
  const seeds = Number(arg('seeds', '100'));
  const days = Number(arg('days', '8'));
  const workers = Math.max(1, Number(arg('workers', String(Math.min(4, availableParallelism())))));
  const off = offArg();
  const policy = policyArg();
  const check = process.argv.includes('--check');
  const margin = Number(arg('margin', '3'));
  const failures: string[] = [];
  // v1.6 modes (--decisions, --bake): a module's own run instead of the report.
  for (const mod of SIM16) {
    for (const [mode, fn] of Object.entries(mod.modes ?? {})) {
      if (!process.argv.includes(`--${mode}`)) continue;
      await fn(sim16Ctx({ seeds, days, workers, check, margin, off, policy }, failures));
      if (failures.length) {
        console.log(`\n${failures.length} target(s) failed.`);
        process.exit(1);
      }
      return;
    }
  }
  if (process.argv.includes('--campaign')) return campaignMain(workers, off);
  if (process.argv.includes('--career')) return careerMain(workers, days, off);
  const botArg = arg('bot', 'all');
  const profileArg = arg('profile', '');
  const forced = arg('forecast', '') as ForecastId | '';
  const mechRows = process.argv.includes('--mech');
  if (botArg !== 'all' && !BOT_KINDS.includes(botArg as BotKind)) throw new Error(`unknown bot ${botArg}`);
  if (forced && !FORECAST_IDS.includes(forced)) throw new Error(`unknown forecast ${forced}`);
  const fc = forced || undefined;

  const withFc = (j: Job): Job => (fc ? { ...j, forecast: fc } : j);
  let base: Job[] = [
    { bot: 'idle', profile: 3 },
    { bot: 'idle', profile: 0 },
    { bot: 'novice', profile: 3 },
    { bot: 'novice', profile: 0 },
    { bot: 'reactive', profile: 3, noMech: true },
    { bot: 'oracle', profile: 3 },
    { bot: 'reactive', profile: 3 },
  ].map((j) => withFc(j as Job));
  if (mechRows) base.push(withFc({ bot: 'oracle', profile: 3, noMech: true }));
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
      ? FORECAST_IDS.flatMap((forecast) => (['idle', 'novice', 'reactive', 'oracle'] as BotKind[]).map((bot) => ({ bot, profile: 3 as ProfileId, forecast, ...(bot === 'reactive' ? { noMech: true } : {}) })))
      : [];
  // v1.6: --policy on the reactive rows that use the mechanics, --off on every row.
  if (policy !== null) base = base.map((j) => (j.bot === 'reactive' && !j.noMech ? { ...j, opts: { ...j.opts, policy } } : j));
  const jobs = [...base, ...advisory, ...forecastJobs].map((j) => withOff(j, off));

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

  console.log(`SHADY sim: ${seeds} seeds, up to Day ${days}, ${workers} workers, ${wall.toFixed(1)} s${fc ? `, forecast ${fc} forced` : ''}${offNote(off)}\n`);
  console.log(`${'row'.padEnd(30)} ${'median'.padEnd(17)} ${'p10'.padEnd(17)} ${'p90'.padEnd(17)} 11AM+  night  run s  melted%  Snow   sw/min  lit%   µs/tick`);
  const rowLine = (ji: number): void => {
    const rs = of(ji);
    const dm = deathMinutes(rs);
    const q = (p: number): string => clockOf(quantile(dm, p), days);
    const ticks = sum(rs, (r) => r.ticks);
    console.log(
      `${jobName(jobs[ji] as Job).padEnd(30)} ${q(0.5).padEnd(17)} ${q(0.1).padEnd(17)} ${q(0.9).padEnd(17)} ${`${(100 * past11(rs)).toFixed(0)}%`.padStart(5)}  ${`${(100 * firstNight(rs)).toFixed(0)}%`.padStart(5)}  ${medianSec(rs).toFixed(1).padStart(5)}  ${meltedPct(rs).toFixed(1).padStart(7)}  ${(sum(rs, (r) => r.snow) / rs.length).toFixed(1).padStart(5)}  ${swingsPerMin(rs).toFixed(2).padStart(6)}  ${(100 * litShare(rs)).toFixed(0).padStart(4)}%  ${((1000 * sum(rs, (r) => r.stepMs)) / Math.max(1, ticks)).toFixed(1).padStart(6)}`,
    );
  };
  base.forEach((_, ji) => rowLine(ji));
  if (advisory.length) {
    console.log('ADVISORY (perception-limited human model on the comfort rungs):');
    advisory.forEach((_, i) => rowLine(base.length + i));
  }

  mechTable(base.map((j, ji) => ({ j, rs: of(ji) })), days);

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
    { rung: 3, what: 'median run ≥ 60 s', ok: (rs) => medianSec(rs) >= 60, got: (rs) => `${medianSec(rs).toFixed(1)} s` },
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
  // Each assisted rung must ease the morning, not only the noon a player who melts at 10 AM never
  // sees: the share reaching 11:00 AM falls rung by rung from R1 to R4.
  const ladder = advisory.filter((j) => (j.rung ?? 0) >= 1).map((j) => past11(of(base.length + advisory.indexOf(j))));
  if (ladder.length >= 2) {
    const ok = ladder.every((v, i) => i === 0 || v < (ladder[i - 1] as number));
    advLines.push(`  ${ok ? 'PASS' : 'MISS'}  ${advisory[0]?.bot} 11:00 AM reached falls rung by rung R1 → R4: ${ladder.map((v) => `${(100 * v).toFixed(0)}%`).join(' → ')}`);
  }
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

  // v1.6 modules: their tables and gates over every row (their failures count under --check).
  const ctx = sim16Ctx({ seeds, days, workers, check, margin, off, policy }, failures);
  const rows = jobs.map((j, ji) => rowOf(j, of(ji)));
  for (const mod of SIM16) await mod.report?.(ctx, rows);

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
    const idle0 = at('idle', 0);
    if (idle0.length) {
      // CO4: the lesson floor holds for its whole 25 s, so even a player who never touches the sun lasts that long.
      const early = idle0.filter((r) => r.died && r.ticks - TUNING.start.readyTicks < TUNING.lesson.maxDaylightTicks).length;
      report(early === 0, `${label}idle p0 (lesson) never melts in its first 25 s of daylight`, `${early} of ${idle0.length} did`);
    }
    const rea = at('reactive', 3);
    if (rea.length) window(`${label}reactive p3 dial median death in [Day 2 noon, Day 4 noon]`, rea, 1080, 2520);
    const ora = at('oracle', 3);
    if (ora.length) {
      const ok = ora.filter((r) => !r.died && r.day >= 8).length / ora.length;
      report(ok === 1 && days >= 8, `${label}oracle p3 reaches Day 8 on 100%`, `${(100 * ok).toFixed(0)}%${days < 8 ? ` (only simulated to Day ${days})` : ''}`);
    }
  };
  gates('', (bot, profile) => of(base.findIndex((j) => j.bot === bot && j.profile === profile)), fc !== undefined);
  // v1.5: the mechanics must pay: the reactive bot using them outlives itself dial-only by ≥ 180 minutes.
  const dialJi = base.findIndex((j) => j.bot === 'reactive' && j.profile === 3 && j.noMech);
  const mechJi = base.findIndex((j) => j.bot === 'reactive' && j.profile === 3 && !j.noMech);
  if (dialJi >= 0 && mechJi >= 0) {
    const a = median(deathMinutes(of(dialJi)));
    const b = median(deathMinutes(of(mechJi)));
    report(b - a >= 180, 'reactive p3 using the v1.5 mechanics outlives reactive p3 dial by ≥ 180 minutes (median)', `${clockOf(b, days)} vs ${clockOf(a, days)} (+${b === Infinity ? '∞' : (b - a).toFixed(0)} min)`);
  }
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
