// Elementals (docs/ELEMENTALS.md §4.10, §5.5): the hero roster and the eight Trials, laid out like
// the Wardrobe. The stage previews a hero (cb.renderHeroPreview; the selected Trial's two heroes side
// by side for a duo) with its element, tagline, three rules, ability line and a swatch of its dial
// arc, and Play for the selected Trial (the last one played, else the first open one not passed).
// The heroes follow as round candy coins on the Title tray's recipe (a locked one is a silhouette
// that says what opens it; a tap previews the hero and highlights its Trials), then the Trials as
// Wardrobe tiles in two columns: a "T3" disc, the name, the best stars and the cast's faces. A tap
// on an open Trial plays it; a locked one says what opens it. Opening the screen marks it seen;
// Trials and heroes opened since the last visit pop in, and a new hero joins the team with a toast.
// refresh() rebuilds the tiles from the save and puts the focus back on the tile that had it.

import { HERO_IDS, HEROES, levelShort, levelTag, TRIAL_BASE, TRIALS, type HeroFace, type HeroId, type TrialDef } from '../../core/index.ts';
import type { Save } from '../../meta/saveTypes.ts';
import { ELEMENTAL_STARS_MAX, elementalStars, heroUnlocked, markElementalsSeen, trialBest, trialOpen } from '../../meta/progression.ts';
import { artIcon } from '../art-icons.ts';
import { h, setChildren, svgFromMarkup } from '../dom.ts';
import { icon } from '../icons.ts';
import { starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, setButtonLabel } from '../widgets.ts';

/** Each candy face's class, written out whole (vite.config.ts shortens class names). */
const FACE: Readonly<Record<HeroFace, string>> = { ice: 'f-ice', red: 'f-red', green: 'f-green', violet: 'f-violet', blue: 'f-blue' };
/** Each hero's go arc on the dial (§1): its colour and pattern (solid, ray ticks, leaf dashes, bolt notches, warm dots). */
const DIAL: Readonly<Record<HeroId, string>> = {
  nubs: '#2EC4B6"',
  ember: '#FF8A1F" stroke-dasharray="3 2"',
  sprout: '#8BD650" stroke-dasharray="8 5"',
  volt: '#FFE14D" stroke-dasharray="13 3"',
  drip: '#FFB347" stroke-dasharray="0 7" stroke-linecap="round"',
};
const ARC = '<path d="M6 30A20 20 0 0 1 46 30" stroke="';

/** The hero a Trial is about (the stage's): the first elemental in its cast. */
const featured = (t: TrialDef): HeroId => t.cast.find((x) => x !== 'nubs') ?? 'nubs';
/** What opens a locked Trial: its first requirement not passed yet. */
const blocker = (save: Save, t: TrialDef): string => (TRIALS[(t.requires.find((n) => !trialBest(save, n)) ?? 1) - 1] as TrialDef).name;

/** Sizes a canvas's backing store to `css` px at the device's pixel ratio (max 2). */
function fit(c: HTMLCanvasElement, css: number): HTMLCanvasElement {
  c.width = c.height = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
  return c;
}

export function createElementalsScreen(ctx: UiContext): Screen {
  /** The Trial Play starts, the last one played, and the hero tapped (null: the Trial's). */
  let sel = TRIALS[0] as TrialDef;
  let last: TrialDef | null = null;
  let picked: HeroId | null = null;
  /** Trials open and heroes unlocked at the last visit (or boot), and what opened since (it pops in). */
  const opened = (): boolean[] => [...TRIALS.map((t) => trialOpen(ctx.save(), t.n)), ...HERO_IDS.map((x) => heroUnlocked(ctx.save(), x))];
  let seen = opened();
  let fresh: boolean[] = [];

  const deny = (text: string): void => {
    ctx.sound('deny');
    ctx.toast(text, { icon: 'lock', tone: 'ink' });
  };
  const play = (t: TrialDef): void => {
    if (!trialOpen(ctx.save(), t.n)) return deny(`Pass ${blocker(ctx.save(), t)} first.`);
    last = t;
    ctx.go('play');
    ctx.cb.startRun('campaign', undefined, t.id);
  };

  const chip = h('span', { class: 'chip chip--stars elementals-stars', role: 'img' });
  const canvases = [0, 1].map(() => h('canvas', { class: 'preview-canvas', deco: true }));
  const spot = h('div', 'stage-spot', ...canvases);
  const name = h('p', 'preview-name gt-ink');
  const tagline = h('p', 'preview-note');
  const ability = h('p', 'preview-note');
  const rules = h('ul', { class: 'el-rules', 'aria-label': 'Rules' });
  const playBtn = button(ctx, { label: 'Play', icon: 'play', variant: 'primary', size: 'lg', block: true, className: 'elementals-play', onPress: () => play(sel) });
  const heroes = h('div', { class: 'tray', role: 'group', 'aria-label': 'Heroes' });
  const grid = h('ul', { class: 'tile-grid panel el-grid', 'aria-label': 'Trials' });
  const body = h('div', 'menu-body', h('div', 'stage card el-stage', spot, name, tagline, ability, rules, playBtn), heroes, grid);
  // Arrow keys walk the tiles: along the hero row, across (±1) and down (±2) the Trial grid.
  body.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const list = [...(t.parentElement?.parentElement === grid ? grid.querySelectorAll('button') : heroes.contains(t) ? heroes.children : [])] as HTMLElement[];
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[e.key] ?? 0;
    const to = list[list.indexOf(t) + (list.length > 5 || d * d < 2 ? d : 0)];
    if (to && to !== t) {
      e.preventDefault();
      to.focus();
    }
  });
  const header = menuHeader(ctx, 'Elementals', chip);
  header.querySelector('.menu-title')?.setAttribute('id', 'elementals-title');
  const el = h('section', { class: 'scr scr-menu scr-elementals', 'aria-labelledby': 'elementals-title' }, h('div', 'menu pe', header, body));

  function refresh(): void {
    const save = ctx.save();
    const focus = document.activeElement as HTMLElement | null;
    const keep = focus && body.contains(focus) ? (focus.dataset.hero ?? focus.dataset.trial) : undefined;
    const stars = elementalStars(save);
    setChildren(chip, artIcon('star'), h('span', 'num', String(stars)), h('small', null, `/${ELEMENTAL_STARS_MAX}`));
    chip.setAttribute('aria-label', `${stars} of ${ELEMENTAL_STARS_MAX} stars`);

    // The stage: the hero tapped, else the selected Trial's (both of a duo's, side by side).
    const id = picked ?? featured(sel);
    const hero = HEROES[id];
    const duo = picked ? null : sel.duo;
    spot.classList.toggle('is-duo', duo !== null);
    canvases[1]!.hidden = !duo;
    (duo ? [duo.left, duo.right] : [id]).forEach((x, i) => ctx.cb.renderHeroPreview(fit(canvases[i] as HTMLCanvasElement, 168), x));
    setChildren(name, duo ? `${HEROES[duo.left].name} + ${hero.name}` : hero.name, ' ', h('span', 'tag', hero.element));
    tagline.textContent = hero.tagline;
    setChildren(ability, svgFromMarkup(`<svg width="40" height="26" viewBox="0 0 52 34" fill="none" stroke-width="7" aria-hidden="true">${ARC}#2A1B45" stroke-width="11"/>${ARC}${DIAL[id]}/></svg>`), ` ${hero.abilityLine}`);
    setChildren(rules, ...hero.rules.map((r) => h('li', 'tag', r)));
    setButtonLabel(playBtn, `Play ${levelShort(sel.id)} · ${sel.name}`);

    // The heroes: a locked one is an ink silhouette with its lock, and says what opens it.
    setChildren(heroes, ...HERO_IDS.map((x, i) => {
      const open = heroUnlocked(save, x);
      const c = fit(h('canvas', { class: 'el-hcanvas', deco: true }), 52);
      ctx.cb.renderHeroPreview(c, x);
      const g = c.getContext('2d');
      if (!open && g) {
        const img = g.getImageData(0, 0, c.width, c.height);
        for (let p = 0; p < img.data.length; p += 4) img.data.set([42, 27, 69, (img.data[p + 3] as number) > 200 ? 150 : 0], p);
        g.putImageData(img, 0, 0);
      }
      const info = HEROES[x];
      const intro = (TRIALS[info.intro - 1] as TrialDef | undefined)?.name;
      const word = open ? info.name : `Pass ${intro}`;
      const on = x === id;
      const b = h(
        'button',
        { class: `tile hero-tile tray-btn${open ? '' : ' is-locked'}${on ? ' is-selected' : ''}${fresh[TRIALS.length + i] ? ' is-unlocked' : ''}`, type: 'button', 'data-hero': x, 'aria-pressed': String(on), 'aria-label': open ? info.name : `${info.name}, locked: pass ${intro}` },
        h('span', `tray-disc candy ${open ? FACE[info.face] : 'f-locked'}`, c, h('span', { class: 'tray-lock lock-badge', deco: true }, icon('lock'))),
        h('span', { class: 'tray-label', deco: true }, word),
      );
      b.addEventListener('click', () => {
        if (!heroUnlocked(ctx.save(), x)) return deny(`${word} first.`);
        ctx.sound('tap');
        picked = x;
        refresh();
        ctx.announce(`${info.name}: ${info.tagline}`);
      });
      return b;
    }));

    // The Trials: state classes written out whole; the lock badge only on a locked one.
    setChildren(grid, ...TRIALS.map((t, i) => {
      const open = trialOpen(save, t.n);
      const best = trialBest(save, t.n);
      const cls = `tile trial-tile${open ? '' : ' is-locked'}${best ? ' is-done' : ''}${t === sel ? ' is-next is-selected' : ''}${picked && t.cast.includes(picked) ? ' is-hl' : ''}${fresh[i] ? ' is-unlocked' : ''}`;
      const cast = t.cast.flatMap((x, k) => [k ? h('span', 'glyph', t.duo ? '+' : '▸') : null, h('span', `el-face ${FACE[HEROES[x].face]}`, HEROES[x].name.charAt(0))]);
      const state = open ? (best ? starsLabel(best) : 'not passed yet') : `locked: pass ${blocker(save, t)}`;
      const b = h(
        'button',
        { class: cls, type: 'button', 'data-trial': t.n, 'aria-disabled': String(!open), 'aria-label': `${levelTag(t.id)}, ${t.name}, ${t.cast.map((x) => HEROES[x].name).join(t.duo ? ' and ' : ', then ')}, ${state}` },
        h('span', 'node candy', levelShort(t.id)),
        h('span', 'tile-name gt-ink', t.name),
        h('span', 'el-stars', ...[0, 1, 2].map((k) => artIcon(k < best ? 'star' : 'starEmpty'))),
        h('span', 'el-cast', ...cast),
        open ? null : h('span', 'tray-lock lock-badge', icon('lock')),
      );
      b.addEventListener('click', () => {
        ctx.sound('tap');
        play(t);
      });
      return h('li', null, b);
    }));
    if (keep) body.querySelector<HTMLElement>(`[data-hero="${keep}"],[data-trial="${keep}"]`)?.focus();
  }

  return {
    el,
    enter(_from, data) {
      const save = ctx.save();
      const n = typeof data === 'number' ? data - TRIAL_BASE : 0;
      if (n >= 1 && n <= TRIALS.length) last = TRIALS[n - 1] as TrialDef;
      // The last Trial played, else the first open one not passed yet.
      sel = last ?? TRIALS.find((t) => trialOpen(save, t.n) && !trialBest(save, t.n)) ?? (TRIALS[0] as TrialDef);
      picked = null;
      // What opened since the last visit pops in; a new hero joins the team.
      const now = opened();
      fresh = now.map((o, i) => o && seen[i] === false);
      seen = now;
      for (const x of HERO_IDS.filter((_, i) => fresh[TRIALS.length + i])) ctx.toast(`${HEROES[x].name} joins the team!`, { icon: 'star', tone: 'gold', duration: 3200 });
      if (fresh.includes(true)) ctx.sound('unlock');
      body.scrollTop = 0;
      refresh();
      fresh = [];
      if (!save.elementals?.seen) ctx.cb.updateSave(markElementalsSeen);
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
