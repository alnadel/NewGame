// v1.4 gamification widgets (docs/V1_4_PLAN.md). CONTRACT FILE: the four first signatures are
// fixed for the v1.4 builders; the rest is additive. The UX builder places these widgets (Title,
// Results, Journey); this file makes them look (gamify.css) and behave:
// - rankBadge: the Sun Rank as a gold medal on a name plate with a mini XP bar; opens the Profile.
// - xpMeter: the Results XP bar that fills by the run's XP and rolls over on a rank up.
// UI v2 (docs/UI_V2.md §6.6, §10.1, §10.3): medals, the violet XP bar with this run's gain marked
// and a "+125 XP" comic burst, a RANK UP! sticker; the reveal is a rarity-framed card on a burst.
// - claimDot: the red dot with a count on a button.
// - revealRewards: the reward overlay (a Snow Globe shakes, snow swirls, it opens on the prize).
// - streakCard / claimDailyReward / openGlobes: the 7-day streak calendar and the claim flows.

import './gamify.css';
import { getCosmetic } from '../meta/content.ts';
import {
  claimDaily,
  featureHint,
  featureUnlocked,
  openGlobe,
  rankForXp,
  rankNeed,
  rankReward,
  rankStartXp,
  rankTitle,
  rankView,
  rarity,
  streakView,
  type GamifyOutcome,
  type Reward,
} from '../meta/gamify.ts';
import type { Save } from '../meta/saveTypes.ts';
import { artIcon, kitShape } from './art-icons.ts';
import { h, setChildren, setFlag, svgFromMarkup } from './dom.ts';
import { RARITY_LABEL } from './labels.ts';
import type { UiContext } from './screen.ts';
import { cosmeticSwatch } from './swatches.ts';
import { isLegalTransition } from './transitions.ts';
import type { ScreenId } from './types.ts';
import { button, hide, medal, progressBar, ribbon } from './widgets.ts';

let globeIds = 0;

/** The Snow Globe: a glass dome with Nubs in the snow, on a gold stand, outlined in the kit's ink. */
export function globeSvg(className = 'globe-art'): SVGSVGElement {
  // Gradient ids are unique per copy: a hidden copy's gradient would blank the others.
  const g = `gg${++globeIds}`;
  return svgFromMarkup(`<svg class="${className}" viewBox="0 0 120 120" aria-hidden="true" stroke="#2A1B45" stroke-linejoin="round">
<radialGradient id="${g}" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9ad8ff"/></radialGradient>
<path d="M30 96h60l6 15H24Z" fill="#2A1B45" stroke="none"/><path d="M30 92h60l6 15H24Z" fill="#ffc23d" stroke-width="4"/><rect x="26" y="86" width="68" height="10" rx="5" fill="#f59a0e" stroke-width="4"/>
<circle cx="60" cy="52" r="42" fill="url(#${g})" stroke="none"/><path d="M22 66q38 14 76 0a42 42 0 0 1-76 0Z" fill="#fff" stroke="none"/>
<g fill="#fff" stroke-width="2.5"><circle cx="60" cy="62" r="11"/><circle cx="60" cy="45" r="8"/></g>
<path d="M51 52q9 4 18 0l1 4q-10 4-20 0Z" fill="#e8475a" stroke-width="2"/><path d="M60 46l7 2-7 1.6Z" fill="#ff8a2b" stroke="none"/>
<path d="M57 43h.1M63 43h.1" stroke-width="2.6" stroke-linecap="round"/><circle cx="60" cy="52" r="42" fill="none" stroke-width="4.5"/>
<path d="M36 30a30 30 0 0 1 18-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`);
}

// ---------------------------------------------------------------------------------------------
// Rank badge and XP meter
// ---------------------------------------------------------------------------------------------

/** The rank badge: a gold medal with the rank, on a plate with "Sun Rank", the name and a mini XP bar. Tapping it opens the Profile. */
export function rankBadge(ctx: UiContext): { el: HTMLElement; update(save: Save): void } {
  const num = medal('', { className: 'rank-medal' });
  const name = h('span', { class: 'rank-name' });
  const bar = progressBar(0, 'bar bar--sm rank-bar', 'violet');
  const el = h('button', { type: 'button', class: 'rank-badge pe' }, num, h('span', { class: 'plate rank-text' }, h('span', { class: 'rank-kicker' }, 'Sun Rank'), name, bar));
  el.addEventListener('click', () => {
    if (!featureUnlocked(ctx.save(), 'profile')) {
      ctx.sound('deny');
      ctx.toast(`Profile: ${featureHint('profile')}`, { icon: 'lock', tone: 'ink' });
      return;
    }
    // From whichever screen shows the badge, when the Profile may open from there.
    const from = (el.closest('.sui') as HTMLElement | null)?.dataset.screen as ScreenId | undefined;
    if (from && from !== 'profile' && isLegalTransition(from, 'profile')) {
      ctx.sound('tap');
      ctx.go('profile');
    }
  });
  const update = (save: Save): void => {
    const v = rankView(save);
    num.textContent = String(v.level);
    num.classList.toggle('medal--sm', v.level >= 100);
    name.textContent = v.title;
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, v.fraction)) * 100)}%`;
    el.setAttribute('aria-label', `Sun Rank ${v.level}, ${v.title}: ${v.into} of ${v.need} XP. Profile`);
  };
  update(ctx.save());
  return { el, update };
}

const frame = (): Promise<number> => new Promise((done) => requestAnimationFrame(done));
const wait = (ms: number): Promise<void> => new Promise((done) => window.setTimeout(done, ms));

/**
 * The Results XP meter: fills by the run's XP, rolls over on a rank up (the rankUp sound, the medal's
 * pop and a RANK UP! sticker), ticking as it goes. `show` resolves once it has settled (at once
 * under reduced motion). The lighter segment on the bar is what this run added within the rank shown.
 */
export function xpMeter(ctx: UiContext): { el: HTMLElement; show(o: GamifyOutcome | undefined, save?: Save): Promise<void> } {
  const num = medal('', { className: 'xp-medal' });
  const title = h('span', { class: 'rank-name' });
  const gainText = h('span', { class: 'gt xp-gain-t' });
  const gain = h('span', { class: 'xp-gain', 'aria-hidden': 'true' }, kitShape('burst', 'xp-gain-bg'), gainText);
  const fill = h('i');
  const added = h('i', { class: 'bar-gain' });
  const count = h('span', { class: 'num bar-label' });
  const next = h('span', { class: 'xp-next' });
  const el = h(
    'div',
    { class: 'xp-meter', role: 'group' },
    num,
    h(
      'div',
      { class: 'xp-foot' },
      h('span', { class: 'bar bar--violet xp-track' }, fill, added, count),
      h('span', { class: 'xp-title' }, h('span', { class: 'rank-kicker' }, 'Sun Rank'), title),
      next,
    ),
    gain,
    h('span', { class: 'sticker xp-pop', 'aria-hidden': 'true' }, 'Rank up!'),
  );
  let token = 0;
  /** Where this run's gain starts (total XP); after a roll-over the segment starts at the rank's left end. */
  let from0 = 0;
  const paint = (xp: number): number => {
    const level = rankForXp(xp);
    const start = rankStartXp(level);
    const into = xp - start;
    const need = rankNeed(level);
    const n = rankReward(level + 1);
    const pct = (v: number): string => `${((100 * v) / need).toFixed(1)}%`;
    const g0 = Math.max(0, from0 - start);
    num.textContent = String(level);
    num.classList.toggle('medal--sm', level >= 100);
    title.textContent = rankTitle(level);
    fill.style.width = pct(into);
    added.style.left = pct(g0);
    added.style.width = pct(Math.max(0, into - g0));
    count.textContent = `${Math.floor(into)} / ${need} XP`;
    next.textContent = `Rank ${level + 1}: ${n.kind === 'globe' ? 'Snow Globe' : `+${n.amount} Snow`}`;
    return level;
  };
  const rankUp = (): void => {
    el.classList.remove('is-rankup');
    void el.offsetWidth;
    el.classList.add('is-rankup');
    ctx.sound('rankUp');
  };
  return {
    el,
    async show(o) {
      const my = ++token;
      el.classList.remove('is-rankup');
      hide(el, !o);
      if (!o) return;
      const end = o.xpBefore + o.xpGained;
      const up = o.rankAfter > o.rankBefore;
      from0 = o.xpBefore;
      gainText.textContent = `+${o.xpGained} XP`;
      hide(gain, o.xpGained <= 0);
      el.setAttribute('aria-label', `Sun Rank ${rankForXp(end)}, ${rankTitle(rankForXp(end))}: plus ${o.xpGained} XP${up ? ', rank up' : ''}`);
      if (ctx.reducedMotion() || o.xpGained <= 0) {
        paint(end);
        if (up) rankUp();
        return;
      }
      // One segment per rank crossed: fill to the rank's end, roll over, fill on.
      let level = paint(o.xpBefore);
      for (let from = o.xpBefore; from < end; ) {
        const to = Math.min(end, rankStartXp(level + 1));
        const ms = 380 + (520 * (to - from)) / rankNeed(level);
        const t0 = performance.now();
        let tick = 0;
        for (let t = 0; t < 1; ) {
          await frame();
          if (my !== token) return;
          t = Math.min(1, (performance.now() - t0) / ms);
          paint(Math.min(to - 0.001, from + (to - from) * (1 - (1 - t) ** 3)));
          if (t - tick >= 0.16) {
            tick = t;
            ctx.sound('tick');
          }
        }
        from = to;
        if (to === rankStartXp(level + 1)) {
          level = paint(to);
          rankUp();
          await wait(520);
          if (my !== token) return;
        }
      }
      paint(end);
    },
  };
}

/** Puts (n > 0) or clears a claim dot with the count on a button. */
export function claimDot(el: HTMLElement, n: number): void {
  el.dataset.dot = n > 0 ? String(Math.min(n, 9)) : '';
  el.classList.toggle('has-dot', n > 0);
}

// ---------------------------------------------------------------------------------------------
// The reward reveal
// ---------------------------------------------------------------------------------------------

/** The shake and swirl, then the burst (ms). */
const SHAKE_MS = 1100;
const BURST_MS = 380;
const FLAKES = 14;

/** Reveals queue behind each other (a claim during the Results reveal waits its turn). */
let queue: Promise<void> = Promise.resolve();

/**
 * Shows the rewards one at a time in the reward reveal overlay (a Snow Globe shakes and opens),
 * resolving once the player has dismissed the last. A 'globe' reward opens its globes (meta
 * openGlobe through cb.updateSave) one by one. A tap or a key skips the animation, the next moves on.
 */
export function revealRewards(ctx: UiContext, rewards: readonly Reward[]): Promise<void> {
  // One step per globe (each opened as it shows), one per other reward.
  const steps = rewards.flatMap((r) => Array<Reward>(r.kind === 'globe' ? Math.min(r.amount, 20) : Math.min(r.amount, 1)).fill(r));
  if (steps.length === 0) return Promise.resolve();
  const run = queue.then(() => reveal(ctx, steps));
  queue = run.catch(() => {});
  return run;
}

/** Opens one waiting globe through the integrator; null when none is left. */
function openOne(ctx: UiContext): Reward | null {
  let got: Reward | null = null;
  ctx.cb.updateSave((s) => {
    const o = openGlobe(s);
    got = o?.reward ?? null;
    return o?.save ?? s;
  });
  return got;
}

/** `steps`: the rewards to show; a 'globe' step opens one globe. */
function reveal(ctx: UiContext, steps: readonly Reward[]): Promise<void> {
  const root = (document.querySelector('.sui') as HTMLElement | null) ?? document.body;
  const layer = root.querySelector<HTMLElement>('.screens');
  const wasInert = layer?.hasAttribute('inert') ?? false;
  const previous = document.activeElement as HTMLElement | null;

  // The kicker is a small red ribbon (its band holds the words); the prize lands on a card framed
  // in its rarity's colour, the rarity word hung under it as a tag (the sub-line says it too).
  const kicker = ribbon('', { tone: 'red', size: 'sm', tag: 'p', bandClass: 'rv-kicker', className: 'rv-ribbon' });
  const name = h('p', { class: 'gt rv-name' });
  const sub = h('p', { class: 'rv-sub' });
  const count = h('p', { class: 'rv-count' });
  const prize = h('div', { class: 'rv-item' });
  const tierTag = h('span', { class: 'tag rv-tag', 'aria-hidden': 'true' });
  const card = h('div', { class: 'panel rv-prize' }, prize, tierTag);
  const flakes = h('div', { class: 'rv-flakes', 'aria-hidden': 'true' });
  for (let i = 0; i < FLAKES; i++) flakes.append(h('i', { style: `--i:${i}` }));
  const next = h('button', { type: 'button', class: 'btn btn--primary btn--xl rv-next' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const el = h(
    'div',
    { class: 'rv pe', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reward' },
    h('div', { class: 'rv-scrim' }),
    h('div', { class: 'rv-frame' }, h('div', { class: 'rv-stage' }, kicker.el,
      h('div', { class: 'rv-art' }, h('div', { class: 'burst rv-rays' }), h('div', { class: 'rv-globe' }, globeSvg()), flakes, card),
      name, sub, count, next, live)),
  );
  root.append(el);
  if (layer) setFlag(layer, 'inert', true);

  return new Promise<void>((resolve) => {
    let i = -1;
    let shaking = false;
    let timer = 0;

    const show = (): void => {
      shaking = false;
      window.clearTimeout(timer);
      el.classList.remove('is-shake');
      el.classList.add('is-open');
      next.focus({ preventScroll: true });
      ctx.sound('reward');
    };

    const land = (r: Reward): void => {
      const item = r.cosmetic ? getCosmetic(r.cosmetic) : undefined;
      el.dataset.tier = item ? rarity(item) : 'snow';
      tierTag.textContent = item ? RARITY_LABEL[rarity(item)] : '';
      hide(tierTag, !item);
      setChildren(prize, item ? cosmeticSwatch(item) : h('span', { class: 'num' }, artIcon('snow'), `+${r.amount}`));
      name.textContent = item ? item.name : `${r.amount} Snow`;
      sub.textContent = item ? `${RARITY_LABEL[rarity(item)]} · new in your Wardrobe` : 'Added to your wallet';
      live.textContent = `${kicker.band.textContent}: ${name.textContent}`;
    };

    const step = (): void => {
      const s = steps[++i];
      if (s === undefined) {
        close();
        return;
      }
      el.classList.remove('is-open', 'is-shake', 'is-burst');
      count.textContent = steps.length > 1 ? `${i + 1} of ${steps.length}` : '';
      kicker.band.textContent = s.title;
      next.textContent = i + 1 < steps.length ? 'Next' : 'Collect';
      const globe = s.kind === 'globe';
      const got = globe ? openOne(ctx) : s;
      if (!got) {
        step();
        return;
      }
      land(got);
      if (!globe || ctx.reducedMotion()) {
        if (globe) ctx.sound('open');
        show();
        return;
      }
      shaking = true;
      void el.offsetWidth;
      el.classList.add('is-shake');
      timer = window.setTimeout(() => {
        ctx.sound('open');
        el.classList.add('is-burst');
        timer = window.setTimeout(show, BURST_MS);
      }, SHAKE_MS);
    };

    // A tap or Enter/Space/Escape: skip the animation to the prize, else move on.
    const advance = (): void => (shaking ? show() : step());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' || ['Escape', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key !== 'Tab' && !e.repeat) advance();
      }
    };

    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('is-out');
      window.setTimeout(() => el.remove(), 200);
      if (layer && !wasInert) setFlag(layer, 'inert', false);
      previous?.focus({ preventScroll: true });
      resolve();
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      advance();
    });
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => el.classList.add('is-on'));
    step();
  });
}

/** Opens every waiting Snow Globe in the reveal. */
export function openGlobes(ctx: UiContext): Promise<void> {
  return revealRewards(ctx, [{ kind: 'globe', amount: ctx.save().gamify.globes, title: 'Snow Globe' }]);
}

/** Claims today's streak reward (through cb.updateSave) and reveals it. Resolves at once when nothing is due. */
export function claimDailyReward(ctx: UiContext): Promise<void> {
  let rewards: Reward[] = [];
  ctx.cb.updateSave((s) => {
    const c = claimDaily(s, ctx.today());
    rewards = c?.rewards ?? [];
    return c?.save ?? s;
  });
  if (rewards.length > 0) ctx.sound('claim');
  return revealRewards(ctx, rewards);
}

/**
 * The 7-day streak calendar with today's Claim button (Missions, Profile; the Title may show it too).
 * Its look (docs/UI_V2.md §10.9, styles/missions.css): claimed days are green candy plates with a
 * check, today a raised gold plate, future days cream plates with the Snow gem, and Day 7 a wide
 * violet plate holding the Snow Globe.
 */
export function streakCard(ctx: UiContext): { el: HTMLElement; update(save: Save): void } {
  const days = h('ol', { class: 'streak-days' });
  const countEl = h('span', { class: 'card-count' });
  const note = h('p', { class: 'card-note' });
  const claim = button(ctx, { label: 'Claim', icon: 'gift', variant: 'primary', size: 'lg', className: 'streak-claim', sound: null, onPress: () => void claimDailyReward(ctx) });
  const el = h('section', { class: 'card streak-card' }, h('h3', { class: 'card-title' }, 'Daily streak', countEl), days, h('div', { class: 'streak-foot' }, note, claim));
  const update = (save: Save): void => {
    const v = streakView(save, ctx.today());
    countEl.textContent = v.count > 0 ? `${v.count} ${v.count === 1 ? 'day' : 'days'}` : '';
    setChildren(
      days,
      ...v.days.map((d) => {
        const globe = d.reward.kind === 'globe';
        return h(
          'li',
          {
            class: `streak-day plate is-${d.state}${globe ? ' is-globe' : ''}`,
            'aria-label': `Day ${d.day}: ${globe ? 'a Snow Globe' : `${d.reward.amount} Snow`}${d.state === 'today' ? ', ready' : d.state === 'claimed' ? ', claimed' : ''}`,
          },
          h('small', { 'aria-hidden': 'true' }, `Day ${d.day}`),
          d.state === 'claimed' ? artIcon('check') : globe ? globeSvg('globe-mini') : artIcon('snow'),
          h('span', { 'aria-hidden': 'true' }, globe ? 'Globe' : `+${d.reward.amount}`),
        );
      }),
    );
    hide(claim, !v.claimable);
    note.textContent = !v.claimable
      ? `Come back tomorrow for Day ${(v.day % 7) + 1}.${v.freezeUsed ? '' : ' Miss one day and a frozen day keeps the streak.'}`
      : v.broken
        ? 'A day was missed, so the streak starts again. Claim today to begin.'
        : v.freezing
          ? 'You missed a day: your free frozen day keeps the streak alive.'
          : 'Today’s reward is ready. Day 7 holds a Snow Globe.';
  };
  update(ctx.save());
  return { el, update };
}
