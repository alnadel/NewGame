// v1.6 on the game side (docs/V1_6_PLAN.md §4, §9 GAME): the render-only demos of every new layer
// (the ring round the badge, the Frost Bank's pips, the banked chip, the landing, deep, glass and
// flare layers, the parry, Noon Heat), the two-pip meter's tap, a level's Dare on its card, pill
// and Pause card, and the soft-fail's eased goal from the save. The rules themselves are CORE's;
// these hold whatever the sim does, because the demos stand in for its state while they last.
import { expect, test, type Page } from '@playwright/test';
import { TUNING } from '../../src/core/index.ts';
import { keepAlive, mech, OPEN_SAVE, seedSave, waitForScreen, watchErrors } from './helpers.ts';

const demo = (page: Page, name: string) => page.evaluate((n) => window.__SHADY_TEST__!.demo(n), name);

/**
 * An endless run at profile 3 (a debug run: nothing is saved), past its start beat. The Frost Bank
 * ships on (V16_SHIP, economy iteration 1); `rules` '&on=bank' keeps it explicit for its own layers.
 */
async function playEndless(page: Page, rules = '&on=bank'): Promise<void> {
  await seedSave(page, OPEN_SAVE);
  await page.goto(`/?test=1&seed=42&profile=3&t=08:30${rules}`);
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title');
  await keepAlive(page);
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  await page.waitForTimeout(1600);
}

test('the ring, the pips and the dial layers show their demos without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await playEndless(page);
  const m0 = await mech(page);
  expect(m0.pips).toBe(2);
  expect(m0.ring).toBe(true);
  await demo(page, 'ring');
  await expect.poll(async () => (await mech(page)).ringFill).toBeCloseTo(2 / 3, 2);
  await demo(page, 'bleed');
  await expect.poll(async () => (await mech(page)).bleed).toBe(true);
  await demo(page, 'pips');
  await expect.poll(async () => (await mech(page)).frost).toBeCloseTo(1.6, 5);
  for (const d of ['trick', 'spill', 'cash', 'landing']) await demo(page, d);
  await demo(page, 'bank');
  // The demo banks one bloom's frost under its snap (TUNING.bank.bloomH, at most garden.bankCapH a snap).
  await expect.poll(async () => (await mech(page)).bankH).toBe(Math.min(TUNING.bank.bloomH, TUNING.garden.bankCapH));
  expect((await mech(page)).snapLeft).toBeGreaterThan(0);
  await page.waitForTimeout(3300);
  await demo(page, 'land');
  await expect.poll(async () => (await mech(page)).landBins).toBeGreaterThan(0);
  await demo(page, 'deepBand');
  await expect.poll(async () => (await mech(page)).deepBins).toBeGreaterThan(0);
  await demo(page, 'glass');
  await expect.poll(async () => (await mech(page)).glassBins).toBeGreaterThan(0);
  await demo(page, 'noonHeat');
  await expect.poll(async () => (await mech(page)).noonHeat).toBe(1.25);
  expect(errors).toEqual([]);
});

test('Guide Auto never hides the deep band: a veteran save (30 runs) still draws it on the dial', async ({ page }) => {
  const errors = watchErrors(page);
  // 30 lifetime runs: Guide Auto has faded the teal guide away (game/assist.ts guideAlpha 0).
  await seedSave(page, { ...OPEN_SAVE, stats: { runs: 30 } });
  await page.goto('/?test=1&seed=42&profile=3&t=08:30');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'title');
  await keepAlive(page);
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  await page.waitForTimeout(1600);
  await demo(page, 'deepBand');
  await expect.poll(async () => (await mech(page)).deepBins).toBeGreaterThan(0);
  // The demo's band sits at the sun's angle, under the sun's knob: turn the sun away from it by hand.
  await page.evaluate(() => window.__SHADY_TEST__!.bot(null));
  const th0 = await page.evaluate(() => window.__SHADY_TEST__!.state().theta);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + 12 * i, box.y + box.height * 0.7);
  await page.mouse.up();
  await expect.poll(async () => Math.abs((((await page.evaluate(() => window.__SHADY_TEST__!.state().theta)) - th0 + 540) % 360) - 180)).toBeGreaterThan(25);
  await page.waitForTimeout(150);
  // Dark teal pixels on the ring (the deep band's colour, #0B5F5A, over its own teal track).
  const teal = await page.evaluate(() => {
    const m = window.__SHADY_TEST__!.mech();
    const c = document.querySelector('canvas#game') as HTMLCanvasElement;
    const k = c.width / c.getBoundingClientRect().width;
    const g = c.getContext('2d')!;
    let n = 0;
    for (let a = 0; a < 360; a += 2) {
      const x = Math.round((m.dialX + Math.cos((-a * Math.PI) / 180) * m.dialR) * k);
      const y = Math.round((m.dialY + Math.sin((-a * Math.PI) / 180) * m.dialR) * k);
      const [r, gg, b] = g.getImageData(x, y, 1, 1).data as unknown as number[];
      if ((gg as number) > (r as number) + 30 && (b as number) > (r as number) + 25 && (gg as number) < 150) n++;
    }
    return n;
  });
  expect(teal).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('boss finales keep the level bar at 360x640, where their HP marks ride', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 360, height: 640 });
  // L190 and L200 offer a seconds Dare (snapSave) on top of the boss: the widest goal pills.
  for (const id of [50, 190, 200]) {
    await page.goto(`/?level=${id}&test=1`);
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'play');
    await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.hud())).ruler, { message: `level ${id}` }).toBe(true);
    expect((await page.evaluate(() => window.__SHADY_TEST__!.hud())).rulerW, `level ${id}`).toBeGreaterThanOrEqual(48);
    // The goal pill keeps its glyph (fix round 2: it used to drop first, leaving a bare count).
    expect((await page.evaluate(() => window.__SHADY_TEST__!.hud())).icon, `level ${id}`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('the deep shade and Cold Snap lessons keep their goal glyph on the pill at 390x844', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of [5, 10]) {
    await page.goto(`/?level=${id}&test=1`);
    await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
    await waitForScreen(page, 'play');
    await expect.poll(async () => (await page.evaluate(() => window.__SHADY_TEST__!.hud())).ruler, { message: `level ${id}` }).toBe(true);
    const hud = await page.evaluate(() => window.__SHADY_TEST__!.hud());
    expect(hud.icon, `level ${id}`).toBe(true);
    expect(hud.rulerW, `level ${id}`).toBeGreaterThanOrEqual(48);
  }
  expect(errors).toEqual([]);
});

test('a Heat Flare counts down on the dial and a parry marks it on the ruler', async ({ page }) => {
  const errors = watchErrors(page);
  // The shipped rules: every rule on (the Frost Bank since economy iteration 1), so the meter is two pips; the ring is on.
  await playEndless(page, '');
  expect((await mech(page)).pips).toBe(2);
  expect((await mech(page)).ring).toBe(true);
  await demo(page, 'flare');
  await expect.poll(async () => (await mech(page)).flarePhase).toBe(1);
  const m1 = await mech(page);
  expect(m1.flareBins).toBeGreaterThan(0);
  await expect.poll(async () => (await mech(page)).flareLeft).toBeLessThan(m1.flareLeft);
  await demo(page, 'parry');
  await expect.poll(async () => (await mech(page)).flareOut).toEqual([1]);
  // The warning runs out into the rise and hold (the sun's white-hot ring), then it is over.
  await expect.poll(async () => (await mech(page)).flarePhase, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("a new player's first Heat Flare: its tip comes before the countdown, leads the toasts and leaves at the rise", async ({ page }) => {
  const errors = watchErrors(page);
  const texts = () => page.evaluate(() => window.__SHADY_TEST__!.toasts().map((t) => t.text));
  const soon = expect.stringMatching(/^Heat Flare soon!/);
  // OPEN_SAVE has no runs: a new player's endless run gets the mechanics' first tips.
  await playEndless(page, '');
  await demo(page, 'flareSoon');
  // The warning is 5 s away and the tip comes 4 s ahead of it: read before the rim runs, not during.
  await expect.poll(texts, { timeout: 4000 }).toContainEqual(soon);
  expect((await mech(page)).flarePhase).toBe(0);
  await expect.poll(async () => (await mech(page)).flarePhase, { timeout: 8000 }).toBe(1);
  expect((await texts())[0]).toMatch(/^Heat Flare soon!/);
  // Once the rim has run out the tip leaves (it is never read after its cue is gone).
  await expect.poll(async () => (await mech(page)).flarePhase, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(texts, { timeout: 1500 }).not.toContainEqual(soon);
  expect(errors).toEqual([]);
});

test('a tap on the two-pip meter asks for a Cold Snap while a pip is full', async ({ page }) => {
  await playEndless(page);
  await demo(page, 'pips');
  await expect.poll(async () => (await mech(page)).frost).toBeCloseTo(1.6, 5);
  const m = await mech(page);
  const before = m.snaps;
  // The capsule round both pips takes the tap, the second pip's centre included.
  await page.mouse.click(m.meterX + 20, m.meterY);
  expect((await mech(page)).snaps).toBe(before + 1);
});

test("a level's Dare: on its card, counted on the Pause card", async ({ page }) => {
  await page.goto('/?level=12&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await keepAlive(page);
  await demo(page, 'dare');
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.stars[1]).toEqual({ label: 'Bloom 2 · 1/2', state: 'open' });
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.state().phase)).toBe('day');
  // The HUD pill counts the Dare (the level's goal is the finish).
  await expect.poll(() => page.evaluate(() => window.__SHADY_TEST__!.hud().snow)).toBe(1);
});

test('two missed goals ease a level to the finish, and its tip says so', async ({ page }) => {
  await seedSave(page, { v: 4, createdAt: 1, settings: { unlockAll: true }, campaign: { stars: [1], unlocked: 3, lastLevel: 2, misses: [0, 2] } });
  await page.goto('/?level=2&test=1');
  await page.waitForFunction(() => window.__SHADY_TEST__ !== undefined);
  await waitForScreen(page, 'play');
  await keepAlive(page);
  const status = await page.evaluate(() => window.__SHADY_TEST__!.runStatus());
  expect(status!.goal).toMatch(/^Reach the finish · /);
  expect(status!.stars[0]!.label).toBe('Finish');
  const box = (await page.locator('canvas#game').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await expect
    .poll(() => page.evaluate(() => window.__SHADY_TEST__!.toasts().map((t) => t.text)), { timeout: 10_000 })
    .toContain('Goal eased: just reach the finish. The Dare still earns its star.');
});
