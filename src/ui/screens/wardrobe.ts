// Wardrobe (GDD §6, V1_1_PLAN UM6): slot tabs (Nubs' scarf, hat and nose, and the sun's Shades),
// item grid with cost/lock/owned/equipped states, buy + equip, and a try-on preview whose drawing
// is injected by the integrator (callbacks.renderWardrobePreview: Nubs, or the sun on Shades).
// Tapping an owned item equips it; tapping anything else previews it and the action button shows
// what it takes (buy / not enough Snow / achievement).
//
// The grid is built once per slot tab; selecting, buying and equipping update the tile buttons in
// place, so keyboard focus stays on the tile that was pressed.

import {
  COSMETIC_SLOTS,
  cosmeticsForSlot,
  getAchievement,
  getCosmetic,
  type Cosmetic,
  type CosmeticId,
  type CosmeticSlot,
  type Equipped,
} from '../../meta/content.ts';
import { itemState, type ItemState } from '../../meta/progression.ts';
import { h, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import type { Screen, UiContext } from '../screen.ts';
import { cosmeticSwatch } from '../swatches.ts';
import { button, menuHeader, setButtonLabel, setDisabled, snowChip } from '../widgets.ts';

const SLOT_LABEL: Record<CosmeticSlot, string> = { scarf: 'Scarf', hat: 'Hat', nose: 'Nose', shades: 'Shades' };
const PREVIEW_CSS = 168;
const STATES: readonly ItemState[] = ['equipped', 'owned', 'buyable', 'expensive', 'locked'];

const costOf = (c: Cosmetic): number => (c.unlock.kind === 'snow' ? c.unlock.cost : 0);

/** The tile's status line. Unaffordable prices carry a lock glyph, not just a muted color. */
function statusContent(c: Cosmetic, state: ItemState): { cls: string; nodes: (Node | string)[] } {
  switch (state) {
    case 'equipped':
      return { cls: 'is-equipped', nodes: [icon('check'), 'Wearing'] };
    case 'owned':
      return { cls: '', nodes: ['Owned'] };
    case 'buyable':
      return { cls: 'is-cost', nodes: [icon('snow'), String(costOf(c))] };
    case 'expensive':
      return { cls: 'is-cost is-short', nodes: [icon('lock'), String(costOf(c))] };
    case 'locked':
      return { cls: 'is-locked', nodes: [icon('lock'), c.unlock.kind === 'achievement' ? (getAchievement(c.unlock.achievement)?.name ?? 'Locked') : 'Locked'] };
  }
}

/** How a tile's state is announced by screen readers. */
function spokenState(c: Cosmetic, state: ItemState, wallet: number): string {
  switch (state) {
    case 'equipped':
      return 'wearing';
    case 'owned':
      return 'owned';
    case 'locked':
      return c.unlock.kind === 'achievement' ? `locked until ${getAchievement(c.unlock.achievement)?.name ?? 'an achievement'}` : 'locked';
    case 'buyable':
      return `costs ${costOf(c)} Snow`;
    case 'expensive':
      return `costs ${costOf(c)} Snow, you need ${costOf(c) - wallet} more`;
  }
}

interface Tile {
  c: Cosmetic;
  btn: HTMLButtonElement;
  status: HTMLElement;
}

export function createWardrobeScreen(ctx: UiContext): Screen {
  let slot: CosmeticSlot = 'scarf';
  /** Try-on selection per slot (starts at what's equipped). */
  let selected: Equipped = { ...ctx.save().equipped };
  /** The slot the grid's tiles were built for. */
  let builtFor: CosmeticSlot | null = null;
  const tiles = new Map<string, Tile>();

  const wallet = snowChip('0');
  const canvas = h('canvas', { class: 'preview-canvas', width: PREVIEW_CSS, height: PREVIEW_CSS, 'aria-hidden': 'true' });
  const itemName = h('p', { class: 'preview-name' });
  const itemNote = h('p', { class: 'preview-note' });
  const action = button(ctx, { label: 'Wearing', icon: 'check', variant: 'primary', size: 'lg', block: true, sound: null, onPress: () => act() });

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Slot' });
  const tabButtons = new Map<CosmeticSlot, HTMLButtonElement>();
  for (const s of COSMETIC_SLOTS) {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${s}`, 'aria-controls': 'wardrobe-grid' }, SLOT_LABEL[s]);
    b.addEventListener('click', () => {
      if (slot === s) return;
      ctx.sound('toggle');
      slot = s;
      refresh();
    });
    tabButtons.set(s, b);
    tabs.append(b);
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = COSMETIC_SLOTS.indexOf(slot);
    const next = COSMETIC_SLOTS[(i + (e.key === 'ArrowRight' ? 1 : COSMETIC_SLOTS.length - 1)) % COSMETIC_SLOTS.length] as CosmeticSlot;
    tabButtons.get(next)?.focus();
    tabButtons.get(next)?.click();
  });

  const grid = h('ul', { class: 'tile-grid', id: 'wardrobe-grid', role: 'tabpanel' });

  const body = h(
    'div',
    { class: 'menu-body' },
    h('div', { class: 'stage card' }, h('div', { class: 'stage-spot' }, canvas), itemName, itemNote, action),
    tabs,
    grid,
  );
  const el = h('section', { class: 'scr scr-menu scr-wardrobe', 'aria-label': 'Wardrobe' },
    h('div', { class: 'menu pe' }, menuHeader(ctx, 'Wardrobe', wallet), body));

  function drawPreview(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(PREVIEW_CSS * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    ctx.cb.renderWardrobePreview(canvas, { ...selected }, slot === 'shades' ? 'sun' : 'nubs');
  }

  function act(): void {
    const id = selected[slot] as CosmeticId;
    const state = itemState(ctx.save(), id);
    const c = getCosmetic(id);
    if (!c) return;
    if (state === 'owned') {
      ctx.sound('equip');
      ctx.cb.equip(id);
      refresh();
      ctx.announce(`Wearing the ${c.name}.`);
    } else if (state === 'buyable') {
      if (ctx.cb.buy(id)) {
        ctx.sound('buy');
        refresh();
        ctx.toast(`${c.name}: yours! ${c.slot === 'shades' ? 'Looking cool, sun.' : 'Looking sharp, Nubs.'}`, { icon: 'gift', tone: 'accent' });
        tiles.get(id)?.btn.classList.add('is-bought');
      } else {
        ctx.sound('deny');
      }
    } else {
      ctx.sound('deny');
      action.classList.remove('is-shake');
      void action.offsetWidth; // restart the shake animation
      action.classList.add('is-shake');
    }
  }

  function select(c: Cosmetic): void {
    selected = { ...selected, [c.slot]: c.id };
    const state = itemState(ctx.save(), c.id);
    if (state === 'owned') {
      ctx.sound('equip');
      ctx.cb.equip(c.id);
    } else {
      ctx.sound('tap');
    }
    refresh();
    const now = itemState(ctx.save(), c.id);
    ctx.announce(now === 'equipped' ? `Wearing the ${c.name}.` : `${c.name} selected, ${spokenState(c, now, ctx.save().stats.wallet)}.`);
  }

  /** Builds the tile buttons for the current slot (tab switches only). */
  function buildGrid(): void {
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && grid.contains(active) ? (active.dataset.id ?? null) : null;
    tiles.clear();
    setChildren(
      grid,
      ...cosmeticsForSlot(slot).map((c) => {
        const status = h('span', { class: 'tile-status' });
        const btn = h(
          'button',
          { class: 'tile', type: 'button', 'data-id': c.id },
          h('span', { class: 'tile-art', 'aria-hidden': 'true' }, cosmeticSwatch(c)),
          h('span', { class: 'tile-name', 'aria-hidden': 'true' }, c.name),
          status,
        );
        btn.addEventListener('click', () => select(c));
        tiles.set(c.id, { c, btn, status });
        return h('li', null, btn);
      }),
    );
    builtFor = slot;
    if (focusedId !== null) tiles.get(focusedId)?.btn.focus({ preventScroll: true });
  }

  /** Updates every tile's state classes, label and status in place (focus stays put). */
  function updateTiles(): void {
    const save = ctx.save();
    for (const { c, btn, status } of tiles.values()) {
      const state = itemState(save, c.id);
      const isSel = selected[slot] === c.id;
      for (const s of STATES) btn.classList.toggle(`is-${s}`, s === state);
      btn.classList.toggle('is-selected', isSel);
      btn.setAttribute('aria-pressed', String(isSel));
      btn.setAttribute('aria-label', `${c.name}, ${spokenState(c, state, save.stats.wallet)}`);
      const s = statusContent(c, state);
      status.className = `tile-status${s.cls ? ` ${s.cls}` : ''}`;
      status.setAttribute('aria-hidden', 'true');
      status.replaceChildren(...s.nodes);
    }
  }

  function refresh(): void {
    const save = ctx.save();
    (wallet.querySelector('.num') as HTMLElement).textContent = String(save.stats.wallet);
    wallet.setAttribute('aria-label', `${save.stats.wallet} Snow`);

    for (const [s, b] of tabButtons) {
      const on = s === slot;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    grid.setAttribute('aria-labelledby', `tab-${slot}`);

    if (builtFor !== slot) buildGrid();
    updateTiles();

    // Action button and caption for the selected item in this slot.
    const id = selected[slot] as CosmeticId;
    const c = getCosmetic(id);
    if (!c) return;
    const state = itemState(save, id);
    itemName.textContent = c.name;
    action.className = 'btn btn--lg btn--block';
    switch (state) {
      case 'equipped':
        setButtonLabel(action, 'Wearing');
        action.classList.add('btn--plain');
        setDisabled(action, true);
        itemNote.textContent = slot === 'shades' ? 'The sun has them on.' : 'Nubs has it on.';
        break;
      case 'owned':
        setButtonLabel(action, 'Wear it');
        action.classList.add('btn--primary');
        setDisabled(action, false);
        itemNote.textContent = 'In your closet.';
        break;
      case 'buyable':
        setButtonLabel(action, `Buy for ${costOf(c)} Snow`);
        action.classList.add('btn--gold');
        setDisabled(action, false);
        itemNote.textContent = 'Trying it on. Like it?';
        break;
      case 'expensive':
        setButtonLabel(action, `Need ${costOf(c) - save.stats.wallet} more Snow`);
        action.classList.add('btn--plain');
        setDisabled(action, true);
        itemNote.textContent = 'Collect flakes and finish missions to earn Snow.';
        break;
      case 'locked': {
        const a = c.unlock.kind === 'achievement' ? getAchievement(c.unlock.achievement) : undefined;
        setButtonLabel(action, a ? `Earn “${a.name}”` : 'Locked');
        action.classList.add('btn--plain');
        setDisabled(action, true);
        itemNote.textContent = a ? a.hint : 'Not available yet.';
        break;
      }
    }
    action.replaceChildren(icon(state === 'locked' ? 'lock' : state === 'equipped' ? 'check' : state === 'owned' ? 'wardrobe' : 'snow'), action.querySelector('.btn-label') ?? '');
    drawPreview();
  }

  return {
    el,
    enter() {
      slot = 'scarf';
      selected = { ...ctx.save().equipped };
      body.scrollTop = 0;
      refresh();
    },
    refresh,
    back: () => ctx.go('title'),
    initialFocus: () => tabButtons.get(slot) ?? null,
  };
}
