// Replay benchmark for docs/V1_6_PLAN.md §13 ("step() µs/tick within +10% of v1.5, guide refresh
// ≤ 1.5× v1.5"): HEAD's core against a base revision's, loaded side by side in one process.
//
//   node scripts/bench-step.ts [--base c956421 | --base-dir DIR] [--head-dir DIR] [--bot reactive|oracle] [--seeds 12] [--days 4] [--reps 9] [--check]
//
// Each variant records its own bot's input frames on seeds 1000.. (profile 3, mechanics on), then
// replays them on fresh runs whose worlds are generated up front, so only step() is timed (the bot
// and world generation are not). Passes alternate between the variants (min and median of --reps);
// the guide refresh is timed by calling updateGuide on every sunlit refresh tick of a replay. The
// base revision's src/ is extracted with `git archive` into a temporary folder (--base-dir: a tree
// already extracted; --head-dir: another working tree than this script's). --check exits 1 when
// step() is over +10% or the guide refresh over 1.5× (medians).

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
const seeds = Number(arg('seeds', '12'));
const days = Number(arg('days', '4'));
const reps = Number(arg('reps', '9'));
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
}

async function load(root: string): Promise<Core> {
  const imp = async (p: string): Promise<any> => import(pathToFileURL(join(root, p)).href);
  const [create, step, bots, headless, guide, clock, world] = await Promise.all([
    imp('src/core/sim/create.ts'),
    imp('src/core/sim/step.ts'),
    imp('src/core/sim/bots.ts'),
    imp('src/core/sim/headless.ts'),
    imp('src/core/sim/guide.ts'),
    imp('src/core/clock.ts'),
    imp('src/core/gen/world.ts'),
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
  };
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

const dir = baseDir || mkdtempSync(join(tmpdir(), 'shady-bench-'));
try {
  if (!baseDir) execFileSync('sh', ['-c', `git -C '${HERE}' archive ${base} src | tar -x -C '${dir}'`]);
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
} finally {
  if (!baseDir) rmSync(dir, { recursive: true, force: true });
}
