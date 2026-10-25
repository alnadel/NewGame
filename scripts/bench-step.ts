// Replay benchmark for docs/V1_6_PLAN.md §13 ("step() µs/tick within +10% of v1.5, guide refresh
// ≤ 1.5× v1.5"): HEAD's core against a base revision's, loaded side by side in one process.
//
//   node scripts/bench-step.ts [--base c956421 | --base-dir DIR] [--head-dir DIR] [--bot reactive|oracle] [--seeds 12] [--days 4] [--reps 9] [--check]
//   node scripts/bench-step.ts --gen [--base …] [--seeds 30] [--days 4] [--reps 3] [--check]
//   node scripts/bench-step.ts --drive [--seeds 12] [--days 4] [--reps 3] [--check]
//
// Each variant records its own bot's input frames on seeds 1000.. (profile 3, mechanics on), then
// replays them on fresh runs whose worlds are generated up front, so only step() is timed (the bot
// and world generation are not). Passes alternate between the variants (min and median of --reps);
// the guide refresh is timed by calling updateGuide on every sunlit refresh tick of a replay. The
// base revision's src/ is extracted with `git archive` into a temporary folder (--base-dir: a tree
// already extracted; --head-dir: another working tree than this script's). --check exits 1 when
// step() is over +10% or the guide refresh over 1.5× (medians).
//
// --gen times idle world generation instead, the way the session runs it: generateSome(w, y + 2400,
// 12) once a 60 Hz frame with y at Nubs' scheduled place (seeds 3000.., default 30 seeds, at least
// 3 alternating reps; each figure is the median over the reps). Both trees are read on the same
// population: the p99 slice is the k-th largest slice with k = 1% of the base's working slices (a
// tree that does work on more frames would otherwise dilute its own p99 with small slices: review
// r5), beside the frames over 1, 2 and 4 ms a minute and the ms per validated chunk. --check exits 1
// when HEAD's p99 slice or its frames over 1 or 2 ms a minute are over 1.1 × the base's, or its p99
// is over 1.5 ms while the base's is not (fix round 2: glass contests ran inside a chunk placement,
// 20 ms; a loaded machine pushes the base over 1.5 ms too, and then only the paired bars decide).
//
// --drive times the Controls v3 driver on HEAD alone (docs/CONTROLS_V3.md §12.4: ≤ 5 µs per tick
// median on an Endless noon): its fill on the reactive bot's frames (copied) with a press every 20
// ticks, called every tick and timed from 11:00 AM to 1:00 PM of each day (seeds 1000.., profile 3,
// the median over the timed ticks of each rep, then over --reps 3). --check exits 1 over 5 µs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

const base = arg('base', 'c956421');
const botKind = arg('bot', 'reactive');
const gen = process.argv.includes('--gen');
const drive = process.argv.includes('--drive');
const seeds = Number(arg('seeds', gen ? '30' : '12'));
const days = Number(arg('days', '4'));
const reps = Math.max(gen ? 3 : 1, Number(arg('reps', gen || drive ? '3' : '9')));
const check = process.argv.includes('--check');
const ROOT = arg('head-dir', HERE);
const baseDir = arg('base-dir', '');

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Core {
  createRun: (cfg: any) => any;
  step: (s: any, f: any) => void;
  createBot: (kind: string, salt: number, mech: boolean) => { next(s: any): any };
  headlessConfig: (seed: number, profile: number) => any;
  updateGuide: (s: any) => void;
  guideDue: (s: any) => boolean;
  dayStartTick: (d: number) => number;
  dayStartY: (d: number) => number;
  ensureGenerated: (w: any, y: number) => void;
  generateSome: (w: any, y: number, budget: number) => boolean;
  worldYAtTick: (w: any, t: number) => number;
}

async function load(root: string): Promise<Core> {
  const imp = async (p: string): Promise<any> => import(pathToFileURL(join(root, p)).href);
  const [create, step, bots, headless, guide, clock, world, plan] = await Promise.all([
    imp('src/core/sim/create.ts'),
    imp('src/core/sim/step.ts'),
    imp('src/core/sim/bots.ts'),
    imp('src/core/sim/headless.ts'),
    imp('src/core/sim/guide.ts'),
    imp('src/core/clock.ts'),
    imp('src/core/gen/world.ts'),
    imp('src/core/gen/plan.ts'),
  ]);
  return {
    createRun: create.createRun,
    step: step.step,
    createBot: bots.createBot,
    headlessConfig: headless.headlessConfig,
    updateGuide: guide.updateGuide,
    guideDue: guide.guideDue,
    dayStartTick: clock.dayStartTick,
    dayStartY: clock.dayStartY,
    ensureGenerated: world.ensureGenerated,
    generateSome: world.generateSome,
    worldYAtTick: plan.worldYAtTick,
  };
}

/** Idle generation slices over seeds 3000.. (ms each, frames that did work), the frames counted, and the chunks validated. */
function genSlices(m: Core): { ms: number[]; frames: number; chunks: number } {
  const ms: number[] = [];
  let frames = 0;
  let chunks = 0;
  for (let i = 0; i < seeds; i++) {
    const s = m.createRun(m.headlessConfig(3000 + i, 3));
    const w = s.world;
    const c0 = w.stats.chunksValidated as number;
    for (let t = m.dayStartTick(1); t < m.dayStartTick(days); t++) {
      const t0 = performance.now();
      const done = m.generateSome(w, m.worldYAtTick(w, t) + 2400, 12);
      const dt = performance.now() - t0;
      frames++;
      if (!done || dt > 0.05) ms.push(dt);
    }
    chunks += (w.stats.chunksValidated as number) - c0;
  }
  return { ms, frames, chunks };
}

interface Variant {
  label: string;
  m: Core;
  recs: any[][];
  ticks: number;
  stepUs: number[];
  guideUs: number[];
}

function fresh(m: Core, i: number): any {
  const s = m.createRun(m.headlessConfig(1000 + i, 3));
  m.ensureGenerated(s.world, m.dayStartY(days) + 2000);
  return s;
}

function record(label: string, m: Core): Variant {
  const end = m.dayStartTick(days);
  const recs: any[][] = [];
  for (let i = 0; i < seeds; i++) {
    const s = fresh(m, i);
    const b = m.createBot(botKind, 0, true);
    const fr: any[] = [];
    while (s.phase !== 'dead' && s.phase !== 'won' && s.tickAbs < end) {
      const f = b.next(s);
      fr.push({ ...f });
      m.step(s, f);
    }
    recs.push(fr);
  }
  return { label, m, recs, ticks: recs.reduce((a, r) => a + r.length, 0), stepUs: [], guideUs: [] };
}

function passStep(v: Variant): number {
  let t = 0;
  for (let i = 0; i < seeds; i++) {
    const s = fresh(v.m, i);
    const fr = v.recs[i] as any[];
    const t0 = performance.now();
    for (let k = 0; k < fr.length; k++) v.m.step(s, fr[k]);
    t += performance.now() - t0;
  }
  return (t * 1000) / v.ticks;
}

function passGuide(v: Variant): number {
  let t = 0;
  let n = 0;
  for (let i = 0; i < seeds; i++) {
    const s = fresh(v.m, i);
    const fr = v.recs[i] as any[];
    for (let k = 0; k < fr.length; k++) {
      v.m.step(s, fr[k]);
      if (s.ready === 0 && s.phase === 'day' && s.sunUp && v.m.guideDue(s)) {
        const g0 = performance.now();
        v.m.updateGuide(s);
        t += performance.now() - g0;
        n++;
      }
    }
  }
  return (t * 1000) / Math.max(1, n);
}

const median = (a: readonly number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
const min = (a: readonly number[]): number => Math.min(...a);

/** --drive: the driver's per-tick µs at an Endless noon (11:00 AM to 1:00 PM), one rep over the seeds. */
async function driveUs(root: string): Promise<{ us: number[]; reps: number[] }> {
  const imp = async (p: string): Promise<any> => import(pathToFileURL(join(root, p)).href);
  const [create, step, bots, headless, driver, clock] = await Promise.all([
    imp('src/core/sim/create.ts'),
    imp('src/core/sim/step.ts'),
    imp('src/core/sim/bots.ts'),
    imp('src/core/sim/headless.ts'),
    imp('src/core/drive/driver.ts'),
    imp('src/core/clock.ts'),
  ]);
  const out: number[] = [];
  const per: number[] = [];
  for (let r = 0; r < reps; r++) {
    const us: number[] = [];
    for (let i = 0; i < seeds; i++) {
      const s = create.createRun(headless.headlessConfig(1000 + i, 3));
      const b = bots.createBot('reactive', 0, true);
      const d = driver.createDriver();
      d.begin(s, bots.touchOpts(s, -1));
      const c = { act: 0, vane: 0, vaneUp: false, rest: false };
      const f = { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
      const end = clock.dayStartTick(days);
      while (s.phase !== 'dead' && s.phase !== 'won' && s.tickAbs < end) {
        const bf = b.next(s);
        Object.assign(f, bf);
        c.act = s.tickAbs % 20 === 0 ? 1 : 0;
        const m = s.phase === 'day' ? clock.minutesOfDay(s.day, s.dayTick) : -1;
        const a = performance.now();
        d.fill(s, f, c);
        const dt = performance.now() - a;
        if (m >= 300 && m <= 420) us.push(1000 * dt);
        step.step(s, bf);
      }
    }
    per.push(median(us));
    if (r === reps - 1) out.push(...us);
  }
  return { us: out, reps: per };
}

const dir = baseDir || mkdtempSync(join(tmpdir(), 'shady-bench-'));
try {
  if (!baseDir && !drive) execFileSync('sh', ['-c', `git -C '${HERE}' archive ${base} src | tar -x -C '${dir}'`]);
  if (drive) {
    const { us, reps: per } = await driveUs(ROOT);
    const med = median(per);
    console.log(`bench-step --drive: driver fill at an Endless noon, ${seeds} seeds × ${days - 1} days, ${reps} reps, ${us.length} timed ticks a rep`);
    console.log(`  ${(ROOT === HERE ? 'HEAD' : 'head').padEnd(16)} ${med.toFixed(2)} µs/tick median (reps ${per.map((x) => x.toFixed(2)).join(', ')}; p99 ${[...us].sort((x, y) => x - y)[Math.floor(0.99 * us.length)]?.toFixed(2) ?? '?'} µs)  gate ≤ 5 µs: ${med <= 5 ? 'PASS' : 'FAIL'}`);
    if (check && med > 5) process.exitCode = 1;
  } else if (gen) {
    const gv = [
      { label: baseDir ? 'base' : `base ${base}`, m: await load(dir) },
      { label: ROOT === HERE ? 'HEAD' : 'head', m: await load(ROOT) },
    ];
    console.log(`bench-step --gen: generateSome(…, 12) a frame, ${seeds} seeds × ${days - 1} days, median of ${reps} alternating reps`);
    /** One rep's figures of a variant (slices sorted from the largest down). */
    interface GenRep {
      desc: number[];
      frames: number;
      chunks: number;
    }
    const runs: GenRep[][] = [[], []];
    // Alternating reps (base, HEAD, HEAD, base, …) so a loaded machine weighs on both alike.
    for (let r = 0; r < reps; r++) {
      for (const vi of r % 2 === 0 ? [0, 1] : [1, 0]) {
        const g = genSlices((gv[vi] as (typeof gv)[number]).m);
        (runs[vi] as GenRep[]).push({ desc: [...g.ms].sort((x, y) => y - x), frames: g.frames, chunks: g.chunks });
      }
    }
    // The common population: k = 1% of the base's working slices (deterministic: the budget is in
    // work units, so the same tree slices the same way every rep).
    const k = Math.max(1, Math.round(0.01 * ((runs[0] as GenRep[])[0] as GenRep).desc.length));
    const at = (g: GenRep, i: number): number => g.desc[Math.min(i, g.desc.length - 1)] ?? 0;
    const perMin = (g: GenRep, ms: number): number => (g.desc.filter((x) => x > ms).length / g.frames) * 3600;
    const total = (g: GenRep): number => g.desc.reduce((a, x) => a + x, 0);
    const fig = runs.map((rs) => ({
      n: median(rs.map((g) => g.desc.length)),
      p50: median(rs.map((g) => at(g, Math.floor(g.desc.length / 2)))),
      p99: median(rs.map((g) => at(g, k - 1))),
      max: median(rs.map((g) => at(g, 0))),
      over1: median(rs.map((g) => perMin(g, 1))),
      over2: median(rs.map((g) => perMin(g, 2))),
      over4: median(rs.map((g) => perMin(g, 4))),
      perChunk: median(rs.map((g) => total(g) / Math.max(1, g.chunks))),
      frames: (rs[0] as GenRep).frames,
    }));
    gv.forEach((v, vi) => {
      const f = fig[vi] as (typeof fig)[number];
      console.log(`  ${v.label.padEnd(16)} ${String(f.n).padStart(6)} slices  p50 ${f.p50.toFixed(2)} ms  p99 (${k}th largest) ${f.p99.toFixed(2)} ms  max ${f.max.toFixed(2)} ms  over 1 ms ${f.over1.toFixed(2)}/min  over 2 ms ${f.over2.toFixed(2)}/min  over 4 ms ${f.over4.toFixed(2)}/min  ${f.perChunk.toFixed(2)} ms/chunk`);
    });
    const [b, h] = fig as [(typeof fig)[number], (typeof fig)[number]];
    // A frame-count bar on a base of (near) zero: allow one frame of the sample over it.
    const oneFrame = 3600 / Math.max(1, b.frames);
    const ratio = (x: number, y: number): string => (y > 0 ? (x / y).toFixed(3) : x > 0 ? '∞' : '1.000');
    const loaded = b.p99 > 1.5;
    const absOk = h.p99 <= 1.5;
    const p99Ok = h.p99 <= 1.1 * b.p99;
    const o1Ok = h.over1 <= 1.1 * b.over1 + oneFrame;
    const o2Ok = h.over2 <= 1.1 * b.over2 + oneFrame;
    console.log(`  gate: HEAD p99 slice ≤ 1.5 ms: ${absOk ? 'PASS' : loaded ? 'n/a (the base is over it too: a loaded machine)' : 'FAIL'}; paired ≤ 1.1 × base: p99 ${p99Ok ? 'PASS' : 'FAIL'} (${ratio(h.p99, b.p99)}), over 1 ms ${o1Ok ? 'PASS' : 'FAIL'} (${ratio(h.over1, b.over1)}), over 2 ms ${o2Ok ? 'PASS' : 'FAIL'} (${ratio(h.over2, b.over2)})`);
    console.log(`  generation ms/chunk: HEAD ${ratio(h.perChunk, b.perChunk)} × base (§6 bar ≤ 3.5 ms/chunk on the plan's 2.37 v1.5 baseline: ≤ ${(3.5 / 2.37).toFixed(2)} ×)`);
    if (loaded) console.log('  WARNING: the base breaks the absolute 1.5 ms bar itself; re-run on a quieter machine for an absolute reading.');
    if (check && (!p99Ok || !o1Ok || !o2Ok || (!absOk && !loaded))) process.exitCode = 1;
  } else {
    const variants = [record(baseDir ? 'base' : `base ${base}`, await load(dir)), record(ROOT === HERE ? 'HEAD' : 'head', await load(ROOT))];
    for (let r = 0; r < reps; r++) {
      for (const v of r % 2 === 0 ? variants : [...variants].reverse()) {
        v.stepUs.push(passStep(v));
        v.guideUs.push(passGuide(v));
      }
    }
    const [b, h] = variants as [Variant, Variant];
    console.log(`bench-step: ${botKind}, ${seeds} seeds × ${days - 1} days, ${reps} alternating reps`);
    for (const v of variants) {
      console.log(`  ${v.label.padEnd(16)} ${String(v.ticks).padStart(7)} ticks  step ${median(v.stepUs).toFixed(2)} µs/tick (min ${min(v.stepUs).toFixed(2)})  guide refresh ${median(v.guideUs).toFixed(1)} µs (min ${min(v.guideUs).toFixed(1)})`);
    }
    const sr = median(h.stepUs) / median(b.stepUs);
    const gr = median(h.guideUs) / median(b.guideUs);
    console.log(`  step ratio ${sr.toFixed(3)} (min ${(min(h.stepUs) / min(b.stepUs)).toFixed(3)}; gate ≤ 1.10), guide ratio ${gr.toFixed(3)} (gate ≤ 1.5)`);
    if (check && (sr > 1.1 || gr > 1.5)) process.exitCode = 1;
  }
} finally {
  if (!baseDir) rmSync(dir, { recursive: true, force: true });
}
