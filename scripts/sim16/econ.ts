// v1.6 economy report (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file): ring, bank and
// garden metrics and gates for `sim --check`, the `--policy` rows and the `--decisions` mode
// (policies plain/chase/naive/safe; snaps panic/plan/hoard at a sweep of Chill bars, the x5 farm and
// greed under the strongest snap rule; the glass seekers; the SWING-hop baseline; economy iteration
// 2's gates E1-E3, docs/V1_6_PLAN.md §6.3-§6.4, pooled over --seeds 960). See registry.ts for the hooks.
//
// Per run (collector, in the worker): Σ multiplier and x5 ticks over daylight (from RunStats), level
// changes, ring income split into shade and tricks, daylight on a full meter, frost income, snaps,
// Garden blooms and landings, lit ticks in the 40 daylight ticks after each snapEnd, the 11 AM-1 PM
// share under a snap, and the priced moments of a daylight minute (Days 2-4).

import { rungConfig } from '../../src/config/days.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { dayTicks } from '../../src/core/clock.ts';
import { formatScore } from '../../src/core/format.ts';
import { BINS, binOf } from '../../src/core/intervals.ts';
import type { BotKind } from '../../src/core/sim/bots.ts';
import { V16_RULES, V16_SHIP, type SimState, type V16Rules } from '../../src/core/sim/types.ts';
import type { Sim16Collector, Sim16Ctx, Sim16Job, Sim16Module, Sim16Row, Sim16Run } from './registry.ts';

const RING = TUNING.ring;
const BANK = TUNING.bank;
/** Ticks after a snapEnd whose lit ticks are counted (§2.4 advisory). */
const AFTER_SNAP = 40;
/** The panic rule's "no safe bin within" (a snap squeeze) and Chill bar. */
const SQUEEZE_DEG = TUNING.bots.reactive.snapNearDeg;
const SQUEEZE_CHILL = TUNING.bots.reactive.snapChill;

/** frostGain sources, as the income table prints them. */
const GAIN_SOURCES = ['bloom', 'swing', 'land', 'garden', 'cash', 'cluster', 'parry'] as const;

function collector(): Sim16Collector {
  let levelChanges = 0;
  let trickUnits = 0;
  let shadeUnits = 0;
  let fullTicks = 0;
  let frostFills = 0;
  let day1Mult = 0;
  let day1Ticks = 0;
  let watch = 0;
  let litAfter = 0;
  let snapEnds = 0;
  let bloomedSnaps = 0;
  let noonTicks = 0;
  let noonSnap = 0;
  // Priced moments (Days 2-4): glass windows, flare warnings, snap squeezes, costly gold.
  let pricedTicks = 0;
  let glass = 0;
  let flares = 0;
  let squeezes = 0;
  let costlyGold = 0;
  let glassOn = false;
  let squeezeOn = false;
  let goldOn = false;
  let guideSeen = -1;
  // Glass banked for the next snap (before this tick) and what of it snaps landed.
  let glassPrev = 0;
  let glassLandedH = 0;
  const gainH: Record<string, number> = {};
  return {
    tick(s: SimState): void {
      const glassBefore = glassPrev;
      glassPrev = s.glassBankH;
      for (const e of s.events) {
        if (e.e === 'snap') glassLandedH += glassBefore;
        if (e.e === 'multUp' || e.e === 'multDown') levelChanges++;
        else if (e.e === 'ringTrick') trickUnits += e.units;
        else if (e.e === 'frostGain') gainH[e.source] = (gainH[e.source] ?? 0) + e.amountH;
        else if (e.e === 'frostReady') frostFills++;
        else if (e.e === 'snapEnd') {
          watch = AFTER_SNAP;
          snapEnds++;
          if (s.snapBlooms > 0) bloomedSnaps++;
        } else if (e.e === 'flareWarn' && s.day >= 2 && s.day <= 4) flares++;
      }
      if (s.phase !== 'day' || s.ready > 0) return;
      const nb = s.nubs;
      const w = s.world;
      if (s.day === 1) {
        day1Mult += nb.mult;
        day1Ticks++;
      }
      if (nb.f === 0) shadeUnits += nb.deep ? RING.shadeUnits * RING.deepMul : RING.shadeUnits;
      if (w.mech.snap && (w.v16.bank ? nb.frostH >= BANK.capH : nb.frost >= 1)) fullTicks++;
      if (watch > 0) {
        if (nb.f > 0) litAfter++;
        watch--;
      }
      const dl = dayTicks(s.day);
      if (12 * s.dayTick >= 5 * dl && 12 * s.dayTick < 7 * dl) {
        noonTicks++;
        if (s.snapTicks > 0) noonSnap++;
      }
      if (s.day < 2 || s.day > 4) return;
      pricedTicks++;
      // Snap squeezes: lit, low, a charge in hand and no safe angle near (rising edges).
      const g = s.guide;
      let near = false;
      const b0 = binOf(s.sun.theta);
      for (let k = -SQUEEZE_DEG; k <= SQUEEZE_DEG && !near; k++) if (g.now[(b0 + k + BINS) % BINS] === 1) near = true;
      const sq = nb.f > 0 && nb.chill < SQUEEZE_CHILL && nb.frost >= 1 && s.snapTicks === 0 && !near;
      if (sq && !squeezeOn) squeezes++;
      squeezeOn = sq;
      if (g.tick === guideSeen) return;
      guideSeen = g.tick;
      // Glass windows (guide.flake non-empty) and costly gold (gold in reach, none of it safe now).
      let fl = false;
      let gold = false;
      let safeGold = false;
      for (let b = 0; b < BINS; b++) {
        if (g.flake[b] === 1) fl = true;
        if (g.bud[b] === 1) {
          gold = true;
          if (g.now[b] === 1) safeGold = true;
        }
      }
      if (fl && !glassOn) glass++;
      glassOn = fl;
      const cg = gold && !safeGold;
      if (cg && !goldOn) costlyGold++;
      goldOn = cg;
    },
    finish(s: SimState, out: Record<string, number>): void {
      const st = s.stats;
      out.multTicks = st.multTicks ?? 0;
      out.x5Ticks = st.x5Ticks ?? 0;
      out.multDowns = st.multDowns ?? 0;
      out.levelChanges = levelChanges;
      out.trickUnits = trickUnits;
      out.shadeUnits = shadeUnits;
      out.ringTricks = st.ringTricks ?? 0;
      out.fullTicks = fullTicks;
      out.frostFills = frostFills;
      out.day1Mult = day1Mult;
      out.day1Ticks = day1Ticks;
      out.frostEarnedH = st.frostEarnedH ?? 0;
      out.glassBankedH = s.world.mech.snap && s.world.v16.bank ? (st.brittleSaved ?? 0) * BANK.clusterH : 0;
      out.glassLandedH = glassLandedH;
      out.frostSpilledH = st.frostSpilledH ?? 0;
      out.snapCashH = st.snapCashH ?? 0;
      out.brittleSeen = st.brittleSeen ?? 0;
      out.brittleSaved = st.brittleSaved ?? 0;
      out.snaps = st.snaps ?? 0;
      out.blooms = st.blooms ?? 0;
      out.gardenBlooms = st.gardenBlooms ?? 0;
      out.snapLands = st.snapLands ?? 0;
      out.snapLandsOwn = st.snapLandsOwn ?? 0;
      out.snapEnds = snapEnds;
      out.bloomedSnaps = bloomedSnaps;
      out.litAfter = litAfter;
      out.noonTicks = noonTicks;
      out.noonSnap = noonSnap;
      out.pricedTicks = pricedTicks;
      out.pricedGlass = glass;
      out.pricedFlares = flares;
      out.pricedSqueezes = squeezes;
      out.pricedGold = costlyGold;
      for (const k of GAIN_SOURCES) out[`gain_${k}`] = gainH[k] ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Row arithmetic

const total = (row: Sim16Row, k: string): number => row.runs.reduce((a, r) => a + (r.m[k] ?? 0), 0);
const daylight = (row: Sim16Row): number => row.runs.reduce((a, r) => a + r.daylight, 0);
/** Days played (minutes / 720; the night counts with its day). */
const daysPlayed = (row: Sim16Row): number => row.runs.reduce((a, r) => a + r.minutes / 720, 0);
const per = (n: number, d: number): number => n / Math.max(1e-9, d);
const meanMult = (row: Sim16Row): number => per(total(row, 'multTicks'), daylight(row));
const x5Share = (row: Sim16Row): number => per(total(row, 'x5Ticks'), daylight(row));
const fullShare = (row: Sim16Row): number => per(total(row, 'fullTicks'), daylight(row));
const metersPerDay = (row: Sim16Row): number => per(total(row, 'frostEarnedH') / BANK.costH, daysPlayed(row));
/** The same income with saved glass counted when it is saved (banked for the next snap) instead of when a snap lands it. */
const metersPerDayGlass = (row: Sim16Row): number =>
  per((total(row, 'frostEarnedH') - total(row, 'glassLandedH') + total(row, 'glassBankedH')) / BANK.costH, daysPlayed(row));
/** Meters filled a day (frostReady events: the v1.5 meter reaching full, or the Bank crossing a charge). */
const fillsPerDay = (row: Sim16Row): number => per(total(row, 'frostFills'), daysPlayed(row));
/** Whether a row plays the Frost Bank (its job's rules over V16_SHIP). */
const bankOf = (row: Sim16Row): boolean => row.job.v16?.bank ?? V16_SHIP.bank;
/** The meters/d column: the Bank's income, or the v1.5 meter's fills (it reports no income by source). */
const metersCol = (row: Sim16Row): number => (bankOf(row) ? metersPerDay(row) : fillsPerDay(row));
const snapsPerDay = (row: Sim16Row): number => per(total(row, 'snaps'), daysPlayed(row));
const changesPerMin = (row: Sim16Row): number => per(total(row, 'levelChanges'), daylight(row) / 3600);
const trickShare = (row: Sim16Row): number => per(total(row, 'trickUnits'), total(row, 'trickUnits') + total(row, 'shadeUnits'));
const day1Mult = (row: Sim16Row): number => per(total(row, 'day1Mult'), total(row, 'day1Ticks'));
const bloomsPerSnap = (row: Sim16Row): number => per(total(row, 'gardenBlooms'), total(row, 'snaps'));
const ownLandShare = (row: Sim16Row): number => per(total(row, 'snapLandsOwn'), total(row, 'bloomedSnaps'));
const litAfterSnap = (row: Sim16Row): number => per(total(row, 'litAfter'), total(row, 'snapEnds'));
const noonSnapShare = (row: Sim16Row): number => per(total(row, 'noonSnap'), total(row, 'noonTicks'));
const pricedPerMin = (row: Sim16Row): number =>
  per(total(row, 'pricedGlass') + total(row, 'pricedFlares') + total(row, 'pricedSqueezes') + total(row, 'pricedGold'), total(row, 'pricedTicks') / 3600);
const meanMinutes = (row: Sim16Row): number => per(row.runs.reduce((a, r) => a + r.minutes, 0), row.runs.length);

function quantileMinutes(row: Sim16Row, p: number): number {
  const xs = row.runs.map((r: Sim16Run) => (r.died ? r.minutes : Infinity)).sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] as number;
}

const clock = (m: number, days: number): string => (m === Infinity ? `≥ Day ${days}` : formatScore(m));
const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;
const f2 = (v: number): string => v.toFixed(2);

/** Frost landed on the meter per day played, by source (charges). */
function incomeTable(rows: readonly Sim16Row[]): void {
  console.log(`\nFrost landed per day played, by source (charges; garden = income banked under a snap):`);
  console.log(`${'row'.padEnd(30)} ${GAIN_SOURCES.map((k) => k.padStart(8)).join('')}  spilled`);
  for (const r of rows) {
    const d = daysPlayed(r);
    console.log(`${r.name.padEnd(30)} ${GAIN_SOURCES.map((k) => f2(per(total(r, `gain_${k}`) / BANK.costH, d)).padStart(8)).join('')}  ${f2(per(total(r, 'frostSpilledH') / BANK.costH, d)).padStart(7)}`);
  }
}

/** The economy table: one line per row. */
function table(rows: readonly Sim16Row[], days: number): void {
  console.log(`${'row'.padEnd(30)} mean×  x5%    chg/min trick%  full%  meters/d snaps/d bl/snap own%   lit40  noonSnap% priced/min  mean death`);
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(30)} ${f2(meanMult(r)).padStart(5)} ${pct(x5Share(r)).padStart(6)} ${changesPerMin(r).toFixed(1).padStart(7)} ${pct(trickShare(r)).padStart(7)} ${pct(fullShare(r)).padStart(6)} ${f2(metersCol(r)).padStart(8)} ${f2(snapsPerDay(r)).padStart(7)} ${f2(bloomsPerSnap(r)).padStart(7)} ${pct(ownLandShare(r)).padStart(6)} ${litAfterSnap(r).toFixed(1).padStart(6)} ${pct(noonSnapShare(r)).padStart(9)} ${pricedPerMin(r).toFixed(2).padStart(10)}  ${clock(meanMinutes(r), days)}`,
    );
  }
}

type Line = (ok: boolean, hard: boolean, what: string, got: string, waiver?: string) => void;

function liner(ctx: Sim16Ctx): Line {
  return (ok, hard, what, got, waiver) => {
    const waived = !ok && hard && waiver !== undefined && ctx.waived(waiver);
    if (hard && !ok && !waived) ctx.fail(what);
    const note = !ok && hard && waiver !== undefined && !waived ? ` (an integrator waiver is --waive ${waiver})` : '';
    console.log(`  ${ok ? 'PASS' : waived ? 'WAIVED' : hard ? 'FAIL' : 'MISS'}  ${what}: ${got}${note}`);
  };
}

const isRow = (r: Sim16Row, bot: BotKind, f: (j: Sim16Job) => boolean = () => true): boolean => r.job.bot === bot && f(r.job);

// ---------------------------------------------------------------------------------------------
// The report after the v1.5 report (sim --check gates)

function report(ctx: Sim16Ctx, rows: readonly Sim16Row[]): void {
  if (ctx.policy !== null) console.log(`\n--policy ${ctx.policy}: on the reactive rows that use the mechanics.`);
  const on = (k: 'ring' | 'bank' | 'garden'): boolean => ctx.off[k] ?? V16_SHIP[k];
  const base = rows.filter((r) => r.job.forecast === undefined);
  console.log(`\nEconomy (v1.6 ring, bank, garden${on('ring') && on('bank') && on('garden') ? '' : `; off: ${(['ring', 'bank', 'garden'] as const).filter((k) => !on(k)).join(', ')}`}):`);
  table(base, ctx.days);
  incomeTable(base.filter((r) => r.job.rung === undefined || r.job.rung >= 2));
  const rea = base.find((r) => isRow(r, 'reactive', (j) => !j.noMech && j.profile === 3 && j.rung === undefined));
  const dial = base.find((r) => isRow(r, 'reactive', (j) => j.noMech === true && j.profile === 3 && j.rung === undefined));
  const ora = base.find((r) => isRow(r, 'oracle', (j) => !j.noMech && j.profile === 3));
  const hd = (rung: number): Sim16Row | undefined => base.find((r) => isRow(r, 'humanDial', (j) => j.rung === rung));
  const line = liner(ctx);
  console.log('\nEconomy gates (docs/V1_6_PLAN.md §2.1, §2.2, §2.4, §6; MISS never fails --check):');
  if (rea && on('ring')) {
    line(x5Share(rea) <= 0.2, ctx.check, 'reactive p3 x5 share ≤ 20% of daylight', pct(x5Share(rea)));
    const m = meanMult(rea);
    line(m >= 2.8 && m <= 3.8, ctx.check, 'reactive p3 mean multiplier x2.8-3.8', `x${f2(m)}`);
    line(changesPerMin(rea) <= 20, false, 'reactive p3 level changes ≤ 20 a minute', changesPerMin(rea).toFixed(1));
    const ts = trickShare(rea);
    line(ts >= 0.1 && ts <= 0.3, false, 'reactive p3 tricks are 10-30% of charge income', pct(ts));
  }
  if (rea && on('bank')) {
    line(fullShare(rea) <= 0.1, ctx.check, 'reactive p3 sits on a full bank ≤ 10% of daylight', pct(fullShare(rea)));
    const spd = snapsPerDay(rea);
    line(spd >= 0.5 && spd <= 0.9, false, 'reactive p3 0.5-0.9 snaps a day', f2(spd));
  } else if (rea) {
    // Bank off (V16_SHIP, §11): diagnosis #4's rows measure the v1.5 meter; they fail unless waived.
    line(fullShare(rea) <= 0.1, ctx.check, 'reactive p3 sits on a full meter ≤ 10% of daylight (Bank off: the v1.5 meter)', pct(fullShare(rea)), 'bank');
    line(snapsPerDay(rea) >= 0.5 && snapsPerDay(rea) <= 0.9, false, 'reactive p3 0.5-0.9 snaps a day', f2(snapsPerDay(rea)));
  }
  if (dial && on('bank')) line(metersPerDay(dial) <= 0.15, ctx.check, 'reactive p3 dial (dial-only) fills ≤ 0.15 meters a day from income', `${f2(metersPerDay(dial))} (${f2(metersPerDayGlass(dial))} counting glass when saved: a snap would land it)`);
  else if (dial) line(fillsPerDay(dial) <= 0.15, ctx.check, 'reactive p3 dial (dial-only) fills ≤ 0.15 meters a day (Bank off: the v1.5 meter fills passively)', f2(fillsPerDay(dial)), 'bank');
  if (ora && on('ring')) line(meanMult(ora) >= 1.5, false, 'oracle p3 mean multiplier ≥ x1.5', `x${f2(meanMult(ora))}`);
  const r2 = hd(2);
  if (r2 && on('ring')) {
    const d1 = day1Mult(r2);
    line(d1 >= 1.8 && d1 <= 2.5, false, 'humanDial R2 Day-1 mean multiplier x1.8-2.5', `x${f2(d1)}`);
    if (rea) line(meanMult(rea) - meanMult(r2) >= 1, false, 'reactive p3 minus humanDial R2 mean multiplier ≥ 1.0 level', f2(meanMult(rea) - meanMult(r2)));
    for (const rung of [2, 3, 4]) {
      const h = hd(rung);
      if (h) line(changesPerMin(h) <= 14, false, `humanDial R${rung} level changes ≤ 14 a minute`, changesPerMin(h).toFixed(1));
    }
  }
  if (on('garden')) {
    if (rea) {
      line(bloomsPerSnap(rea) >= 0.8, false, 'reactive p3 blooms per snap ≥ 0.8', f2(bloomsPerSnap(rea)));
      line(ownLandShare(rea) >= 0.3, false, 'reactive p3 own landings on ≥ 30% of snaps that bloomed', pct(ownLandShare(rea)));
      line(litAfterSnap(rea) <= 10, false, 'reactive p3 lit ticks in the 40 after snapEnd ≤ 10', litAfterSnap(rea).toFixed(1));
      line(noonSnapShare(rea) <= 0.25, false, 'reactive p3 11 AM-1 PM daylight under a snap ≤ 25%', pct(noonSnapShare(rea)));
    }
    if (ora) {
      line(bloomsPerSnap(ora) >= 1.2, false, 'oracle p3 blooms per snap ≥ 1.2', f2(bloomsPerSnap(ora)));
      line(litAfterSnap(ora) <= 12, false, 'oracle p3 lit ticks in the 40 after snapEnd ≤ 12', litAfterSnap(ora).toFixed(1));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// --decisions: the bank's policies and snap rules (§2.2 acceptance; economy iterations 1-2, V1_6_PLAN §6.2-§6.4)

/** Paired mean difference a − b over the seeds both rows played, with its standard error. */
function paired(a: Sim16Row, b: Sim16Row): { mean: number; se: number; n: number } {
  const by = new Map(b.runs.map((r) => [r.seed, r.minutes]));
  const d: number[] = [];
  for (const r of a.runs) {
    const m = by.get(r.seed);
    if (m !== undefined) d.push(r.minutes - m);
  }
  const n = d.length;
  const mean = n > 0 ? d.reduce((x, y) => x + y, 0) / n : 0;
  const se = n > 1 ? Math.sqrt(d.reduce((x, y) => x + (y - mean) * (y - mean), 0) / (n - 1) / n) : 0;
  return { mean, se, n };
}

/** Seeds from which the pooled rows (E2 chase, E3) gate on the lower 1-SE bound instead of the mean. */
const POOLED_SEEDS = 960;

/**
 * sim --release's held-out seeds (docs/V1_6_PLAN.md §6.4, §13): two 960-seed blocks no iteration was
 * tuned on. E2 and E3 gate on the 1920 seeds pooled, with the bars of seeds 1-960.
 */
export const HELD_OUT: readonly (readonly [number, number])[] = Object.freeze([
  [40001, 960],
  [50001, 960],
]);

const rea = (label: string, opts: Sim16Job['opts'], extra: Partial<Sim16Job> = {}): Sim16Job => ({ bot: 'reactive', profile: 3, label, ...(opts ? { opts } : {}), ...extra });

async function decisions(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const rung = (r: number): Sim16Job => {
    const rc = rungConfig(r, { tutorialDone: true });
    return { bot: 'humanDial', profile: rc.profile, drain: rc.drain, noonCloud: rc.noonCloud, lesson: rc.lesson, rung: r, label: `humanDial R${r}` };
  };
  const L = BANK.coolChill;
  const PANIC = TUNING.bots.reactive.snapChill;
  // The snap-rule sweep on plain play (iteration 2): the panic bar, the plan's bar and the hoarders.
  // A hoarder snaps only when lit below its bar and never spends an overflow. The E1 family (every
  // policy that waits longer than the plan) is the panic rule at its own bar and below it, and every
  // hoarder up to the panic bar; the bars above it look for the strongest snap rule.
  const PANIC_BARS = [25, 30, 35, 45, 50, 60, 70];
  const PLAN_BARS = [50, 70, 80];
  const HOARD_BARS = [...new Set([20, 25, L + 2, L + 10, PANIC])];
  const jobs: Sim16Job[] = [
    rea('reactive plain', { policy: 'plain' }),
    rea('reactive chase', { policy: 'chase' }),
    rea('reactive naive', { policy: 'naive' }),
    rea('reactive safe', { policy: 'safe' }),
    rea('reactive plain plan-snap', { policy: 'plain', snap: 'plan' }),
    rea('reactive dial (dial-only)', undefined, { noMech: true }),
    rea('reactive plain glass-seeking', { policy: 'plain', glass: true }),
    rea('reactive plain glass strong', { policy: 'plain', glass: 'strong' }),
    rung(2),
    rung(3),
    rung(4),
    rea('reactive plain, v1.6 all off', { policy: 'plain' }, { v16: { ring: false, bank: false, garden: false, brittle: false, flares: false, noonHeat: false } }),
    rea('reactive plain, no start charge', { policy: 'plain' }, { startFrost: 0 }),
    ...PANIC_BARS.map((t) => rea(`plain panic@${t}`, { policy: 'plain', snapChill: t })),
    ...PLAN_BARS.map((t) => rea(`plain plan@${t}`, { policy: 'plain', snap: 'plan', snapChill: t })),
    ...HOARD_BARS.map((t) => rea(`plain hoard@${t}`, { policy: 'plain', snap: 'hoard', snapChill: t })),
    rea('plain panic@45 + x5 farm', { policy: 'plain', snapChill: 45, farm: 5 }),
    // E3's gate (review of iteration 2): the cheap-detour seeker, and plain play on worlds without glass.
    rea('reactive plain glass near', { policy: 'plain', glass: 'near' }),
    rea('reactive plain, no glass', { policy: 'plain' }, { v16: { brittle: false } }),
    // E2 on a stronger shade baseline (advisory, review of iteration 2): play that hops to another
    // caster's shade, with each greed policy layered on it.
    rea('reactive plain hop@2', { policy: 'plain', hop: 2 }),
    rea('reactive chase hop@2', { policy: 'chase', hop: 2 }),
    rea('reactive naive hop@2', { policy: 'naive', hop: 2 }),
    rea('reactive safe hop@2', { policy: 'safe', hop: 2 }),
  ];
  const EXTRA = 6;
  const rows = await ctx.run(jobs);
  const [plain, chase, naive, safe, plan, dial, glass, strong, h2, h3, h4, none, noStart] = rows as Sim16Row[] as [Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row];
  const sweep = rows.slice(13, 13 + PANIC_BARS.length + PLAN_BARS.length + HOARD_BARS.length);
  const farm = rows[rows.length - 1 - EXTRA] as Sim16Row;
  const [near, noGlass, hop, chaseHop, naiveHop, safeHop] = rows.slice(rows.length - EXTRA) as [Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row];
  const panic45 = rows[13 + PANIC_BARS.indexOf(45)] as Sim16Row;
  // The strongest snap rule for plain play: greed is gated under it too (review of iteration 1).
  const candidates = [plain, plan, ...sweep];
  // (The hop baseline is a shade policy, not a snap rule: E2 reports greed against it on its own lines.)
  let best = plain;
  for (const r of candidates) if (meanMinutes(r) > meanMinutes(best)) best = r;
  const bestOpts = { ...(best.job.opts ?? {}) };
  const greedy = await ctx.run([
    rea(`naive, ${best.name.replace('reactive ', '')} rule`, { ...bestOpts, policy: 'naive' }),
    rea(`chase, ${best.name.replace('reactive ', '')} rule`, { ...bestOpts, policy: 'chase' }),
  ]);
  const [naiveBest, chaseBest] = greedy as [Sim16Row, Sim16Row];
  const all = [...rows, ...greedy];
  const wall = (performance.now() - t0) / 1000;
  const rule = (k: keyof V16Rules): boolean => ctx.off[k] ?? V16_SHIP[k];
  const offNames = V16_RULES.filter((k) => !rule(k));
  const onNames = V16_RULES.filter((k) => rule(k) && !V16_SHIP[k]);
  console.log(`SHADY sim --decisions: ${ctx.seeds} seeds${ctx.seedFrom !== 1 ? ` from ${ctx.seedFrom}` : ''}, profile 3, up to Day ${ctx.days}, ${ctx.workers} workers, ${wall.toFixed(1)} s${offNames.length ? `, v1.6 off: ${offNames.join(', ')}` : ''}${onNames.length ? `, switched on: ${onNames.join(', ')}` : ''}\n`);
  console.log(`${'row'.padEnd(34)} ${'mean'.padEnd(17)} ${'median'.padEnd(17)} p90`);
  for (const r of all) console.log(`${r.name.padEnd(34)} ${clock(meanMinutes(r), ctx.days).padEnd(17)} ${clock(quantileMinutes(r, 0.5), ctx.days).padEnd(17)} ${clock(quantileMinutes(r, 0.9), ctx.days)}`);
  console.log('');
  table(all, ctx.days);
  incomeTable(all.slice(0, 13));
  const sgn = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)} min`;
  const pm = (p: { mean: number; se: number }): string => `${sgn(p.mean)} ± ${p.se.toFixed(0)}`;
  const pooled = ctx.seeds >= POOLED_SEEDS;
  /** A pooled row: at ≥ POOLED_SEEDS seeds its lower 1-SE bound must clear `bar`; below that, its mean. */
  const lo = (p: { mean: number; se: number }): number => (pooled ? p.mean - p.se : p.mean);
  const loNote = pooled ? 'lower 1-SE bound' : `mean; the lower 1-SE bound gates at --seeds ${POOLED_SEEDS}`;
  const line = liner(ctx);
  console.log(`\nSnap rules on plain play (red line: Chill ${L}; a hoarder never spends an overflow):`);
  for (const r of [plain, plan, ...sweep]) {
    const p = paired(r, plan);
    console.log(`  ${r.name.padEnd(34)} ${clock(meanMinutes(r), ctx.days).padEnd(17)} vs plan ${pm(p).padEnd(16)} snaps/d ${f2(snapsPerDay(r))}${r === best ? '  (strongest)' : ''}`);
  }
  console.log('\nDecision gates (docs/V1_6_PLAN.md §2.2, §6, §6.2-§6.4; MISS never fails):');
  // E1 (re-specified in iteration 2, V1_6_PLAN §6.3): plan beats the best hoarder, and still the panic bot.
  const hoarders = [plain, ...sweep.filter((r) => r.job.opts?.snap === 'hoard' || (r.job.opts?.snap === undefined && (r.job.opts?.snapChill ?? PANIC) <= PANIC))];
  let worst = { mean: Infinity, se: 0, n: 0 };
  let worstName = '';
  for (const h of hoarders) {
    const p = paired(plan, h);
    if (p.mean < worst.mean) {
      worst = p;
      worstName = h.name;
    }
  }
  line(worst.mean >= 30, true, `E1: plan-snap outlives the best hoarder by ≥ 30 min (mean; ${hoarders.map((h) => h.name.replace('plain ', '')).join(', ')})`, `${pm(worst)} vs ${worstName}`);
  line(paired(plan, plain).mean >= 30, true, 'E1: plan-snap outlives panic-snap by ≥ 30 min (mean; iteration 1)', pm(paired(plan, plain)));
  line(fullShare(plain) <= 0.15, true, 'E1: reactive plain sits on a full bank ≤ 15% of daylight', pct(fullShare(plain)));
  const cp = paired(chase, plain);
  line(lo(cp) >= 150, true, `E2: chase outlives plain by ≥ 150 min (${loNote})`, pm(cp));
  line(paired(naive, plain).mean < 0, true, 'E2: naive does not beat plain (mean)', pm(paired(naive, plain)));
  const nb = best === plain ? paired(naive, plain) : paired(naiveBest, best);
  line(nb.mean < 0, true, `E2: naive does not beat plain under the strongest snap rule (${best.name.replace('reactive ', '')})`, pm(nb));
  line(paired(chaseBest, best).mean > 0, false, `chase outlives plain under the strongest snap rule`, pm(paired(chaseBest, best)));
  line(paired(safe, plain).mean < 0, true, 'E2: safe trails plain (mean)', pm(paired(safe, plain)));
  // E2 on a stronger shade baseline (advisory, review of iteration 2): each greed policy layered on
  // the SWING hopper, against the hopper (is greed's payoff more than the weak baseline's?).
  line(paired(chaseHop, hop).mean >= 150, false, `E2 on hop@2: chase outlives its baseline by ≥ 150 min (mean)`, `${pm(paired(chaseHop, hop))}; hop@2 − plain ${pm(paired(hop, plain))}`);
  line(paired(naiveHop, hop).mean < 0, false, 'E2 on hop@2: naive does not beat its baseline', pm(paired(naiveHop, hop)));
  line(paired(safeHop, hop).mean < 0, false, 'E2 on hop@2: safe trails its baseline', pm(paired(safeHop, hop)));
  const gp = paired(glass, plain);
  const sp = paired(strong, plain);
  const np = paired(near, plain);
  const ng = paired(plain, noGlass);
  const saved = (r: Sim16Row): string => pct(per(total(r, 'brittleSaved'), total(r, 'brittleSeen')));
  // E3 (re-specified in the review of iteration 2, V1_6_PLAN §6.4): the gate's seeker takes only the
  // cheap detours; the two seekers that pay for detours costing more than glass earns stay as rows
  // that glass is never a tax (mean above −1 SE), with plain play on worlds without glass as the control.
  line(lo(np) > 0, true, `E3: a glass seeker on the cheap detours (weight 4 within 15° of now ∪ next, any hour) outlives glass-ignoring (${loNote})`, `${pm(np)} (glass clusters saved ${saved(near)} vs ${saved(plain)})`);
  line(gp.mean > -gp.se, false, `E3: glass is never a tax on chase's glass term at its hours (mean > −1 SE)`, `${pm(gp)} (saved ${saved(glass)})`);
  line(sp.mean > -sp.se, false, 'E3: glass is never a tax on a weight-4 seeker at any hour (mean > −1 SE)', `${pm(sp)} (saved ${saved(strong)})`);
  line(ng.mean > -ng.se, false, 'E3: glass is never a tax on glass-ignoring play (plain − plain on worlds without glass, mean > −1 SE)', pm(ng));
  line(paired(farm, panic45).mean <= 0, true, 'a cool snap at x5 with a bud in reach, needed or not, does not pay (x5 farm vs panic@45)', pm(paired(farm, panic45)));
  if (rule('bank')) {
    line(fullShare(plain) <= 0.1, true, 'reactive plain sits on a full bank ≤ 10% of daylight', pct(fullShare(plain)));
    line(metersPerDay(dial) <= 0.15, true, 'dial-only fills ≤ 0.15 meters a day from income', `${f2(metersPerDay(dial))} (${f2(metersPerDayGlass(dial))} counting glass when saved: a snap would land it)`);
  } else {
    // The Frost Bank switched off: the rows measure the v1.5 meter and fail unless waived.
    line(fullShare(plain) <= 0.1, true, 'reactive plain sits on a full meter ≤ 10% of daylight (Bank off: the v1.5 meter)', pct(fullShare(plain)), 'bank');
    line(fillsPerDay(dial) <= 0.15, true, 'dial-only fills ≤ 0.15 meters a day (Bank off: the v1.5 meter fills passively)', f2(fillsPerDay(dial)), 'bank');
  }
  // E5 (review of iteration 1): mechanics vs dial on every 240-seed block (hard in --check, which plays seeds 1..N).
  const med = (r: Sim16Row, a: number, b: number): number => {
    const xs = r.runs.filter((x) => x.seed >= a && x.seed <= b).map((x) => (x.died ? x.minutes : Infinity)).sort((x, y) => x - y);
    return xs[Math.min(xs.length - 1, Math.floor(0.5 * xs.length))] as number;
  };
  const blocks: string[] = [];
  let blockOk = true;
  for (let a = ctx.seedFrom; a + 239 < ctx.seedFrom + ctx.seeds; a += 240) {
    const v = med(plain, a, a + 239) - med(dial, a, a + 239);
    blockOk &&= v >= 180;
    blocks.push(`${a}-${a + 239}: ${sgn(v)}`);
  }
  if (blocks.length) line(blockOk, false, 'reactive plain outlives dial-only by ≥ 180 min (median) on every 240-seed block (hard in --check)', blocks.join(', '));
  const spd = snapsPerDay(plain);
  line(spd >= 0.5 && spd <= 0.9, false, 'reactive plain 0.5-0.9 snaps a day', f2(spd));
  for (const h of [h2, h3, h4]) {
    const n = per(total(h, 'snaps'), h.runs.length);
    line(n >= 0.8, false, `${h.name} ≥ 0.8 snaps per run`, f2(n));
  }
  line(paired(plan, plain).mean >= 60, false, 'plan-snap outlives panic-snap by ≥ 60 min (mean)', pm(paired(plan, plain)));
  line(paired(plain, noStart).mean <= 120, false, 'the starting charge alone adds ≤ 120 min (§2.2; plain against plain with no charge)', `${pm(paired(plain, noStart))}; without it plain − dial-only ${pm(paired(noStart, dial))}`);
  const p90 = quantileMinutes(chase, 0.9);
  line(p90 <= 7 * 720, false, 'chase p90 ≤ Day 7', clock(p90, ctx.days));
  const pmn = pricedPerMin(plain);
  const pm0 = pricedPerMin(none);
  line(pmn - pm0 >= 3, false, 'priced moments per daylight minute, Days 2-4 (reactive plain), ≥ +3 over v1.6 all off', `${pmn.toFixed(2)} vs ${pm0.toFixed(2)} (glass ${per(total(plain, 'pricedGlass'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, flares ${per(total(plain, 'pricedFlares'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, squeezes ${per(total(plain, 'pricedSqueezes'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, costly gold ${per(total(plain, 'pricedGold'), total(plain, 'pricedTicks') / 3600).toFixed(2)})`);
}

/**
 * --release (docs/V1_6_PLAN.md §13): --decisions on seeds 1-960 (every hard row), then E2 and E3 on
 * the held-out seeds (HELD_OUT, 1920 seeds pooled): chase − plain's lower 1-SE bound ≥ +150, naive
 * and safe below plain, and the near glass seeker's lower 1-SE bound above plain. Exits 1 on either.
 */
async function release(ctx: Sim16Ctx): Promise<void> {
  // An explicit --seeds N plays N seeds a block instead (a smoke run of the mode; the gates want 960).
  const block = process.argv.includes('--seeds') ? ctx.seeds : POOLED_SEEDS;
  await decisions({ ...ctx, seedFrom: 1, seeds: block, run: (jobs, from = 1, n = block) => ctx.run(jobs, from, n) });
  const t0 = performance.now();
  const jobs = [
    rea('reactive plain', { policy: 'plain' }),
    rea('reactive chase', { policy: 'chase' }),
    rea('reactive naive', { policy: 'naive' }),
    rea('reactive safe', { policy: 'safe' }),
    rea('reactive plain glass near', { policy: 'plain', glass: 'near' }),
  ];
  const blocks: Sim16Row[][] = [];
  for (const [from, n] of HELD_OUT) blocks.push(await ctx.run(jobs, from, Math.min(n, block)));
  const pooledRows: Sim16Row[] = jobs.map((job, i) => ({ name: (blocks[0]?.[i] as Sim16Row).name, job, runs: blocks.flatMap((b) => (b[i] as Sim16Row).runs) }));
  const wall = (performance.now() - t0) / 1000;
  const n = pooledRows[0]?.runs.length ?? 0;
  console.log(`\nSHADY sim --release, held out: ${HELD_OUT.map(([a, k]) => `${a}-${a + Math.min(k, block) - 1}`).join(' and ')} (${n} seeds pooled), ${ctx.workers} workers, ${wall.toFixed(1)} s`);
  const sgn = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)} min`;
  const pm = (p: { mean: number; se: number }): string => `${sgn(p.mean)} ± ${p.se.toFixed(0)}`;
  const each = (i: number): string => blocks.map((b, k) => `${(HELD_OUT[k] as readonly number[])[0]}: ${pm(paired(b[i] as Sim16Row, b[0] as Sim16Row))}`).join(', ');
  const [plain, chase, naive, safe, near] = pooledRows as [Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row];
  const line = liner(ctx);
  const cp = paired(chase, plain);
  line(cp.mean - cp.se >= 150, true, 'held out, E2: chase outlives plain by ≥ 150 min (lower 1-SE bound, pooled)', `${pm(cp)}; ${each(1)}`);
  line(paired(naive, plain).mean < 0, true, 'held out, E2: naive does not beat plain (mean, pooled)', `${pm(paired(naive, plain))}; ${each(2)}`);
  line(paired(safe, plain).mean < 0, true, 'held out, E2: safe trails plain (mean, pooled)', `${pm(paired(safe, plain))}; ${each(3)}`);
  const np = paired(near, plain);
  const saved = (r: Sim16Row): string => pct(per(total(r, 'brittleSaved'), total(r, 'brittleSeen')));
  line(np.mean - np.se > 0, true, 'held out, E3: the cheap-detour glass seeker outlives glass-ignoring (lower 1-SE bound, pooled)', `${pm(np)} (saved ${saved(near)} vs ${saved(plain)}); ${each(4)}`);
}

export const ECON: Sim16Module = {
  name: 'econ',
  collector,
  report,
  modes: { decisions, release },
};
