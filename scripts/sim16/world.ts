// v1.6 world and Journey report (docs/V1_6_PLAN.md §2.3, §2.5, §2.6; CORE-2 owns this file): glass,
// flare and Noon Heat metrics and gates for `sim --check`, deaths by hour (`--hours`) and the
// `--bake` mode (levelBake.gen.ts: offers and boss flares) and the `--flares` mode (the Heat Flare
// threat, flares on against off: fix round 3). See registry.ts for the hooks.
//
// Hard gates (under --check): the oracle parries ≥ 70% of the kept flares it meets; ≥ 85% of the
// flare candidates of Days 2-4 are kept (plan mix, profile 3); rescues per chunk within +0.1 of the
// same worlds without flares and Noon Heat. Advisory rows: plain reactive parries 25-55% and preAim
// ≥ 15 points more; ≥ 25% of the reactive bot's deaths fall in 11 AM-1 PM; glass clusters per
// daylight minute (Day 1 ≥ 1.8, later ≥ 2.5); glass flakes saved (oracle ≥ 85%, plain reactive
// 30-60%, chase ≥ 70%); the novice's melted share rises by ≤ 8 points.

import { dayStartY } from '../../src/core/clock.ts';
import { formatScore } from '../../src/core/format.ts';
import { createWorld, ensureGenerated } from '../../src/core/gen/world.ts';
import { lowerBound } from '../../src/core/gen/store.ts';
import { FLARE_DROPPED, FLARE_KEPT, type Pickup } from '../../src/core/objects.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import type { SimState } from '../../src/core/sim/types.ts';
import { bakeMain } from './bake.ts';
import type { Sim16Collector, Sim16Ctx, Sim16Job, Sim16Module, Sim16Row, Sim16Run } from './registry.ts';

/** The pickup a flake/flakeMelt event at (x, y) refers to (pickups are y-sorted). */
function pickupAt(s: SimState, x: number, y: number): Pickup | null {
  const ps = s.world.pickups;
  for (let i = lowerBound(ps, y); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.y > y) break;
    if (p.x === x) return p;
  }
  return null;
}

function collector(): Sim16Collector {
  const m: Record<string, number> = {
    fWarn: 0, fParry: 0, fMiss: 0, fSnap: 0,
    gTaken: 0, gMelted: 0, pTaken: 0, pMelted: 0,
    gSeen1: 0, gSeenL: 0, day1Ticks: 0, laterTicks: 0,
  };
  let seen = 0;
  return {
    tick(s: SimState): void {
      if (s.phase === 'day' && s.ready === 0) {
        if (s.day === 1) m.day1Ticks = (m.day1Ticks as number) + 1;
        else m.laterTicks = (m.laterTicks as number) + 1;
      }
      const bs = s.stats.brittleSeen ?? 0;
      if (bs > seen) {
        if (s.day === 1) m.gSeen1 = (m.gSeen1 as number) + (bs - seen);
        else m.gSeenL = (m.gSeenL as number) + (bs - seen);
        seen = bs;
      }
      for (const e of s.events) {
        if (e.e === 'flareWarn') m.fWarn = (m.fWarn as number) + 1;
        else if (e.e === 'flareParry') {
          m.fParry = (m.fParry as number) + 1;
          if (e.snap) m.fSnap = (m.fSnap as number) + 1;
        } else if (e.e === 'flareMiss') m.fMiss = (m.fMiss as number) + 1;
        else if (e.e === 'flake' || e.e === 'flakeMelt') {
          const p = pickupAt(s, e.x, e.y);
          if (!p || p.kind !== 'flake') continue;
          const k = (p.brittle ? 'g' : 'p') + (e.e === 'flake' ? 'Taken' : 'Melted');
          m[k] = (m[k] as number) + 1;
        }
      }
    },
    finish(s: SimState, out: Record<string, number>): void {
      for (const [k, v] of Object.entries(m)) out[k] = v;
      // Flare candidates decided so far, Days 2-4 and 5+ (a pending one is not counted).
      let k24 = 0, n24 = 0, k5 = 0, n5 = 0;
      for (const f of s.world.flares) {
        if (f.state !== FLARE_KEPT && f.state !== FLARE_DROPPED) continue;
        if (f.day >= 2 && f.day <= 4) {
          n24++;
          if (f.state === FLARE_KEPT) k24++;
        } else if (f.day >= 5) {
          n5++;
          if (f.state === FLARE_KEPT) k5++;
        }
      }
      Object.assign(out, { fKept24: k24, fCand24: n24, fKept5: k5, fCand5: n5, gSaved: s.stats.brittleSaved ?? 0, gSeen: s.stats.brittleSeen ?? 0 });
    },
  };
}

const total = (runs: readonly Sim16Run[], k: string): number => runs.reduce((a, r) => a + (r.m[k] ?? 0), 0);
const pct = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '–');
const isMechReactive = (j: Sim16Job): boolean => j.bot === 'reactive' && !j.noMech && j.rung === undefined && j.forecast === undefined && j.profile === 3;
const find = (rows: readonly Sim16Row[], f: (j: Sim16Job) => boolean): Sim16Row | undefined => rows.find((r) => f(r.job));

/** Minute of the day (0 = 6:00 AM) a run died at, or −1 for survivors and night deaths. */
function deathMinuteOfDay(r: Sim16Run): number {
  if (!r.died) return -1;
  const m = r.minutes - 720 * (r.day - 1);
  return m >= 0 && m < 720 ? m : -1;
}

/** Daylight deaths in 11 AM-1 PM, and all daylight deaths (from Day `fromDay` on). */
function noonShare(rs: readonly Sim16Run[], fromDay = 1): [number, number] {
  const ds = rs.filter((r) => r.day >= fromDay).map(deathMinuteOfDay).filter((m) => m >= 0);
  return [ds.filter((m) => m >= 300 && m < 420).length, ds.length];
}

function hoursTable(rows: readonly Sim16Row[]): void {
  console.log('\nDeaths by in-game hour (6 AM … 5 PM; share of the row\'s daylight deaths):');
  console.log(`${'row'.padEnd(30)} ${Array.from({ length: 12 }, (_, h) => `${((h + 5) % 12) + 1}`.padStart(4)).join('')}   11-1`);
  for (const row of rows) {
    const ds = row.runs.map(deathMinuteOfDay).filter((m) => m >= 0);
    if (ds.length === 0) continue;
    const hist = Array.from({ length: 12 }, (_, h) => ds.filter((m) => Math.floor(m / 60) === h).length);
    const [n, d] = noonShare(row.runs);
    console.log(`${row.name.padEnd(30)} ${hist.map((c) => `${Math.round((100 * c) / ds.length)}`.padStart(4)).join('')}   ${pct(n, d)}`);
  }
}

/** Rescues per chunk of the plan-mix p3 worlds through Day `days`, with and without flares and Noon Heat. */
function rescueDelta(seedFrom: number, seeds: number, days: number): { on: number; off: number } {
  const one = (off: boolean): number => {
    let rescues = 0, chunks = 0;
    for (let seed = seedFrom; seed < seedFrom + seeds; seed++) {
      const w = createWorld({ ...headlessConfig(seed, 3), ...(off ? { v16: { flares: false, noonHeat: false } } : {}) });
      ensureGenerated(w, dayStartY(days));
      const per = w.stats.rescuesPerChunk.filter((r): r is number => r !== undefined);
      rescues += per.reduce((a, r) => a + r, 0);
      chunks += per.length;
    }
    return rescues / Math.max(1, chunks);
  };
  return { on: one(false), off: one(true) };
}

/** Death minute of a run (Infinity for a survivor). */
const deathMin = (r: Sim16Run): number => (r.died ? r.minutes : Infinity);

/** The median death minute of a row (survivors last). */
function medianDeath(rs: readonly Sim16Run[]): number {
  const v = rs.map(deathMin).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] as number;
}

const clockOf = (m: number, days: number): string => (m === Infinity ? `≥ Day ${days}` : formatScore(m));

/**
 * --flares [--seeds 120]: the Heat Flare threat (fix round 3, WORLD W1). Flares on against off,
 * seed by seed: the dial-only reactive bot (no telegraph reading) must lose ≥ 60 min of median
 * survival, the anticipating bot (reactive with the mechanics and preAim) at most half of what the
 * dial-only bot loses, and the oracle still parries ≥ 70% of the kept flares it meets. Plain
 * reactive with the mechanics is reported. Medians flip on a few seeds below about 120 seeds (deaths
 * cluster by day), so run it with at least 120.
 */
async function flaresMain(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const off = { flares: false };
  const jobs: Sim16Job[] = [
    { bot: 'reactive', profile: 3, noMech: true, label: 'reactive p3 dial' },
    { bot: 'reactive', profile: 3, noMech: true, v16: off, label: 'reactive p3 dial, flares off' },
    { bot: 'reactive', profile: 3, opts: { preAim: true }, label: 'reactive p3 preAim' },
    { bot: 'reactive', profile: 3, opts: { preAim: true }, v16: off, label: 'reactive p3 preAim, flares off' },
    { bot: 'reactive', profile: 3, label: 'reactive p3' },
    { bot: 'reactive', profile: 3, v16: off, label: 'reactive p3, flares off' },
    { bot: 'oracle', profile: 3, label: 'oracle p3' },
  ];
  const rows = await ctx.run(jobs);
  const wall = (performance.now() - t0) / 1000;
  console.log(`SHADY sim --flares: ${ctx.seeds} seeds${ctx.seedFrom !== 1 ? ` from ${ctx.seedFrom}` : ''}, profile 3, up to Day ${ctx.days}, ${ctx.workers} workers, ${wall.toFixed(1)} s\n`);
  console.log(`${'row'.padEnd(32)} ${'median death'.padEnd(17)} parried  flares met/run`);
  for (const r of rows) {
    const meet = total(r.runs, 'fParry') + total(r.runs, 'fMiss');
    console.log(`${r.name.padEnd(32)} ${clockOf(medianDeath(r.runs), ctx.days).padEnd(17)} ${pct(total(r.runs, 'fParry'), meet).padStart(7)}  ${(meet / Math.max(1, r.runs.length)).toFixed(2)}`);
  }
  const loss = (on: Sim16Row, offRow: Sim16Row): { med: number; mean: number } => {
    const a = medianDeath(offRow.runs);
    const b = medianDeath(on.runs);
    const cap = ctx.days * 720;
    let sum = 0;
    for (let i = 0; i < on.runs.length; i++) sum += Math.min(cap, deathMin(offRow.runs[i] as Sim16Run)) - Math.min(cap, deathMin(on.runs[i] as Sim16Run));
    return { med: a === Infinity && b === Infinity ? 0 : Math.min(cap, a) - Math.min(cap, b), mean: sum / Math.max(1, on.runs.length) };
  };
  const [dial, dialOff, pre, preOff, plain, plainOff, oracle] = rows as [Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row];
  const d = loss(dial, dialOff);
  const p = loss(pre, preOff);
  const q = loss(plain, plainOff);
  const line = (hard: boolean, ok: boolean, what: string, got: string): void => {
    if (hard && !ok) ctx.fail(what);
    console.log(`  ${ok ? 'PASS' : hard ? 'FAIL' : 'MISS'}  ${what}: ${got}`);
  };
  console.log('\nHeat Flare threat (flares on against off; loss = minutes of survival lost):');
  line(true, d.med >= 60, 'the dial-only reactive bot loses ≥ 60 min of median survival', `${d.med.toFixed(0)} min (mean ${d.mean.toFixed(0)})`);
  line(true, p.med <= Math.max(0, d.med) / 2, 'the anticipating (preAim) bot loses at most half of that', `${p.med.toFixed(0)} min (mean ${p.mean.toFixed(0)})`);
  const meet = total(oracle.runs, 'fParry') + total(oracle.runs, 'fMiss');
  line(true, meet === 0 || total(oracle.runs, 'fParry') >= 0.7 * meet, 'the oracle parries ≥ 70% of the kept flares it meets', pct(total(oracle.runs, 'fParry'), meet));
  console.log(`  (row) reactive p3 (mechanics, no preAim) loses ${q.med.toFixed(0)} min of median survival (mean ${q.mean.toFixed(0)})`);
}

export const WORLD: Sim16Module = {
  name: 'world',
  collector,
  async report(ctx: Sim16Ctx, rows: readonly Sim16Row[]): Promise<void> {
    const gate = (hard: boolean, ok: boolean, what: string, got: string, waiver?: string): void => {
      const waived = !ok && hard && waiver !== undefined && ctx.waived(waiver);
      if (hard && !ok && !waived) ctx.fail(what);
      const note = !ok && hard && waiver !== undefined && !waived ? ` (an integrator waiver is --waive ${waiver})` : '';
      console.log(`  ${ok ? 'PASS' : waived ? 'WAIVED' : hard ? 'FAIL' : 'MISS'}  ${what}: ${got}${note}`);
    };
    console.log('\nWorld v1.6 (Heat Flares, Noon Heat, glass): per row');
    console.log(`${'row'.padEnd(30)} flares/run  parried  (snap)   glass/min D1 | D2+   glass flakes saved  plain flakes saved  deaths 11-1`);
    for (const row of rows) {
      const rs = row.runs;
      const meet = total(rs, 'fParry') + total(rs, 'fMiss');
      const d1 = total(rs, 'day1Ticks') / 3600;
      const dl = total(rs, 'laterTicks') / 3600;
      const [n, d] = noonShare(rs);
      console.log(
        `${row.name.padEnd(30)} ${(total(rs, 'fWarn') / Math.max(1, rs.length)).toFixed(2).padStart(10)}  ${pct(total(rs, 'fParry'), meet).padStart(7)}  ${pct(total(rs, 'fSnap'), total(rs, 'fParry')).padStart(6)}   ${(total(rs, 'gSeen1') / Math.max(1e-9, d1)).toFixed(2).padStart(6)} | ${(total(rs, 'gSeenL') / Math.max(1e-9, dl)).toFixed(2).padEnd(5)}   ${pct(total(rs, 'gTaken'), total(rs, 'gTaken') + total(rs, 'gMelted')).padStart(18)}  ${pct(total(rs, 'pTaken'), total(rs, 'pTaken') + total(rs, 'pMelted')).padStart(18)}  ${pct(n, d).padStart(10)}`,
      );
    }
    if (ctx.hours) hoursTable(rows);
    const oracle = find(rows, (j) => j.bot === 'oracle' && j.profile === 3 && !j.noMech && j.forecast === undefined);
    const rea = find(rows, isMechReactive);
    console.log('\nWorld v1.6 gates:');
    if (oracle) {
      const meet = total(oracle.runs, 'fParry') + total(oracle.runs, 'fMiss');
      gate(true, ctx.check ? meet === 0 || total(oracle.runs, 'fParry') >= 0.7 * meet : true, 'oracle p3 parries ≥ 70% of the kept flares it meets', pct(total(oracle.runs, 'fParry'), meet));
      const k = total(oracle.runs, 'fKept24');
      const c = total(oracle.runs, 'fCand24');
      gate(true, c === 0 || k >= 0.85 * c, 'flare candidates kept on Days 2-4 ≥ 85% (oracle p3 worlds)', `${pct(k, c)} of ${c}; Days 5+ ${pct(total(oracle.runs, 'fKept5'), total(oracle.runs, 'fCand5'))}`, 'flareKeep');
      const gs = total(oracle.runs, 'gTaken') + total(oracle.runs, 'gMelted');
      if (gs > 0) gate(false, total(oracle.runs, 'gTaken') >= 0.85 * gs, 'oracle saves ≥ 85% of glass flakes (advisory)', pct(total(oracle.runs, 'gTaken'), gs));
    }
    if (rea) {
      const [n, d] = noonShare(rea.runs);
      gate(false, n >= 0.25 * d, `${rea.name} deaths in 11 AM-1 PM ≥ 25% (advisory)`, `${pct(n, d)} of ${d}`);
      // Fix round 2 (review): noon is the boss for the human models at the standard rungs too.
      for (const rung of [3, 4]) {
        const hd = find(rows, (j) => j.bot === 'humanDial' && j.rung === rung && j.forecast === undefined);
        if (!hd) continue;
        const [hn, hdd] = noonShare(hd.runs);
        gate(false, hn >= 0.25 * hdd, `${hd.name} deaths in 11 AM-1 PM ≥ 25% (advisory)`, `${pct(hn, hdd)} of ${hdd}`);
        // Review of economy iteration 2: Day 1 has no Noon Heat, so the Day 2+ share
        // is the one that says whether the Noon Heat is the day's boss (an extra line, same bar).
        const [h2, h2d] = noonShare(hd.runs, 2);
        gate(false, h2 >= 0.25 * h2d, `${hd.name} deaths in 11 AM-1 PM from Day 2 ≥ 25% (advisory)`, `${pct(h2, h2d)} of ${h2d}`);
        // Review r5: the threat layer reaches the standard rung (its runs end on Day 1, where profile 3
        // now meets a morning flare and the Noon Heat). Beside it, the shares the change must not move
        // by more than 5 points (seeds 1-240 before it: R4 70% reach 11 AM, 12% the first night).
        const met = hd.runs.filter((r) => (r.m.fWarn ?? 0) > 0).length;
        const at11 = hd.runs.filter((r) => r.minutes >= 300).length;
        const night = hd.runs.filter((r) => r.minutes >= 720).length;
        gate(false, met >= 0.5 * hd.runs.length, `${hd.name} meets a flare warning on ≥ 50% of runs (advisory)`, `${pct(met, hd.runs.length)}; reach 11 AM ${pct(at11, hd.runs.length)}, the first night ${pct(night, hd.runs.length)}`);
      }
      const meet = total(rea.runs, 'fParry') + total(rea.runs, 'fMiss');
      const p = meet > 0 ? total(rea.runs, 'fParry') / meet : 0;
      gate(false, p >= 0.25 && p <= 0.55, `${rea.name} parries 25-55% (advisory)`, pct(total(rea.runs, 'fParry'), meet));
      const gs = total(rea.runs, 'gTaken') + total(rea.runs, 'gMelted');
      if (gs > 0) gate(false, total(rea.runs, 'gTaken') >= 0.3 * gs && total(rea.runs, 'gTaken') <= 0.6 * gs, `${rea.name} saves 30-60% of glass flakes (advisory)`, pct(total(rea.runs, 'gTaken'), gs));
      const d1 = total(rea.runs, 'day1Ticks') / 3600;
      const dl = total(rea.runs, 'laterTicks') / 3600;
      gate(false, total(rea.runs, 'gSeen1') >= 1.8 * d1, 'glass clusters per daylight minute on Day 1 ≥ 1.8 (advisory, reactive p3)', (total(rea.runs, 'gSeen1') / Math.max(1e-9, d1)).toFixed(2));
      gate(false, total(rea.runs, 'gSeenL') >= 2.5 * dl, 'glass clusters per daylight minute from Day 2 ≥ 2.5 (advisory, reactive p3)', (total(rea.runs, 'gSeenL') / Math.max(1e-9, dl)).toFixed(2));
    }
    if (!ctx.check) return;
    // Extra rows: preAim and the chase policy on the mechanics reactive bot; the novice without glass.
    const extra: Sim16Job[] = [
      { bot: 'reactive', profile: 3, opts: { preAim: true }, label: 'reactive p3 preAim' },
      { bot: 'reactive', profile: 3, opts: { policy: 'chase' }, label: 'reactive p3 chase' },
      { bot: 'novice', profile: 3, v16: { brittle: false }, label: 'novice p3 no glass' },
    ];
    const [pre, chase, novOff] = await ctx.run(extra);
    if (rea && pre) {
      const a = total(rea.runs, 'fParry') / Math.max(1, total(rea.runs, 'fParry') + total(rea.runs, 'fMiss'));
      const b = total(pre.runs, 'fParry') / Math.max(1, total(pre.runs, 'fParry') + total(pre.runs, 'fMiss'));
      gate(false, b - a >= 0.15, 'preAim parries ≥ 15 points more than plain reactive (advisory)', `${(100 * b).toFixed(1)}% vs ${(100 * a).toFixed(1)}%`);
    }
    if (chase) {
      const gs = total(chase.runs, 'gTaken') + total(chase.runs, 'gMelted');
      gate(false, gs === 0 || total(chase.runs, 'gTaken') >= 0.7 * gs, 'reactive chase saves ≥ 70% of glass flakes (advisory)', pct(total(chase.runs, 'gTaken'), gs));
    }
    const nov = find(rows, (j) => j.bot === 'novice' && j.profile === 3 && j.forecast === undefined);
    if (nov && novOff) {
      const melted = (rs: readonly Sim16Run[]): number => (total(rs, 'gMelted') + total(rs, 'pMelted')) / Math.max(1, total(rs, 'gMelted') + total(rs, 'pMelted') + total(rs, 'gTaken') + total(rs, 'pTaken'));
      const dpts = 100 * (melted(nov.runs) - melted(novOff.runs));
      gate(false, dpts <= 8, 'novice p3 melted share rises by ≤ 8 points with glass (advisory)', `${(100 * melted(nov.runs)).toFixed(1)}% vs ${(100 * melted(novOff.runs)).toFixed(1)}% (${dpts >= 0 ? '+' : ''}${dpts.toFixed(1)} pts)`);
    }
    for (const row of [pre, chase, novOff]) {
      if (!row) continue;
      const dm = row.runs.map((r) => (r.died ? r.minutes : Infinity)).sort((x, y) => x - y);
      const med = dm[Math.floor(dm.length / 2)] as number;
      console.log(`  (row) ${row.name.padEnd(24)} median death ${med === Infinity ? `≥ Day ${ctx.days}` : formatScore(med)}, flares parried ${pct(total(row.runs, 'fParry'), total(row.runs, 'fParry') + total(row.runs, 'fMiss'))}, glass flakes saved ${pct(total(row.runs, 'gTaken'), total(row.runs, 'gTaken') + total(row.runs, 'gMelted'))}`);
    }
    const days = Math.min(ctx.days, 5);
    const rd = rescueDelta(ctx.seedFrom, ctx.seeds, days);
    gate(true, rd.on <= 0.8 && rd.on - rd.off <= 0.1, `rescues per chunk ≤ 0.8 and within +0.1 of the same worlds without flares and Noon Heat (p3 plan mix, Days 1-${days - 1})`, `${rd.on.toFixed(3)} vs ${rd.off.toFixed(3)} (${rd.on - rd.off >= 0 ? '+' : ''}${(rd.on - rd.off).toFixed(3)})`);
  },
  modes: {
    bake: bakeMain,
    flares: flaresMain,
  },
};
