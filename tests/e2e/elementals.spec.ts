// Elementals v2 (docs/ELEMENTALS_V2.md §7.9, §7.11, §9.6): the Title's pill (once the first-run lesson
// is passed) opens the Elementals screen; the roster of five and the seven Trial tiles show their lock
// states and labels, the stage its verb row; T1 from the screen starts level 1001 with Nubs, and each
// element's verb is played with real pointer events on its own leg (testSkipToLeg): Ember's tap burns
// the wall under the finger and leaves the sun alone, Up burns the next one; Drip follows a drag by
// the finger's world distance with the sun held, Left steers west, the Pause button steers nothing;
// Sprout's 1 s holds grow a soil patch and a gap; Gust's left swipe blows the wind west. The Cold
// Snap coin snaps on a Nubs leg only. The Results say "Trial 1", Retry keeps it and "Trials" returns;
// the stored save keeps elementals2 apart from the Journey; the reactive bot passes T1 and T4; a
// point 340 u ahead of the walker lies below the HUD band.
import { expect, test, type Page } from '@playwright/test';
import { openGame, runCfg, screen, seedSave, skipToLeg, state, waitForScreen, watchErrors, worldToScreen, type ShadyState } from './helpers.ts';

/** Endless open (Level 3 passed) and the first-run lesson passed; nothing played on the Elementals yet. */
function openSave(el?: object): object {
  const stars = Array<number>(200).fill(0);
  stars[0] = 3;
  stars[1] = 2;
  stars[2] = 1;
  return { v: 4, createdAt: 1, stats: { runs: 6, wallet: 40 }, campaign: { stars, unlocked: 4, lastLevel: 3 }, flags: { tutorialDone: true }, ...(el ? { elementals2: el } : {}) };
}

async function openElementals(page: Page): Promise<void> {
  await page.locator('.scr-title .elementals-btn').click();
  await waitForScreen(page, 'elementals');
}

const stored = (page: Page): Promise<{ elementals?: unknown; elementals2?: { stars: number[]; seen: boolean }; campaign: { stars: number[] } }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('shady.save') ?? '{}'));

type Obj = NonNullable<ShadyState['el']>['objs'][number];
const WALLS = ['bramble', 'gate', 'ice'];

/** Opens Trial n (?trial=), starts it and hands leg `leg` to the input, the game clock at `scale`. */
async function playLeg(page: Page, n: number, leg: number, scale = 0.5): Promise<ShadyState> {
  await page.goto(`/?trial=${n}&test=1`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).phase).toBe('day');
  if (leg > 0) await skipToLeg(page, leg);
  await page.evaluate((k) => window.__SHADY_TEST__!.setTimeScale(k), scale);
  // A drawn frame on the new leg (the camera follows the walker), and the sun settled.
  await page.waitForTimeout(300);
  return state(page);
}

/** The first object of `kinds` ahead of the walker on screen (24 CSS px ahead at least, below the HUD), with its screen point. */
async function firstAhead(page: Page, kinds: string[], pred: (o: Obj) => boolean = (o) => o.state === 0): Promise<{ i: number; x: number; y: number }> {
  const s = await state(page);
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  const objs = s.el!.objs;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i] as Obj;
    if (!kinds.includes(o.k) || !pred(o)) continue;
    const p = await worldToScreen(page, o.x, o.y);
    if (p.y < nubs.y - 24 && p.y > 90) return { i, ...p };
  }
  throw new Error(`no ${kinds.join('/')} ahead`);
}

test('the Title pill waits for the first-run lesson, then opens T1-T4; NEW until the screen is opened', async ({ page }) => {
  await openGame(page);
  const btn = page.locator('.scr-title .title-top .elementals-btn');
  await expect(btn).toBeHidden();
  await seedSave(page, openSave());
  await openGame(page);
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAccessibleName('Elementals');
  await expect(btn).toHaveClass(/is-new/);
  await expect(btn.locator('.el-tfaces canvas')).toHaveCount(4);
  await openElementals(page);
  await expect(page.locator('.elementals-stars')).toHaveText('0/21');
  for (const n of [1, 2, 3, 4]) await expect(page.locator(`.trial-tile[data-trial="${n}"]`)).not.toHaveClass(/is-locked/);
  for (const n of [5, 6, 7]) await expect(page.locator(`.trial-tile[data-trial="${n}"]`)).toHaveClass(/is-locked/);
  const save = await stored(page);
  expect(save.elementals2?.seen).toBe(true);
  expect('elementals' in save).toBe(false);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(btn).not.toHaveClass(/is-new/);
});

test('lock states, labels and the verb row: seven Trials, five elements (Gust in)', async ({ page }) => {
  await seedSave(page, openSave());
  await openGame(page);
  await openElementals(page);
  const tiles = page.locator('.scr-elementals .trial-tile');
  await expect(tiles).toHaveCount(7);
  await expect(page.locator('.trial-tile[data-trial="3"]')).toHaveAttribute('aria-label', 'Trial 3, Green Bridge, Nubs, Sprout, not passed yet');
  await expect(page.locator('.trial-tile[data-trial="5"]')).toHaveAttribute('aria-label', 'Trial 5, Steam, Nubs, Ember, Drip, locked: pass Kindling and Puddle Run');
  // T7's five faces go without arrows.
  await expect(page.locator('.trial-tile[data-trial="7"] .el-face')).toHaveCount(5);
  await expect(page.locator('.trial-tile[data-trial="1"]')).toHaveClass(/is-next/);
  await expect(page.locator('.elementals-play')).toHaveText('Play T1 · Kindling');
  // The stage: Ember (T1's element), its verb row with the gesture icon, how it plays and its keys.
  const verb = page.locator('.scr-elementals .el-verb');
  await expect(verb).toContainText('Tap: burn a wall');
  await expect(verb.locator('small')).toHaveText('↑ burns the next wall · ← → turn the sun');
  await expect(verb.locator('svg')).toHaveCount(1);
  const heroes = page.locator('.scr-elementals .hero-tile');
  await expect(heroes).toHaveCount(5);
  await expect(page.locator('.hero-tile[data-hero="nubs"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('.hero-tile[data-hero="gust"]')).toHaveClass(/is-locked/);
  await expect(page.locator('.hero-tile[data-hero="gust"]')).toContainText('Pass T4');
  await expect(page.locator('.hero-tile[data-hero="gust"]')).toHaveAttribute('aria-label', 'Gust, locked: pass Weather Vane');
  await expect(page.locator('.hero-tile[data-hero="volt"]')).toHaveCount(0);
  // A locked Trial says what opens it.
  await page.locator('.trial-tile[data-trial="6"]').click({ force: true });
  await expect(page.locator('.toast').last()).toContainText('Pass Green Bridge and Weather Vane first.');
  expect(await screen(page)).toBe('elementals');
  // Arrow keys walk the grid: right, then down a row.
  await page.locator('.trial-tile[data-trial="1"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.trial-tile[data-trial="2"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.trial-tile[data-trial="4"]')).toBeFocused();
});

test('an element tap points Play at its next Trial and shows its verb', async ({ page }) => {
  await seedSave(page, openSave({ stars: [2, 2, 0, 0, 0, 0, 0], seen: true }));
  await openGame(page);
  await openElementals(page);
  await expect(page.locator('.elementals-play')).toHaveText('Play T3 · Green Bridge');
  await page.locator('.hero-tile[data-hero="drip"]').click();
  // Drip's first open Trial not passed yet: T5 (Nubs ▸ Ember ▸ Drip ▸ Nubs).
  await expect(page.locator('.elementals-play')).toHaveText('Play T5 · Steam');
  await expect(page.locator('.trial-tile[data-trial="5"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.scr-elementals .el-verb')).toContainText('Drag: steer Drip');
  await expect(page.locator('.scr-elementals .el-verb small')).toHaveText('← → steer');
});

test("T1 from the screen starts with Nubs; Ember's tap burns the wall under the finger and leaves the sun alone; Up burns the next", async ({ page }) => {
  const errors = watchErrors(page);
  await seedSave(page, openSave());
  await openGame(page);
  await openElementals(page);
  await page.locator('.trial-tile[data-trial="1"]').click();
  await waitForScreen(page, 'play');
  expect((await runCfg(page)).mode).toBe('campaign');
  let s = await state(page);
  expect([s.level, s.hero, s.verb]).toEqual([1001, 'nubs', 'sun']);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).phase).toBe('day');
  await skipToLeg(page, 1);
  await page.evaluate(() => window.__SHADY_TEST__!.setTimeScale(0.5));
  await page.waitForTimeout(300);
  s = await state(page);
  expect([s.hero, s.verb, s.sunHeld]).toEqual(['ember', 'burn', false]);
  // The sun settles (the bot's last drag has no lift), then a tap on the first wall burns it.
  await expect.poll(async () => (await state(page)).omega, { timeout: 5000 }).toBe(0);
  const wall = await firstAhead(page, WALLS);
  const before = await state(page);
  await page.mouse.move(wall.x, wall.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => ((await state(page)).el!.objs[wall.i] as Obj).state, { timeout: 5000 }).toBeGreaterThan(0);
  const after = await state(page);
  // No catch, no turn: θ and ω are as they were.
  expect(after.theta).toBe(before.theta);
  expect(after.omega).toBe(0);
  // Up burns the next wall ahead.
  const lit = (x: ShadyState): number => x.el!.objs.filter((o) => WALLS.includes(o.k) && o.state > 0).length;
  const n0 = lit(after);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => lit(await state(page)), { timeout: 5000 }).toBeGreaterThan(n0);
  expect(errors).toEqual([]);
});

test("T2: Drip follows a drag by the finger's world distance, the sun holds, Left steers west, Pause steers nothing", async ({ page }) => {
  // A slow clock: Drip's Size and Gust's Lift drain in the sun and rain while the test plays.
  let s = await playLeg(page, 2, 1, 0.25);
  expect([s.hero, s.verb]).toEqual(['drip', 'steer']);
  await expect.poll(async () => (await state(page)).sunHeld).toBe(true);
  s = await state(page);
  const dx0 = s.el!.dx;
  const theta = s.theta;
  // World u per CSS px on the drawn frame.
  const a = await worldToScreen(page, 0, 0);
  const b = await worldToScreen(page, 100, 0);
  const uPerPx = 100 / (b.x - a.x);
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  const y = nubs.y - 120;
  // A 10 px drag (≈ 9 u: inside the narrowest lane, ±12 u).
  await page.mouse.move(nubs.x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(nubs.x + 2 * i, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await state(page)).el!.dx - (dx0 + 10 * uPerPx)), { timeout: 5000 }).toBeLessThan(0.1);
  s = await state(page);
  expect(s.theta).toBe(theta);
  expect(s.sunHeld).toBe(true);
  // Left steers west.
  const dx1 = s.el!.dx;
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowLeft');
  await expect.poll(async () => (await state(page)).el!.dx, { timeout: 5000 }).toBeLessThan(dx1 - 1);
  // Settled; the Pause button pauses and steers nothing.
  await page.waitForTimeout(400);
  const dx2 = (await state(page)).el!.dx;
  await page.getByRole('button', { name: 'Pause' }).click();
  await waitForScreen(page, 'pause');
  await page.getByRole('button', { name: 'Resume' }).click();
  await waitForScreen(page, 'play');
  await page.waitForTimeout(300);
  expect(Math.abs((await state(page)).el!.dx - dx2)).toBeLessThan(0.01);
});

test("T3: Sprout's 1 s holds grow the first soil patch and the first gap", async ({ page }) => {
  const s = await playLeg(page, 3, 1);
  expect([s.hero, s.verb]).toEqual(['sprout', 'grow']);
  const hold = async (p: { x: number; y: number }): Promise<void> => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
  };
  const plot = await firstAhead(page, ['plot'], (o) => o.size === 0);
  await hold(plot);
  await expect.poll(async () => ((await state(page)).el!.objs[plot.i] as Obj).size).toBeGreaterThan(0);
  const gap = await firstAhead(page, ['gap'], (o) => o.size === 0);
  await hold(gap);
  await expect.poll(async () => ((await state(page)).el!.objs[gap.i] as Obj).size).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).el!.hold).toBe(-1);
});

test("T4: Gust's left swipe blows the wind west (the sun holds)", async ({ page }) => {
  const s = await playLeg(page, 4, 1, 0.25);
  expect([s.hero, s.verb]).toEqual(['gust', 'blow']);
  await expect.poll(async () => (await state(page)).sunHeld).toBe(true);
  const theta = (await state(page)).theta;
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  const y = nubs.y - 140;
  await page.mouse.move(nubs.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(nubs.x + 30 - 20 * i, y);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).el!.wind, { timeout: 5000 }).toBeLessThan(0);
  const after = await state(page);
  // A swipe costs 8 Lift (T4 keeps costMul 1).
  expect(after.el!.spent).toBe(8);
  expect(after.theta).toBe(theta);
});

test('the Cold Snap coin snaps on a Nubs leg and not on an Ember leg', async ({ page }) => {
  await playLeg(page, 1, 0, 1);
  // The start beat (the sim's ready count) ends before input may snap; the TAG's lock is 3.9 s in.
  await page.waitForTimeout(1300);
  await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.mech())).meter, { timeout: 5000 }).toBe(true);
  const m = await page.evaluate(() => window.__SHADY_TEST__!.mech());
  await page.mouse.click(m.meterX, m.meterY);
  expect((await page.evaluate(() => window.__SHADY_TEST__!.mech())).snaps).toBe(1);
  await skipToLeg(page, 1);
  await page.waitForTimeout(300);
  expect((await state(page)).hero).toBe('ember');
  await page.mouse.click(m.meterX, m.meterY);
  await page.keyboard.press('ArrowDown');
  expect((await page.evaluate(() => window.__SHADY_TEST__!.mech())).snaps).toBe(1);
});

test("every Trial's intro card keeps its whole sentence, and the Pause card names the walker's verb and keys", async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one project walks the sizes');
  test.slow();
  for (const [width, height] of [[1280, 800], [1280, 720], [390, 844], [360, 640]] as const) {
    await page.setViewportSize({ width, height });
    for (let n = 1; n <= 7; n++) {
      await page.goto(`/?trial=${n}&test=1`);
      await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
      await expect
        .poll(() => page.evaluate(() => { const c = window.__SHADY_TEST__!.levelCard(); return c && c.concept && c.blurb > 0 && c.blurb === c.lines; }), { message: `T${n} at ${width}x${height}` })
        .toBe(true);
    }
  }
  await playLeg(page, 3, 1, 0.25);
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.title).toBe('Trial 3 · Green Bridge');
  expect(status!.goal).toMatch(/^Reach the finish · \d+ %$/);
  expect(status!.stars[1]).toEqual({ label: 'Grow 2 trees · 0/2', state: 'open' });
  await page.getByRole('button', { name: 'Pause' }).click();
  await waitForScreen(page, 'pause');
  await expect(page.locator('.pause-card')).toContainText('Grow the way ahead.');
  await expect(page.locator('.pause-card')).toContainText('Hold: grow a plant · Hold ↑ grows the next one · ← → turn the sun');
});

test('T1: the Results say Trial 1, Retry keeps it and Trials returns; the save keeps elementals2 apart from the Journey', async ({ page }) => {
  const errors = watchErrors(page);
  await seedSave(page, { v: 4, createdAt: 1, settings: { unlockAll: true } });
  await openGame(page);
  await openElementals(page);
  await page.locator('.trial-tile[data-trial="1"]').click();
  await waitForScreen(page, 'play');
  expect((await state(page)).level).toBe(1001);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  const verdict = await page.evaluate(() => window.__SHADY_TEST__!.campaign());
  expect(verdict?.id).toBe(1001);
  expect(verdict?.passed).toBe(false);
  await expect(page.locator('.res-sheet')).toContainText('Trial 1');
  // Nubs melted: today's recap tips (none of an element's).
  expect((await page.evaluate(() => window.__SHADY_TEST__!.resultsTip())) ?? '').not.toMatch(/Ember|Drip|Sprout|Gust/);
  await page.getByRole('button', { name: /^Retry/ }).click();
  await expect.poll(async () => `${await screen(page)}:${(await state(page)).level}`, { timeout: 10_000 }).toBe('play:1001');
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  await expect(page.locator('.res-sheet').getByRole('button', { name: 'Map' })).toHaveCount(0);
  await page.locator('.res-sheet').getByRole('button', { name: 'Trials' }).click();
  await waitForScreen(page, 'elementals');
  await expect(page.locator('.trial-tile[data-trial="1"]')).toHaveClass(/is-next/);
  const save = await stored(page);
  expect(save.elementals2?.stars).toHaveLength(7);
  expect('elementals' in save).toBe(false);
  expect(save.campaign.stars.every((n) => n === 0)).toBe(true);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'title');
  await expect(page.locator('.scr-title .play-pill')).toHaveText('Level 1');
  expect(errors).toEqual([]);
});

test('T3: a fall on Sprout\'s leg offers Retry from the Tag Stone, which picks up at the telegraph and waits on Pause', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  // Nubs' leg by the reactive bot (its frames are recorded as the player's), then Sprout with no input.
  await playLeg(page, 3, 1, 1);
  await waitForScreen(page, 'results', 30_000);
  expect((await state(page)).relay).toBe(1);
  const btn = page.locator('.res-sheet').getByRole('button', { name: 'Retry from the Tag Stone' });
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled({ timeout: 5_000 });
  await btn.click();
  await waitForScreen(page, 'pause');
  const s = await state(page);
  // The telegraph of the TAG at 340 (11:40 AM) opens 180 ticks (43.2 minutes) before it (TAG ticks
  // fall on the 6-tick grid: within a minute).
  expect([s.level, s.phase, s.relay, s.hero]).toEqual([1003, 'day', 0, 'nubs']);
  expect(Math.abs(s.minutes - (340 - 43.2))).toBeLessThan(1);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await state(page)).hero, { timeout: 10_000 }).toBe('sprout');
  expect(errors).toEqual([]);
});

test('?trial=6 walks Nubs first; Back from its Results leads to the Elementals', async ({ page }) => {
  await page.goto('/?trial=6&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  const s = await state(page);
  // T6's pin starts Nubs' opening leg at 80 (tune.legStart, docs/ELEMENTALS_V2.md §13).
  expect([s.level, s.hero, s.meter, s.verb]).toEqual([1006, 'nubs', 80, 'sun']);
  await page.evaluate(() => window.__SHADY_TEST__!.forceDeath());
  await waitForScreen(page, 'results', 15_000);
  await page.keyboard.press('Escape');
  await waitForScreen(page, 'elementals');
  await expect(page.locator('.trial-tile[data-trial="6"]')).toHaveClass(/is-next/);
});

for (const n of [1, 4]) {
  test(`?trial=${n} with the reactive bot passes, and the pass is kept apart from the Journey`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.goto(`/?trial=${n}&test=1`);
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'play');
    await page.evaluate(() => {
      window.__SHADY_TEST__!.bot('reactive');
      window.__SHADY_TEST__!.setTimeScale(4);
    });
    await waitForScreen(page, 'results', 120_000);
    const verdict = await page.evaluate(() => window.__SHADY_TEST__!.campaign());
    expect(verdict?.id).toBe(1000 + n);
    expect(verdict?.passed).toBe(true);
    await expect(page.locator('.res-sheet .res-ribbon')).toHaveText(`Trial ${n} Passed!`);
    const save = await stored(page);
    expect(save.elementals2?.stars[n - 1]).toBe(verdict?.stars);
    expect(save.campaign.stars.every((x) => x === 0)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// §1.4: the window's far edge (340 u ahead) is on screen below the HUD band (safe top + 64 CSS px).
for (const size of [
  { width: 360, height: 640 },
  { width: 1280, height: 720 },
]) {
  test(`at ${size.width}x${size.height} a point 340 u ahead of the walker lies below the HUD band`, async ({ page }) => {
    await page.setViewportSize(size);
    await playLeg(page, 1, 1, 0.25);
    const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
    const a = await worldToScreen(page, 0, 0);
    const b = await worldToScreen(page, 0, 100);
    const perU = (a.y - b.y) / 100;
    const top = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--world-top')) || 0);
    expect(nubs.y - 340 * perU).toBeGreaterThan(top + 64);
  });
}
