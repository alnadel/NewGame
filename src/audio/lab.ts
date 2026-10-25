// SHADY Audio Lab (dev only): `npx vite`, then open /audio-lab.html. Auditions every sound, the
// router's throttles, quantization and ducks, the adaptive score under any game state (chapter
// palettes and campaign concepts included), the results melody, and an offline level check with
// waveform/spectrogram views.

import type { SimEvent } from '../core/sim/events.ts';
import { createAudio, createAudioView, SFX_NAMES } from './index.ts';
import type { AudioView, ScreenMode, SfxName, SfxParams, SimPhase } from './index.ts';
import { drawAnalysis, levelCases, measure, renderOffline } from './labTools.ts';
import type { Levels, Rendered } from './labTools.ts';

const audio = createAudio({ muted: false });
const view: AudioView = createAudioView();
const volumes = { sfx: 0.8, music: 0.6 };

// ---------------------------------------------------------------------------------------------
// Tiny DOM helpers.

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const button = (label: string, onClick: () => void, className = ''): HTMLButtonElement => el('button', { type: 'button', className, onclick: onClick }, label);
const section = (title: string, wide: boolean, ...children: Child[]): HTMLElement => el('section', { className: wide ? 'wide' : '' }, el('h2', {}, title), ...children);
const buttons = (...b: HTMLButtonElement[]): HTMLElement => el('div', { className: 'buttons' }, ...b);
const note = (text: string): HTMLElement => el('p', { className: 'note' }, text);

/** A labelled range input; `onInput` gets the number. */
function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLElement {
  const out = el('output', {}, String(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  return el('div', { className: 'row' }, el('label', {}, label), input, out);
}

function select<T extends string>(label: string, options: readonly T[], value: T, onChange: (v: T) => void): HTMLElement {
  const s = el('select', {}, ...options.map((o) => el('option', { value: o }, o)));
  s.value = value;
  s.setAttribute('aria-label', label);
  s.addEventListener('change', () => onChange(s.value as T));
  return el('div', { className: 'row' }, el('label', {}, label), s, el('span'));
}

/** A checkbox pill toggling a boolean. */
function toggle(label: string, onChange: (on: boolean) => void): HTMLElement {
  const box = el('input', { type: 'checkbox' });
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { className: 'pill' }, box, ` ${label}`);
}

// ---------------------------------------------------------------------------------------------
// Header: status and a live peak meter (−48..0 dBFS; the red tick is −6).

const status = el('span', { className: 'pill' }, 'locked: tap anything');
const meterFill = el('div', { className: 'fill' });
const meterText = el('span', {}, '−∞ dBFS');
const meterLimit = el('div', { className: 'limit' });
meterLimit.style.left = `${(42 / 48) * 100}%`;
const header = el(
  'header',
  {},
  el('h1', {}, 'SHADY Audio Lab', el('small', {}, 'everything is synthesized live')),
  status,
  el('div', { className: 'meter' }, el('div', { className: 'bar' }, meterFill, meterLimit), meterText),
);
const scope = new Float32Array(2048);

function updateMeter(): void {
  const st = audio.status;
  status.textContent = st === 'running' ? (audio.muted ? 'running (muted)' : 'running') : `${st}: tap anything`;
  status.className = st === 'running' ? 'pill on' : st === 'unavailable' ? 'pill warn' : 'pill';
  const a = audio.meter();
  if (!a) return;
  a.getFloatTimeDomainData(scope);
  const db = 20 * Math.log10(scope.reduce((m, s) => Math.max(m, Math.abs(s)), 1e-9));
  meterFill.style.width = `${Math.max(0, Math.min(100, ((db + 48) / 48) * 100))}%`;
  meterFill.style.background = db > -6 ? 'var(--danger)' : db > -12 ? 'var(--gold)' : 'var(--teal)';
  meterText.textContent = `${db.toFixed(1)} dBFS`;
}

// ---------------------------------------------------------------------------------------------
// Mix and scene (the AudioView the game would send each frame).

const applyVolumes = (): void => audio.setVolumes(volumes.sfx, volumes.music);
const SCREENS: readonly ScreenMode[] = ['title', 'play', 'paused', 'dying', 'results', 'menu'];
const PHASES: readonly SimPhase[] = ['hold', 'day', 'night', 'dead', 'won'];
const set = <K extends keyof AudioView>(k: K) => (v: AudioView[K]): void => {
  view[k] = v;
};

const mixSection = section(
  'Mix',
  false,
  slider('SFX', 0, 1, 0.01, volumes.sfx, (v) => ((volumes.sfx = v), applyVolumes())),
  slider('Music', 0, 1, 0.01, volumes.music, (v) => ((volumes.music = v), applyVolumes())),
  el('div', { className: 'buttons' }, toggle('mute', (m) => audio.setMuted(m))),
  note('Ambience follows the music volume.'),
);

const sceneSection = section(
  'Scene (AudioView)',
  false,
  select('screen', SCREENS, view.screen, set('screen')),
  select('phase', PHASES, view.phase, set('phase')),
  slider('day', 1, 12, 1, view.day, set('day')),
  slider('day %', 0, 100, 1, 0, (v) => (view.tDay = (v / 100) * view.dayLength)),
  slider('ε', 0, 80, 0.5, view.eps, set('eps')),
  slider('f (lit)', 0, 2, 0.01, view.f, set('f')),
  slider('glare', 0, 1, 0.01, view.glareW, set('glareW')),
  slider('chill', 0, 100, 1, view.chill, set('chill')),
  slider('mult', 1, 5, 1, view.mult, set('mult')),
  slider('ω °/s', -600, 600, 10, view.omega, set('omega')),
  slider('chapter', 0, 20, 1, 0, set('chapter')),
  slider('progress', -1, 1, 0.01, -1, set('progress')),
  slider('eclipse', 0, 1, 0.01, 0, set('eclipse')),
  el('div', { className: 'buttons' }, toggle('locked', set('locked')), toggle('moonlit', set('moonlit')), toggle('fog', set('fog'))),
  note('Try: play/day with mult ×1→×5, chill below 40 (arpeggio drops) and 25 (heartbeat), f above 0 (sizzle), day % 50 (cicadas), chapter 1-20 (palettes), progress past 0.85 (final stretch).'),
);

// ---------------------------------------------------------------------------------------------
// Sounds, events through the router, and the results melody.

const playSound = (name: SfxName, params: SfxParams = {}): void => audio.play(name, { day: view.day, ...params });
const send = (events: SimEvent[]): void => audio.onEvents(events, view);
/** Sends `count` events built by `make`, `everyMs` apart. */
function burst(count: number, everyMs: number, make: (i: number) => SimEvent): void {
  for (let i = 0; i < count; i++) setTimeout(() => send([make(i)]), i * everyMs);
}

const soundsSection = section(
  'Sounds (direct)',
  true,
  buttons(...SFX_NAMES.map((name) => button(name, () => playSound(name)))),
  note('Tonal cues play in the key of the scene’s day and chapter.'),
  buttons(...Array.from({ length: 10 }, (_, d) => button(`bell ${d}`, () => playSound('bell', { degree: d })))),
  buttons(
    ...[2, 3, 4, 5].map((level) => button(`×${level} up`, () => playSound('multUp', { level }))),
    ...[1, 2, 3].map((level) => button(`win ${'★'.repeat(level)}`, () => playSound('levelWin', { level }))),
    button('heartbeat (strong)', () => playSound('heartbeat', { strong: true })),
  ),
);

const eventButtons: [string, () => void][] = [
  ['Fast spin: 40 detents in 1 s', () => burst(40, 25, (i) => ({ e: 'detent', dir: 1, index: i % 24 }))],
  ['Flake run: 6 pickups (quantized)', () => burst(6, 70, (i) => ({ e: 'flake', mult: view.mult, degree: (i + view.mult) % 10, x: 0, y: 0, snow: 1 }))],
  ['Melt storm: 12 in 1 s', () => burst(12, 80, () => ({ e: 'flakeMelt', x: 0, y: 0 }))],
  ['Shade enter after 0.5 s lit', () => send([{ e: 'shadeEnter', litFor: 0.5 }])],
  ['Frost flowers ×5', () => burst(5, 400, () => ({ e: 'flower', x: 0, y: 0, snow: 2 }))],
  ['×2 → ×5 climb', () => burst(4, 900, (i) => ({ e: 'multUp', level: i + 2 }))],
  ['PHEW (+ slow-mo dip)', () => send([{ e: 'phew' }])],
  ['Dawn (fanfare, duck, key change)', () => send([{ e: 'dawn', day: ++view.day }])],
  ['Level won ★★★ (duck)', () => send([{ e: 'levelWon', passed: true, stars: 3, flakes: 9, minChill: 80 }])],
  ['Level missed', () => send([{ e: 'levelWon', passed: false, stars: 0, flakes: 1, minChill: 10 }])],
  ['Swing chain 1 → 3', () => burst(3, 500, (i) => ({ e: 'swing', deg: 80, chain: i + 1, snow: 1, x: 0, y: 0 }))],
];

const melodyLabel = el('span', { className: 'note' }, '');
function playMelody(degrees: number[]): void {
  view.screen = 'results';
  const secs = audio.playMelody(degrees, view.day);
  melodyLabel.textContent = secs > 0 ? `${degrees.length} notes, ${secs.toFixed(1)} s` : 'unlock audio first';
}

const eventsSection = section(
  'Events (through the router) and the results melody',
  true,
  buttons(...eventButtons.map(([label, fn]) => button(label, fn))),
  note('Detents ≤ 20/s (≥ 50 ms apart), melts ≤ 3/s, bells ≤ 12/s on the next free 16th. Concept cues (gust, lock, eclipse, finish line) fire from the scene sliders.'),
  buttons(
    button('Melody: random run', () => playMelody(Array.from({ length: 24 }, () => Math.floor(Math.random() * 10)))),
    button('Melody: rising run', () => playMelody([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])),
    button('Stop', () => audio.stopMelody()),
  ),
  melodyLabel,
);

// ---------------------------------------------------------------------------------------------
// Offline level check.

interface LevelResult extends Levels {
  name: string;
  oneShot: boolean;
}

const results: LevelResult[] = [];
const tbody = el('tbody');
const canvas = el('canvas', { width: 1100, height: 300 });
const checkLabel = el('span', { className: 'note' }, '');
const db = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

async function runLevelCheck(): Promise<LevelResult[]> {
  results.length = 0;
  tbody.replaceChildren();
  const cases = levelCases();
  let mix: Rendered | null = null;
  for (const [i, c] of cases.entries()) {
    checkLabel.textContent = `rendering ${i + 1}/${cases.length}: ${c.name}`;
    const r = await renderOffline(c.seconds, c.build);
    const m = measure(r);
    if (c.name.startsWith('mix')) mix = r;
    results.push({ name: c.name, oneShot: c.oneShot, ...m });
    // A one-shot is "cut" when its last 10 ms are within 40 dB of its peak.
    const cut = c.oneShot && m.tailDb > m.peakDb - 40;
    const cells: [string, string][] = [
      [c.name, ''],
      [db(m.peakDb), m.peakDb > -6 ? 'bad' : 'ok'],
      [db(m.rmsDb), ''],
      [db(m.preDb), m.preDb > -14 ? 'bad' : ''],
      [c.oneShot ? m.lengthS.toFixed(2) : '—', ''],
      [c.oneShot ? (cut ? `cut (${db(m.tailDb)})` : 'clean') : '—', cut ? 'bad' : c.oneShot ? 'ok' : ''],
    ];
    const row = el('tr', {}, ...cells.map(([text, cls]) => el('td', { className: cls }, text)));
    row.addEventListener('click', () => drawAnalysis(canvas, r, c.name));
    tbody.append(row);
  }
  checkLabel.textContent = `${cases.length} renders. Click a row for its waveform and spectrogram.`;
  if (mix) drawAnalysis(canvas, mix, 'mix · worst case');
  return results;
}

const levelsSection = section(
  'Level check (offline, through the real mix chain)',
  true,
  buttons(button('Run level check', () => void runLevelCheck(), 'primary')),
  checkLabel,
  el(
    'table',
    {},
    el('thead', {}, el('tr', {}, ...['sound', 'peak dBFS', 'loudest 100 ms RMS', 'pre-comp peak', 'length s', 'ending'].map((h) => el('th', {}, h)))),
    tbody,
  ),
  note('Targets (README "Mix and levels"): cues peak −24 to −10 dBFS, the worst-case pile-up stays under −3 dBFS, and every one-shot ends “clean”.'),
  canvas,
);

// ---------------------------------------------------------------------------------------------
// Assemble and run.

document.getElementById('lab')?.append(header, el('div', { className: 'grid' }, mixSection, sceneSection, soundsSection, eventsSection, levelsSection));

let last = performance.now();
function frame(now: number): void {
  audio.update(view, Math.min(0.1, (now - last) / 1000));
  last = now;
  updateMeter();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Automation hook (Playwright): the lab's audio, view and level check. */
(window as unknown as { __AUDIO_LAB__: unknown }).__AUDIO_LAB__ = { audio, view, runLevelCheck, results };
