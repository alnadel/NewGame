// v1.6 economy report (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file): ring, bank and
// garden metrics and gates for `sim --check`, the `--policy` rows and the `--decisions` mode
// (policies plain/chase/naive/safe, snaps panic/plan). See registry.ts for the hooks.
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
  const gainH: Record<string, number> = {};
  return {
    tick(s: SimState): void {
      for (const e of s.events) {
        if (e.e === 'multUp' || e.e === 'multDown') levelChanges++;
        else if (e.e === 'ringTrick') trickUnits += e.units;
        else if (e.e === 'frostGain') gainH[e.source] = (gainH[e.source] ?? 0) + e.amountH;
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
      out.day1Mult = day1Mult;
      out.day1Ticks = day1Ticks;
      out.frostEarnedH = st.frostEarnedH ?? 0;
      out.frostSpilledH = st.frostSpilledH ?? 0;
      out.snapCashH = st.snapCashH ?? 0;
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
      `${r.name.padEnd(30)} ${f2(meanMult(r)).padStart(5)} ${pct(x5Share(r)).padStart(6)} ${changesPerMin(r).toFixed(1).padStart(7)} ${pct(trickShare(r)).padStart(7)} ${pct(fullShare(r)).padStart(6)} ${f2(metersPerDay(r)).padStart(8)} ${f2(snapsPerDay(r)).padStart(7)} ${f2(bloomsPerSnap(r)).padStart(7)} ${pct(ownLandShare(r)).padStart(6)} ${litAfterSnap(r).toFixed(1).padStart(6)} ${pct(noonSnapShare(r)).padStart(9)} ${pricedPerMin(r).toFixed(2).padStart(10)}  ${clock(meanMinutes(r), days)}`,
    );
  }
}

type Line = (ok: boolean, hard: boolean, what: string, got: string) => void;

function liner(ctx: Sim16Ctx): Line {
  return (ok, hard, what, got) => {
    if (hard && !ok) ctx.fail(what);
    console.log(`  ${ok ? 'PASS' : hard ? 'FAIL' : 'MISS'}  ${what}: ${got}`);
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
    console.log(`  n/a   the Frost Bank's gates (Bank off: the v1.5 meter; reactive p3 sits on a full meter ${pct(fullShare(rea))} of daylight, ${f2(snapsPerDay(rea))} snaps a day)`);
  }
  if (dial && on('bank')) line(metersPerDay(dial) <= 0.15, ctx.check, 'reactive p3 dial (dial-only) fills ≤ 0.15 meters a day from income', f2(metersPerDay(dial)));
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
// --decisions: the bank's policies and snap rules (§2.2 acceptance)

async function decisions(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const rea = (label: string, opts: Sim16Job['opts'], extra: Partial<Sim16Job> = {}): Sim16Job => ({ bot: 'reactive', profile: 3, label, ...(opts ? { opts } : {}), ...extra });
  const rung = (r: number): Sim16Job => {
    const rc = rungConfig(r, { tutorialDone: true });
    return { bot: 'humanDial', profile: rc.profile, drain: rc.drain, noonCloud: rc.noonCloud, lesson: rc.lesson, rung: r, label: `humanDial R${r}` };
  };
  const jobs: Sim16Job[] = [
    rea('reactive plain', { policy: 'plain' }),
    rea('reactive chase', { policy: 'chase' }),
    rea('reactive naive', { policy: 'naive' }),
    rea('reactive safe', { policy: 'safe' }),
    rea('reactive plain plan-snap', { policy: 'plain', snap: 'plan' }),
    rea('reactive dial (dial-only)', undefined, { noMech: true }),
    rung(2),
    rung(3),
    rung(4),
    rea('reactive plain, v1.6 all off', { policy: 'plain' }, { v16: { ring: false, bank: false, garden: false, brittle: false, flares: false, noonHeat: false } }),
  ];
  const rows = await ctx.run(jobs);
  const wall = (performance.now() - t0) / 1000;
  const rule = (k: keyof V16Rules): boolean => ctx.off[k] ?? V16_SHIP[k];
  const offNames = V16_RULES.filter((k) => !rule(k));
  const onNames = V16_RULES.filter((k) => rule(k) && !V16_SHIP[k]);
  console.log(`SHADY sim --decisions: ${ctx.seeds} seeds, profile 3, up to Day ${ctx.days}, ${ctx.workers} workers, ${wall.toFixed(1)} s${offNames.length ? `, v1.6 off: ${offNames.join(', ')}` : ''}${onNames.length ? `, switched on: ${onNames.join(', ')}` : ''}\n`);
  console.log(`${'row'.padEnd(30)} ${'mean'.padEnd(17)} ${'median'.padEnd(17)} p90`);
  for (const r of rows) console.log(`${r.name.padEnd(30)} ${clock(meanMinutes(r), ctx.days).padEnd(17)} ${clock(quantileMinutes(r, 0.5), ctx.days).padEnd(17)} ${clock(quantileMinutes(r, 0.9), ctx.days)}`);
  console.log('');
  table(rows, ctx.days);
  incomeTable(rows);
  const [plain, chase, naive, safe, plan, dial, h2, h3, h4, none] = rows as [Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row, Sim16Row];
  const d = (a: Sim16Row, b: Sim16Row): number => meanMinutes(a) - meanMinutes(b);
  const sgn = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)} min`;
  const line = liner(ctx);
  console.log('\nDecision gates (docs/V1_6_PLAN.md §2.2, §6; MISS never fails):');
  line(d(chase, plain) >= 150, true, 'chase outlives plain by ≥ 150 min (mean)', sgn(d(chase, plain)));
  line(d(naive, plain) <= 0, true, 'naive does not beat plain (mean)', sgn(d(naive, plain)));
  line(d(safe, plain) < 0, true, 'safe trails plain (mean)', sgn(d(safe, plain)));
  if (rule('bank')) {
    line(fullShare(plain) <= 0.1, true, 'reactive plain sits on a full bank ≤ 10% of daylight', pct(fullShare(plain)));
    line(metersPerDay(dial) <= 0.15, true, 'dial-only fills ≤ 0.15 meters a day from income', f2(metersPerDay(dial)));
  } else {
    // The Frost Bank ships off (V16_SHIP): its own rows measure a bank that is not there.
    console.log(`  n/a   the Frost Bank's rows (Bank off: the v1.5 meter; reactive plain sits on a full meter ${pct(fullShare(plain))} of daylight; --on bank measures the Bank)`);
  }
  const spd = snapsPerDay(plain);
  line(spd >= 0.5 && spd <= 0.9, false, 'reactive plain 0.5-0.9 snaps a day', f2(spd));
  for (const h of [h2, h3, h4]) {
    const n = per(total(h, 'snaps'), h.runs.length);
    line(n >= 0.8, false, `${h.name} ≥ 0.8 snaps per run`, f2(n));
  }
  line(d(plan, plain) >= 60, false, 'plan-snap outlives panic-snap by ≥ 60 min (mean)', sgn(d(plan, plain)));
  const p90 = quantileMinutes(chase, 0.9);
  line(p90 <= 7 * 720, false, 'chase p90 ≤ Day 7', clock(p90, ctx.days));
  const pm = pricedPerMin(plain);
  const pm0 = pricedPerMin(none);
  line(pm - pm0 >= 3, false, 'priced moments per daylight minute, Days 2-4 (reactive plain), ≥ +3 over v1.6 all off', `${pm.toFixed(2)} vs ${pm0.toFixed(2)} (glass ${per(total(plain, 'pricedGlass'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, flares ${per(total(plain, 'pricedFlares'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, squeezes ${per(total(plain, 'pricedSqueezes'), total(plain, 'pricedTicks') / 3600).toFixed(2)}, costly gold ${per(total(plain, 'pricedGold'), total(plain, 'pricedTicks') / 3600).toFixed(2)})`);
}

export const ECON: Sim16Module = {
  name: 'econ',
  collector,
  report,
  modes: { decisions },
};
