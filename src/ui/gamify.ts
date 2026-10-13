// v1.4 gamification widgets (docs/V1_4_PLAN.md). CONTRACT FILE: the four first signatures are
// fixed for the v1.4 builders; the rest is additive. The UX builder places these widgets (Title,
// Results, Journey); this file makes them look (gamify.css) and behave:
// - rankBadge: the Sun Rank in a progress ring; opens the Profile.
// - xpMeter: the Results XP bar that fills by the run's XP and rolls over on a rank up.
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
import { h, setChildren, setFlag, svgFromMarkup } from './dom.ts';
import { icon } from './icons.ts';
import type { UiContext } from './screen.ts';
import { cosmeticSwatch } from './swatches.ts';
import { isLegalTransition } from './transitions.ts';
import type { ScreenId } from './types.ts';
import { button, hide } from './widgets.ts';

/** The screen the UI shows now (ui.ts publishes it on the root). */
const screenOf = (el: Element): ScreenId | null => ((el.closest('.sui') ?? document.querySelector('.sui')) as HTMLElement | null)?.dataset.screen as ScreenId | null;

let globeIds = 0;

/** The Snow Globe: a glass dome with Nubs and snow inside, on a gold stand. */
export function globeSvg(className = 'globe-art'): SVGSVGElement {
  // Gradient ids are unique per copy: a hidden copy's gradients would blank the others.
  const n = ++globeIds;
  return svgFromMarkup(`<svg class="${className}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
<defs><radialGradient id="gg${n}" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#dff1ff" stop-opacity=".75"/><stop offset="1" stop-color="#9ad8ff" stop-opacity=".85"/></radialGradient>
<linearGradient id="gb${n}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd76a"/><stop offset="1" stop-color="#d99a12"/></linearGradient></defs>
<ellipse cx="60" cy="111" rx="34" ry="5" fill="#2b2140" opacity=".16"/>
<path d="M30 92h60l6 16H24Z" fill="url(#gb${n})"/><rect x="26" y="88" width="68" height="8" rx="4" fill="#e8a91e"/>
<circle cx="60" cy="52" r="42" fill="url(#gg${n})" stroke="#fff" stroke-width="3"/>
<path d="M22 66q38 14 76 0v4a42 42 0 0 1-76 0Z" fill="#fff"/>
<circle cx="60" cy="62" r="11" fill="#fff" stroke="#c9d8f0" stroke-width="1.5"/><circle cx="60" cy="45" r="8" fill="#fff" stroke="#c9d8f0" stroke-width="1.5"/>
<path d="M51 52q9 4 18 0l1 4q-10 4-20 0Z" fill="#e8475a"/><path d="M60 46l7 2-7 1.6Z" fill="#ff8a2b"/>
<circle cx="57" cy="43" r="1.3" fill="#2b2b33"/><circle cx="63" cy="43" r="1.3" fill="#2b2b33"/>
<path d="M36 30a30 30 0 0 1 18-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".9"/>
</svg>`);
}

// ---------------------------------------------------------------------------------------------
// Rank badge
// ---------------------------------------------------------------------------------------------

/** A ring of `fraction` around the rank number (stroke dashes over a 100-unit path). */
export function rankRing(): { el: HTMLElement; set(level: number, fraction: number): void } {
  const svg = svgFromMarkup(
    '<svg class="rank-ring-svg" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" pathLength="100" class="rank-ring-bg"/><circle cx="20" cy="20" r="17" pathLength="100" class="rank-ring-fg"/></svg>',
  );
  const num = h('span', { class: 'rank-num num' });
  const el = h('span', { class: 'rank-ring' }, svg, num);
  return {
    el,
    set(level, fraction) {
      num.textContent = String(level);
      el.style.setProperty('--p', String(Math.round(Math.max(0, Math.min(1, fraction)) * 100)));
    },
  };
}

/** The rank badge (level number in a progress ring, rank name). Tapping it opens the Profile. */
export function rankBadge(ctx: UiContext): { el: HTMLElement; update(save: Save): void } {
  const r = rankRing();
  const name = h('span', { class: 'rank-name' });
  const el = h('button', { type: 'button', class: 'rank-badge pe' }, r.el, h('span', { class: 'rank-text' }, h('span', { class: 'rank-kicker' }, 'Sun Rank'), name));
  el.addEventListener('click', () => {
    if (!featureUnlocked(ctx.save(), 'profile')) {
      ctx.sound('deny');
      ctx.toast(`Profile: ${featureHint('profile')}`, { icon: 'lock', tone: 'ink' });
      return;
    }
    const from = screenOf(el);
    if (from && from !== 'profile' && isLegalTransition(from, 'profile')) {
      ctx.sound('tap');
      ctx.go('profile');
    }
  });
  const update = (save: Save): void => {
    const v = rankView(save);
    r.set(v.level, v.fraction);
    name.textContent = v.title;
    el.setAttribute('aria-label', `Sun Rank ${v.level}, ${v.title}: ${v.into} of ${v.need} XP. Profile`);
  };
  update(ctx.save());
  return { el, update };
}

// ---------------------------------------------------------------------------------------------
// XP meter
// ---------------------------------------------------------------------------------------------

const wait = (ms: number): Promise<void> => new Promise((done) => window.setTimeout(done, ms));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** "Next: Rank 5 · Snow Globe" / "Next: Rank 4 · +30 Snow". */
function nextRankText(level: number): string {
  const r = rankReward(level + 1);
  return `Rank ${level + 1}: ${r.kind === 'globe' ? 'Snow Globe' : `+${r.amount} Snow`}`;
}

/**
 * The Results XP meter: fills by the run's XP, rolls over on a rank up (with the rankUp sound and a
 * flash), ticking as it goes. `show` resolves once it has settled (at once under reduced motion).
 */
export function xpMeter(ctx: UiContext): { el: HTMLElement; show(o: GamifyOutcome | undefined, save: Save): Promise<void> } {
  const r = rankRing();
  const title = h('span', { class: 'xp-title' });
  const gain = h('span', { class: 'xp-gain num' });
  const fill = h('i', { class: 'xp-fill' });
  const count = h('span', { class: 'xp-count num' });
  const next = h('span', { class: 'xp-next' });
  const pop = h('span', { class: 'xp-pop', 'aria-hidden': 'true' }, 'Rank up!');
  const el = h(
    'div',
    { class: 'xp-meter', role: 'group', 'aria-label': 'Sun Rank' },
    h('div', { class: 'xp-row' }, r.el, h('span', { class: 'xp-head' }, h('span', { class: 'rank-kicker' }, 'Sun Rank'), title), gain, pop),
    h('span', { class: 'xp-bar', 'aria-hidden': 'true' }, fill),
    h('div', { class: 'xp-foot' }, count, next),
  );
  let token = 0;
  const paint = (xp: number): number => {
    const level = rankForXp(xp);
    const into = xp - rankStartXp(level);
    const need = rankNeed(level);
    r.set(level, into / need);
    title.textContent = rankTitle(level);
    fill.style.width = `${(Math.min(1, into / need) * 100).toFixed(1)}%`;
    count.textContent = `${Math.floor(into)} / ${need} XP`;
    next.textContent = nextRankText(level);
    return level;
  };
  return {
    el,
    async show(o) {
      const my = ++token;
      el.classList.remove('is-rankup');
      if (!o) {
        hide(el, true);
        return;
      }
      hide(el, false);
      const end = o.xpBefore + o.xpGained;
      gain.textContent = `+${o.xpGained} XP`;
      el.setAttribute('aria-label', `Sun Rank ${rankForXp(end)}, ${rankTitle(rankForXp(end))}: plus ${o.xpGained} XP${o.rankAfter > o.rankBefore ? ', rank up' : ''}`);
      if (ctx.reducedMotion() || o.xpGained <= 0) {
        paint(end);
        if (o.rankAfter > o.rankBefore) {
          el.classList.add('is-rankup');
          ctx.sound('rankUp');
        }
        return;
      }
      let level = paint(o.xpBefore);
      // One segment per rank crossed: fill to the rank's end, roll over, fill on.
      let from = o.xpBefore;
      while (from < end) {
        const to = Math.min(end, rankStartXp(level + 1));
        const ms = 380 + 520 * ((to - from) / rankNeed(level));
        const t0 = performance.now();
        let lastTick = 0;
        for (;;) {
          await new Promise<void>((done) => requestAnimationFrame(() => done()));
          if (my !== token) return;
          const t = Math.min(1, (performance.now() - t0) / ms);
          paint(from + (to - from) * easeOut(t) - (t < 1 ? 0 : 1e-9));
          if (t - lastTick >= 0.16 && t < 1) {
            lastTick = t;
            ctx.sound('tick');
          }
          if (t >= 1) break;
        }
        from = to;
        if (from >= rankStartXp(level + 1)) {
          level += 1;
          paint(from);
          el.classList.remove('is-rankup');
          void el.offsetWidth;
          el.classList.add('is-rankup');
          ctx.sound('rankUp');
          await wait(520);
          if (my !== token) return;
        }
      }
      paint(end);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Claim dot
// ---------------------------------------------------------------------------------------------

/** Puts (n > 0) or clears a claim dot with the count on a button. */
export function claimDot(el: HTMLElement, n: number): void {
  el.dataset.dot = n > 0 ? String(Math.min(n, 9)) : '';
  el.classList.toggle('has-dot', n > 0);
}

// ---------------------------------------------------------------------------------------------
// The reward reveal
// ---------------------------------------------------------------------------------------------

const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' } as const;
/** Shake and swirl, then the burst (ms). */
const SHAKE_MS = 1100;
const BURST_MS = 380;
const FLAKES = 14;

/** Reveals queue behind each other (a claim during the Results reveal waits its turn). */
let queue: Promise<void> = Promise.resolve();

/**
 * Shows the rewards one at a time in the reward reveal overlay (a Snow Globe shakes and opens),
 * resolving once the player has dismissed the last. A 'globe' reward opens its globes (meta
 * openGlobe through cb.updateSave) one by one; a tap skips the animation, the next tap moves on.
 */
export function revealRewards(ctx: UiContext, rewards: readonly Reward[]): Promise<void> {
  const steps = rewards.filter((r) => r.amount > 0);
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
    if (!o) return s;
    got = o.reward;
    return o.save;
  });
  return got;
}

function reveal(ctx: UiContext, rewards: readonly Reward[]): Promise<void> {
  // One step per globe; Snow and items show as they are.
  const plan: { reward: Reward; globe: boolean }[] = [];
  for (const r of rewards) {
    if (r.kind === 'globe') for (let i = 0; i < Math.min(r.amount, 20); i++) plan.push({ reward: r, globe: true });
    else plan.push({ reward: r, globe: false });
  }
  const root = (document.querySelector('.sui') as HTMLElement | null) ?? document.body;
  const layer = root.querySelector<HTMLElement>('.screens');
  const wasInert = layer?.hasAttribute('inert') ?? false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const kicker = h('p', { class: 'rv-kicker' });
  const name = h('p', { class: 'rv-name' });
  const sub = h('p', { class: 'rv-sub' });
  const count = h('p', { class: 'rv-count' });
  const prize = h('div', { class: 'rv-prize' });
  const flakes = h('div', { class: 'rv-flakes', 'aria-hidden': 'true' });
  for (let i = 0; i < FLAKES; i++) {
    const f = h('i');
    f.style.setProperty('--i', String(i));
    flakes.append(f);
  }
  const globe = h('div', { class: 'rv-globe', 'aria-hidden': 'true' }, globeSvg());
  const art = h('div', { class: 'rv-art' }, h('div', { class: 'rv-rays', 'aria-hidden': 'true' }), globe, flakes, prize);
  const next = h('button', { type: 'button', class: 'btn btn--primary btn--lg rv-next' }, h('span', { class: 'btn-label' }, 'Continue'));
  const live = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const stage = h('div', { class: 'rv-stage' }, kicker, art, name, sub, count, next, live);
  const el = h('div', { class: 'rv pe', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reward' }, h('div', { class: 'rv-scrim' }), h('div', { class: 'rv-frame' }, stage));
  root.append(el);
  if (layer) setFlag(layer, 'inert', true);

  return new Promise<void>((resolve) => {
    let i = -1;
    let phase: 'shake' | 'shown' = 'shown';
    let timer = 0;

    const show = (): void => {
      phase = 'shown';
      window.clearTimeout(timer);
      el.classList.remove('is-shake');
      el.classList.add('is-open');
      next.focus({ preventScroll: true });
    };

    const land = (r: Reward): void => {
      const item = r.kind === 'cosmetic' && r.cosmetic ? getCosmetic(r.cosmetic) : undefined;
      const tier = item ? rarity(item) : r.kind === 'snow' ? 'snow' : 'common';
      el.dataset.tier = tier;
      if (item) {
        setChildren(prize, cosmeticSwatch(item));
        name.textContent = item.name;
        sub.textContent = `${RARITY_LABEL[rarity(item)]} · new in your Wardrobe`;
      } else {
        setChildren(prize, h('span', { class: 'rv-snow' }, icon('snow'), h('span', { class: 'num' }, `+${r.amount}`)));
        name.textContent = `${r.amount} Snow`;
        sub.textContent = 'Added to your wallet';
      }
      live.textContent = `${kicker.textContent}: ${name.textContent}`;
    };

    const step = (): void => {
      i += 1;
      const s = plan[i];
      if (!s) {
        close();
        return;
      }
      el.classList.remove('is-open', 'is-shake');
      count.textContent = plan.length > 1 ? `${i + 1} of ${plan.length}` : '';
      kicker.textContent = s.reward.title;
      next.querySelector('.btn-label')!.textContent = i + 1 < plan.length ? 'Next' : 'Collect';
      if (s.globe) {
        const got = openOne(ctx);
        if (!got) {
          step();
          return;
        }
        land(got);
        if (ctx.reducedMotion()) {
          ctx.sound('open');
          show();
          ctx.sound('reward');
          return;
        }
        phase = 'shake';
        void el.offsetWidth;
        el.classList.add('is-shake');
        ctx.sound('tick');
        timer = window.setTimeout(() => {
          ctx.sound('open');
          timer = window.setTimeout(() => {
            show();
            ctx.sound('reward');
          }, BURST_MS);
          el.classList.add('is-burst');
        }, SHAKE_MS);
      } else {
        land(s.reward);
        el.classList.add('is-plain');
        show();
        ctx.sound(s.reward.kind === 'snow' ? 'claim' : 'reward');
      }
    };

    const advance = (): void => {
      if (phase === 'shake') {
        // Skip the animation: straight to the prize.
        show();
        ctx.sound('reward');
      } else {
        el.classList.remove('is-burst', 'is-plain');
        step();
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      if (!['Escape', 'Enter', ' '].includes(e.key)) {
        if (e.key === 'Tab') e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) advance();
    };

    const close = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('is-out');
      window.setTimeout(() => el.remove(), ctx.reducedMotion() ? 0 : 200);
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
  const n = ctx.save().gamify.globes;
  return revealRewards(ctx, n > 0 ? [{ kind: 'globe', amount: n, title: 'Snow Globe' }] : []);
}

/** Claims today's streak reward (through cb.updateSave) and reveals it. Resolves at once when nothing is due. */
export function claimDailyReward(ctx: UiContext): Promise<void> {
  let rewards: Reward[] = [];
  ctx.cb.updateSave((s) => {
    const c = claimDaily(s, ctx.today());
    rewards = c?.rewards ?? [];
    return c?.save ?? s;
  });
  if (rewards.length === 0) return Promise.resolve();
  ctx.sound('claim');
  return revealRewards(ctx, rewards);
}

// ---------------------------------------------------------------------------------------------
// The daily streak card
// ---------------------------------------------------------------------------------------------

/** The 7-day streak calendar with today's Claim button (Missions, Profile; the Title may show it too). */
export function streakCard(ctx: UiContext): { el: HTMLElement; update(save: Save): void } {
  const days = h('ol', { class: 'streak-days' });
  const countEl = h('span', { class: 'card-count' });
  const note = h('p', { class: 'card-note' });
  const claim = button(ctx, { label: 'Claim', icon: 'gift', variant: 'primary', className: 'streak-claim', sound: null, onPress: () => void claimDailyReward(ctx) });
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
            class: `streak-day is-${d.state}${globe ? ' is-globe' : ''}`,
            'aria-label': `Day ${d.day}: ${globe ? 'a Snow Globe' : `${d.reward.amount} Snow`}${d.state === 'claimed' ? ', claimed' : d.state === 'today' ? ', ready' : ''}`,
          },
          h('span', { class: 'streak-n', 'aria-hidden': 'true' }, `Day ${d.day}`),
          h('span', { class: 'streak-art', 'aria-hidden': 'true' }, globe ? globeSvg('globe-mini') : icon(d.state === 'claimed' ? 'check' : 'snow')),
          h('span', { class: 'streak-amt num', 'aria-hidden': 'true' }, globe ? 'Globe' : `+${d.reward.amount}`),
        );
      }),
    );
    hide(claim, !v.claimable);
    note.textContent = v.claimable
      ? v.broken
        ? 'A day was missed, so the streak starts again. Claim today to begin.'
        : v.freezing
          ? 'You missed a day: your free frozen day keeps the streak alive.'
          : `Today's reward is ready. Day 7 holds a Snow Globe.`
      : `Come back tomorrow for Day ${(v.day % 7) + 1}.${v.freezeUsed ? '' : ' Miss one day and a frozen day keeps the streak.'}`;
  };
  update(ctx.save());
  return { el, update };
}
