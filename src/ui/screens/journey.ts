// Journey map (CAMPAIGN_PLAN §5, docs/UI_V2.md §6.13 and §10.2): the star total, a sticky "Continue ·
// Level N" with the progress to the next star reward, then 20 chapter boards. A board carries its
// biome colour, "Chapter 4" over its name and the chapter's Snow Globe with the stars earned; its ten
// level nodes ride a dirt road that snakes left to right, then back (CSS only: DOM and Tab order stay
// 1→10). A node shows its number, its stars, the concept a level introduces and a lock past the
// unlocked level; the level in play wears Nubs on top and a ray burst. Tapping a playable node starts
// it. Every visit centers the level in play; stars and unlocks earned since the last visit (or boot)
// pop in. The nodes are built once and refresh() updates them from the save, so focus survives a save
// change (the testing toggle, another tab's progress).

import { CAMPAIGN_LEVELS, CHAPTERS, CONCEPTS, type LevelDef } from '../../core/index.ts';
import { CAMPAIGN_STARS_MAX, continueLevel, isLevelPlayable, totalStars } from '../../meta/progression.ts';
import { STARS_PER_LEVEL } from '../../meta/save.ts';
import { biomeIcon, biomeName, conceptIcon } from '../concepts.ts';
import { h } from '../dom.ts';
import { artIcon } from '../art-icons.ts';
import { icon } from '../icons.ts';
import { continueLabel, levelTileLabel, starsLabel } from '../labels.ts';
import type { Screen, UiContext } from '../screen.ts';
import { button, countUp, menuHeader, starRoad } from '../widgets.ts';

/** Nodes per road row: the road runs 1→5, U-turns, then 6→10 (journey.css). */
const COLUMNS = 5;
const LEVELS_PER_CHAPTER = 10;
const CHAPTER_STARS = LEVELS_PER_CHAPTER * STARS_PER_LEVEL;
/** New stars pop in this long after the map opens, this far apart. */
const FRESH_MS = 280;
const FRESH_GAP_MS = 160;
/** The lead word of continueLabel ("Continue · Level 12"); the rest is set smaller. */
const CONTINUE = 'Continue';

interface Tile {
  level: LevelDef;
  el: HTMLButtonElement;
  stars: HTMLElement[];
  /** Each star's <use>: the earned or the empty art star. */
  uses: SVGUseElement[];
}

interface ChapterView {
  el: HTMLElement;
  count: HTMLElement;
  prize: HTMLElement;
}

/**
 * Where a level sits on screen (§10.2): the visual row `R` (two per chapter) and the column, which
 * runs right to left on a chapter's second row (the snake).
 */
function cellOf(n: number): { row: number; col: number } {
  const i = (n - 1) % LEVELS_PER_CHAPTER;
  const r = Math.floor(i / COLUMNS);
  return { row: 2 * Math.floor((n - 1) / LEVELS_PER_CHAPTER) + r, col: r === 0 ? i % COLUMNS : COLUMNS - 1 - (i % COLUMNS) };
}

/** The level at a visual row and column (the inverse of cellOf). */
function levelAt(row: number, col: number): number {
  const r = row % 2;
  return Math.floor(row / 2) * LEVELS_PER_CHAPTER + r * COLUMNS + (r === 0 ? col : COLUMNS - 1 - col) + 1;
}

/** The level an arrow key moves to from `n`: along the visual row (stopping at its ends) or straight up or down. */
export function journeyStep(n: number, key: string, levels: number): number | null {
  const { row, col } = cellOf(n);
  const to =
    key === 'ArrowLeft' ? (col > 0 ? levelAt(row, col - 1) : null)
    : key === 'ArrowRight' ? (col < COLUMNS - 1 ? levelAt(row, col + 1) : null)
    : key === 'ArrowUp' ? (row > 0 ? levelAt(row - 1, col) : null)
    : key === 'ArrowDown' ? levelAt(row + 1, col)
    : null;
  return to !== null && to >= 1 && to <= levels ? to : null;
}

// --- Board props (the storybook graft): two per biome standing on a board's bottom corners, each
// casting the game's purple shade. Drawn here once and handed to journey.css as data-URI custom
// properties, so the locked boards reuse the same shapes in lavender.
/** Each prop's shapes with its colours as `a` (face), `b` (shaded side or roof), `c` (wood, posts). */
type PropKind = 'tree' | 'bush' | 'house' | 'lamp';
const PROPS: Record<PropKind, string> = {
  tree: '<path d="M18 38V24h6v14Z" fill="c"/><circle cx="21" cy="15" r="11" fill="a"/><circle cx="12" cy="22" r="7" fill="a"/><circle cx="29" cy="22" r="7" fill="b"/>',
  bush: '<circle cx="14" cy="31" r="7" fill="a"/><circle cx="24" cy="27" r="10" fill="a"/><circle cx="34" cy="31" r="7" fill="b"/>',
  house: '<path d="M9 22h28v16H9Z" fill="a"/><path d="M5 23 23 8l18 15Z" fill="b"/><path d="M19 38v-9h6v9" fill="c"/>',
  lamp: '<path d="M22 38V16h4v22ZM17 38h14" fill="c"/><path d="M18 9h12l-2 8h-8Z" fill="a"/>',
};
const LIVE: Record<PropKind, string> = { tree: '8d5 6b4 b74', bush: '8c5 6b3 000', house: 'fec f74 b74', lamp: 'fe7 000 549' };
/** A prop as a data-URI image: its purple shade, then its shapes in `colours` ("a b c", 3-digit hex). */
function propUrl(kind: PropKind, colours: string): string {
  const [a, b, c] = colours.split(' ');
  const body = PROPS[kind].replace(/fill="([abc])"/g, (_, k: string) => `fill="#${k === 'a' ? a : k === 'b' ? b : c}"`);
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 44"><ellipse cx="27" cy="39" rx="17" ry="3.5" fill="#5A4A78" opacity=".32"/><g stroke="#2A1B45" stroke-width="2" stroke-linejoin="round">${body}</g></svg>`)}")`;
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

  // The header's star counter: "71" with "/600" as its small part (the element reads "71/600").
  const starsNum = h('span', { class: 'num' });
  const starsChip = h('span', { class: 'chip chip--stars', role: 'img' }, artIcon('star'), starsNum, h('small', null, `/${CAMPAIGN_STARS_MAX}`));
  // "Continue · Level 38": the level is the smaller second half of the label (one text, two sizes).
  const continueLevelText = h('span', { class: 'jc-level' });
  const continueBtn = button(ctx, {
    label: CONTINUE,
    icon: 'play',
    variant: 'primary',
    size: 'lg',
    block: true,
    className: 'journey-continue',
    onPress: () => start(continueLevel(ctx.save())),
  });
  continueBtn.querySelector('.btn-label')?.append(continueLevelText);
  const road = starRoad();
  // The road on the Journey is a plate with its item on an ice medal (§10.2).
  road.el.classList.add('plate');
  road.el.querySelector('.road-art')?.classList.add('medal', 'medal--ice');
  const sticky = h('div', { class: 'journey-sticky' }, continueBtn, road.el);

  // The level in play: Nubs on top of its node and a slow ray burst behind it (moved on refresh).
  const pin = artIcon('nubs', 'ai lvl-pin');
  const glow = h('span', { class: 'lvl-glow', 'aria-hidden': 'true' });
  const rays = h('span', { class: 'burst lvl-rays', 'aria-hidden': 'true' });

  // Chapters and nodes, built once.
  const tiles: Tile[] = [];
  const chapters: ChapterView[] = [];
  const body = h('div', { class: 'menu-body journey-body' });
  for (const chapter of CHAPTERS) {
    // The grid holds the ten nodes only (the snake places them by nth-child).
    const grid = h('div', { class: 'lvl-grid' });
    for (const level of CAMPAIGN_LEVELS.filter((l) => l.chapter === chapter.id)) {
      const uses: SVGUseElement[] = [];
      const stars = Array.from({ length: STARS_PER_LEVEL }, () => {
        const art = artIcon('starEmpty');
        uses.push(art.firstElementChild as SVGUseElement);
        return h('span', { class: 'lvl-star' }, art);
      });
      const concept = level.introduces ? CONCEPTS[level.introduces] : null;
      const finale = level.id % LEVELS_PER_CHAPTER === 0;
      const el = h(
        'button',
        { class: `lvl-tile pe${finale ? ' is-finale' : ''}`, type: 'button', 'data-level': level.id, title: concept ? (concept.name === level.name ? concept.blurb : `${concept.name}: ${concept.blurb}`) : null },
        h('span', { class: `lvl-num node candy${level.id >= 100 ? ' is-wide' : ''}` }, String(level.id)),
        finale ? artIcon('crown', 'ai lvl-crown') : null,
        concept ? h('span', { class: 'lvl-concept' }, icon(conceptIcon(concept.id))) : null,
        h('span', { class: 'lvl-stars' }, ...stars),
        h('span', { class: 'lvl-lock lock-badge' }, icon('lock')),
      );
      el.addEventListener('click', () => {
        ctx.sound('tap');
        start(level.id);
      });
      grid.append(el);
      tiles.push({ level, el, stars, uses });
    }
    // The banner on the board's frame: biome coin, "Chapter 4" over its name, the chapter's Snow Globe
    // (earned once all ten levels are passed) with the chapter's stars as a tag hanging under it (the
    // count says what the v1 bar did).
    const count = h('span', { class: 'chapter-count num' });
    const prize = h('span', { class: 'chapter-prize', role: 'img' }, artIcon('globe'), h('span', { class: 'chapter-check' }, artIcon('check')));
    const first = (chapter.id - 1) * LEVELS_PER_CHAPTER + 1;
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
      h('div', { class: 'chapter-meta tag' }, h('span', { class: 'chapter-stars' }, artIcon('star'), count)),
      h(
        'div',
        { class: 'chapter-map' },
        grid,
        // A locked board says what opens it (each locked node still says "Locked" in its label).
        first > 1 ? h('span', { class: 'chapter-plate plate', 'aria-hidden': 'true' }, h('span', { class: 'lock-badge' }, icon('lock')), `Finish Level ${first - 1}`) : null,
      ),
    );
    chapters.push({ el, count, prize });
    body.append(el);
  }

  // Arrow keys walk the nodes as they sit on screen: along the road's row (stopping at its ends),
  // or straight up and down to the node above or below, across chapters.
  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLButtonElement) || !t.classList.contains('lvl-tile')) return;
    const to = journeyStep(Number(t.dataset.level), e.key, tiles.length);
    if (to === null) return;
    e.preventDefault();
    tiles[to - 1]?.el.focus();
  });

  const header = menuHeader(ctx, 'Journey', starsChip);
  header.querySelector('.menu-title')?.setAttribute('id', 'journey-title');
  const el = h(
    'section',
    { class: 'scr scr-menu scr-journey', 'aria-labelledby': 'journey-title' },
    h('div', { class: 'menu pe' }, header, sticky, body),
  );
  for (const kind of Object.keys(PROPS) as PropKind[]) {
    el.style.setProperty(`--prop-${kind}`, propUrl(kind, LIVE[kind]));
    el.style.setProperty(`--prop-${kind}-x`, propUrl(kind, 'd9d1e6 c3b8d6 a99cc6'));
  }

  function refresh(): void {
    const save = ctx.save();
    const total = totalStars(save);
    starsNum.textContent = String(total);
    starsChip.setAttribute('aria-label', `${total} of ${CAMPAIGN_STARS_MAX} stars`);
    const next = continueLevel(save);
    continueLevelText.textContent = continueLabel(next).slice(CONTINUE.length);
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
      t.uses.forEach((u, i) => u.setAttribute('href', i < stars ? '#a-star' : '#a-starEmpty'));
      t.el.setAttribute('aria-label', levelTileLabel(t.level, stars, playable));
    }
    const current = tiles[next - 1]?.el;
    if (current) current.append(glow, rays, pin);
    chapters.forEach((c, i) => {
      const n = perChapter[i] ?? 0;
      c.count.textContent = `${n}/${CHAPTER_STARS}`;
      c.count.setAttribute('aria-label', starsLabel(n, CHAPTER_STARS));
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
    // The header's total counts up by the stars earned since the last visit (its slot holds the final width).
    const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);
    const to = sum(c.stars);
    starsNum.style.minWidth = `${String(to).length}ch`;
    stopCount = countUp(starsNum, sum(before.stars), to, ctx, { end: null });
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
