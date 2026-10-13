// Journey map (CAMPAIGN_PLAN §5): total stars, a sticky "Continue · Level N" with the progress to the
// next star reward, then 20 chapter cards (name, stars, a bar) of 10 level tiles each (number, stars,
// the concept a level introduces, a lock past the unlocked level). Tapping a playable tile starts it.
// Every visit centers the level in play; stars and unlocks earned since the last visit (or boot) pop in. The
// tiles are built once and refresh() updates them from the save, so focus survives a save change
// (the testing toggle, another tab's progress).

import { CAMPAIGN_LEVELS, CHAPTERS, CONCEPTS, type LevelDef } from '../../core/index.ts';
import { CAMPAIGN_STARS_MAX, continueLevel, isLevelPlayable, totalStars } from '../../meta/progression.ts';
import { STARS_PER_LEVEL } from '../../meta/save.ts';
import { biomeIcon, biomeName, conceptIcon } from '../concepts.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { continueLabel, levelTileLabel, starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, countUp, menuHeader, progressBar, setButtonLabel, starRoad } from '../widgets.ts';

/** Tiles per grid row (arrow keys move by this many up and down). */
const COLUMNS = 5;
const LEVELS_PER_CHAPTER = 10;
const CHAPTER_STARS = LEVELS_PER_CHAPTER * STARS_PER_LEVEL;
/** New stars pop in this long after the map opens, this far apart. */
const FRESH_MS = 280;
const FRESH_GAP_MS = 160;

interface Tile {
  level: LevelDef;
  el: HTMLButtonElement;
  stars: HTMLElement[];
}

interface ChapterView {
  el: HTMLElement;
  count: HTMLElement;
  bar: HTMLElement;
  prize: HTMLElement;
}

export function createJourneyScreen(ctx: UiContext): Screen {
  /** Stars and the unlocked level at the last visit (or at boot): what changed since then pops in. */
  const snapshot = (): { stars: number[]; unlocked: number } => ({ stars: ctx.save().campaign.stars.slice(), unlocked: ctx.save().campaign.unlocked });
  let seen = snapshot();
  let timer = 0;
  let stopCount = (): void => {};
  /** Back returns to the Title, or to the Profile when the map was opened from there. */
  let origin: 'title' | 'profile' = 'title';

  const start = (id: number): void => {
    const save = ctx.save();
    if (!isLevelPlayable(save, id)) {
      ctx.sound('deny');
      ctx.toast(`Finish Level ${Math.max(1, Math.min(id - 1, save.campaign.unlocked))} first.`, { icon: 'lock', tone: 'ink' });
      return;
    }
    ctx.go('play');
    ctx.cb.startRun('campaign', undefined, id);
  };

  const starsNum = h('span', { class: 'num' });
  const starsChip = h('span', { class: 'chip chip--stars', role: 'img' }, icon('star'), starsNum);
  const continueBtn = button(ctx, {
    label: 'Continue',
    icon: 'play',
    variant: 'primary',
    size: 'lg',
    block: true,
    className: 'journey-continue',
    onPress: () => start(continueLevel(ctx.save())),
  });
  const road = starRoad();
  const sticky = h('div', { class: 'journey-sticky' }, continueBtn, road.el);

  // Chapters and tiles, built once.
  const tiles: Tile[] = [];
  const chapters: ChapterView[] = [];
  const body = h('div', { class: 'menu-body journey-body' });
  for (const chapter of CHAPTERS) {
    const grid = h('div', { class: 'lvl-grid' });
    for (const level of CAMPAIGN_LEVELS.filter((l) => l.chapter === chapter.id)) {
      const stars = Array.from({ length: STARS_PER_LEVEL }, () => h('span', { class: 'lvl-star' }, icon('star')));
      const concept = level.introduces ? CONCEPTS[level.introduces] : null;
      const el = h(
        'button',
        { class: 'lvl-tile pe', type: 'button', 'data-level': level.id, title: concept ? (concept.name === level.name ? concept.blurb : `${concept.name}: ${concept.blurb}`) : null },
        h('span', { class: 'lvl-num num' }, String(level.id)),
        concept ? h('span', { class: 'lvl-concept' }, icon(conceptIcon(concept.id))) : null,
        h('span', { class: 'lvl-stars' }, ...stars),
        h('span', { class: 'lvl-lock' }, icon('lock')),
      );
      el.addEventListener('click', () => {
        ctx.sound('tap');
        start(level.id);
      });
      grid.append(el);
      tiles.push({ level, el, stars });
    }
    // The banner: biome mark, "Chapter 4" over its name, the stars and the chapter's Snow Globe
    // (earned once all ten levels are passed).
    const count = h('span', { class: 'chapter-count num' });
    const bar = progressBar(0);
    const prize = h('span', { class: 'chapter-prize', role: 'img' }, icon('globe'), h('span', { class: 'chapter-check' }, icon('check')));
    const el = h(
      'section',
      { class: 'card chapter', 'data-chapter': chapter.id, 'data-biome': chapter.biome },
      h(
        'header',
        { class: 'chapter-banner' },
        h('span', { class: 'chapter-biome', title: biomeName(chapter.biome) }, icon(biomeIcon(chapter.biome))),
        h(
          'h3',
          { class: 'chapter-head' },
          h('span', { class: 'chapter-kicker' }, `Chapter ${chapter.id}`, h('span', { class: 'sr-only' }, `, ${biomeName(chapter.biome)}: `)),
          h('span', { class: 'chapter-name' }, chapter.name),
        ),
        prize,
      ),
      h('div', { class: 'chapter-meta' }, h('span', { class: 'chapter-stars' }, icon('star'), count), bar),
      grid,
    );
    chapters.push({ el, count, bar, prize });
    body.append(el);
  }

  // Arrow keys walk the tiles: left/right one level, up/down one row (across chapters).
  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLButtonElement) || !t.classList.contains('lvl-tile')) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[e.key];
    const next = step === undefined ? undefined : tiles[Number(t.dataset.level) - 1 + step];
    if (!next) return;
    e.preventDefault();
    next.el.focus();
  });

  const header = menuHeader(ctx, 'Journey', starsChip);
  header.querySelector('.menu-title')?.setAttribute('id', 'journey-title');
  const el = h('section', { class: 'scr scr-menu scr-journey', 'aria-labelledby': 'journey-title' }, h('div', { class: 'menu pe' }, header, sticky, body));

  function refresh(): void {
    const save = ctx.save();
    const total = totalStars(save);
    starsNum.textContent = `${total}/${CAMPAIGN_STARS_MAX}`;
    starsChip.setAttribute('aria-label', `${total} of ${CAMPAIGN_STARS_MAX} stars`);
    const next = continueLevel(save);
    setButtonLabel(continueBtn, continueLabel(next));
    road.update(save);
    const perChapter = Array<number>(CHAPTERS.length).fill(0);
    const passed = Array<number>(CHAPTERS.length).fill(0);
    for (const t of tiles) {
      const id = t.level.id;
      const stars = save.campaign.stars[id - 1] ?? 0;
      const playable = isLevelPlayable(save, id);
      perChapter[t.level.chapter - 1] = (perChapter[t.level.chapter - 1] ?? 0) + stars;
      if (stars > 0) passed[t.level.chapter - 1] = (passed[t.level.chapter - 1] ?? 0) + 1;
      t.el.classList.toggle('is-locked', !playable);
      t.el.classList.toggle('is-done', stars > 0);
      t.el.classList.toggle('is-perfect', stars >= STARS_PER_LEVEL);
      t.el.classList.toggle('is-next', id === next);
      t.el.setAttribute('aria-disabled', String(!playable));
      t.stars.forEach((s, i) => s.classList.toggle('is-on', i < stars));
      t.el.setAttribute('aria-label', levelTileLabel(t.level, stars, playable));
    }
    chapters.forEach((c, i) => {
      const n = perChapter[i] ?? 0;
      c.count.textContent = `${n}/${CHAPTER_STARS}`;
      c.count.setAttribute('aria-label', starsLabel(n, CHAPTER_STARS));
      (c.bar.firstElementChild as HTMLElement).style.width = `${Math.round((n / CHAPTER_STARS) * 100)}%`;
      // Complete: all ten levels passed (the chapter's Snow Globe is earned); perfect: every star.
      const complete = (passed[i] ?? 0) >= LEVELS_PER_CHAPTER;
      c.el.classList.toggle('is-complete', complete);
      c.el.classList.toggle('is-perfect', n >= CHAPTER_STARS);
      c.prize.setAttribute('aria-label', complete ? 'Chapter complete: Snow Globe earned' : `Snow Globe for passing all ${LEVELS_PER_CHAPTER} levels`);
      c.prize.title = c.prize.getAttribute('aria-label') ?? '';
      c.el.classList.toggle('is-locked', tiles[i * LEVELS_PER_CHAPTER]?.el.classList.contains('is-locked') === true);
    });
  }

  /** Pops the stars earned and the levels unlocked since the last visit. */
  function celebrate(): void {
    const c = ctx.save().campaign;
    const before = seen;
    seen = snapshot();
    // The header's total counts up by the stars earned since the last visit.
    const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);
    stopCount = countUp(starsNum, sum(before.stars), sum(c.stars), ctx, { format: (n) => `${n}/${CAMPAIGN_STARS_MAX}`, end: null });
    let fresh = 0;
    for (const t of tiles) {
      const i = t.level.id - 1;
      for (let k = before.stars[i] ?? 0; k < (c.stars[i] ?? 0); k++) {
        t.stars[k]?.classList.add('is-fresh');
        t.stars[k]?.style.setProperty('--d', `${FRESH_MS + fresh++ * FRESH_GAP_MS}ms`);
      }
      if (t.level.id > before.unlocked && t.level.id <= c.unlocked) t.el.classList.add('is-unlocked');
    }
    // A chapter completed since the last visit: its banner celebrates (the globe drops in).
    const done = (stars: readonly number[], ch: number): boolean => stars.slice(ch * LEVELS_PER_CHAPTER, (ch + 1) * LEVELS_PER_CHAPTER).every((n) => n > 0);
    chapters.forEach((v, ch) => {
      if (!done(before.stars, ch) && done(c.stars, ch)) {
        v.el.classList.add('is-just-complete');
        ctx.toast(`Chapter ${ch + 1} complete!`, { icon: 'star', tone: 'gold' });
      }
    });
    if (fresh > 0 || c.unlocked > before.unlocked) timer = window.setTimeout(() => ctx.sound(fresh > 0 ? 'stamp' : 'unlock'), FRESH_MS);
  }

  return {
    el,
    enter(from) {
      if (from !== 'journey') origin = from === 'profile' ? 'profile' : 'title';
      refresh();
      celebrate();
      // The level in play sits in the middle of the view.
      const tile = tiles[continueLevel(ctx.save()) - 1]?.el;
      if (tile) {
        const r = tile.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        body.scrollTop = Math.max(0, body.scrollTop + r.top - b.top - (b.height - r.height) / 2);
      }
    },
    leave() {
      clearTimeout(timer);
      stopCount();
      for (const c of chapters) c.el.classList.remove('is-just-complete');
      for (const t of tiles) {
        t.el.classList.remove('is-unlocked');
        for (const s of t.stars) s.classList.remove('is-fresh');
      }
    },
    refresh,
    back: () => ctx.go(origin),
    initialFocus: () => continueBtn,
  };
}
