// Journey map (CAMPAIGN_PLAN §5): total stars, a sticky "Continue · Level N", then 20 chapter cards
// of 10 level tiles each (number, stars, the concept a level introduces, a lock past the unlocked
// level). Tapping a playable tile starts it. The tiles are built once; refresh() updates them from
// the save, so focus survives a save change (the testing toggle, another tab's progress). The
// scroll position is kept for the session; the first open scrolls to the chapter in play.

import { CAMPAIGN_LEVELS, CHAPTERS, CONCEPTS, type LevelDef } from '../../core/index.ts';
import { CAMPAIGN_STARS_MAX, continueLevel, isLevelPlayable, totalStars } from '../../meta/progression.ts';
import { STARS_PER_LEVEL } from '../../meta/save.ts';
import { biomeIcon, biomeName, conceptIcon } from '../concepts.ts';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { chapterTitle, continueLabel, levelTileLabel, starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, menuHeader, setButtonLabel } from '../widgets.ts';

/** Tiles per grid row (arrow keys move by this many up and down). */
const COLUMNS = 5;
const LEVELS_PER_CHAPTER = 10;

interface Tile {
  level: LevelDef;
  el: HTMLButtonElement;
  stars: HTMLElement[];
  lock: HTMLElement;
}

export function createJourneyScreen(ctx: UiContext): Screen {
  /** The body's scroll position when the screen was left (null until the first visit). */
  let scrollTop: number | null = null;

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

  // Header: total stars.
  const starsNum = h('span', { class: 'num' });
  const starsChip = h('span', { class: 'chip chip--stars', role: 'img' }, icon('star'), starsNum);

  // Sticky: Continue and where it leads.
  const continueBtn = button(ctx, {
    label: 'Continue',
    icon: 'play',
    variant: 'primary',
    size: 'lg',
    block: true,
    className: 'journey-continue',
    onPress: () => start(continueLevel(ctx.save())),
  });
  const where = h('p', { class: 'journey-where' });
  const sticky = h('div', { class: 'journey-sticky' }, continueBtn, where);

  // Chapters and tiles, built once.
  const tiles: Tile[] = [];
  const chapterEls: HTMLElement[] = [];
  const chapterCounts: HTMLElement[] = [];
  const body = h('div', { class: 'menu-body journey-body' });
  for (const chapter of CHAPTERS) {
    const grid = h('div', { class: 'lvl-grid' });
    const levels = CAMPAIGN_LEVELS.filter((l) => l.chapter === chapter.id);
    for (const level of levels) {
      const stars = Array.from({ length: STARS_PER_LEVEL }, () => h('span', { class: 'lvl-star' }, icon('star')));
      const concept = level.introduces ? CONCEPTS[level.introduces] : null;
      const lock = h('span', { class: 'lvl-lock' }, icon('lock'));
      const el = h(
        'button',
        { class: 'lvl-tile pe', type: 'button', 'data-level': level.id, title: concept ? (concept.name === level.name ? concept.blurb : `${concept.name}: ${concept.blurb}`) : null },
        h('span', { class: 'lvl-num num' }, String(level.id)),
        concept ? h('span', { class: 'lvl-concept' }, icon(conceptIcon(concept.id))) : null,
        h('span', { class: 'lvl-stars' }, ...stars),
        lock,
      );
      el.addEventListener('click', () => {
        ctx.sound('tap');
        start(level.id);
      });
      grid.append(el);
      tiles.push({ level, el, stars, lock });
    }
    const count = h('span', { class: 'card-count' });
    const card = h(
      'section',
      { class: 'card chapter', 'data-chapter': chapter.id },
      h(
        'h3',
        { class: 'card-title' },
        h('span', { class: 'chapter-name' },
          h('span', { class: 'chapter-biome', title: biomeName(chapter.biome) }, icon(biomeIcon(chapter.biome))),
          chapterTitle(chapter.id, chapter.name),
          h('span', { class: 'sr-only' }, `, ${biomeName(chapter.biome)}`)),
        count,
      ),
      grid,
    );
    chapterEls.push(card);
    chapterCounts.push(count);
    body.append(card);
  }

  // Arrow keys walk the tiles: left/right one level, up/down one row (across chapters).
  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLButtonElement) || !t.classList.contains('lvl-tile')) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[e.key];
    if (step === undefined) return;
    const i = Number(t.dataset.level) - 1 + step;
    const next = tiles[i];
    if (!next) return;
    e.preventDefault();
    next.el.focus();
  });

  const header = menuHeader(ctx, 'Journey', starsChip);
  const el = h(
    'section',
    { class: 'scr scr-menu scr-journey', 'aria-labelledby': 'journey-title' },
    h('div', { class: 'menu pe' }, header, sticky, body),
  );
  header.querySelector('.menu-title')?.setAttribute('id', 'journey-title');

  function refresh(): void {
    const save = ctx.save();
    const total = totalStars(save);
    starsNum.textContent = `${total}/${CAMPAIGN_STARS_MAX}`;
    starsChip.setAttribute('aria-label', `${total} of ${CAMPAIGN_STARS_MAX} stars`);
    const next = continueLevel(save);
    setButtonLabel(continueBtn, continueLabel(next));
    const chapter = CHAPTERS[Math.ceil(next / LEVELS_PER_CHAPTER) - 1];
    where.textContent = chapter ? chapterTitle(chapter.id, chapter.name) : '';
    const perChapter = Array<number>(CHAPTERS.length).fill(0);
    for (const t of tiles) {
      const id = t.level.id;
      const stars = save.campaign.stars[id - 1] ?? 0;
      const playable = isLevelPlayable(save, id);
      perChapter[t.level.chapter - 1] = (perChapter[t.level.chapter - 1] ?? 0) + stars;
      t.el.classList.toggle('is-locked', !playable);
      t.el.classList.toggle('is-done', stars > 0);
      t.el.classList.toggle('is-perfect', stars >= STARS_PER_LEVEL);
      t.el.classList.toggle('is-next', id === next);
      t.el.setAttribute('aria-disabled', String(!playable));
      t.stars.forEach((s, i) => s.classList.toggle('is-on', i < stars));
      t.lock.hidden = playable;
      t.el.setAttribute('aria-label', levelTileLabel(t.level, stars, playable));
    }
    chapterCounts.forEach((c, i) => {
      c.textContent = `${perChapter[i] ?? 0}/${LEVELS_PER_CHAPTER * STARS_PER_LEVEL}`;
      c.setAttribute('aria-label', starsLabel(perChapter[i] ?? 0, LEVELS_PER_CHAPTER * STARS_PER_LEVEL));
    });
  }

  return {
    el,
    enter() {
      refresh();
      if (scrollTop === null) {
        // First visit: the chapter in play at the top.
        const card = chapterEls[Math.ceil(continueLevel(ctx.save()) / LEVELS_PER_CHAPTER) - 1];
        body.scrollTop = card ? Math.max(0, card.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 6) : 0;
      } else {
        body.scrollTop = scrollTop;
      }
    },
    leave() {
      scrollTop = body.scrollTop;
    },
    refresh,
    back: () => ctx.go('title'),
    initialFocus: () => continueBtn,
  };
}
