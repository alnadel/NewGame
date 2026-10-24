// Elementals: the element roster and the Trials, laid out like the Wardrobe. The stage previews an
// element (cb.renderHeroPreview) with its element word, tagline and three rules, and Play for the
// selected Trial (the last one played, else the first open one not passed).
// The heroes follow as round candy coins with their names hung under them (a locked one is a
// silhouette with a lock that says what opens it; a tap previews the hero, highlights its Trials and
// points Play at its next one), then the Trials as Wardrobe tiles in two columns: a "T3" disc, the
// name, the best stars and the cast's faces (the roster's art, small). A tap
// on an open Trial plays it; a locked one says what opens it. Opening the screen marks it seen;
// Trials and heroes opened since the last visit pop in, and a new hero joins the team with a toast.
// refresh() rebuilds the tiles from the save and puts the focus back on the tile that had it.

import { HERO_IDS, HEROES, levelShort, levelTag, TRIAL_BASE, TRIALS, type HeroFace, type HeroId, type TrialDef } from '../../core/index.ts';
import type { Save } from '../../meta/saveTypes.ts';
import { ELEMENTAL_STARS_MAX, elementalStars, heroUnlocked, markElementalsSeen, trialBest, trialOpen } from '../../meta/progression.ts';
import { artIcon } from '../art-icons.ts';
import { fitCanvas as fit, h, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import { starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, setButtonLabel } from '../widgets.ts';

/** Each candy face's class, written out whole (vite.config.ts shortens class names). */
const FACE: Readonly<Record<HeroFace, string>> = { ice: 'f-ice', red: 'f-red', blue: 'f-blue', green: 'f-green', cloud: 'f-cloud' };

/** The hero a Trial is about (the stage's): the first elemental in its cast. */
const featured = (t: TrialDef): HeroId => t.cast.find((x) => x !== 'nubs') ?? 'nubs';
/** What opens a locked Trial: its first requirement not passed yet. */
const blocker = (save: Save, t: TrialDef): string => (TRIALS[(t.requires.find((n) => !trialBest(save, n)) ?? 1) - 1] as TrialDef).name;

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
  const canvas = h('canvas', { class: 'preview-canvas', deco: true });
  const spot = h('div', 'stage-spot', canvas);
  const name = h('p', 'preview-name gt-ink');
  const tagline = h('p', 'preview-note');
  const rules = h('ul', { class: 'el-rules', 'aria-label': 'Rules' });
  const playBtn = button(ctx, { label: 'Play', icon: 'play', variant: 'primary', size: 'lg', block: true, className: 'elementals-play', onPress: () => play(sel) });
  const heroes = h('div', { class: 'el-heroes', role: 'group', 'aria-label': 'Heroes' });
  const grid = h('ul', { class: 'tile-grid panel el-grid', 'aria-label': 'Trials' });
  const body = h('div', 'menu-body', h('div', 'stage card el-stage', spot, name, tagline, rules, playBtn), heroes, grid);
  // Arrow keys walk the tiles: along the hero row, across (±1) and down (±2) the Trial grid; down
  // from a hero to its first Trial, up from the grid's top row to the selected hero.
  body.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const inGrid = t.parentElement?.parentElement === grid;
    const list = [...(inGrid ? grid.querySelectorAll('button') : heroes.contains(t) ? heroes.children : [])] as HTMLElement[];
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[e.key] ?? 0;
    const i = list.indexOf(t);
    const to =
      !inGrid && d > 1 && i >= 0
        ? grid.querySelector<HTMLElement>(`[data-trial="${TRIALS.find((x) => x.cast.includes(t.dataset.hero as HeroId))?.n}"]`)
        : inGrid && d < -1 && i < 2
          ? heroes.querySelector<HTMLElement>('.is-selected')
          : list[i + (list.length > 5 || d * d < 2 ? d : 0)];
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

    // The stage: the element tapped, else the selected Trial's.
    const id = picked ?? featured(sel);
    const hero = HEROES[id];
    ctx.cb.renderHeroPreview(fit(canvas, 168), id);
    setChildren(name, hero.name, ' ', h('span', 'tag', hero.element));
    tagline.textContent = hero.tagline;
    setChildren(rules, ...hero.rules.map((r) => h('li', 'tag', r)));
    setButtonLabel(playBtn, `Play ${levelShort(sel.id)} · ${sel.name}`);

    // The heroes: a locked one is a silhouette (elementals.css) with its lock, and says what opens it.
    setChildren(heroes, ...HERO_IDS.map((x, i) => {
      const open = heroUnlocked(save, x);
      const c = fit(h('canvas', { class: 'el-hcanvas', deco: true }), 52);
      ctx.cb.renderHeroPreview(c, x);
      const info = HEROES[x];
      const intro = TRIALS[info.intro - 1] as TrialDef | undefined;
      // A locked hero's label stays short ("Pass T1"); its aria-label and the toast name the Trial.
      const word = open ? info.name : `Pass ${levelShort(intro?.id ?? 0)}`;
      const on = x === id;
      const b = h(
        'button',
        { class: `tile hero-tile${open ? '' : ' is-locked'}${on ? ' is-selected' : ''}${fresh[TRIALS.length + i] ? ' is-unlocked' : ''}`, type: 'button', 'data-hero': x, 'aria-pressed': String(on), 'aria-label': open ? info.name : `${info.name}, locked: pass ${intro?.name}` },
        h('span', `candy el-disc ${open ? FACE[info.face] : 'f-locked'}`, c, open ? null : h('span', { class: 'tray-lock lock-badge', deco: true }, icon('lock'))),
        h('span', { class: 'gt el-name', deco: true }, word),
      );
      b.addEventListener('click', () => {
        const save = ctx.save();
        if (!heroUnlocked(save, x)) return deny(`Pass ${intro?.name} first.`);
        ctx.sound('tap');
        // Play follows the hero: its first open Trial not passed, else its first open one, else its first.
        const mine = TRIALS.filter((t) => t.cast.includes(x));
        const open = mine.filter((t) => trialOpen(save, t.n));
        sel = open.find((t) => !trialBest(save, t.n)) ?? open[0] ?? mine[0] ?? sel;
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
      // The cast's faces, the roster's art in small coins: a relay in walking order, back to Nubs too
      // (T5); five (T8) go without arrows to stay on one line.
      const who = t.relays.length ? [t.cast[0] as HeroId, ...t.relays.map((r) => r.to)] : t.cast;
      const cast = who.flatMap((x, k) => {
        const c = fit(h('canvas', { deco: true }), 18);
        ctx.cb.renderHeroPreview(c, x);
        return [k && who.length < 5 ? h('span', 'glyph', '▸') : null, h('span', `el-face candy ${FACE[HEROES[x].face]}`, c)];
      });
      const state = open ? (best ? starsLabel(best) : 'not passed yet') : `locked: pass ${blocker(save, t)}`;
      const b = h(
        'button',
        { class: cls, type: 'button', 'data-trial': t.n, 'aria-disabled': String(!open), 'aria-label': `${levelTag(t.id)}, ${t.name}, ${who.map((x) => HEROES[x].name).join(', then ')}, ${state}` },
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
