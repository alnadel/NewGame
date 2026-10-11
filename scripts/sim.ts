// Headless balance simulation and acceptance check (V1_PLAN §13).
//
//   node scripts/sim.ts [--seeds N] [--days D] [--bot idle|novice|reactive|oracle|all] [--profile P]
//                       [--check] [--margin PTS] [--workers W]
//
// Runs the real createRun/step with bot input at full speed in worker threads and prints, per bot
// and profile, death-time quantiles, first-night rate, flake stats and Snow, plus world stats
// (rescues per chunk, unresolved validator failures), generation ms/chunk and sim µs/tick.
// --check exits non-zero if any acceptance target fails, or passes by less than --margin
// percentage points of seeds (default 3), so a target that only just passes fails CI before a
// small tuning change or a different seed count tips it over:
//   - share targets ("≥ 90% of seeds"): the share must clear the bar by the margin (≥ 93%);
//   - median-window targets: at least 50% + margin of the seeds must die at or after the window's
//     start, and 50% + margin at or before its end (the median sits inside with room to spare).
// The oracle's 100% and the world targets are absolute and have no margin.

import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import type { ProfileId } from '../src/config/days.ts';
import { dayStartTick, dayStartY } from '../src/core/clock.ts';
import { formatScore } from '../src/core/format.ts';
import { ensureGenerated } from '../src/core/gen/world.ts';
import { BOT_KINDS, createBot, type BotKind } from '../src/core/sim/bots.ts';
import { createRun } from '../src/core/sim/create.ts';
import { headlessConfig } from '../src/core/sim/headless.ts';
import { step } from '../src/core/sim/step.ts';

interface Job {
  bot: BotKind;
  profile: ProfileId;
}

interface Task extends Job {
  seed: number;
  days: number;
  /** Pre-generate the whole world first to time generation separately from the sim. */
  timeGen: boolean;
}

interface RunOut extends Task {
  died: boolean;
  minutes: number;
  day: number;
  nights: number;
  flakes: number;
  flakesMelted: number;
  snow: number;
  ticks: number;
  stepMs: number;
  botMs: number;
  genMs: number;
  chunks: number;
  rescues: number;
  maxRescues: number;
  parked: number;
  unresolved: number;
}

// ---------------------------------------------------------------------------------------------
// Worker side

function runTask(t: Task): RunOut {
  const cfg = headlessConfig(t.seed, t.profile);
  let genMs = 0;
  const s = createRun(cfg);
  if (t.timeGen) {
    const g0 = performance.now();
    ensureGenerated(s.world, dayStartY(t.days) + 2000);
    genMs = performance.now() - g0;
  }
  const bot = createBot(t.bot);
  // Stop at death or at the dawn of Day `days` ("reaches Day D").
  const endTick = dayStartTick(t.days);
  // Bot decisions are timed per tick and subtracted, so stepMs is the cost of step() alone.
  let botMs = 0;
  const start = performance.now();
  while (s.phase !== 'dead' && s.tickAbs < endTick) {
    const b0 = performance.now();
    const f = bot.next(s);
    botMs += performance.now() - b0;
    step(s, f);
  }
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
    ...t,
    died: s.phase === 'dead',
    minutes: s.minutes,
    day: s.day,
    nights: s.stats.nightsReached,
    flakes: s.stats.flakes,
    flakesMelted: s.stats.flakesMelted,
    snow: s.stats.snow,
    ticks: s.tick,
    stepMs,
    botMs,
    genMs,
    chunks,
    rescues,
    maxRescues,
    parked: w.parkedClouds,
    unresolved: w.unresolved,
  };
}

if (!isMainThread) {
  const tasks = workerData as Task[];
  const out: RunOut[] = [];
  for (const t of tasks) out.push(runTask(t));
  parentPort?.postMessage(out);
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

/** "Day 1 · 9:37 AM", or "≥ Day 8" for runs that survived to the cap. */
function label(m: number, survived: boolean, days: number): string {
  return survived ? `≥ Day ${days}` : formatScore(m);
}

async function main(): Promise<void> {
  const seeds = Number(arg('seeds', '100'));
  const days = Number(arg('days', '8'));
  const botArg = arg('bot', 'all');
  const profileArg = arg('profile', '');
  const check = process.argv.includes('--check');
  const margin = Number(arg('margin', '3'));
  const workers = Math.max(1, Number(arg('workers', String(Math.min(4, availableParallelism())))));

  const all: Job[] = [
    { bot: 'idle', profile: 3 },
    { bot: 'novice', profile: 3 },
    { bot: 'novice', profile: 0 },
    { bot: 'reactive', profile: 3 },
    { bot: 'oracle', profile: 3 },
  ];
  let jobs = botArg === 'all' ? all : all.filter((j) => j.bot === botArg);
  if (botArg !== 'all' && !BOT_KINDS.includes(botArg as BotKind)) throw new Error(`unknown bot ${botArg}`);
  if (profileArg !== '') {
    const p = Number(profileArg) as ProfileId;
    const bots = [...new Set(jobs.map((j) => j.bot))];
    jobs = bots.map((bot) => ({ bot, profile: p }));
  }

  const tasks: Task[] = [];
  for (const j of jobs) {
    for (let seed = 1; seed <= seeds; seed++) tasks.push({ ...j, seed, days, timeGen: j.bot === 'oracle' });
  }
  // Interleave so every worker gets a similar mix of long and short runs.
  const buckets: Task[][] = Array.from({ length: workers }, () => []);
  tasks.forEach((t, i) => buckets[i % workers]?.push(t));
  const t0 = performance.now();
  const results = (
    await Promise.all(
      buckets.map(
        (b) =>
          new Promise<RunOut[]>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: b });
            w.once('message', resolve);
            w.once('error', reject);
          }),
      ),
    )
  ).flat();
  const wall = (performance.now() - t0) / 1000;

  const failures: string[] = [];
  const targetMet = (ok: boolean, what: string): string => {
    if (!ok) failures.push(what);
    return ok ? 'PASS' : 'FAIL';
  };

  console.log(`SHADY sim: ${seeds} seeds, up to Day ${days}, ${workers} workers, ${wall.toFixed(1)} s\n`);
  for (const j of jobs) {
    const rs = results.filter((r) => r.bot === j.bot && r.profile === j.profile);
    const keyed = rs.map((r) => (r.died ? r.minutes : Infinity)).sort((a, b) => a - b);
    const q = (p: number): string => {
      const v = quantile(keyed, p);
      return v === Infinity ? label(0, true, days) : label(v, false, days);
    };
    const night = rs.filter((r) => !r.died || r.minutes >= 720).length / rs.length;
    const flakes = rs.reduce((a, r) => a + r.flakes, 0);
    const melted = rs.reduce((a, r) => a + r.flakesMelted, 0);
    const snow = rs.reduce((a, r) => a + r.snow, 0) / rs.length;
    const ticks = rs.reduce((a, r) => a + r.ticks, 0);
    const stepMs = rs.reduce((a, r) => a + r.stepMs, 0);
    console.log(`${j.bot.padEnd(8)} p${j.profile}  median ${q(0.5).padEnd(17)} p10 ${q(0.1).padEnd(17)} p90 ${q(0.9).padEnd(17)}`);
    console.log(
      `             first night ${(100 * night).toFixed(0)}%  flakes ${flakes} collected / ${melted} melted (${((100 * melted) / Math.max(1, flakes + melted)).toFixed(0)}% melted)  mean Snow ${snow.toFixed(1)}  step ${((1000 * stepMs) / Math.max(1, ticks)).toFixed(1)} µs/tick${j.bot === 'oracle' ? ' (world pre-generated)' : ' (incl. in-step generation)'}`,
    );
  }

  console.log('\nWorld (validator):');
  for (const profile of [...new Set(jobs.map((j) => j.profile))]) {
    // Each seed's deepest run for this profile covers the most chunks.
    const bySeed = new Map<number, RunOut>();
    for (const r of results) {
      if (r.profile !== profile) continue;
      const cur = bySeed.get(r.seed);
      if (!cur || r.chunks > cur.chunks) bySeed.set(r.seed, r);
    }
    const ws = [...bySeed.values()];
    const chunks = ws.reduce((a, r) => a + r.chunks, 0);
    const rescues = ws.reduce((a, r) => a + r.rescues, 0);
    const maxR = ws.reduce((a, r) => Math.max(a, r.maxRescues), 0);
    const unresolved = ws.reduce((a, r) => a + r.unresolved, 0);
    const parked = ws.reduce((a, r) => a + r.parked, 0);
    const gen = ws.filter((r) => r.timeGen);
    const genMs = gen.reduce((a, r) => a + r.genMs, 0);
    const genChunks = gen.reduce((a, r) => a + r.chunks, 0);
    console.log(
      `  p${profile}: ${chunks} chunks, rescues/chunk mean ${(rescues / Math.max(1, chunks)).toFixed(3)} max ${maxR}, parked clouds ${parked}, unresolved ${unresolved}` +
        (genChunks > 0 ? `, gen+validate ${(genMs / genChunks).toFixed(2)} ms/chunk` : ''),
    );
    if (check) {
      targetMet(rescues / Math.max(1, chunks) <= 1.0, `p${profile} mean rescues per chunk ≤ 1.0`);
      targetMet(unresolved === 0, `p${profile} unresolved = 0`);
    }
  }

  if (check) {
    console.log(`\nAcceptance (V1_PLAN §13), required margin ${margin} points:`);
    const runs = (bot: BotKind, profile: ProfileId): RunOut[] => results.filter((r) => r.bot === bot && r.profile === profile);
    const median = (rs: RunOut[]): number => quantile(rs.map((r) => (r.died ? r.minutes : Infinity)).sort((a, b) => a - b), 0.5);
    const report = (ok: boolean, what: string, got: string): void => console.log(`  ${targetMet(ok, what)}  ${what}: ${got}`);
    const pts = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`;
    /** A share target: `share` of the seeds must reach `bar`, by at least the margin. */
    const share = (what: string, got: number, bar: number): void => {
      const m = 100 * (got - bar);
      report(m >= 0, what, `${(100 * got).toFixed(1)}% (margin ${pts(m)})`);
      if (m >= 0 && m < margin) report(false, `${what} with a ${margin}-point margin`, pts(m));
    };
    /** A median-window target: the median death in [lo, hi] minutes, with the margin on both sides. */
    const window = (what: string, rs: RunOut[], lo: number, hi: number): void => {
      const m = median(rs);
      const after = (100 * rs.filter((r) => !r.died || r.minutes >= lo).length) / rs.length - 50;
      const before = (100 * rs.filter((r) => r.died && r.minutes <= hi).length) / rs.length - 50;
      const got = m === Infinity ? 'survived' : formatScore(m);
      report(m >= lo && m <= hi, what, `${got} (margin ${pts(Math.min(after, before))}: ${pts(after)} after the start, ${pts(before)} before the end)`);
      if (m >= lo && m <= hi && Math.min(after, before) < margin) report(false, `${what} with a ${margin}-point margin`, pts(Math.min(after, before)));
    };
    const idle = runs('idle', 3);
    if (idle.length) {
      const early = idle.filter((r) => r.died && r.minutes < 120).length / idle.length;
      share('idle p3 dies before 8:00 AM Day 1 on ≥ 90%', early, 0.9);
    }
    const nov3 = runs('novice', 3);
    if (nov3.length) window('novice p3 median death in [Day 1 10:00 AM, Day 1 3:00 PM]', nov3, 240, 540);
    const nov0 = runs('novice', 0);
    if (nov0.length) {
      const night = nov0.filter((r) => !r.died || r.minutes >= 720).length / nov0.length;
      share('novice p0 reaches the first night on ≥ 75%', night, 0.75);
    }
    const rea = runs('reactive', 3);
    if (rea.length) window('reactive p3 median death in [Day 2 noon, Day 4 noon]', rea, 1080, 2520);
    const ora = runs('oracle', 3);
    if (ora.length) {
      const ok = ora.filter((r) => !r.died && r.day >= 8).length / ora.length;
      report(ok === 1 && days >= 8, 'oracle p3 reaches Day 8 on 100%', `${(100 * ok).toFixed(0)}%${days < 8 ? ` (only simulated to Day ${days})` : ''}`);
    }
    if (failures.length) {
      console.log(`\n${failures.length} target(s) failed.`);
      process.exit(1);
    }
    console.log('\nAll targets met.');
  }
}

if (isMainThread) await main();
