// Elementals v2 (docs/ELEMENTALS_V2.md §7.9, §7.11, §9.6): the Title's pill (once the first-run lesson
// is passed) opens the Elementals screen; the roster of five and the seven Trial tiles show their lock
// states and labels, the stage its verb row; the Results say "Trial 1", Retry keeps it and "Trials"
// returns; the stored save keeps elementals2 apart from the Journey; the reactive bot passes T1 and
// T4; a point 340 u ahead of the walker lies below the HUD band.
// Controls v3 (docs/CONTROLS_V3.md §3, §12.2), played with real touch through CDP (human timing): on
// T1's Ember leg a press on the button arms the pick and the wall burns before contact, the press
// never turning the sun, and ↑ arms; a finger held through the TAG into Drip steers at once; Drip
// follows a drag by the finger's world distance with the sun held, Left steers west, Pause steers
// nothing; T3's press grows the first gap to its need and a second press tops a plot up; T4's 40 px
// drag sets the vane to 1, the wind rises, Lift goes in gusts of 8 × costMul, the button calms it
// and a press on a calm vane refuses nothing; Retry from the Tag Stone resumes with no arms or jobs.
import { expect, test, type Page } from '@playwright/test';
import { TUNING, trialDef } from '../../src/core/index.ts';
import {
  acts,
  button,
  openGame,
  playTouch,
  pressPts,
  screen,
  seedSave,
  skipToLeg,
  state,
  strokePts,
  touchScreen,
  waitForScreen,
  watchErrors,
  worldToScreen,
  type ShadyState,
} from './helpers.ts';

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

/** Opens Trial n (?trial=), starts it and hands leg `leg` to the input (`before` ticks ahead of its TAG), the game clock at `scale`. */
async function playLeg(page: Page, n: number, leg: number, scale = 0.5, before = 0): Promise<ShadyState> {
  await page.goto(`/?trial=${n}&test=1`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).phase).toBe('day');
  if (leg > 0) await skipToLeg(page, leg, before);
  await page.evaluate((k) => window.__SHADY_TEST__!.setTimeScale(k), scale);
  // A drawn frame on the new leg (the camera follows the walker), and the sun settled.
  await page.waitForTimeout(300);
  return state(page);
}

/** A point in the world band below the walker (clear of the button and the edge zones). */
async function band(page: Page): Promise<{ x: number; y: number }> {
  const nubs = await page.evaluate(() => window.__SHADY_TEST__!.nubsScreen());
  return { x: nubs.x, y: nubs.y + 110 };
}

/** A still 90 ms tap on the action button. */
async function pressButton(page: Page, id: number): Promise<void> {
  const b = await button(page);
  expect(b.shown).toBe(true);
  await playTouch(await touchScreen(page), [{ id, pts: pressPts(b.x, b.y, 90, 3) }]);
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
  await expect(verb).toContainText('Button: burn the next wall');
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

test("T2: Drip follows a drag by the finger's world distance, the sun holds, Left steers west, Pause steers nothing", async ({ page, isMobile }) => {
  // A slow clock: Drip's Size and Gust's Lift drain in the sun and rain while the test plays.
  let s = await playLeg(page, 2, 1, 0.25);
  expect([s.hero, s.verb, s.drive.act]).toEqual(['drip', 'steer', 'none']);
  await expect.poll(async () => (await state(page)).sunHeld).toBe(true);
  s = await state(page);
  const dx0 = s.el!.dx;
  const theta = s.theta;
  // World u per CSS px on the drawn frame.
  const a = await worldToScreen(page, 0, 0);
  const b = await worldToScreen(page, 100, 0);
  const uPerPx = 100 / (b.x - a.x);
  const p = await band(page);
  // A 10 px drag (≈ 9 u: inside the narrowest lane, ±12 u), slow enough for any hand.
  await playTouch(await touchScreen(page), [{ id: 1, pts: strokePts(p.x, p.y, 10, 0, 160) }]);
  await expect.poll(async () => Math.abs((await state(page)).el!.dx - (dx0 + 10 * uPerPx)), { timeout: 5000 }).toBeLessThan(0.1);
  s = await state(page);
  expect(s.theta).toBe(theta);
  expect(s.sunHeld).toBe(true);
  if (!isMobile) {
    // Left steers west.
    const dx1 = s.el!.dx;
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowLeft');
    await expect.poll(async () => (await state(page)).el!.dx, { timeout: 5000 }).toBeLessThan(dx1 - 1);
  }
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

test('T2: a finger held through the TAG into Drip steers within 0.5 s (re-anchored, never cut)', async ({ page }) => {
  await playLeg(page, 2, 1, 0.5, 60);
  let s = await state(page);
  expect([s.hero, s.relay]).toEqual(['nubs', 0]);
  const p = await band(page);
  const cdp = await touchScreen(page);
  // The thumb rests on the world through the hand-off.
  await playTouch(cdp, [{ id: 1, pts: [{ t: 0, x: p.x, y: p.y }], hold: true }]);
  await expect.poll(async () => (await state(page)).hero, { timeout: 5_000 }).toBe('drip');
  s = await state(page);
  const dx0 = s.el!.dx;
  const t0 = Date.now();
  // It slides 30 px right without lifting first: Drip follows within 0.5 s.
  await playTouch(cdp, [{ id: 1, pts: strokePts(p.x, p.y, 30, 0, 250) }]);
  await expect.poll(async () => Math.abs((await state(page)).el!.dx - dx0), { timeout: 2_000 }).toBeGreaterThan(2);
  expect(Date.now() - t0).toBeLessThan(1_500);
  expect((await state(page)).sunHeld).toBe(true);
});

test('T1: a press on the flame button arms the pick, the wall burns before contact, the press never turns the sun; ↑ arms', async ({ page, isMobile }) => {
  await playLeg(page, 1, 1, 0.5);
  expect((await state(page)).hero).toBe('ember');
  await expect.poll(async () => (await state(page)).drive.pick, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  let s = await state(page);
  const pick = s.drive.pick;
  const theta = s.theta;
  const bumps = s.el!.bumps;
  const burns = s.el!.burns;
  await pressButton(page, 1);
  await expect.poll(async () => (await state(page)).drive.queue, { timeout: 2_000 }).toContain(pick);
  expect((await state(page)).theta).toBe(theta);
  // Ember lights it right on time: a burn, and no bump at it.
  await expect.poll(async () => (await state(page)).el!.burns, { timeout: 30_000 }).toBeGreaterThan(burns);
  s = await state(page);
  expect(s.el!.bumps).toBe(bumps);
  expect(s.el!.objs[pick]!.state).not.toBe(0);
  if (!isMobile) {
    // ↑ arms the next pick the same way.
    await expect.poll(async () => (await state(page)).drive.pick, { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    const next = (await state(page)).drive.pick;
    const a0 = await acts(page);
    await page.keyboard.press('ArrowUp');
    expect(await acts(page)).toBe(a0 + 1);
    await expect.poll(async () => (await state(page)).drive.queue, { timeout: 2_000 }).toContain(next);
  }
});

test('T3: a press grows the first gap to its need; a second press on a plot job tops it up', async ({ page }) => {
  test.slow();
  // A quarter-speed clock: a pour of 20 Sap takes 1.6 s of real time.
  await playLeg(page, 3, 1, 0.25);
  expect((await state(page)).hero).toBe('sprout');
  await expect.poll(async () => (await state(page)).drive.pick, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  let s = await state(page);
  const gap = s.drive.pick;
  const o = s.el!.objs[gap]!;
  expect(['gap', 'stream']).toContain(o.k);
  await pressButton(page, 1);
  await expect.poll(async () => (await state(page)).drive.queue[0], { timeout: 2_000 }).toBe(gap);
  // The job pours to the crossing's need, then lets go.
  await expect.poll(async () => { const t = await state(page); return t.drive.queue[0] !== gap && t.el!.objs[gap]!.size >= o.need; }, { timeout: 30_000 }).toBe(true);
  // On to a plot as the pick with Sap to spare and no job running (each crossing on the way gets its press).
  let id = 2;
  let plot = -1;
  for (const until = Date.now() + 90_000; plot < 0 && Date.now() < until; ) {
    s = await state(page);
    const p = s.drive.pick;
    if (p >= 0 && s.drive.queue[0] < 0) {
      if (s.el!.objs[p]!.k === 'plot' && s.meter > 56) plot = p;
      else if (s.el!.objs[p]!.k !== 'plot') await pressButton(page, id++);
    }
    await page.waitForTimeout(100);
  }
  expect(plot).toBeGreaterThanOrEqual(0);
  // One press starts its job to 20 Sap; the next, while it pours, tops it up by 20: the job pours on past
  // 20 (a job that was not topped up lets go within a tick of its goal), refusing nothing.
  const refuse = s.drive.refuseNote;
  await pressButton(page, id++);
  await expect.poll(async () => (await state(page)).el!.objs[plot]!.size, { timeout: 3_000 }).toBeGreaterThan(2);
  await pressButton(page, id++);
  await expect.poll(async () => (await state(page)).el!.objs[plot]!.size, { timeout: 30_000 }).toBeGreaterThan(22);
  expect((await state(page)).drive.refuseNote).toBe(refuse);
});

test('T4: a 40 px drag sets the vane to 1, the wind rises in gusts of 8 × costMul Lift; the button calms it; a press on a calm vane refuses nothing', async ({ page, isMobile }) => {
  test.slow();
  await playLeg(page, 4, 1, 1);
  let s = await state(page);
  expect([s.hero, s.drive.act, s.drive.vane]).toEqual(['gust', 'calm', 0]);
  const spent0 = s.el!.spent;
  const p = await band(page);
  await playTouch(await touchScreen(page), [{ id: 1, pts: strokePts(p.x, p.y, 40, 0, 300) }]);
  await expect.poll(async () => (await state(page)).drive.vane, { timeout: 2_000 }).toBe(1);
  // With weather in play the governor blows east: the wind rises; Lift goes a gust at a time.
  await expect.poll(async () => (await state(page)).el!.wind, { timeout: 30_000 }).toBeGreaterThan(5);
  s = await state(page);
  const gust = TUNING.elements.gust.swipe * trialDef(1004)!.tune.costMul;
  const spent = s.el!.spent - spent0;
  expect(spent).toBeGreaterThan(0);
  expect(Math.abs(spent / gust - Math.round(spent / gust))).toBeLessThan(1e-6);
  // Calm: ↑ on the desktop, the button on a phone.
  if (isMobile) await pressButton(page, 2);
  else await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await state(page)).drive.vane, { timeout: 2_000 }).toBe(0);
  // Calming a calm vane is a no-op, never a refusal.
  if (isMobile) await pressButton(page, 3);
  else await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(700);
  s = await state(page);
  expect([s.drive.vane, s.drive.refuseNote, s.drive.refuse]).toEqual([0, 0, 0]);
});

// CORE's driver: the CALM note (a = 2: the soft cue "The wind is calm") and the touch bots.
test.describe('the CALM note and the touch bots', () => {
  test('T4: a press on a calm vane says "The wind is calm"', async ({ page }) => {
    await playLeg(page, 4, 1, 1);
    await pressButton(page, 1);
    await expect(page.locator('.cue')).toHaveText('The wind is calm');
    expect((await state(page)).drive.refuseNote).toBe(0);
  });
  test("bot('reactiveTouch') shows the bot's own pips on T1's Ember leg", async ({ page }) => {
    await page.goto('/?trial=1&test=1');
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'play');
    await page.evaluate(() => {
      window.__SHADY_TEST__!.bot('reactiveTouch');
      window.__SHADY_TEST__!.setTimeScale(4);
    });
    await expect.poll(async () => { const s = await state(page); return s.hero === 'ember' && s.drive.queue.some((q) => q >= 0); }, { timeout: 60_000 }).toBe(true);
  });
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
        // Controls v3 (§5.2) lifts Nubs 19 px at 360x640, and the card sits between the HUD and his dial:
        // there a Trial's three-line blurb may lose its last line (render/banners.ts sizeCard stops at .85).
        .poll(() => page.evaluate((cut) => { const c = window.__SHADY_TEST__!.levelCard(); return c && c.concept && c.blurb > 0 && c.blurb >= c.lines - cut; }, height < 700 ? 1 : 0), { message: `T${n} at ${width}x${height}` })
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
  await expect(page.locator('.pause-card')).toContainText('Button: grow the next plant · ↑ grows the next one · ← → turn the sun');
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
  // Controls v3 (§11.5): no arms, jobs or vane carried over; the cue line says where the run resumed.
  expect([s.drive.queue, s.drive.vane]).toEqual([[-1, -1], 0]);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await state(page)).hero, { timeout: 10_000 }).toBe('sprout');
  expect(errors).toEqual([]);
});

test('?trial=6 walks Nubs first; Back from its Results leads to the Elementals', async ({ page }) => {
  await page.goto('/?trial=6&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  const s = await state(page);
  // T6's pin starts Nubs' opening leg at 60 (tune.legStart, docs/ELEMENTALS_V2.md §13.3).
  expect([s.level, s.hero, s.meter, s.verb]).toEqual([1006, 'nubs', 60, 'sun']);
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
