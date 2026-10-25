// v1.6 Dare sizing and teaching-level variants for `node scripts/sim.ts --bake` (docs/V1_6_PLAN.md
// §2.6, fix round 3; Journey). The bake plays bots on each level's fixed world:
//
// - Dares need their verb: for each Dare candidate (config/campaign.ts dareCandidates), what the
//   players who do not seek it reach (the reactive bot, the oracle playing the level's verb goal as in
//   --campaign, humanDial) and what the players who seek it reach (the Feat-seeking oracle, humanFeat),
//   each run to the finish line; campaign.ts sizeDare puts the target just above the first group
//   where the second reaches it, and pickDare takes the first candidate that needs its verb.
// - Teaching without walls: a teaching level's world variant (campaign.ts levelSeed) on which
//   humanDial, the oracle and the reactive bot pass it (lessonReads).
//
// The human models play SIZE_SALTS, decision streams the campaign sim's --tries never draws (it plays
// 0, 1, 2, …), so its humanDial and humanFeat rows are held out from the sizing. A level that would
// dare a snap starts with one ready (startsWithSnap), so the snapSave candidate is measured that way.

import { Worker } from 'node:worker_threads';
import { DARE_PLAYERS, FEAT_KINDS, featValue, goalMet, levelDef, type DareMeasure, type FeatKind, type LevelDef, type LevelFlare } from '../../src/config/campaign.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { worldYAtDayTick } from '../../src/core/gen/plan.ts';
import { createWorld } from '../../src/core/gen/world.ts';
import { campaignConfig, minuteStart, resolveLevelConfig } from '../../src/core/level.ts';
import { DARE_TERMS } from '../../src/core/sim/bots/dares.ts';
import { createBot, type BotKind } from '../../src/core/sim/bots.ts';
import { createRun, type RunBuild } from '../../src/core/sim/create.ts';
import { step } from '../../src/core/sim/step.ts';
import type { RunConfig } from '../../src/core/sim/types.ts';

/** humanDial's and humanFeat's decision streams in the sizing runs (DARE_PLAYERS of them). */
export const SIZE_SALTS: readonly number[] = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
if (SIZE_SALTS.length !== DARE_PLAYERS) throw new Error('SIZE_SALTS must hold DARE_PLAYERS streams');
/** The seekers' target while sizing: never met, so they seek the whole level. */
const SEEK_ALL = 1e9;

export type SizeBot = 'reactive' | 'oracle' | 'humanDial' | 'oracleFeat' | 'humanFeat' | 'humanTouch';

/**
 * One sizing run: a bot on a level (its world: `seed` and `flares`, the level's own when left out),
 * seeking `seek` (the seekers) or nothing; `snap`: the level starts with a snap ready.
 */
export interface DareRunSpec {
  readonly id: number;
  readonly bot: SizeBot;
  readonly salt: number;
  readonly seek: FeatKind | null;
  readonly snap: boolean;
  readonly seed?: number;
  readonly flares?: readonly LevelFlare[];
  /** The goal's target when the world sizes it (the glare lesson's clean balls), else the level's. */
  readonly goal?: number;
}

export interface DareRunOut {
  /** Reached the finish line (a Dare is met only then), and the goal passed there. */
  readonly won: boolean;
  readonly passed: boolean;
  /** featValue of every kind (FEAT_KINDS order) at the end of the run. */
  readonly v: readonly number[];
}

/**
 * The level as a sizing run plays it: its world (`seed`, `flares`), and its Dare `seek` with an
 * unbounded target (the seekers), or for the non-seekers none, or a snapSave Dare when `snap` (so it
 * starts with a snap ready, as it would: create.ts startsWithSnap).
 */
function sizingLevel(spec: DareRunSpec): LevelDef {
  const l = levelDef(spec.id) as LevelDef;
  const k: FeatKind | null = spec.seek ?? (spec.snap ? 'snapSave' : null);
  return Object.freeze({
    ...l,
    seed: spec.seed ?? l.seed,
    flares: spec.flares ?? l.flares,
    goal: spec.goal === undefined ? l.goal : Object.freeze({ kind: l.goal.kind, target: spec.goal }),
    feats: Object.freeze(k ? [Object.freeze({ kind: k, target: SEEK_ALL })] : []),
  });
}

/** Plays one sizing run (pure in its spec). */
export function playDareRun(spec: DareRunSpec): DareRunOut {
  const lv = sizingLevel(spec);
  // The level's own config (lesson on level 1, as the campaign plays it), on the world under test.
  const cfg: RunConfig = { ...resolveLevelConfig(campaignConfig(spec.id, { lesson: spec.id === 1 })), seed: lv.seed };
  const world = createWorld(cfg, lv);
  const start = minuteStart(lv.startMinute);
  const build: RunBuild = { cfg, world, targetY: worldYAtDayTick(world, start.day, start.dayTick) + TUNING.world.hardAhead };
  const s = createRun(cfg, build);
  // createRun re-resolves the config from levelDef(id): the variant's seed is the run's (gusts, bots).
  s.cfg.seed = lv.seed;
  const kind: BotKind = spec.bot === 'oracleFeat' ? 'oracle' : spec.bot;
  const bot = createBot(kind, spec.salt, true, { feats: spec.bot === 'oracleFeat', dares: DARE_TERMS });
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < 8000) step(s, bot.next(s));
  const won = s.phase === 'won';
  return { won, passed: won && goalMet(lv, s.stats), v: FEAT_KINDS.map((k) => featValue(k, s.stats)) };
}

interface Pending<T, R> {
  readonly task: T;
  readonly resolve: (o: R) => void;
  readonly reject: (e: unknown) => void;
}

/**
 * A pool of worker threads running `script` (tagged `tag` in workerData: the script's worker side
 * answers each task message with its result); identical tasks (as JSON) are run once.
 */
export class TaskPool<T, R> {
  private readonly queue: Pending<T, R>[] = [];
  private readonly idle: Worker[] = [];
  private readonly workers: Worker[] = [];
  private readonly cache = new Map<string, Promise<R>>();
  private readonly busy = new Map<Worker, Pending<T, R>>();
  /** Tasks run (not served from the cache). */
  played = 0;

  constructor(script: URL, tag: string, n: number) {
    for (let i = 0; i < Math.max(1, n); i++) {
      const w = new Worker(script, { workerData: tag });
      w.on('message', (o: R) => {
        const t = this.busy.get(w);
        this.busy.delete(w);
        this.idle.push(w);
        t?.resolve(o);
        this.pump();
      });
      w.on('error', (e) => {
        const t = this.busy.get(w);
        this.busy.delete(w);
        t?.reject(e);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  readonly run = (task: T): Promise<R> => {
    const key = JSON.stringify(task);
    let p = this.cache.get(key);
    if (!p) {
      p = new Promise<R>((resolve, reject) => this.queue.push({ task, resolve, reject }));
      this.cache.set(key, p);
      this.played++;
      this.pump();
    }
    return p;
  };

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop() as Worker;
      const t = this.queue.shift() as Pending<T, R>;
      this.busy.set(w, t);
      w.postMessage(t.task);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/** Plays a sizing run: in the bake's pool (scripts/sim16/bake.ts) or in this thread (runHere, the tests). */
export type DareRunner = (spec: DareRunSpec) => Promise<DareRunOut>;
export const runHere: DareRunner = (spec) => Promise.resolve(playDareRun(spec));

/** A level's world under test: its seed and flares (and the goal target it sizes, if any). */
export interface DareWorld {
  readonly id: number;
  readonly seed: number;
  readonly flares: readonly LevelFlare[];
  readonly goal?: number;
}

/**
 * Fresh humanDial streams that confirm a teaching level's world variant once it read on SIZE_SALTS:
 * a search over many variants with one set of streams finds worlds that suit those streams by luck.
 */
export const CONFIRM_SALTS: readonly number[] = Array.from({ length: 20 }, (_, i) => 201 + i);

/** The non-seekers' runs on a world: [reactive, oracle, humanDial × `salts` (SIZE_SALTS)]. */
export function notRuns(run: DareRunner, w: DareWorld, snap: boolean, salts: readonly number[] = SIZE_SALTS): Promise<DareRunOut[]> {
  const base = { id: w.id, seek: null, snap, seed: w.seed, flares: w.flares, ...(w.goal === undefined ? {} : { goal: w.goal }) };
  return Promise.all([run({ ...base, bot: 'reactive', salt: 0 }), run({ ...base, bot: 'oracle', salt: 0 }), ...salts.map((salt) => run({ ...base, bot: 'humanDial', salt }))]);
}

/** Controls v3 TOUCH_READS (docs/CONTROLS_V3.md §5.3): humanTouch's runs on a world, `salts` its streams. */
export function touchRuns(run: DareRunner, w: DareWorld, snap: boolean, salts: readonly number[]): Promise<DareRunOut[]> {
  const base = { id: w.id, seek: null, snap, seed: w.seed, flares: w.flares, ...(w.goal === undefined ? {} : { goal: w.goal }) };
  return Promise.all(salts.map((salt) => run({ ...base, bot: 'humanTouch', salt })));
}

/** What the bake measures of Dare `kind` on a world (campaign.ts DareMeasure). */
export async function measureDare(run: DareRunner, w: DareWorld, kind: FeatKind, snap: boolean): Promise<DareMeasure> {
  const base = { id: w.id, seek: kind, snap, seed: w.seed, flares: w.flares, ...(w.goal === undefined ? {} : { goal: w.goal }) };
  const [not, seek] = await Promise.all([
    notRuns(run, w, snap),
    Promise.all([run({ ...base, bot: 'oracleFeat', salt: 0 }), ...SIZE_SALTS.map((salt) => run({ ...base, bot: 'humanFeat', salt }))]),
  ]);
  const i = FEAT_KINDS.indexOf(kind);
  const val = (o: DareRunOut): number => (o.won ? (o.v[i] as number) : -1);
  return Object.freeze({ kind, not: Object.freeze(not.map(val)), seek: Object.freeze(seek.map(val)) });
}

