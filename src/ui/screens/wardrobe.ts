// Wardrobe (GDD §6): slot tabs, item grid with cost/lock/owned/equipped states, buy + equip, and a
// try-on preview whose drawing is injected by the integrator (callbacks.renderWardrobePreview).
// Tapping an owned item equips it; tapping anything else previews it and the action button shows
// what it takes (buy / not enough Snow / achievement).

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

const SLOT_LABEL: Record<CosmeticSlot, string> = { scarf: 'Scarf', hat: 'Hat', nose: 'Nose' };
const PREVIEW_CSS = 168;

function statusOf(c: Cosmetic, state: ItemState): HTMLElement {
  switch (state) {
    case 'equipped':
      return h('span', { class: 'tile-status is-equipped' }, icon('check'), 'Wearing');
    case 'owned':
      return h('span', { class: 'tile-status' }, 'Owned');
    case 'buyable':
    case 'expensive':
      return h('span', { class: `tile-status is-cost${state === 'expensive' ? ' is-short' : ''}` },
        icon('snow'), c.unlock.kind === 'snow' ? String(c.unlock.cost) : '');
    case 'locked':
      return h('span', { class: 'tile-status is-locked' }, icon('lock'),
        c.unlock.kind === 'achievement' ? (getAchievement(c.unlock.achievement)?.name ?? 'Locked') : 'Locked');
  }
}

/** How a tile's state is announced by screen readers. */
function spokenState(c: Cosmetic, state: ItemState): string {
  switch (state) {
    case 'equipped':
      return 'wearing';
    case 'owned':
      return 'owned';
    case 'locked':
      return c.unlock.kind === 'achievement' ? `locked until ${getAchievement(c.unlock.achievement)?.name ?? 'an achievement'}` : 'locked';
    case 'buyable':
    case 'expensive':
      return `costs ${c.unlock.kind === 'snow' ? c.unlock.cost : 0} Snow`;
  }
}

export function createWardrobeScreen(ctx: UiContext): Screen {
  let slot: CosmeticSlot = 'scarf';
  /** Try-on selection per slot (starts at what's equipped). */
  let selected: Equipped = { ...ctx.save().equipped };

  const wallet = snowChip('0');
  const canvas = h('canvas', { class: 'preview-canvas', width: PREVIEW_CSS, height: PREVIEW_CSS, 'aria-hidden': 'true' });
  const itemName = h('p', { class: 'preview-name', 'aria-live': 'polite' });
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
    ctx.cb.renderWardrobePreview(canvas, { ...selected });
  }

  function act(): void {
    const id = selected[slot] as CosmeticId;
    const state = itemState(ctx.save(), id);
    const c = getCosmetic(id);
    if (!c) return;
    if (state === 'owned') {
      ctx.sound('equip');
      ctx.cb.equip(id);
    } else if (state === 'buyable') {
      if (ctx.cb.buy(id)) {
        ctx.sound('buy');
        ctx.toast(`${c.name}: yours! Looking sharp, Nubs.`, { icon: 'gift', tone: 'accent' });
        grid.querySelector(`[data-id="${id}"]`)?.classList.add('is-bought');
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

    setChildren(
      grid,
      ...cosmeticsForSlot(slot).map((c) => {
        const state = itemState(save, c.id);
        const tile = h(
          'li',
          null,
          h(
            'button',
            {
              class: `tile is-${state}${selected[slot] === c.id ? ' is-selected' : ''}`,
              type: 'button',
              'data-id': c.id,
              'aria-pressed': String(selected[slot] === c.id),
              'aria-label': `${c.name}, ${spokenState(c, state)}`,
            },
            h('span', { class: 'tile-art' }, cosmeticSwatch(c)),
            h('span', { class: 'tile-name' }, c.name),
            statusOf(c, state),
          ),
        );
        tile.firstElementChild?.addEventListener('click', () => select(c));
        return tile;
      }),
    );

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
        itemNote.textContent = 'Nubs has it on.';
        break;
      case 'owned':
        setButtonLabel(action, 'Wear it');
        action.classList.add('btn--primary');
        setDisabled(action, false);
        itemNote.textContent = 'In your closet.';
        break;
      case 'buyable':
        setButtonLabel(action, `Buy for ${c.unlock.kind === 'snow' ? c.unlock.cost : 0} Snow`);
        action.classList.add('btn--gold');
        setDisabled(action, false);
        itemNote.textContent = 'Trying it on. Like it?';
        break;
      case 'expensive': {
        const cost = c.unlock.kind === 'snow' ? c.unlock.cost : 0;
        setButtonLabel(action, `Need ${cost - save.stats.wallet} more Snow`);
        action.classList.add('btn--plain');
        setDisabled(action, true);
        itemNote.textContent = 'Collect flakes and finish missions to earn Snow.';
        break;
      }
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
