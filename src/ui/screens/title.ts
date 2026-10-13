// Title overlay over the live dawn scene (GDD §4-§5, V1_PLAN §8.3-§8.4, v1.3 Journey-first).
// The primary action plays the next Journey level ("Level 4"; Space/Enter too); the map and Endless
// sit beside it, the tray holds Daily, Missions, Wardrobe and Settings. The top bar holds the Sun
// Rank badge (opens the Profile), the daily reward when one waits, and the Snow wallet (v1.4).
// Progressive disclosure (v1.4): a feature still locked (meta/gamify featureUnlocked) shows a lock
// and says how to unlock it; while nothing is unlocked yet the Title is Play (and Settings) only. A
// feature unlocked by progress wears a NEW mark until opened (kept in the save). Only the controls take
// pointer events: a press anywhere else reaches the canvas and starts an endless run (the challenge
// while a challenge banner is up; the next level while Endless is locked). Tray and mode buttons activate on click with < 8 px of travel,
// and a sideways drag that starts on one is handed to the canvas.

import { formatScore, formatTimeOfDay, splitMinutes, type DayPlan } from '../../core/index.ts';
import {
  activeMissionViews,
  CAMPAIGN_STARS_MAX,
  continueLevel,
  dailyStatus,
  nextGoal,
  nextRunEased,
  totalStars,
} from '../../meta/progression.ts';
import { claimables, featureHint, featureIsNew, featureName, featureUnlocked, markFeatureSeen, type Feature } from '../../meta/gamify.ts';
import type { Save } from '../../meta/saveTypes.ts';
import { logoLayers } from '../art.ts';
import { h, setChildren, setFlag, svgFromMarkup } from '../dom.ts';
import { claimDailyReward, claimDot, rankBadge } from '../gamify.ts';
import { icon, type IconName } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import type { ScreenId } from '../types.ts';
import { challengeGoalText, planText } from '../labels.ts';
import { button, countUp, hide, setButtonLabel } from '../widgets.ts';

/** Travel (px) after which a press is no longer a tap. */
const TAP_SLOP = 8;
/** Horizontal travel (px) that turns a press on a tray button into a canvas drag. */
const HANDOFF_DX = 10;
/** Best score shows once onboarding (gentle runs 0-2) is over: no score pressure before that. */
const BEST_CHIP_RUNS = 3;
/** Gap (px) kept between the challenge banner and the chips. */
const BANNER_GAP = 6;
const TAGLINE = "Don't melt Nubs.";
/** Shown under the tagline for mouse and keyboard players (the arrows play the level until Endless unlocks). */
export const KEY_HINT = 'Space: play the level · ← →: Endless · Esc: back';
const KEY_HINT_LOCKED = 'Space or ← →: play the level · Esc: back';

/**
 * The logo as stacked layers (art.ts logoLayers): the sun's bob, the rays' spin and the shadow's
 * sway animate HTML wrappers' transforms only, so the compositor runs them without relayout or
 * SVG repaints every frame.
 */
function logo(): HTMLElement {
  const l = logoLayers();
  const origin = `${l.origin.x} ${l.origin.y}`;
  const rays = h('span', { class: 'logo-layer logo-rays' }, svgFromMarkup(l.rays));
  const sun = h('span', { class: 'logo-layer logo-sun' }, svgFromMarkup(l.bloom), rays, svgFromMarkup(l.face));
  sun.style.transformOrigin = origin;
  rays.style.transformOrigin = origin;
  return h('h1', { class: 'logo' }, sun, h('span', { class: 'logo-layer logo-drop' }, svgFromMarkup(l.shadow)), svgFromMarkup(l.word));
}

/** An element's layout box bottom in viewport px, ignoring transforms (the banner pops in with a scale). */
function layoutBottom(e: HTMLElement): number {
  let y = 0;
  let p: HTMLElement = e;
  for (let next = p.offsetParent as HTMLElement | null; next; next = p.offsetParent as HTMLElement | null) {
    y += p.offsetTop;
    p = next;
  }
  return p.getBoundingClientRect().top + y + e.offsetHeight;
}

export interface TitleScreen extends Screen {
  /** The Title run's Day-1 plan for the forecast chip (null hides it). */
  setRunPreview(p: DayPlan | null): void;
}

export function createTitleScreen(ctx: UiContext): TitleScreen {
  /** The menu the Title was last left for: keyboard focus returns to its button. */
  let returnFrom: ScreenId | null = null;

  const run = (kind: 'endless' | 'challenge'): void => {
    ctx.go('play');
    ctx.cb.startRun(kind);
  };
  const playLevel = (): void => {
    ctx.go('play');
    ctx.cb.startRun('campaign', undefined, continueLevel(ctx.save()));
  };

  /**
   * Press handling shared by the tray and mode buttons: a tap (under 8 px of travel) activates on
   * click; a sideways drag that starts on the button is handed to the canvas.
   */
  const pressable = <T extends HTMLButtonElement>(btn: T, onActivate: () => void, sound = true): T => {
    let press: { id: number; x: number; y: number } | null = null;
    let moved = false;
    btn.addEventListener('pointerdown', (e) => {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      moved = false;
    });
    btn.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) moved = true;
      if (Math.abs(dx) > HANDOFF_DX) {
        press = null;
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
        ctx.cb.dragHandoff(e);
      }
    });
    const end = (): void => {
      press = null;
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('click', () => {
      if (moved) {
        moved = false;
        return;
      }
      if (sound) ctx.sound('tap');
      onActivate();
    });
    return btn;
  };
  /** A mode pill: icon, label and the press handling above. */
  const pill = (cls: string, iconName: IconName, label: HTMLElement, onActivate: () => void): HTMLButtonElement =>
    pressable(h('button', { class: `btn ${cls} pe`, type: 'button' }, icon(iconName), label), onActivate);

  // --- Challenge banner ------------------------------------------------------------------------
  // "Sam challenges you:" — the name is isolated (<bdi>) so a right-to-left name can't reorder the line.
  const challengeName = h('bdi', null);
  const challengeGoal = h('strong', { class: 'challenge-goal' });
  const challengeNote = h('span', { class: 'challenge-note' });
  const challengePlay = button(ctx, { label: 'Play', icon: 'play', variant: 'primary', className: 'challenge-play', onPress: () => run('challenge') });
  const challengeClose = button(ctx, { label: 'Dismiss challenge', icon: 'close', round: true, sound: 'back', className: 'challenge-close', onPress: () => {
    ctx.clearChallenge();
    ctx.cb.dismissChallenge();
  } });
  const challenge = h(
    'div',
    { class: 'challenge pe', role: 'group', 'aria-label': 'Challenge' },
    h('span', { class: 'challenge-flag', 'aria-hidden': 'true' }, icon('flag')),
    h('div', { class: 'challenge-text' }, h('span', { class: 'challenge-from' }, challengeName, ' challenges you:'), challengeGoal, challengeNote),
    challengePlay,
    challengeClose,
  );

  // --- Progressive disclosure ------------------------------------------------------------------
  // A gated control: locked, it says how to unlock (featureHint) instead of opening; unlocked by
  // progress and not opened since (meta/gamify featureIsNew, kept in the save), it wears a NEW mark.
  const gates: { f: Feature; el: HTMLButtonElement; name: string }[] = [];
  const isOpen = (save: Save, f: Feature): boolean => featureUnlocked(save, f);
  const deny = (text: string): void => {
    ctx.sound('deny');
    ctx.toast(text, { icon: 'lock', tone: 'ink' });
  };
  const gated = (f: Feature, open: () => void) => (): void => {
    const save = ctx.save();
    if (!isOpen(save, f)) return deny(featureHint(f));
    if (featureIsNew(save, f)) ctx.cb.updateSave((s) => markFeatureSeen(s, f));
    ctx.sound('tap');
    open();
  };
  const lockBadge = (): HTMLElement => h('span', { class: 'tray-lock', 'aria-hidden': 'true' }, icon('lock'));
  const newTag = (): HTMLElement => h('span', { class: 'new-tag', 'aria-hidden': 'true' }, 'New');

  // --- Top bar: the Sun Rank, a waiting daily reward, the wallet ----------------------------------
  const badge = rankBadge(ctx);
  const badgeSlot = h('div', { class: 'title-rank pe' }, badge.el);
  // The Profile opens from the badge once unlocked; before that the badge says how to get there.
  badgeSlot.addEventListener(
    'click',
    (e) => {
      if (featureUnlocked(ctx.save(), 'profile')) return;
      e.stopPropagation();
      deny(featureHint('profile'));
    },
    true,
  );
  // The daily streak's reward, when one waits: claimed right here (the reveal plays over the Title).
  const rewardBtn = button(ctx, { label: 'Reward', icon: 'gift', variant: 'gold', className: 'title-reward pe', ariaLabel: 'Claim the daily reward', sound: null, onPress: () => void claimDailyReward(ctx) });
  const walletValue = h('span', { class: 'num' });
  const chipSnow = h('span', { class: 'chip chip--snow', role: 'img' }, icon('snow'), walletValue);
  const hud = h('div', { class: 'title-hud' }, badgeSlot, rewardBtn, h('i', { class: 'title-hud-gap' }), chipSnow);

  // --- Chips -------------------------------------------------------------------------------------
  // Best as "D3 2:40 PM", matching the HUD's compact day badge; it opens the Profile's records.
  const bestDay = h('span', { class: 'day-badge' });
  const bestValue = h('span', { class: 'num' });
  const chipBest = pressable(h('button', { class: 'chip chip--btn pe', type: 'button' }, icon('trophy'), bestDay, bestValue, icon('chevron', 'ic chip-chev')), () => ctx.go('profile'));
  // The other chips are read as one labeled image each (their aria-label carries the full sentence).
  const pips = h('span', { class: 'pips' });
  const chipMissions = h('span', { class: 'chip', role: 'img' }, icon('missions'), pips);
  const chips = h('div', { class: 'chips' }, chipBest, chipMissions);

  // --- The modes: the map, the next level (primary) and Endless ----------------------------------
  const starsValue = h('span', { class: 'num' });
  const mapBtn = pill('journey-pill', 'map', starsValue, () => {
    ctx.go('journey');
    ctx.cb.openJourney();
  });
  const playBtn = pill('btn--primary play-pill', 'play', h('span', { class: 'btn-label' }), playLevel);
  const endlessBtn = pressable(
    h('button', { class: 'btn endless-pill pe', type: 'button' }, icon('endless'), h('span', { class: 'btn-label' }, 'Endless'), lockBadge(), newTag()),
    gated('endless', () => run('endless')),
    false,
  );
  gates.push({ f: 'endless', el: endlessBtn, name: 'Endless run' });
  const modes = h('div', { class: 'modes' }, mapBtn, playBtn, endlessBtn);

  // --- Tray --------------------------------------------------------------------------------------
  const dailyDot = h('span', { class: 'tray-dot', 'aria-hidden': 'true' });
  const trayButton = (label: string, iconName: IconName, onActivate: () => void, f?: Feature, extras: HTMLElement[] = []): HTMLButtonElement => {
    const btn = pressable(
      h(
        'button',
        { class: 'tray-btn pe', type: 'button', 'aria-label': label },
        h('span', { class: 'tray-disc' }, icon(iconName), ...extras, ...(f ? [lockBadge(), newTag()] : [])),
        h('span', { class: 'tray-label', 'aria-hidden': 'true' }, label),
      ),
      f ? gated(f, onActivate) : onActivate,
      f === undefined,
    );
    if (f) gates.push({ f, el: btn, name: label });
    return btn;
  };
  const dailyBtn = trayButton('Daily', 'daily', () => ctx.go('daily'), 'daily', [dailyDot]);
  const trayFor: Partial<Record<ScreenId, HTMLElement>> = {
    profile: badge.el,
    journey: mapBtn,
    daily: dailyBtn,
    missions: trayButton('Missions', 'missions', () => ctx.go('missions'), 'missions'),
    wardrobe: trayButton('Wardrobe', 'wardrobe', () => ctx.go('wardrobe'), 'wardrobe'),
    settings: trayButton('Settings', 'settings', () => ctx.go('settings')),
  };
  const tray = h('nav', { class: 'tray', 'aria-label': 'Menu' }, dailyBtn, trayFor.missions, trayFor.wardrobe, trayFor.settings);

  // After onboarding the tagline names the next goal; the forecast chip previews the endless run's Day 1.
  const tagline = h('p', { class: 'tagline' }, TAGLINE);
  const forecast = h('p', { class: 'forecast-chip', hidden: true });
  const keys = h('p', { class: 'title-keys' }, KEY_HINT);
  const gap = (): HTMLElement => h('i', { class: 'title-gap', 'aria-hidden': 'true' });
  const bottomCluster = h('div', { class: 'title-bottom' }, chips, gap(), modes, gap(), tray);
  const el = h(
    'section',
    { class: 'scr scr-title' },
    hud,
    h('div', { class: 'title-top' }, logo(), tagline, forecast, keys, challenge),
    bottomCluster,
  );
  let preview: DayPlan | null = null;
  /** The wallet as last shown (it counts up from there); null before the first render. */
  let shownWallet: number | null = null;
  let stopCount = (): void => {};
  const celebrated = new Set<Feature>();
  /** The tagline shows the next goal (it gives way first when the Title is crowded). */
  let goalTagline = false;

  /**
   * Measures and resolves crowding (called on enter, refresh, resize and the first key press; reads
   * layout, never per frame):
   * - the bottom cluster stays below Nubs' halo (--nubs-y + --halo-r): gaps shrink first (CSS),
   *   then the tray labels go (the buttons keep their aria-labels), then the tray discs and the
   *   mode pills shrink (is-tight), then the chips row goes (tiny screens);
   * - a tall challenge banner drops the goal tagline, shrinks the logo, drops the forecast chip,
   *   then the tagline, to stay clear of the chips.
   */
  function fit(): void {
    if (!el.classList.contains('is-on')) return;
    bottomCluster.classList.remove('no-labels', 'is-tight', 'no-chips');
    el.classList.remove('is-compact', 'no-tagline', 'no-forecast');

    // --nubs-y is in viewport px, like the rects.
    const nubsY = ctx.rootPx('--nubs-y');
    const haloR = ctx.rootPx('--halo-r');
    if (nubsY !== null && haloR !== null) {
      // The chips are the cluster's top row; when the column can't hold it all they overflow
      // upward, so measure them rather than the (capped) cluster box. 1 px covers the rounding of
      // the published vars.
      const limit = nubsY + haloR + 1;
      const top = (): number => (bottomCluster.classList.contains('no-chips') ? modes : chips).getBoundingClientRect().top;
      for (const step of ['no-labels', 'is-tight', 'no-chips']) if (top() < limit) bottomCluster.classList.add(step);
    }
    // A tall banner (large text, small phone) must not reach the chips.
    if (ctx.challenge() !== null) {
      const steps = [...(goalTagline ? ['no-tagline'] : []), 'is-compact', 'no-forecast', 'no-tagline'];
      for (const step of steps) if (layoutBottom(challenge) + BANNER_GAP > chips.getBoundingClientRect().top) el.classList.add(step);
    }
  }

  function refresh(): void {
    const save = ctx.save();
    const s = save.stats;

    // The best of the rules the next run is played at: the eased best (hatched) on a comfort rung
    // or the warm-up, the standard best at standard rules; the other one when that is still empty.
    const easedNext = nextRunEased(save);
    const eased = s.easedBest > 0 && (easedNext || s.bestMinutes <= 0);
    const shownBest = eased ? s.easedBest : s.bestMinutes;
    hide(chipBest, s.runs < BEST_CHIP_RUNS || shownBest <= 0);
    chipBest.classList.toggle('is-eased', eased);
    const best = splitMinutes(shownBest);
    bestDay.textContent = `D${best.day}`;
    bestValue.textContent = formatTimeOfDay(best.minute);
    chipBest.setAttribute('aria-label', `Profile, ${eased ? 'eased best' : 'best'} ${formatScore(shownBest)}`);

    const missions = activeMissionViews(save);
    setChildren(pips, ...missions.map((m) => {
      const p = h('i', { class: `pip${m.done ? ' is-done' : ''}` });
      p.style.setProperty('--p', String(m.fraction));
      return p;
    }));
    chipMissions.setAttribute('aria-label', `Missions: ${missions.filter((m) => m.done).length} of ${missions.length} complete`);

    const goal = nextGoal(save, ctx.today());
    goalTagline = goal !== null;
    tagline.textContent = goal?.text ?? TAGLINE;
    tagline.classList.toggle('is-goal', goalTagline);
    renderPreview();

    // The wallet counts up to what the last run earned.
    hide(chipSnow, s.runs === 0);
    stopCount();
    stopCount = countUp(walletValue, shownWallet ?? s.wallet, s.wallet, ctx);
    shownWallet = s.wallet;
    chipSnow.setAttribute('aria-label', `${s.wallet} Snow`);

    const level = continueLevel(save);
    setButtonLabel(playBtn, `Level ${level}`);
    playBtn.setAttribute('aria-label', `Play Level ${level}`);
    const stars = totalStars(save);
    starsValue.textContent = stars > 0 ? `${stars}★` : 'Map';
    mapBtn.setAttribute('aria-label', `Journey map, ${stars} of ${CAMPAIGN_STARS_MAX} stars`);

    renderGates(save);
    keys.textContent = isOpen(save, 'endless') ? KEY_HINT : KEY_HINT_LOCKED;
    const unplayed = isOpen(save, 'daily') && !dailyStatus(save, ctx.today()).played;
    hide(dailyDot, !unplayed);
    if (unplayed) dailyBtn.setAttribute('aria-label', "Daily: today's is new");

    const banner = ctx.challenge();
    hide(challenge, banner === null);
    el.setAttribute('aria-label', banner ? 'Press Space to start the challenge.' : `Press Space to play Level ${level}.`);
    if (banner) {
      challengeName.textContent = banner.name || 'A friend';
      challengeGoal.textContent = challengeGoalText(banner.minutes);
      const note = banner.warmup ? 'Warm-up run first' : (banner.note ?? '');
      challengeNote.textContent = note;
      hide(challengeNote, note === '');
    }
    fit();
  }

  /**
   * Locks, NEW marks and claim dots. While nothing is unlocked yet (a first-time player) the locked
   * controls, the map and the top bar stay hidden: the Title is Play (and Settings) only.
   */
  function renderGates(save: Save): void {
    const open = gates.map((g) => isOpen(save, g.f));
    const fresh = !open.some(Boolean) && !featureUnlocked(save, 'profile') && totalStars(save) === 0;
    gates.forEach((g, i) => {
      const on = open[i] as boolean;
      const isNew = on && featureIsNew(save, g.f);
      g.el.classList.toggle('is-locked', !on);
      g.el.classList.toggle('is-new', isNew);
      hide(g.el, !on && fresh);
      // The name stays the accessible name; "New" is its description.
      g.el.setAttribute('aria-label', on ? g.name : `${g.name} (locked)`);
      setFlag(g.el, 'aria-description', false);
      if (isNew) g.el.setAttribute('aria-description', 'New');
    });
    hide(mapBtn, fresh);
    hide(chipMissions, !featureUnlocked(save, 'missions'));
    hide(hud, fresh);
    badge.update(save);
    const c = claimables(save);
    claimDot(badge.el, c.globes + c.trophies);
    claimDot(trayFor.missions?.firstElementChild as HTMLElement, c.missions);
    claimDot(trayFor.wardrobe?.firstElementChild as HTMLElement, c.wardrobe);
    // The gold button is the daily's signal itself (a dot would be clipped by the button's rounding).
    hide(rewardBtn, !c.daily);
  }

  function renderPreview(): void {
    hide(forecast, preview === null);
    forecast.textContent = preview ? `Forecast: ${planText(preview)}` : '';
  }

  return {
    el,
    setRunPreview(p) {
      if (p?.biome === preview?.biome && p?.forecast === preview?.forecast) return;
      preview = p;
      renderPreview();
      fit();
    },
    enter(from) {
      returnFrom = from;
      refresh();
      // A feature unlocked since the last visit is announced once per session (its NEW mark stays).
      const fresh = gates.filter((g) => g.el.classList.contains('is-new') && !celebrated.has(g.f));
      for (const g of fresh) {
        celebrated.add(g.f);
        ctx.toast(`${featureName(g.f)} unlocked!`, { icon: 'star', tone: 'gold', duration: 3200 });
      }
      if (fresh.length > 0) ctx.sound('unlock');
    },
    refresh,
    leave: () => stopCount(),
    relayout: fit,
    activate() {
      if (ctx.challenge() !== null) run('challenge');
      else playLevel();
      return true;
    },
    // Back from a menu: the button that opened it. Otherwise nothing is focused, so Space and Enter
    // play the level (or the challenge) instead of pressing a button.
    initialFocus: () => (returnFrom !== null ? (trayFor[returnFrom] ?? null) : null),
  };
}
