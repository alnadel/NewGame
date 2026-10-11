// SHADY Audio Lab (dev only): `npx vite`, then open /audio-lab.html. Auditions every sound, the
// router's throttles and quantization, the adaptive score under any game state, a 30-second
// simulated day, the results melody, and an offline level check with waveform/spectrogram views.

import type { SimEvent } from '../core/sim/events.ts';
import { createAudio, createAudioView, SFX_NAMES } from './index.ts';
import type { AudioView, ScreenMode, SfxName, SfxParams, SimPhase } from './index.ts';
import { drawAnalysis, levelCases, measure, renderOffline } from './labTools.ts';
import type { Levels, Rendered } from './labTools.ts';

const audio = createAudio({ muted: false });
const view: AudioView = createAudioView();
let sfxVolume = 0.8;
let musicVolume = 0.6;
let musicOn = true;

// ---------------------------------------------------------------------------------------------
// Tiny DOM helpers.

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  return el('button', { type: 'button', className, onclick: onClick }, label);
}

function section(title: string, wide = false, ...children: Child[]): HTMLElement {
  return el('section', { className: wide ? 'wide' : '' }, el('h2', {}, title), ...children);
}

interface Slider {
  row: HTMLElement;
  set(v: number): void;
}

function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): Slider {
  const out = el('output', {}, fmt(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return {
    row: el('div', { className: 'row' }, el('label', {}, label), input, out),
    set(v: number) {
      input.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

function select<T extends string>(label: string, options: readonly T[], value: T, onChange: (v: T) => void): { row: HTMLElement; set(v: T): void } {
  const s = el('select', {}, ...options.map((o) => el('option', { value: o }, o)));
  s.value = value;
  s.setAttribute('aria-label', label);
  s.addEventListener('change', () => onChange(s.value as T));
  return {
    row: el('div', { className: 'row' }, el('label', {}, label), s, el('span')),
    set(v: T) {
      s.value = v;
    },
  };
}

const fixed = (d: number) => (v: number) => v.toFixed(d);

// ---------------------------------------------------------------------------------------------
// Header: status and live meter.

const status = el('span', { className: 'pill' }, 'locked: tap anything');
const meterFill = el('div', { className: 'fill' });
const meterHold = el('div', { className: 'hold' });
const meterLimit = el('div', { className: 'limit' });
const meterText = el('span', {}, '−∞ dBFS');
const header = el(
  'header',
  {},
  el('h1', {}, 'SHADY Audio Lab', el('small', {}, 'everything is synthesized live')),
  status,
  el('div', { className: 'meter' }, el('div', { className: 'bar' }, meterFill, meterHold, meterLimit), meterText),
);

/** Meter scale: −48..0 dBFS across the bar. */
function dbToPct(db: number): number {
  return Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
}
meterLimit.style.left = `${dbToPct(-6)}%`;

let holdDb = -Infinity;
let holdAt = 0;
const scope = new Float32Array(2048);

function updateMeter(now: number): void {
  const st = audio.status;
  status.textContent = st === 'running' ? (audio.muted ? 'running (muted)' : 'running') : `${st}: tap anything`;
  status.className = st === 'running' ? 'pill on' : st === 'unavailable' ? 'pill warn' : 'pill';
  const a = audio.meter();
  if (!a) return;
  a.getFloatTimeDomainData(scope);
  let peak = 0;
  for (const s of scope) peak = Math.max(peak, Math.abs(s));
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  if (db >= holdDb || now - holdAt > 3000) {
    holdDb = db;
    holdAt = now;
  }
  meterFill.style.width = `${dbToPct(db)}%`;
  meterFill.style.background = db > -6 ? 'var(--danger)' : db > -12 ? 'var(--gold)' : 'var(--teal)';
  meterHold.style.left = `${dbToPct(holdDb)}%`;
  meterText.textContent = `${Number.isFinite(holdDb) ? holdDb.toFixed(1) : '−∞'} dBFS peak`;
}

// ---------------------------------------------------------------------------------------------
// Mix controls.

const musicToggle = button('Music: on', () => {
  musicOn = !musicOn;
  musicToggle.textContent = musicOn ? 'Music: on' : 'Music: off';
  musicToggle.classList.toggle('active', !musicOn);
  applyVolumes();
});

function applyVolumes(): void {
  audio.setVolumes(sfxVolume, musicOn ? musicVolume : 0);
}

const muteBox = el('input', { type: 'checkbox' });
muteBox.addEventListener('change', () => audio.setMuted(muteBox.checked));

const mixSection = section(
  'Mix',
  false,
  slider('SFX', 0, 1, 0.01, sfxVolume, fixed(2), (v) => {
    sfxVolume = v;
    applyVolumes();
  }).row,
  slider('Music', 0, 1, 0.01, musicVolume, fixed(2), (v) => {
    musicVolume = v;
    applyVolumes();
  }).row,
  el('div', { className: 'buttons' }, musicToggle, el('label', { className: 'pill' }, muteBox, ' mute')),
  el('p', { className: 'note' }, 'Ambience follows the music volume. The meter shows the final output; the red tick is −6 dBFS.'),
);

// ---------------------------------------------------------------------------------------------
// Scene controls (the AudioView the game would send each frame).

const SCREENS: readonly ScreenMode[] = ['title', 'play', 'paused', 'dying', 'results', 'menu'];
const PHASES: readonly SimPhase[] = ['hold', 'day', 'night', 'dead'];
const screenSel = select('screen', SCREENS, view.screen, (v) => (view.screen = v));
const phaseSel = select('phase', PHASES, view.phase, (v) => (view.phase = v));
const daySlider = slider('day', 1, 12, 1, view.day, fixed(0), (v) => (view.day = v));
const uSlider = slider('day %', 0, 1, 0.01, 0, (v) => `${Math.round(v * 100)}%`, (v) => (view.tDay = v * view.dayLength));
const epsSlider = slider('ε', 0, 80, 0.5, view.eps, (v) => `${v.toFixed(0)}°`, (v) => (view.eps = v));
const epsNoonSlider = slider('ε noon', 40, 80, 1, view.epsNoon, (v) => `${v}°`, (v) => (view.epsNoon = v));
const fSlider = slider('f (lit)', 0, 2, 0.01, view.f, fixed(2), (v) => (view.f = v));
const glareSlider = slider('glare', 0, 1, 0.01, view.glareW, fixed(2), (v) => (view.glareW = v));
const chillSlider = slider('chill', 0, 100, 1, view.chill, fixed(0), (v) => (view.chill = v));
const multSlider = slider('mult', 1, 5, 1, view.mult, (v) => `×${v}`, (v) => (view.mult = v));
const omegaSlider = slider('ω', -600, 600, 10, view.omega, (v) => `${v}°/s`, (v) => (view.omega = v));

function playing(): void {
  view.screen = 'play';
  view.phase = 'day';
  screenSel.set('play');
  phaseSel.set('day');
}

const sceneSection = section(
  'Scene (AudioView)',
  false,
  screenSel.row,
  phaseSel.row,
  daySlider.row,
  uSlider.row,
  epsSlider.row,
  epsNoonSlider.row,
  fSlider.row,
  glareSlider.row,
  chillSlider.row,
  multSlider.row,
  omegaSlider.row,
  el('div', { className: 'buttons' }, button('Play · day', playing, 'primary')),
  el(
    'p',
    { className: 'note' },
    'Try: play/day with mult ×1→×5 (arpeggio density), chill below 40 (arpeggio drops) and 25 (heartbeat), f above 0 (sizzle), day % at 50 (cicadas), phase night (crickets), screen paused.',
  ),
);

// ---------------------------------------------------------------------------------------------
// Simulated day: daylight 24 s (dawn → noon → dusk) + 6 s night, then dawn of the next day.

const SIM_DAYLIGHT = 24;
const SIM_NIGHT = 6;
let simT = -1;
const simLabel = el('span', { className: 'sim' }, '');

function startSimDay(): void {
  playing();
  view.dayLength = SIM_DAYLIGHT;
  view.tDay = 0;
  simT = 0;
}

function clockLabel(t: number): string {
  const minutes = 360 + Math.floor((720 * t) / SIM_DAYLIGHT);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${m < 10 ? '0' : ''}${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Advances the simulated day and returns the events it crossed. */
function stepSim(dt: number): SimEvent[] {
  if (simT < 0) return [];
  const events: SimEvent[] = [];
  const prev = simT;
  simT += dt;
  const crossed = (at: number) => prev < at && simT >= at;
  if (crossed(SIM_DAYLIGHT / 2 - 2 * (SIM_DAYLIGHT / 50))) events.push({ e: 'noonBanner' });
  if (crossed(0.6 * SIM_DAYLIGHT)) events.push({ e: 'noonPassed' });
  if (crossed(SIM_DAYLIGHT)) {
    view.phase = 'night';
    phaseSel.set('night');
    events.push({ e: 'nightStart', day: view.day });
  }
  if (simT < SIM_DAYLIGHT) {
    view.tDay = simT;
    view.eps = 6 + (view.epsNoon - 6) * Math.sin((Math.PI * simT) / SIM_DAYLIGHT);
    epsSlider.set(Math.round(view.eps * 2) / 2);
    uSlider.set(simT / SIM_DAYLIGHT);
    simLabel.textContent = clockLabel(simT);
  } else if (simT < SIM_DAYLIGHT + SIM_NIGHT) {
    view.eps = 0;
    simLabel.textContent = 'night';
  } else {
    view.day += 1;
    view.phase = 'day';
    view.tDay = 0;
    view.eps = 6;
    daySlider.set(view.day);
    phaseSel.set('day');
    uSlider.set(0);
    epsSlider.set(6);
    events.push({ e: 'dawn', day: view.day });
    simLabel.textContent = `Day ${view.day} · 6:00 AM`;
    simT = -1;
  }
  return events;
}

const simSection = section(
  'Simulate a day',
  false,
  el('div', { className: 'buttons' }, button('Simulate a day (30 s)', startSimDay, 'primary'), button('Stop', () => (simT = -1))),
  el('p', { className: 'note' }, 'Sweeps ε dawn → noon → dusk over 24 s, then 6 s of night and a dawn key change. Sliders still work while it runs.'),
  el('p', {}, simLabel),
);

// ---------------------------------------------------------------------------------------------
// Sounds: one button per recipe, plus variants.

const SOUND_LABELS: Readonly<Record<SfxName, string>> = {
  detent: 'Detent click',
  catch: 'Catch thunk',
  ahh: 'Shade “ahh”',
  bell: 'Flake bell',
  crystal: 'Ice crystal',
  flower: 'Frost flower',
  melt: 'Flake melt “tss”',
  multUp: 'Multiplier up',
  multReset: 'Multiplier reset',
  phew: 'PHEW',
  glare: 'Glare zap',
  cloud: 'Cloud whoosh',
  death: 'Death sweep + plop',
  noon: 'NOON gong',
  noonPassed: 'Noon passed',
  nightfall: 'Nightfall',
  dayFanfare: 'Day fanfare',
  newBest: 'New best',
  heartbeat: 'Heartbeat',
  uiTap: 'UI tap',
  uiBuy: 'Buy / equip',
  uiError: 'Error',
};

function playSound(name: SfxName, params: SfxParams = {}): void {
  audio.play(name, { day: view.day, ...params });
}

const soundButtons = SFX_NAMES.map((name) => {
  const b = button(SOUND_LABELS[name], () => playSound(name));
  b.dataset['sound'] = name;
  return b;
});
const bellRow = Array.from({ length: 10 }, (_, d) => button(`bell ${d}`, () => playSound('bell', { degree: d })));
const multRow = [2, 3, 4, 5].map((level) => button(`×${level} up`, () => playSound('multUp', { level })));
const variantRow = [
  button('Heartbeat (strong)', () => playSound('heartbeat', { strong: true })),
  ...[0, 1, 2, 3, 4].map((i) => button(`detent ${i}`, () => playSound('detent', { index: i }))),
];

const soundsSection = section(
  'Sounds (direct)',
  true,
  el('div', { className: 'buttons' }, ...soundButtons),
  el('p', { className: 'note' }, 'Tonal cues play in the key of the scene’s day.'),
  el('div', { className: 'buttons' }, ...bellRow),
  el('div', { className: 'buttons spaced' }, ...multRow, ...variantRow),
);

// ---------------------------------------------------------------------------------------------
// Events through the router (throttles, quantization, thresholds, ducks).

function send(events: SimEvent[]): void {
  audio.onEvents(events, view);
}

/** Sends `count` events built by `make`, `everyMs` apart. */
function burst(count: number, everyMs: number, make: (i: number) => SimEvent): void {
  for (let i = 0; i < count; i++) setTimeout(() => send([make(i)]), i * everyMs);
}

const eventButtons: [string, () => void][] = [
  ['Fast spin: 40 detents in 1 s', () => burst(40, 25, (i) => ({ e: 'detent', dir: 1, index: i % 24 }))],
  ['Slow turn: 8 detents in 2 s', () => burst(8, 250, (i) => ({ e: 'detent', dir: 1, index: i % 24 }))],
  ['Flake run: 6 pickups (quantized)', () => burst(6, 70, (i) => ({ e: 'flake', mult: view.mult, degree: (i + view.mult) % 10, x: 0, y: 0, snow: 1 }))],
  ['Melt storm: 12 melts in 1 s', () => burst(12, 80, () => ({ e: 'flakeMelt', x: 0, y: 0 }))],
  ['Shade enter after 0.5 s lit', () => send([{ e: 'shadeEnter', litFor: 0.5 }])],
  ['Shade enter after 0.1 s (silent)', () => send([{ e: 'shadeEnter', litFor: 0.1 }])],
  ['Frost flowers ×5', () => burst(5, 400, () => ({ e: 'flower', x: 0, y: 0, snow: 2 }))],
  ['×2 → ×5 climb', () => burst(4, 900, (i) => ({ e: 'multUp', level: i + 2 }))],
  ['Reset from ×3', () => send([{ e: 'multReset', from: 3 }])],
  ['PHEW (+ slow-mo dip)', () => send([{ e: 'phew' }])],
  ['Dawn (fanfare, duck, key change)', () => {
    view.day += 1;
    daySlider.set(view.day);
    send([{ e: 'dawn', day: view.day }]);
  }],
  ['Catch', () => send([{ e: 'catch', omega: 300 }])],
  ['Cloud capture', () => send([{ e: 'cloudCapture', id: 1 }])],
  ['Glare touch', () => send([{ e: 'glareTouch', ballId: 1 }])],
];

const eventsSection = section(
  'Events (through the router)',
  true,
  el('div', { className: 'buttons' }, ...eventButtons.map(([label, fn]) => button(label, fn))),
  el('p', { className: 'note' }, 'Detents are limited to 20/s (≥ 50 ms apart), melts to 3/s and bells to 12/s; bells land on the next free 16th note.'),
);

// ---------------------------------------------------------------------------------------------
// Results melody.

const melodyLabel = el('span', { className: 'note' }, '');

function playMelody(degrees: number[]): void {
  view.screen = 'results';
  screenSel.set('results');
  const secs = audio.playMelody(degrees, view.day);
  melodyLabel.textContent = secs > 0 ? `${degrees.length} notes, ${secs.toFixed(1)} s` : 'unlock audio first';
}

const melodySection = section(
  'Results melody',
  false,
  el(
    'div',
    { className: 'buttons' },
    button('Random run (24 notes)', () => playMelody(Array.from({ length: 24 }, () => Math.floor(Math.random() * 10)))),
    button('Rising run', () => playMelody([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])),
    button('Stop', () => audio.stopMelody()),
  ),
  el('p', {}, melodyLabel),
);

// ---------------------------------------------------------------------------------------------
// Offline level check.

interface LevelResult extends Levels {
  name: string;
  oneShot: boolean;
}

const results: LevelResult[] = [];
const renders = new Map<string, Rendered>();
const tbody = el('tbody');
const canvas = el('canvas', { width: 1100, height: 300 });
const checkLabel = el('span', { className: 'note' }, '');

function cell(text: string, cls = ''): HTMLTableCellElement {
  return el('td', { className: cls }, text);
}

function db(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '−∞';
}

async function runLevelCheck(): Promise<LevelResult[]> {
  results.length = 0;
  renders.clear();
  tbody.replaceChildren();
  const cases = levelCases();
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as (typeof cases)[number];
    checkLabel.textContent = `rendering ${i + 1}/${cases.length}: ${c.name}`;
    const r = await renderOffline(c.seconds, c.build);
    const m = measure(r);
    renders.set(c.name, r);
    results.push({ name: c.name, oneShot: c.oneShot, ...m });
    // A one-shot is "cut" when its last 10 ms are within 40 dB of its peak.
    const cut = c.oneShot && m.tailDb > m.peakDb - 40;
    const row = el(
      'tr',
      {},
      cell(c.name),
      cell(db(m.peakDb), m.peakDb > -6 ? 'bad' : 'ok'),
      cell(db(m.rmsDb)),
      cell(db(m.preDb), m.preDb > -14 ? 'bad' : ''),
      cell(c.oneShot ? m.lengthS.toFixed(2) : '—'),
      cell(c.oneShot ? (cut ? `cut (${db(m.tailDb)})` : 'clean') : '—', cut ? 'bad' : c.oneShot ? 'ok' : ''),
    );
    row.addEventListener('click', () => drawAnalysis(canvas, r, c.name));
    tbody.append(row);
  }
  checkLabel.textContent = `${cases.length} renders. Click a row for its waveform and spectrogram.`;
  const mix = renders.get('mix · worst case');
  if (mix) drawAnalysis(canvas, mix, 'mix · worst case');
  return results;
}

const checkButton = button('Run level check', () => void runLevelCheck(), 'primary');
const levelsSection = section(
  'Level check (offline, through the real mix chain)',
  true,
  el('div', { className: 'buttons' }, checkButton, checkLabel),
  el(
    'table',
    {},
    el(
      'thead',
      {},
      el('tr', {}, ...['sound', 'peak dBFS', 'loudest 100 ms RMS', 'pre-comp peak', 'length s', 'ending'].map((h) => el('th', {}, h))),
    ),
    tbody,
  ),
  el(
    'p',
    { className: 'note' },
    'Targets: single cues peak around −16 to −9 dBFS, the worst-case pile-up stays near −6 dBFS, and every one-shot ends “clean” (no cut-off click). Pre-comp peaks above −14 dBFS mean the compressor is working.',
  ),
  canvas,
);

// ---------------------------------------------------------------------------------------------
// Assemble and run.

const root = document.getElementById('lab');
if (root) {
  const timeColumn = el('div', { className: 'stack' }, simSection, melodySection);
  root.append(header, el('div', { className: 'grid' }, mixSection, sceneSection, timeColumn, soundsSection, eventsSection, levelsSection));
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const events = stepSim(dt);
  if (events.length > 0) audio.onEvents(events, view);
  audio.update(view, dt);
  updateMeter(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Automation hook (Playwright): the lab's audio, view and level check. */
(window as unknown as { __AUDIO_LAB__: unknown }).__AUDIO_LAB__ = { audio, view, runLevelCheck, results };
