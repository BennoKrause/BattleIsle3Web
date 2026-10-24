import { expect, test } from '@playwright/test';
import { openMission } from './helpers.ts';

test('menu text is drawn above the menu frame pieces and has visible ink', async ({ page }) => {
  await page.goto('/?nointro');
  await page.waitForSelector('.menu-row');
  const r = await page.evaluate(() => {
    const row = document.querySelector('.menu-row')!;
    const z = (e: Element) => Number(getComputedStyle(e).zIndex) || 0;
    const piece = document.querySelector('.menu .frame-piece')!;
    const c = row.querySelector('canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) ink++;
    // glyphs are thin strokes: ink must be well below half of the box (not an inverted filled box)
    return { rowAbovePiece: z(row) > z(piece), ink, box: c.width * c.height };
  });
  expect(r.rowAbovePiece).toBe(true);
  expect(r.ink).toBeGreaterThan(20);
  expect(r.ink / r.box).toBeLessThan(0.5);
});

test('the unit command window opens next to the selected unit', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const pos = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game;
    const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 3);
    return app.running.screen.fieldToClient(g.w.idx(u.x, u.y));
  });
  await page.mouse.click(pos.x, pos.y);
  const chip = page.locator('.chipwin');
  await chip.waitFor();
  const box = (await chip.boundingBox())!;
  const dist = Math.min(Math.abs(box.y - pos.y), Math.abs(box.y + box.height - pos.y));
  expect(dist).toBeLessThan(110); // before: fixed position, typically several hundred pixels away
  expect(errors).toEqual([]);
});

test('the UIA window shows the unit with a rotating animation, values and weapons, expands and follows the cursor', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const ids = await page.evaluate(() => {
    const a = (window as any).bi3app, g = a.running.game;
    const own = g.unitsOf(0).filter((x: any) => g.w.cls(x).weapons.filter((w: any) => w.damage > 0).length >= 1);
    return own.slice(0, 2).map((u: any) => ({ id: u.id, type: u.type, pos: a.running.screen.fieldToClient(g.w.idx(u.x, u.y)) }));
  });
  await page.evaluate((id) => (window as any).bi3app.running.screen.showUnitInfo(id), ids[0].id);
  const win = page.locator('.uia-window');
  await win.waitFor();
  expect(await win.evaluate((e: HTMLElement) => [e.offsetWidth, e.offsetHeight])).toEqual([336, 322]);
  const anim = page.locator('.uia-anim');
  await anim.waitFor({ timeout: 15000 });
  // the animation advances: two frames 400 ms apart differ
  const grab = () => anim.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 160, 100).data.slice(0, 64000)).join(','));
  const f1 = await grab(); await page.waitForTimeout(450); const f2 = await grab();
  expect(f1).not.toBe(f2);
  // text fields contain ink: the class name line and one value field
  const ink = await win.evaluate((e: HTMLElement) => [...e.querySelectorAll('canvas.sprite')].filter((c) => (c as HTMLCanvasElement).width > 30 && (c as HTMLCanvasElement).height <= 16).length);
  expect(ink).toBeGreaterThan(8);
  // expanding doubles the animation, the window grows
  await page.click('[data-cmd="UIA Vergrößern"]');
  await expect(anim).toHaveCount(1);
  expect(await win.evaluate((e: HTMLElement) => [e.offsetWidth, e.offsetHeight])).toEqual([336, 449]);
  await page.waitForFunction(() => (document.querySelector('.uia-anim') as HTMLCanvasElement | null)?.width === 320);
  // the window follows the unit under the cursor (different unit type -> different animation / first text line)
  const other = ids.find((u: any) => u.type !== ids[0].type);
  if (other) {
    const before = await page.locator('.uia-window .uia-line').first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
    await page.mouse.move(other.pos.x, other.pos.y);
    await page.waitForTimeout(300);
    const after = await page.locator('.uia-window .uia-line').first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
    expect(after).not.toBe(before);
  }
  await page.click('[data-cmd="UIA Schließen"]');
  await expect(win).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the manager bar buttons sit on the lamp strips of the bar bitmap (no doubled strips)', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  // the button bitmaps contain their own blue lamp strip; it has to cover the strip of MNGR0000 (button top = 2)
  const tops = await page.locator('.manager .btn').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
  expect(tops.length).toBe(11);
  expect(new Set(tops)).toEqual(new Set([2]));
});

test('the setup menu switches between desktop and phone interface and the choice survives a reload', async ({ page }) => {
  await page.goto('/?nointro');
  await page.waitForSelector('.menu-row');
  expect(await page.evaluate(() => document.body.classList.contains('mobile-ui'))).toBe(false);
  // open Setup, step "Oberfläche" (automatic -> phone) and confirm the message
  await page.locator('.menu-row[data-item="Setup"]').click();
  await page.locator('.menu-row[data-item^="Oberfläche"]').click();
  await page.locator('.msgbox').click();
  await page.waitForSelector('.m-item', { timeout: 30000 });
  expect(await page.evaluate(() => document.body.classList.contains('mobile-ui'))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bi3.settings')!).uiMode)).toBe('mobile');
  // in the phone interface the same setting leads on to the desktop
  await page.locator('.m-item', { hasText: 'Setup' }).click();
  await page.locator('.m-item', { hasText: 'Oberfläche' }).click();
  await page.locator('.msgbox .m-cmd').click();
  await page.waitForSelector('.menu-row', { timeout: 30000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bi3.settings')!).uiMode)).toBe('desktop');
});

test('while the computer moves only the statistics window with the progress bar is shown (w_computer.c)', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 107, errors);
  await page.click('[data-cmd="Spielerwechsel"]');
  const win = page.locator('.computerwin');
  await win.waitFor({ timeout: 30000 });
  expect(await win.evaluate((e: HTMLElement) => [e.offsetWidth, e.offsetHeight])).toEqual([640, 258]);
  // one row per player with name and six numbers; no fight window during the computer move
  expect(await win.locator('canvas.sprite').count()).toBeGreaterThan(20);
  expect(await page.locator('.fightpanel, .fightwin').count()).toBe(0);
  // afterwards the window disappears and the human player continues
  await win.waitFor({ state: 'detached', timeout: 120000 });
  expect(await page.evaluate(() => (window as any).bi3app.running.game.isHumanTurn())).toBe(true);
  expect(errors).toEqual([]);
});
