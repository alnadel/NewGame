// v1.6 sim report registry (docs/V1_6_PLAN.md §9-§10). scripts/sim.ts plays the rows and prints the
// v1.5 report; each v1.6 module (econ.ts: CORE-1, world.ts: CORE-2) adds:
//   - per-run metrics, gathered in the worker that plays the run (`collector`), as plain numbers;
//   - tables and gates after the v1.5 report (`report`), failing --check through ctx.fail;
//   - its own modes (`modes`: --decisions, --bake), run instead of the report.
// Each builder edits only its own module; this file and sim.ts change by agreement.

import type { NoonCloud, ProfileId } from '../../src/config/days.ts';
import type { ForecastId } from '../../src/config/forecasts.ts';
import type { BotKind, BotOptions, BotPolicy } from '../../src/core/sim/bots.ts';
import type { SimState, V16Rules } from '../../src/core/sim/types.ts';

/** One row of the report: a bot on one kind of run (all fields cross the worker boundary). */
export interface Sim16Job {
  bot: BotKind;
  profile: ProfileId;
  drain?: number;
  noonCloud?: NoonCloud;
  lesson?: boolean;
  forecast?: ForecastId;
  /** Advisory comfort-rung row (PASS/MISS only, never fails --check). */
  rung?: number;
  /** v1.5 --mech: the bot ignores the core mechanics (no gold, no snaps). */
  noMech?: boolean;
  /** v1.6 bot options (policy, snap rule, preAim, feats). */
  opts?: BotOptions;
  /** v1.6 rules switched off on this row, on top of --off. */
  v16?: Partial<V16Rules>;
  /** The row's printed name (default: bot, profile, rules and options). */
  label?: string;
}

/** Gathers one run's metrics inside the worker that plays it. */
export interface Sim16Collector {
  /** After every step() of the run (this tick's events are in s.events). */
  tick(s: SimState): void;
  /** At the end of the run: writes this collector's metrics (plain numbers) into `out`. */
  finish(s: SimState, out: Record<string, number>): void;
}

/** One finished run, as the main thread sees it. */
export interface Sim16Run {
  readonly seed: number;
  readonly died: boolean;
  readonly minutes: number;
  readonly day: number;
  /** Sim ticks, and daylight ticks with the clock running. */
  readonly ticks: number;
  readonly daylight: number;
  /** Every collector's metrics. */
  readonly m: Readonly<Record<string, number>>;
}

export interface Sim16Row {
  readonly name: string;
  readonly job: Sim16Job;
  /** One run per seed 1..seeds. */
  readonly runs: readonly Sim16Run[];
}

export interface Sim16Ctx {
  readonly seeds: number;
  readonly days: number;
  readonly workers: number;
  readonly check: boolean;
  /** --margin: points of seeds a share target must clear its bar by. */
  readonly margin: number;
  /** --off: v1.6 rules switched off on every row. */
  readonly off: Partial<V16Rules>;
  /** --policy: the reactive rows' policy (null when unset). */
  readonly policy: BotPolicy | null;
  /** --hours: print deaths by in-game hour. */
  readonly hours: boolean;
  /** Plays every job on seeds 1..seeds in the worker pool (with --off applied); rows in job order. */
  run(jobs: readonly Sim16Job[]): Promise<Sim16Row[]>;
  /** Records a hard-gate failure: under --check (and in a mode) the sim exits 1. */
  fail(what: string): void;
}

export interface Sim16Module {
  readonly name: string;
  /** A fresh collector for each run (called in the worker). */
  collector?(): Sim16Collector;
  /** Tables and gates printed after the v1.5 report, over its rows (awaited: it may play more rows with ctx.run). */
  report?(ctx: Sim16Ctx, rows: readonly Sim16Row[]): void | Promise<void>;
  /** Modes run instead of the report, keyed by their flag without the dashes ('decisions', 'bake'). */
  readonly modes?: Readonly<Record<string, (ctx: Sim16Ctx) => Promise<void>>>;
}
