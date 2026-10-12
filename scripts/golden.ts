// Golden determinism fixtures. `node scripts/golden.ts` rewrites tests/golden/hashes.json; the unit
// tests recompute the same values and compare. Update the file only deliberately (and say why):
// any change means worlds or replays from older builds no longer match.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASTER_KINDS } from '../src/config/casters.ts';
import { rungConfig } from '../src/config/days.ts';
import { FORECAST_IDS, forecastFits } from '../src/config/forecasts.ts';
import { TUNING } from '../src/config/tuning.ts';
import { sinD } from '../src/core/dmath.ts';
import { planDay } from '../src/core/gen/plan.ts';
import { createWorld, ensureGenerated } from '../src/core/gen/world.ts';
import { createBot } from '../src/core/sim/bots.ts';
import { createRun } from '../src/core/sim/create.ts';
import { hashState } from '../src/core/sim/hash.ts';
import { headlessConfig, runBot, runHeadless } from '../src/core/sim/headless.ts';
import { step } from '../src/core/sim/step.ts';
import type { InputFrame } from '../src/core/sim/types.ts';

const CH = TUNING.world.chunkLen;
/** Three minutes of ticks. */
export const SCRIPT_TICKS = 3 * 60 * 60;
export const CHECK_EVERY = 600;

const q1024 = (v: number): number => Math.round(v * 1024) / 1024;
const q64 = (v: number): number => Math.round(v * 64) / 64;

/**
 * A fixed 3-minute input script exercising every input path: sine-swept drags, flicks released at
 * speed, catches mid-coast, taps and keyboard bursts (ramping and fine). A pure function of the tick
 * index.
 */
export function scriptedInput(i: number): InputFrame {
  const f: InputFrame = { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
  if (i === 0) {
    f.downEdge = true;
    f.upEdge = true;
    return f;
  }
  const c = i % 240;
  if (c < 120) {
    f.down = true;
    f.downEdge = c === 0;
    f.dTheta = q1024(4 * sinD(i * 3.1) + 1.5 * sinD(i * 11.7));
  } else if (c === 120) {
    f.upEdge = true;
    f.dTheta = q1024(2.5);
    f.release = q64(150 + 140 * sinD(i * 0.7));
  } else if (c === 170 && (i / 240) % 2 < 1) {
    // Catch the coasting sun and let go again (a tap).
    f.downEdge = true;
    f.upEdge = true;
  } else if (c >= 200 && c < 230 && i % 1000 < 500) {
    const k = i % 2000 < 1000 ? 1 : -1;
    f.key = c < 218 ? k : k > 0 ? 2 : -2;
  }
  return f;
}

/**
 * Hash checkpoints of the scripted run (seed 1, profile 0 with the tutorial chunk) every 60 ticks
 * until Nubs melts (an unsteered sun does not last three minutes), then the final state.
 */
export function scriptedHashes(): string[] {
  const s = createRun(headlessConfig(1, 0));
  const out: string[] = [];
  for (let i = 0; i < SCRIPT_TICKS && s.phase !== 'dead'; i++) {
    step(s, scriptedInput(i));
    if ((i + 1) % 60 === 0) out.push(hashState(s));
  }
  out.push(hashState(s));
  return out;
}

/** Hash checkpoints of a 3-minute oracle run (seed 9, profile 3): long-lived, crosses nights. */
export function oracleHashes(): string[] {
  const s = createRun(headlessConfig(9, 3));
  const bot = createBot('oracle');
  const out: string[] = [];
  for (let i = 0; i < SCRIPT_TICKS; i++) {
    step(s, bot.next(s));
    if ((i + 1) % CHECK_EVERY === 0) out.push(hashState(s));
  }
  return out;
}

const dv = new DataView(new ArrayBuffer(8));

/** FNV-1a (32-bit) over the IEEE bytes of the given numbers. */
function fnv(values: number[]): string {
  let h = 0x811c9dc5;
  for (const v of values) {
    dv.setFloat64(0, v);
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ dv.getUint8(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Digest of each of chunks 0-9 of a profile-3 world (Day Plan on, or off for the v1.0 world): its
 * casters (incl. rescues) and pickups.
 */
export function chunkDigests(seed: number, plan = true): string[] {
  const w = createWorld({ seed, profile: 3, tutorial: false, plan });
  ensureGenerated(w, 11 * CH);
  const out: string[] = [];
  for (let k = 0; k < 10; k++) {
    const v: number[] = [];
    for (const c of w.casters.filter((x) => x.chunk === k).sort((a, b) => a.id - b.id)) {
      v.push(c.id, CASTER_KINDS.indexOf(c.kind), c.x, c.y, c.rot, c.maxZ, c.rescue ? 1 : 0);
    }
    for (const p of w.pickups.filter((x) => x.y >= k * CH && x.y < (k + 1) * CH)) v.push(p.id, p.x, p.y);
    out.push(fnv(v));
  }
  return out;
}

/** Final hash of a 40 s reactive run with each forecast forced, on the first seed ≥ 5 whose Day 1 it fits. */
export function forecastHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const forecast of FORECAST_IDS) {
    let seed = 5;
    while (!forecastFits(forecast, planDay(seed, 1).biome)) seed++;
    out[forecast] = hashState(runBot({ ...headlessConfig(seed, 3), forecast }, 2400, 'reactive'));
  }
  return out;
}

/** Final hash of a 30 s humanDial run on seed 6 at each comfort rung (rung 2 is p3 @ 44 with noon cloud 1). */
export function rungHashes(): string[] {
  return [0, 1, 2, 3, 4].map((rung) => {
    const rc = rungConfig(rung, { tutorialDone: rung > 0 });
    return hashState(runBot({ ...headlessConfig(6, rc.profile, rc.drain, rc.noonCloud), tutorial: rc.tutorial, lesson: rc.lesson }, 1800, 'humanDial'));
  });
}

export function goldenValues(): Record<string, unknown> {
  return {
    scripted: scriptedHashes(),
    oracle3min: oracleHashes(),
    headless_7_3600_reactive: runHeadless(7, 3600, 'reactive'),
    chunks: { 1: chunkDigests(1), 2: chunkDigests(2), 3: chunkDigests(3) },
    // Plan-off profile-3 worlds (v1.0 links and Dailies before PLAN_START_DATE) are the v1.0 worlds.
    chunksPlanOff: { 1: chunkDigests(1, false), 2: chunkDigests(2, false), 3: chunkDigests(3, false) },
    forecasts: forecastHashes(),
    rungs: rungHashes(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../tests/golden/hashes.json');
  writeFileSync(file, JSON.stringify(goldenValues(), null, 2) + '\n');
  console.log(`wrote ${file}`);
}
