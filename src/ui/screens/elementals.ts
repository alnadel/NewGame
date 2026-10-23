// Elementals (docs/ELEMENTALS.md §4.10, §5.5): the hero roster and the eight Trials, laid out like
// the Wardrobe. The stage previews a hero (cb.renderHeroPreview; the selected Trial's two heroes side
// by side for a duo) with its element, tagline, three rules, ability line and a swatch of its dial
// arc, and Play for the selected Trial (the last one played, else the first open one not passed).
// Five round hero tiles follow (a locked one is a silhouette with what opens it; a tap previews the
// hero and highlights its Trials), then the Trials in two columns: a "T3" disc, the name, the best
// stars and the cast's faces. A tap on an open Trial plays it; a locked one says what opens it.
// Opening the screen marks it seen. Trials and heroes opened since the last visit pop in, and a new
// hero joins the team with a toast. Tiles are built once; refresh() updates them, so focus stays.

import { HERO_IDS, HEROES, levelShort, levelTag, TRIAL_BASE, TRIALS, type HeroFace, type HeroId, type TrialDef } from '../../core/index.ts';
import type { Save } from '../../meta/saveTypes.ts';
import { ELEMENTAL_STARS_MAX, elementalStars, heroUnlocked, markElementalsSeen, trialBest, trialOpen } from '../../meta/progression.ts';
import { artIcon } from '../art-icons.ts';
import { h, svgFromMarkup } from '../dom.ts';
import { icon } from '../icons.ts';
import { starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, setButtonLabel } from '../widgets.ts';

/** Backing stores, in CSS px (× devicePixelRatio, max 2): the stage's preview and a hero tile's. */
const STAGE_PX = 168;
const TILE_PX = 56;
/** Each candy face's class, written out whole (vite.config.ts shortens class names). */
const FACE: Readonly<Record<HeroFace, string>> = { ice: 'f-ice', red: 'f-red', green: 'f-green', violet: 'f-violet', blue: 'f-blue' };
/** The dial's go arc, as the swatch draws it (52 × 34). */
const ARC = 'M6 30A20 20 0 0 1 46 30';
const arc = (colour: string, extra = '', d = ARC): string => `<path d="${d}" stroke="${colour}" stroke-width="6"${extra}/>`;
/** Each hero's go arcs (§1): its colour and pattern (rays, leaf dashes, a bolt notch, warm dots). */
const DIAL: Readonly<Record<HeroId, string>> = {
  nubs: arc('#2EC4B6'),
  ember: arc('#FF8A1F') + arc('#FF8A1F', ' stroke-width="4" stroke-dasharray="2 5"', 'M0 30A26 26 0 0 1 52 30'),
  sprout: arc('#8BD650', ' stroke-dasharray="8 6"'),
  volt: `${arc('#FFE14D')}<path d="M28 3l-5 8h6l-5 8" stroke="#2A1B45" stroke-width="2.5"/>`,
  drip: arc('#2EC4B6', '', 'M6 30A20 20 0 0 1 26 10') + arc('#FFB347', '', 'M26 10A20 20 0 0 1 46 30') + arc('#fff', ' stroke-width="2.5" stroke-dasharray="0 6" stroke-linecap="round"', 'M26 10A20 20 0 0 1 46 30'),
};

/** The heroes of a Trial in words: "Volt", "Nubs and Ember", "Nubs, then Ember, then Nubs". */
const castWords = (t: TrialDef): string => t.cast.map((x) => HEROES[x].name).join(t.duo ? ' and ' : ', then ');
/** The hero a Trial is about (the stage's detail): the duo's partner, a relay's first elemental. */
const featured = (t: TrialDef): HeroId => t.duo?.right ?? t.cast.find((x) => x !== 'nubs') ?? (t.cast[0] as HeroId);
/** What opens a locked Trial: its first requirement not passed yet. */
const blocker = (save: Save, t: TrialDef): TrialDef => TRIALS[(t.requires.find((n) => trialBest(save, n) === 0) ?? 1) - 1] as TrialDef;
/** The Trial that introduces a hero. */
const introOf = (id: HeroId): TrialDef => TRIALS[HEROES[id].intro - 1] as TrialDef;

/** Sizes a canvas's backing store to `css` px at the device's pixel ratio (max 2). */
function fit(c: HTMLCanvasElement, css: number): void {
  const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
  if (c.width !== px) c.width = c.height = px;
}

/** A locked hero: its preview turned into a flat ink silhouette (the opaque pixels only). */
function silhouette(c: HTMLCanvasElement): void {
  const g = c.getContext('2d');
  if (!g) return;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = (d[i + 3] as number) > 200 ? 150 : 0;
    d[i] = 42;
    d[i + 1] = 27;
    d[i + 2] = 69;
    d[i + 3] = a;
  }
  g.putImageData(img, 0, 0);
}

interface TrialTile {
  t: TrialDef;
  btn: HTMLButtonElement;
  uses: SVGUseElement[];
}

interface HeroTile {
  id: HeroId;
  btn: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  label: HTMLElement;
}

export function createElementalsScreen(ctx: UiContext): Screen {
  /** The Trial Play starts, the last one played (null: pick on entry), and a hero tapped (null: the Trial's). */
  let sel = TRIALS[0] as TrialDef;
  let last: TrialDef | null = null;
  let picked: HeroId | null = null;
  /** Trials open and heroes unlocked at the last visit (or boot): what opened since pops in. */
  const snapshot = (): boolean[] => [...TRIALS.map((t) => trialOpen(ctx.save(), t.n)), ...HERO_IDS.map((id) => heroUnlocked(ctx.save(), id))];
  let seen = snapshot();

  const deny = (text: string): void => {
    ctx.sound('deny');
    ctx.toast(text, { icon: 'lock', tone: 'ink' });
  };
  const play = (t: TrialDef): void => {
    const save = ctx.save();
    if (!trialOpen(save, t.n)) return deny(`Pass ${blocker(save, t).name} first.`);
    last = t;
    ctx.go('play');
    ctx.cb.startRun('campaign', undefined, t.id);
  };

  // The header's star counter: "9" with "/24" as its small part (the element reads "9/24").
  const starsNum = h('span', 'num');
  const starsChip = h('span', { class: 'chip chip--stars elementals-stars', role: 'img' }, artIcon('star'), starsNum, h('small', null, `/${ELEMENTAL_STARS_MAX}`));

  // --- The stage: the hero(es), the words, the dial swatch and Play ---------------------------
  const canvases = [h('canvas', { class: 'preview-canvas', deco: true }), h('canvas', { class: 'preview-canvas', deco: true })];
  const spot = h('div', 'stage-spot', ...canvases);
  const name = h('span', 'preview-name gt-ink');
  const element = h('span', 'tag el-elem');
  const tagline = h('p', 'preview-note');
  const rules = h('ul', { class: 'el-rules', 'aria-label': 'Rules' });
  const swatch = h('span', { class: 'el-dial', deco: true });
  const ability = h('span', null);
  const playBtn = button(ctx, { label: 'Play', icon: 'play', variant: 'primary', size: 'lg', block: true, className: 'elementals-play', onPress: () => play(sel) });
  const stage = h(
    'div',
    'stage card el-stage',
    spot,
    h('p', 'el-head', name, element),
    tagline,
    h('p', 'el-ability', swatch, ability),
    rules,
    playBtn,
  );

  // --- Hero tiles ----------------------------------------------------------------------------
  const heroes: HeroTile[] = HERO_IDS.map((id) => {
    const canvas = h('canvas', { class: 'el-hcanvas', deco: true });
    const label = h('span', { class: 'tag el-hname', deco: true });
    const btn = h('button', { class: `tile hero-tile candy ${FACE[HEROES[id].face]}`, type: 'button', 'data-hero': id }, canvas, label);
    btn.addEventListener('click', () => {
      const save = ctx.save();
      if (!heroUnlocked(save, id)) return deny(`Pass ${introOf(id).name} first.`);
      ctx.sound('tap');
      picked = id;
      refresh();
      ctx.announce(`${HEROES[id].name}: ${HEROES[id].tagline}`);
    });
    return { id, btn, canvas, label };
  });
  const heroRow = h('div', { class: 'el-heroes', role: 'group', 'aria-label': 'Heroes' }, ...heroes.map((x) => x.btn));

  // --- Trial tiles ---------------------------------------------------------------------------
  const trials: TrialTile[] = TRIALS.map((t) => {
    const uses: SVGUseElement[] = [];
    const stars = [0, 1, 2].map(() => {
      const a = artIcon('starEmpty');
      uses.push(a.firstElementChild as SVGUseElement);
      return a;
    });
    // The cast's faces: one coin for a solo, "▸" between a relay's, "+" between a duo's.
    const cast = h('span', 'el-cast');
    t.cast.forEach((x, i) => {
      if (i > 0) cast.append(h('span', 'glyph', t.duo ? '+' : '▸'));
      cast.append(h('span', `el-face ${FACE[HEROES[x].face]}`, HEROES[x].name.charAt(0)));
    });
    const btn = h(
      'button',
      { class: 'trial-tile', type: 'button', 'data-trial': t.n },
      h('span', 'node candy', levelShort(t.id)),
      h('span', 'el-tname gt-ink', t.name),
      h('span', 'el-stars', ...stars),
      cast,
      h('span', 'lock-badge', icon('lock')),
    );
    btn.addEventListener('click', () => {
      ctx.sound('tap');
      play(t);
    });
    return { t, btn, uses };
  });
  const grid = h('div', { class: 'el-grid', role: 'group', 'aria-label': 'Trials' }, ...trials.map((x) => x.btn));

  const body = h('div', 'menu-body', stage, heroRow, grid);
  // Arrow keys walk the tiles: along the hero row, and across (±1) and down (±2) the Trial grid.
  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLButtonElement)) return;
    const list = t.classList.contains('hero-tile') ? heroes.map((x) => x.btn) : t.classList.contains('trial-tile') ? trials.map((x) => x.btn) : null;
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : list && list.length === TRIALS.length ? (e.key === 'ArrowUp' ? -2 : e.key === 'ArrowDown' ? 2 : 0) : 0;
    const to = list?.[list.indexOf(t) + step];
    if (!step || !to) return;
    e.preventDefault();
    to.focus();
  });

  const header = menuHeader(ctx, 'Elementals', starsChip);
  header.querySelector('.menu-title')?.setAttribute('id', 'elementals-title');
  const el = h('section', { class: 'scr scr-menu scr-elementals', 'aria-labelledby': 'elementals-title' }, h('div', 'menu pe', header, body));

  /** The stage: the hero tapped, else the selected Trial's (both of a duo's, side by side). */
  function renderStage(): void {
    const duo = picked === null ? sel.duo : null;
    const id = picked ?? featured(sel);
    const info = HEROES[id];
    spot.classList.toggle('is-duo', duo !== null);
    canvases[1]!.hidden = duo === null;
    const shown: HeroId[] = duo ? [duo.left, duo.right] : [id];
    shown.forEach((x, i) => {
      const c = canvases[i] as HTMLCanvasElement;
      fit(c, STAGE_PX);
      ctx.cb.renderHeroPreview(c, x);
    });
    name.textContent = duo ? `${HEROES[duo.left].name} + ${info.name}` : info.name;
    element.textContent = info.element;
    tagline.textContent = info.tagline;
    ability.textContent = info.abilityLine;
    swatch.replaceChildren(svgFromMarkup(`<svg viewBox="0 0 52 34" fill="none"><path d="${ARC}" stroke="#2A1B45" stroke-width="11"/>${DIAL[id]}</svg>`));
    rules.replaceChildren(...info.rules.map((r) => h('li', 'tag', r)));
    const label = `Play ${levelShort(sel.id)} · ${sel.name}`;
    setButtonLabel(playBtn, label);
  }

  function refresh(): void {
    const save = ctx.save();
    const total = elementalStars(save);
    starsNum.textContent = String(total);
    starsChip.setAttribute('aria-label', `${total} of ${ELEMENTAL_STARS_MAX} stars`);
    for (const { t, btn, uses } of trials) {
      const open = trialOpen(save, t.n);
      const stars = trialBest(save, t.n);
      btn.classList.toggle('is-locked', !open);
      btn.classList.toggle('is-done', stars > 0);
      btn.classList.toggle('is-next', t === sel);
      btn.classList.toggle('is-hl', picked !== null && t.cast.includes(picked));
      btn.setAttribute('aria-disabled', String(!open));
      uses.forEach((u, i) => u.setAttribute('href', i < stars ? '#a-star' : '#a-starEmpty'));
      const state = !open ? `locked: pass ${blocker(save, t).name}` : stars > 0 ? starsLabel(stars) : 'not passed yet';
      btn.setAttribute('aria-label', `${levelTag(t.id)}, ${t.name}, ${castWords(t)}, ${state}`);
    }
    for (const { id, btn, canvas, label } of heroes) {
      const open = heroUnlocked(save, id);
      const on = id === (picked ?? featured(sel));
      btn.classList.toggle('is-locked', !open);
      // The locked face (and its hatch in high contrast) over the hero's own.
      btn.classList.toggle('f-locked', !open);
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', String(on));
      const intro = HEROES[id].intro > 0 ? introOf(id).name : '';
      btn.setAttribute('aria-label', open ? HEROES[id].name : `${HEROES[id].name}, locked: pass ${intro}`);
      // A locked hero's label is its lock badge: "Pass Kindling".
      label.className = open ? 'tag el-hname' : 'lock-badge el-hname';
      label.replaceChildren(...(open ? [HEROES[id].name] : [icon('lock'), `Pass ${intro}`]));
      fit(canvas, TILE_PX);
      ctx.cb.renderHeroPreview(canvas, id);
      if (!open) silhouette(canvas);
    }
    renderStage();
  }

  /** Pops the Trials and heroes opened since the last visit; a new hero joins the team. */
  function celebrate(): void {
    const before = seen;
    seen = snapshot();
    const fresh = (i: number): boolean => seen[i] === true && before[i] === false;
    trials.forEach((x, i) => x.btn.classList.toggle('is-unlocked', fresh(i)));
    const joined = heroes.filter((x, i) => {
      x.btn.classList.toggle('is-unlocked', fresh(TRIALS.length + i));
      return fresh(TRIALS.length + i);
    });
    for (const x of joined) ctx.toast(`${HEROES[x.id].name} joins the team!`, { icon: 'star', tone: 'gold', duration: 3200 });
    if (joined.length > 0 || trials.some((_, i) => fresh(i))) ctx.sound('unlock');
  }

  return {
    el,
    enter(_from, data) {
      const save = ctx.save();
      const id = typeof data === 'number' ? data - TRIAL_BASE : 0;
      if (id >= 1 && id <= TRIALS.length) last = TRIALS[id - 1] as TrialDef;
      // The last Trial played, else the first open one not passed yet (else the first open one).
      sel = last ?? TRIALS.find((t) => trialOpen(save, t.n) && trialBest(save, t.n) === 0) ?? (TRIALS[0] as TrialDef);
      picked = null;
      body.scrollTop = 0;
      refresh();
      celebrate();
      if (save.elementals?.seen !== true) ctx.cb.updateSave(markElementalsSeen);
    },
    leave() {
      for (const x of [...trials, ...heroes]) x.btn.classList.remove('is-unlocked');
    },
    refresh,
    back: () => ctx.go('title'),
    activate() {
      play(sel);
      return true;
    },
    initialFocus: () => playBtn,
  };
}
