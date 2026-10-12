// UI lab (dev only, ui-lab.html): mounts every screen with fake data over a stand-in scene, with a
// working fake integrator, so screens can be reviewed in isolation. URL parameters make every state
// reachable for screenshots:
//   ?screen=title|play|pause|dying|results|settings|daily|missions|wardrobe|journal|rotate
//   &variant=…   (see VARIANTS)   &inset=47 (simulated top inset)   &rm=1 (reduced motion)
//   &bare=1 (hide the lab toolbar)   &toast=1 (demo toasts)   &sheet=install|confirm

import type { HourGlyph, RunResult } from '../core/sim/events.ts';
import { formatScore } from '../core/format.ts';
import type { Save } from '../meta/saveTypes.ts';
import { defaults, sanitizeSettings } from '../meta/save.ts';
import { equippedLooks, getCosmetic, type CosmeticId, type Equipped, type HatLook, type NoseLook, type ScarfLook } from '../meta/content.ts';
import { addDays, localDate } from '../meta/daily.ts';
import { applyRunResult, buyCosmetic, equipCosmetic, resetProgress, swapMission } from '../meta/progression.ts';
import { backupErrorMessage, exportBackup, importBackup } from '../meta/backup.ts';
import { buildShare, shareBase } from '../meta/share.ts';
import { mondayOf } from '../meta/week.ts';
// V11-SHIM: CC-4/CC-7 — RunResultV11 becomes core's RunResult at integration.
import type { DayPlan, RunResultV11 } from '../meta/shims.ts';
import { shareText } from '../platform/share.ts';
import { cosmeticSwatch } from './swatches.ts';
import { simulateSafeArea } from '../platform/safeArea.ts';
import { createUi } from './ui.ts';
import type { ResultsView, ScreenId, Ui, UiCallbacks } from './types.ts';

type LabScreen = Exclude<ScreenId, 'boot'> | 'rotate';

const VARIANTS: Record<LabScreen, readonly string[]> = {
  title: ['regular', 'fresh', 'challenge', 'warmup', 'locked'],
  play: ['regular', 'muted', 'hint', 'cue', 'kbd'],
  pause: ['regular'],
  dying: ['regular'],
  results: ['best', 'first', 'daily', 'challenge', 'warmup', 'long', 'quiet'],
  settings: ['regular', 'from-pause'],
  daily: ['regular', 'used'],
  missions: ['regular', 'fresh'],
  wardrobe: ['regular', 'hats', 'shades', 'poor'],
  journal: ['regular', 'empty'],
  rotate: ['regular'],
};
/** A Title run's Day 1 in the lab. */
const PREVIEW: DayPlan = { biome: 'oldtown', forecast: 'breezy' };

const params = new URLSearchParams(location.search);
// ?today=YYYY-MM-DD pins the lab's date (e.g. a Sunday, to show a full Sunny Week).
const today = params.get('today') ?? localDate();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;
const bar = document.getElementById('lab-bar') as HTMLElement;

// ---------------------------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------------------------

function richSave(): Save {
  const s = defaults(Date.now() - 40 * 86_400_000);
  s.stats = { ...s.stats, runs: 34, bestMinutes: 1960, bestSnowRun: 96, lifetimeSnow: 1910, wallet: 230, phews: 39,
    flakes: 802, daysSurvived: 19, maxDay: 3, dailyDaysPlayed: 5, cloudSeconds: 164, reachedNight: true, comfort: 4,
    playSeconds: 3 * 3600 + 720, swings: 61, sunnyWeeks: 1, forecastNoons: 0b11010 };
  s.unlocks.cosmetics = ['scarf-red', 'scarf-mint', 'hat-none', 'hat-beanie', 'hat-visor', 'nose-carrot', 'nose-parsnip', 'shades-classic', 'shades-round'];
  s.unlocks.achievements = ['first-light', 'night-owl', 'high-noon', 'sundancer'];
  s.unlocks.cosmetics.push('shades-star');
  s.equipped = { scarf: 'scarf-mint', hat: 'hat-beanie', nose: 'nose-carrot', shades: 'shades-round' };
  s.missions = {
    cursor: 7,
    tier: 1,
    active: [
      { id: 'reach-day-2', progress: 1240, done: true, stale: 0 },
      { id: 'two-phews', progress: 1, done: false, stale: 6 },
      { id: 'cloud-ride', progress: 1.8, done: false, stale: 1 },
    ],
    deferred: ['gate-arch'],
    errand: { date: today, id: 'e-flakes-25', progress: 14, done: false },
  };
  // 30 endless runs: a climb through the comfort ladder, then standard rules.
  s.history = Array.from({ length: 30 }, (_, i) => ({
    m: Math.round(160 + i * 28 + ((i * 7919) % 11) * 70 - (i % 4 === 3 ? 260 : 0)),
    s: 20 + i,
    r: i < 4 ? i : 4,
    d: addDays(today, i - 30),
  }));
  s.week = { start: mondayOf(today), days: 0, paid: 0, best: [0, 0, 0, 0, 0, 0, 0] };
  for (let i = 0; i < 7 && addDays(s.week.start, i) < today; i++) {
    if (i === 2) continue;
    s.week.days |= 1 << i;
    s.week.best[i] = [2, 5, 0, 1, 3, 2, 1][i] as number;
  }
  s.lastPlay = addDays(today, -1);
  s.pars[today] = 455;
  const strip = '❄️❄️❄️🟨❄️❄️🔥🟨❄️❄️❄️❄️🌙\n❄️❄️🟨🟨🔥🔥🟨💧';
  s.daily[addDays(today, -1)] = { tries: 3, bestMinutes: 1240, bestSnow: 61, glyphs: strip };
  s.daily[addDays(today, -2)] = { tries: 2, bestMinutes: 455, bestSnow: 22, glyphs: '❄️❄️🟨🟨🔥🔥🟨💧' };
  s.daily[addDays(today, -4)] = { tries: 1, bestMinutes: 830, bestSnow: 40, glyphs: strip };
  s.daily[addDays(today, -5)] = { tries: 3, bestMinutes: 1505, bestSnow: 70, glyphs: strip };
  s.daily[addDays(today, -8)] = { tries: 1, bestMinutes: 12, bestSnow: 0, glyphs: '💧' };
  return s;
}

type Stats = RunResultV11['stats'];

function stats(over: Partial<Stats>): Stats {
  return {
    flakes: 0, flakesMelted: 0, crystals: 0, flowers: 0, phews: 0, snow: 0, maxMult: 1, x5HoldBest: 0, cloudRideBest: 0,
    cloudSeconds: 0, ballsPassedClean: 0, ballGlared: false, gateNoon: false, dayReached: 1, nightsReached: 0, minutes: 0,
    litTotal: 0, swings: 0, swingChainBest: 0, phewMinChill: 100, ...over,
  };
}

const LAB_PLAN: readonly DayPlan[] = [
  { biome: 'oldtown', forecast: 'breezy' },
  { biome: 'meadow', forecast: 'clear' },
  { biome: 'oldtown', forecast: 'heat' },
  { biome: 'meadow', forecast: 'long' },
  { biome: 'oldtown', forecast: 'clear' },
  { biome: 'meadow', forecast: 'dazzle' },
];

function fakeRun(minutes: number, over: Partial<Stats>, extra: Partial<RunResultV11>, line: string): RunResultV11 {
  const day = Math.floor(minutes / 720) + 1;
  const pattern: HourGlyph[] = ['cool', 'cool', 'warm', 'cool', 'hot', 'warm', 'cool', 'cool', 'warm', 'cool', 'cool', 'cool'];
  const glyphs: HourGlyph[][] = [];
  for (let d = 1; d < day; d++) glyphs.push([...pattern]);
  glyphs.push([...pattern.slice(0, Math.floor((minutes % 720) / 60)), 'melt']);
  return {
    mode: 'endless', seed: 20261011, profile: 3, drain: 55, noonCloud: 0, plan: LAB_PLAN.slice(0, day), minutes, day,
    clock: formatScore(minutes),
    stats: stats({ minutes, dayReached: day, nightsReached: day - 1, ...over }),
    death: { day, tDay: 0, minutes, time: '', x: 0, y: 0, cause: 'gap', line },
    hourGlyphs: glyphs, melody: [], assisted: false, ...extra,
  };
}

function resultsView(variant: string, save: Save): { view: ResultsView; save: Save } {
  const base = variant === 'first' ? defaults() : save;
  let run: RunResult;
  let dailyTry: number | null | undefined;
  let challengeTarget: number | undefined;
  let tip: string | undefined;
  let warmupFor: ResultsView['warmupFor'];
  let rung: number | undefined;
  switch (variant) {
    case 'first':
      run = fakeRun(204, { flakes: 9, flakesMelted: 2, snow: 11, maxMult: 2 }, { profile: 0 }, 'Melted by You at 9:24 AM, just past the Sleepy Hut.');
      tip = 'Tip: drag before the shade runs out. Thick teal lasts.';
      rung = 0;
      break;
    case 'warmup':
      run = fakeRun(204, { flakes: 9, snow: 11, maxMult: 2 }, { profile: 0 }, 'Melted by You at 9:24 AM, just past the Sleepy Hut.');
      warmupFor = { minutes: 1240, name: 'Sam' };
      rung = 0;
      break;
    case 'long':
      run = fakeRun(4100, { flakes: 88, snow: 190, phews: 6, maxMult: 5, x5HoldBest: 12.4, swings: 9, swingChainBest: 4 }, {},
        'Melted by You at 1:20 PM. The noon sun found a gap.');
      tip = 'Tip: at noon the shadows shrink. Stay close to tall things.';
      break;
    case 'daily':
      run = fakeRun(1335, { flakes: 31, flakesMelted: 4, snow: 58, phews: 1, maxMult: 4, x5HoldBest: 0 }, { mode: 'daily', dailyDate: today },
        'Glared by the Fancy Gazing Ball at 4:15 PM.');
      dailyTry = 2;
      break;
    case 'challenge':
      run = fakeRun(1312, { flakes: 26, snow: 47, phews: 2, maxMult: 5, x5HoldBest: 6.4, swings: 3, swingChainBest: 2 }, { mode: 'challenge' },
        'Melted by You at 3:52 PM. That cloud was right there.');
      challengeTarget = 1240;
      break;
    case 'quiet':
      run = fakeRun(95, { flakes: 3, flakesMelted: 3, snow: 3 }, {}, 'Melted by You at 7:35 AM.');
      break;
    default:
      run = fakeRun(2095, { flakes: 48, flakesMelted: 6, snow: 112, phews: 3, maxMult: 5, x5HoldBest: 9.2, cloudRideBest: 4.1, swings: 5, swingChainBest: 3 }, {},
        'Melted by You at 10:55 AM, between the Mossy Oak and the Little Hut.');
      tip = 'Tip: a SWING hands Nubs to the next shadow before the old one ends.';
  }
  const r = applyRunResult(base, run, { today, dailyTry, challengeTarget, rung, playSeconds: 140 });
  const view: ResultsView = { result: run, outcome: r.outcome, dailyTry, challengeTarget, tip, warmupFor };
  if (challengeTarget !== undefined) view.challengeName = 'Sam';
  return { view, save: r.save };
}

// ---------------------------------------------------------------------------------------------
// Stand-in scene (the real one is the game renderer)
// ---------------------------------------------------------------------------------------------

function drawScene(ui: Ui | null, screen: LabScreen): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = w / 360;
  const sky = g.createLinearGradient(0, 0, 0, hgt);
  sky.addColorStop(0, '#F3C48F');
  sky.addColorStop(1, '#F6B07C');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hgt);

  // Grass tufts.
  g.strokeStyle = 'rgba(43,33,64,0.08)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 140; i++) {
    const x = ((i * 97) % 360) * k;
    const y = ((i * 211) % 1000) / 1000 * hgt;
    g.beginPath();
    g.moveTo(x - 3, y - 4);
    g.lineTo(x, y);
    g.lineTo(x + 3, y - 4);
    g.stroke();
  }

  const trailX = (y: number): number => w / 2 + Math.sin(y / hgt * 3.2) * 40 * k;
  g.lineCap = 'round';
  for (const [width, color] of [[34, '#D9875E'], [30, '#E39468']] as const) {
    g.strokeStyle = color;
    g.lineWidth = width * k;
    g.beginPath();
    for (let y = -20; y <= hgt + 20; y += 8) {
      if (y === -20) g.moveTo(trailX(y), y);
      else g.lineTo(trailX(y), y);
    }
    g.stroke();
  }

  const nubsY = hgt * 0.68;
  const nubsX = trailX(nubsY);
  // Long dawn shadows falling west (left) from casters east of the trail.
  g.fillStyle = 'rgba(91,74,138,0.42)';
  const shadow = (x: number, y: number, half: number, len: number): void => {
    g.beginPath();
    g.moveTo(x, y - half);
    g.lineTo(x - len, y - half - 8 * k);
    g.lineTo(x - len, y + half - 8 * k);
    g.lineTo(x, y + half);
    g.fill();
  };
  shadow(nubsX + 48 * k, nubsY - 6 * k, 16 * k, 150 * k);
  shadow(w * 0.8, hgt * 0.32, 18 * k, 190 * k);
  shadow(w * 0.88, hgt * 0.86, 14 * k, 160 * k);

  // Hut
  const hut = (x: number, y: number, s: number): void => {
    g.fillStyle = '#9C6B41';
    g.fillRect(x - 16 * s, y - 10 * s, 32 * s, 22 * s);
    g.fillStyle = '#C08A5B';
    g.fillRect(x - 16 * s, y - 22 * s, 32 * s, 16 * s);
    g.fillStyle = '#8E6B4E';
    g.beginPath();
    g.moveTo(x - 20 * s, y - 20 * s);
    g.lineTo(x, y - 34 * s);
    g.lineTo(x + 20 * s, y - 20 * s);
    g.fill();
  };
  hut(nubsX + 56 * k, nubsY, k);
  hut(w * 0.86, hgt * 0.88, k * 0.9);
  // Tree
  g.fillStyle = '#4E9A63';
  g.beginPath();
  g.arc(w * 0.82, hgt * 0.3, 24 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6DBE7B';
  g.beginPath();
  g.arc(w * 0.82 + 5 * k, hgt * 0.3 - 5 * k, 18 * k, 0, Math.PI * 2);
  g.fill();

  // Nubs
  g.fillStyle = 'rgba(207,230,255,0.9)';
  g.beginPath();
  g.ellipse(nubsX, nubsY + 2 * k, 10 * k, 4 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(nubsX, nubsY - 6 * k, 11 * k, 0, Math.PI * 2);
  g.arc(nubsX, nubsY - 20 * k, 7.5 * k, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6FD8BE';
  g.fillRect(nubsX - 8 * k, nubsY - 15 * k, 16 * k, 3.5 * k);
  g.fillStyle = '#FF8A2B';
  g.beginPath();
  g.moveTo(nubsX, nubsY - 22 * k);
  g.lineTo(nubsX + 2 * k, nubsY - 30 * k);
  g.lineTo(nubsX + 4 * k, nubsY - 22 * k);
  g.fill();

  if (screen === 'results' && ui) {
    // Melt Map stand-in framed above the sheet.
    const top = ui.resultsSheetTop() ?? hgt * 0.42;
    g.fillStyle = 'rgba(52,48,107,0.28)';
    g.fillRect(0, 0, w, top);
    g.lineWidth = 3;
    const colors = ['#5AB8FF', '#5AB8FF', '#FFC23D', '#FF5D5D'];
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      g.fillStyle = colors[Math.min(3, Math.floor(t * 4))] as string;
      g.beginPath();
      g.arc(w * 0.5 + Math.sin(t * 5) * 50 * k, top - 30 - t * (top - 90), 3.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#CFE6FF';
    g.beginPath();
    g.ellipse(w * 0.5 + Math.sin(5) * 50 * k, 60, 16, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Wardrobe preview placeholder (the integrator injects the real Nubs renderer)
// ---------------------------------------------------------------------------------------------

function drawScarf(g: CanvasRenderingContext2D, l: ScarfLook, cx: number, y: number): void {
  const band = (color: string, x: number, wdt: number): void => {
    g.fillStyle = color;
    g.fillRect(x, y, wdt, 12);
  };
  if (l.pattern === 'rainbow') {
    l.stripes.forEach((c, i) => band(c, cx - 36 + (72 / l.stripes.length) * i, 72 / l.stripes.length + 0.5));
  } else {
    band(l.main, cx - 36, 72);
  }
  g.fillStyle = l.pattern === 'rainbow' ? (l.stripes[3] ?? l.main) : l.main;
  g.fillRect(cx + 12, y + 8, 13, 34);
  g.fillStyle = l.shine ?? l.stripes[0] ?? l.shade;
  if (l.pattern === 'stripes' || l.pattern === 'plaid' || l.pattern === 'metallic') {
    for (let i = 0; i < 4; i++) g.fillRect(cx + 12, y + 14 + i * 7, 13, 2.5);
  }
}

function drawHat(g: CanvasRenderingContext2D, l: HatLook, cx: number, top: number): void {
  g.fillStyle = l.main;
  switch (l.shape) {
    case 'beanie':
      g.beginPath();
      g.arc(cx, top + 8, 30, Math.PI, 0);
      g.fill();
      g.fillStyle = l.shade;
      g.fillRect(cx - 31, top + 2, 62, 11);
      g.fillStyle = l.accent;
      g.beginPath();
      g.arc(cx, top - 24, 8, 0, Math.PI * 2);
      g.fill();
      break;
    case 'topHat':
      g.fillRect(cx - 22, top - 36, 44, 40);
      g.fillStyle = l.accent;
      g.fillRect(cx - 22, top - 8, 44, 8);
      g.fillStyle = l.shade;
      g.fillRect(cx - 34, top + 2, 68, 7);
      break;
    case 'partyCone':
      g.beginPath();
      g.moveTo(cx - 22, top + 6);
      g.lineTo(cx + 4, top - 50);
      g.lineTo(cx + 24, top + 6);
      g.fill();
      g.fillStyle = l.accent;
      g.beginPath();
      g.arc(cx + 4, top - 50, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'sunVisor':
      g.fillStyle = l.accent;
      g.fillRect(cx - 30, top + 2, 60, 8);
      g.fillStyle = l.main;
      g.beginPath();
      g.ellipse(cx + 26, top + 8, 28, 7, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'crown':
      g.beginPath();
      g.moveTo(cx - 26, top + 8);
      g.lineTo(cx - 26, top - 22);
      g.lineTo(cx - 13, top - 8);
      g.lineTo(cx, top - 28);
      g.lineTo(cx + 13, top - 8);
      g.lineTo(cx + 26, top - 22);
      g.lineTo(cx + 26, top + 8);
      g.fill();
      g.fillStyle = l.accent;
      g.beginPath();
      g.arc(cx, top - 2, 4, 0, Math.PI * 2);
      g.fill();
      break;
    case 'none':
      break;
  }
}

function drawNose(g: CanvasRenderingContext2D, l: NoseLook, cx: number, cy: number): void {
  g.fillStyle = l.main;
  const len = 34 * l.length;
  if (l.shape === 'pinecone') {
    g.beginPath();
    g.ellipse(cx + 16, cy, 14, 9, 0, 0, Math.PI * 2);
    g.fill();
    return;
  }
  if (l.shape === 'candyCane') {
    g.strokeStyle = l.accent;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + 22, cy);
    g.arc(cx + 22, cy - 8, 8, Math.PI / 2, -Math.PI / 2, true);
    g.stroke();
    return;
  }
  g.beginPath();
  g.moveTo(cx, cy - 6);
  g.lineTo(cx + len, cy + 1);
  g.lineTo(cx, cy + 7);
  g.fill();
}

function placeholderPreview(target: HTMLCanvasElement, equipped: Equipped, subject: 'nubs' | 'sun'): void {
  const g = target.getContext('2d');
  if (!g) return;
  const s = target.width / 168;
  g.setTransform(s, 0, 0, s, 0, 0);
  g.clearRect(0, 0, 168, 168);
  if (subject === 'sun') {
    // The sun in its shades: the tile art, scaled up.
    const c = getCosmetic(equipped.shades);
    if (!c) return;
    const img = new Image();
    img.onload = () => g.drawImage(img, 4, 4, 160, 160);
    img.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(cosmeticSwatch(c)))}`;
    return;
  }
  const looks = equippedLooks(equipped);
  const cx = 84;
  g.fillStyle = '#fff';
  g.strokeStyle = '#C9D8F0';
  g.lineWidth = 2;
  for (const [y, r] of [[118, 40], [64, 28]] as const) {
    g.beginPath();
    g.arc(cx, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#2B2B33';
  for (const x of [cx - 10, cx + 10]) {
    g.beginPath();
    g.arc(x, 58, 3.4, 0, Math.PI * 2);
    g.fill();
  }
  drawNose(g, looks.nose, cx + 2, 68);
  drawScarf(g, looks.scarf, cx, 86);
  drawHat(g, looks.hat, cx, 40);
}

/** A stand-in postcard: paper, a map panel and a score line (the game draws the real one). */
function postcardThumb(): string {
  const c = document.createElement('canvas');
  c.width = 216;
  c.height = 270;
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#FFF8EE';
  g.fillRect(0, 0, 216, 270);
  g.fillStyle = '#F2B47C';
  g.fillRect(8, 8, 200, 164);
  g.fillStyle = '#5B4A8A';
  g.globalAlpha = 0.4;
  g.fillRect(20, 40, 120, 18);
  g.fillRect(70, 110, 130, 16);
  g.globalAlpha = 1;
  g.fillStyle = '#2B2140';
  g.font = '900 30px system-ui';
  g.fillText('2:40 PM', 16, 220);
  g.fillStyle = '#2EC4B6';
  for (let i = 0; i < 8; i++) g.fillRect(16 + i * 24, 236, 20, 20);
  return c.toDataURL();
}

// ---------------------------------------------------------------------------------------------
// Lab wiring
// ---------------------------------------------------------------------------------------------

let ui: Ui | null = null;

function mount(screen: LabScreen, variant: string): void {
  ui?.destroy();
  simulateSafeArea(params.has('inset') ? { top: Number(params.get('inset')) } : null);

  let save = variant === 'fresh' || variant === 'empty' ? defaults() : richSave();
  if (screen === 'title' && variant === 'locked') save.stats = { ...save.stats, runs: 2, reachedNight: false, bestMinutes: 410 };
  if (screen === 'title' && variant === 'warmup') save = defaults();
  if (screen === 'daily' && variant === 'used') save.daily[today] = { tries: 3, bestMinutes: 1290, bestSnow: 52, glyphs: '❄️❄️🟨💧' };
  if (screen === 'wardrobe' && variant === 'poor') save.stats.wallet = 40;
  if (params.get('rm') === '1') save.settings.reducedMotion = 'on';

  const log = (...args: unknown[]): void => console.info('[lab]', ...args);
  let lastResults: ResultsView | null = null;
  const callbacks: UiCallbacks = {
    startRun: (kind, date) => log('startRun', kind, date ?? ''),
    retry: () => log('retry'),
    home: () => log('home'),
    pause: () => log('pause'),
    resume: () => log('resume'),
    restart: () => log('restart'),
    skipDying: () => {
      log('skipDying');
      const r = resultsView('best', save);
      lastResults = r.view;
      ui?.show('results', r.view);
    },
    share: async () => {
      const run = lastResults?.result;
      return run ? shareText({ text: buildShare(run, shareBase(), null, { name: save.settings.name }).text }) : 'failed';
    },
    sharePostcard: async () => {
      log('sharePostcard');
      return 'saved';
    },
    swapMission: (slotId) => {
      save = swapMission(save, slotId);
      ui?.setSave(save);
    },
    settingsChanged: (settings) => {
      save = { ...save, settings: sanitizeSettings(settings) };
      log('settings', settings);
    },
    buy: (id: CosmeticId) => {
      const r = buyCosmetic(save, id);
      if (r.ok) {
        save = r.save;
        ui?.setSave(save);
      }
      return r.ok;
    },
    equip: (id: CosmeticId) => {
      const r = equipCosmetic(save, id);
      if (r.ok) {
        save = r.save;
        ui?.setSave(save);
      }
    },
    exportBackup: () => exportBackup(save),
    importBackup: (code) => {
      const r = importBackup(code);
      if (!r.ok) return { ok: false, message: backupErrorMessage(r.error) };
      save = r.save;
      ui?.setSave(save);
      return { ok: true };
    },
    resetProgress: () => {
      save = resetProgress(save);
      ui?.setSave(save);
      return { ok: true };
    },
    dismissChallenge: () => log('dismissChallenge'),
    dragHandoff: (e) => {
      log('dragHandoff', e.pointerId);
      ui?.show('play');
    },
    uiSound: (name) => log('sound', name),
    renderWardrobePreview: placeholderPreview,
  };

  ui = createUi(root, { callbacks, save, today, version: '0.1.0 (lab)' });
  if (screen === 'title' && variant === 'challenge') ui.setChallenge({ minutes: 1240, name: 'Sam' });
  if (screen === 'title' && variant === 'warmup') ui.setChallenge({ minutes: 1240, name: '', warmup: true });
  if (screen === 'title' && variant !== 'fresh' && variant !== 'warmup') ui.setRunPreview(PREVIEW);

  const path: ScreenId[] = {
    title: ['title'],
    play: ['title', 'play'],
    pause: ['title', 'play', 'pause'],
    dying: ['title', 'play', 'dying'],
    results: ['title', 'play', 'dying'],
    settings: variant === 'from-pause' ? ['title', 'play', 'pause', 'settings'] : ['title', 'settings'],
    daily: ['title', 'daily'],
    missions: ['title', 'missions'],
    wardrobe: ['title', 'wardrobe'],
    journal: ['title', 'journal'],
    rotate: ['title', 'play'],
  }[screen] as ScreenId[];
  for (const id of path) ui.show(id);
  if (screen === 'results') {
    const r = resultsView(variant, save);
    lastResults = r.view;
    save = r.save;
    ui.setSave(save);
    ui.show('results', r.view);
    // The postcard arrives a moment after the sheet (built in idle time by the game).
    const shown = ui;
    if (variant !== 'quiet') setTimeout(() => shown.setPostcard(postcardThumb()), 900);
  }
  if (screen === 'wardrobe' && variant === 'hats') (document.getElementById('tab-hat') as HTMLButtonElement | null)?.click();
  if (screen === 'wardrobe' && variant === 'shades') (document.getElementById('tab-shades') as HTMLButtonElement | null)?.click();
  if (screen === 'play' && variant === 'cue') ui.showCue('drag', -1);
  if (screen === 'play' && variant === 'kbd') {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    ui.setGhostThumb('left');
    ui.showCue('drag', -1);
  }
  if (screen === 'title') ui.setGhostThumb('both');
  if (screen === 'play' && variant === 'hint') ui.setGhostThumb('right');
  if (screen === 'play' && variant === 'muted') ui.setAudioMuted(true);
  if (params.get('toast') === '1') {
    ui.toast('Achievement: Night Owl', { icon: 'trophy', tone: 'gold', duration: 60_000 });
    ui.toast('Unlocked: Sun Visor', { icon: 'gift', tone: 'accent', duration: 60_000 });
    ui.notifyStorageDegraded();
  }
  if (params.get('sheet') === 'install') ui.showInstallSheet();
  if (params.get('sheet') === 'confirm') {
    (document.querySelector('.scr-settings .btn--danger') as HTMLButtonElement | null)?.click();
  }

  const current = ui;
  requestAnimationFrame(() => requestAnimationFrame(() => drawScene(current, screen)));
}

function navigate(screen: LabScreen, variant: string): void {
  params.set('screen', screen);
  params.set('variant', variant);
  history.replaceState(null, '', `?${params.toString()}`);
  mount(screen, variant);
  buildBar();
}

function toggleParam(name: string, value: string): void {
  if (params.get(name) === value) params.delete(name);
  else params.set(name, value);
  navigate(currentScreen(), currentVariant());
}

function currentScreen(): LabScreen {
  const s = params.get('screen') as LabScreen | null;
  return s && s in VARIANTS ? s : 'title';
}

function currentVariant(): string {
  const v = params.get('variant');
  return v && VARIANTS[currentScreen()].includes(v) ? v : (VARIANTS[currentScreen()][0] as string);
}

function buildBar(): void {
  if (params.get('bare') === '1') {
    bar.hidden = true;
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'lab-panel';
  panel.hidden = sessionStorage.getItem('lab-open') !== '1';
  const add = (label: string, on: boolean, fn: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.classList.toggle('is-on', on);
    b.addEventListener('click', fn);
    panel.append(b);
  };
  for (const [screen, variants] of Object.entries(VARIANTS) as [LabScreen, readonly string[]][]) {
    for (const v of variants) {
      add(v === 'regular' ? screen : `${screen}:${v}`, screen === currentScreen() && v === currentVariant(), () => navigate(screen, v));
    }
  }
  panel.append(Object.assign(document.createElement('span'), { className: 'lab-sep' }));
  add('inset 47', params.get('inset') === '47', () => toggleParam('inset', '47'));
  add('reduced motion', params.get('rm') === '1', () => toggleParam('rm', '1'));
  add('toasts', params.get('toast') === '1', () => toggleParam('toast', '1'));
  add('install sheet', params.get('sheet') === 'install', () => toggleParam('sheet', 'install'));
  const toggle = document.createElement('button');
  toggle.className = 'lab-toggle';
  toggle.type = 'button';
  toggle.textContent = `Lab: ${currentScreen()}:${currentVariant()}`;
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    sessionStorage.setItem('lab-open', panel.hidden ? '0' : '1');
  });
  bar.replaceChildren(panel, toggle);
}

window.addEventListener('resize', () => drawScene(ui, currentScreen()));
mount(currentScreen(), currentVariant());
buildBar();
