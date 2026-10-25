import { expect, test, type Page } from '@playwright/test';

// Phone interface (src/ui/mobile): iPhone-sized viewport with touch. The desktop interface is covered by the other specs.
test.use({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
});

async function startMission(page: Page, id: number, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?mission=${id}`);
  await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
  for (let i = 0; i < 8; i++) {
    const sk = page.locator('.m-skip');
    if (await sk.count()) await sk.first().click();
    await page.waitForTimeout(200);
  }
  await page.locator('.m-game').waitFor();
}

const ownUnit = (page: Page) => page.evaluate(() => {
  const a = (window as any).bi3app, g = a.running.game;
  const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 3);
  return { id: u.id, pos: a.running.screen.fieldToClient(g.w.idx(u.x, u.y)) };
});

test('the phone interface is chosen automatically: list menu, no horizontal overflow, large touch targets', async ({ page }) => {
  await page.goto('/?nointro');
  await page.waitForSelector('.m-item');
  expect(await page.evaluate(() => document.body.classList.contains('mobile-ui'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const heights = await page.locator('.m-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  expect(heights.length).toBeGreaterThanOrEqual(5);
});

test('?ui=desktop keeps the original-like desktop on a phone-sized window', async ({ page }) => {
  await page.goto('/?nointro&ui=desktop');
  await page.waitForSelector('.menu-row');
  expect(await page.evaluate(() => document.body.classList.contains('mobile-ui'))).toBe(false);
});

test('a mission starts full screen with header and dock; tapping a unit shows its card and move works by touch', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 100, errors);
  expect(await page.locator('.m-mission').textContent()).toBeTruthy();
  expect(await page.locator('.m-round').textContent()).toContain('Runde 1');
  const map = await page.locator('.m-map-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(map[0]).toBeGreaterThan(380);
  expect(map[1]).toBeGreaterThan(400);
  const u = await ownUnit(page);
  await page.touchscreen.tap(u.pos.x, u.pos.y);
  await expect(page.locator('.m-card')).toBeVisible();
  expect(await page.locator('.m-card-title').textContent()).toBeTruthy();
  await page.locator('[data-action="move"]').tap();
  const target = await page.evaluate((id) => {
    const a = (window as any).bi3app, g = a.running.game;
    const t = [...g.moveArea(id).targets.keys()].pop();
    return { t, pos: a.running.screen.fieldToClient(t) };
  }, u.id);
  await page.touchscreen.tap(target.pos.x, target.pos.y);
  await page.waitForFunction(({ id, t }) => { const g = (window as any).bi3app.running.game; const x = g.state.units[id]; return g.w.idx(x.x, x.y) === t; }, { id: u.id, t: target.t }, { timeout: 10000 });
  expect(errors).toEqual([]);
});

test('unit information opens as a sheet with the rotating animation, values and weapons; it closes again', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 100, errors);
  const u = await ownUnit(page);
  await page.touchscreen.tap(u.pos.x, u.pos.y);
  await page.locator('[data-action="info"]').tap();
  const anim = page.locator('.m-info-anim');
  await anim.waitFor();
  const grab = () => anim.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, 160, 100).data.join(','));
  await page.waitForTimeout(600);
  const a = await grab();
  await page.waitForTimeout(500);
  const b = await grab();
  expect(a).not.toBe(b);
  expect(await page.locator('.m-cell').count()).toBe(8);
  expect(await page.locator('.m-sheet-body .m-weapon').count()).toBeGreaterThan(0);
  await page.locator('.m-close').tap();
  await expect(page.locator('.m-bsheet')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dragging pans the map, the zoom buttons change the zoom and the overview sheet centres the map', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 100, errors);
  const state = () => page.evaluate(() => { const r = (window as any).bi3app.renderer; return { x: r.scrollX, y: r.scrollY, z: r.zoom }; });
  const before = await state();
  const box = (await page.locator('.m-map-canvas').boundingBox())!;
  // one-finger drag (pointer events, the same path as touch)
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 220, { steps: 6 });
  await page.mouse.up();
  const after = await state();
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(30);
  await page.locator('[data-cmd="Zoom +"]').tap();
  expect((await state()).z).toBeGreaterThan(after.z);
  await page.locator('[data-cmd="Übersicht"]').tap();
  await page.locator('.m-overview-canvas').tap({ position: { x: 20, y: 20 } });
  await expect(page.locator('.m-bsheet')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an attack shows the fight full screen with the large statistics panel; the button skips it', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 100, errors);
  await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    app.settings.fightMode = '3d';
    const me = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.some((w: any) => w.damage > 0 && w.minRange <= 1));
    const foe = s.units.find((u: any) => u.alive && !u.container && u.owner !== 0 && u.owner < 6 && g.w.isEnemyOf(0, u));
    const free = g.w.neighbours(me.x, me.y).filter((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0)[0];
    s.unitAt[foe.y * s.width + foe.x] = -1; foe.x = free.x; foe.y = free.y; s.unitAt[free.y * s.width + free.x] = foe.id;
    s.vision.fill(255);
    void app.running.screen.playEvents(g.attack(me.id, foe.id).events);
  });
  await page.locator('.m-fight-view').waitFor({ timeout: 30000 });
  await expect(page.locator('.m-fight .m-fstats .m-fs-row')).toHaveCount(3);
  await expect(page.locator('.m-fight .m-fs-name')).toHaveCount(2);
  // full screen: the picture covers the whole viewport, not a 3:2 box in the middle
  const box = await page.locator('.m-fight-view').evaluate((c) => { const r = c.getBoundingClientRect(); return [r.width, r.height]; });
  expect(box[0]).toBeGreaterThanOrEqual(388);
  expect(box[1]).toBeGreaterThanOrEqual(840);
  await page.waitForTimeout(800);
  const colours = await page.locator('.m-fight-view').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 40) set.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    return set.size;
  });
  expect(colours).toBeGreaterThan(40);
  await page.locator('.m-fight-skip').tap();
  await expect(page.locator('.m-fight')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ending the turn from the dock hands over to the computer and back', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 100, errors);
  await page.locator('.m-end').tap();
  // the computer moves behind the statistics window; then "Nächster Spieler" has to be confirmed
  await page.locator('.computerwin').waitFor({ timeout: 30000 });
  await page.locator('.msgbox .m-cmd').click({ timeout: 120000 });
  await expect(page.locator('.m-round')).toContainText('Runde 2', { timeout: 60000 });
  expect(errors).toEqual([]);
});

test('after moving a transporter its cargo can still be unloaded from the unit card', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 103, errors);
  const info = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    const t = g.unitsOf(0).find((u: any) => !u.container && u.cargo.length && g.canMove(u))!;
    const cargoCls = g.w.cls(s.units[t.cargo[0]]);
    const coast = (f: number) => g.w.neighbours(f % s.width, Math.trunc(f / s.width)).some((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0 && s.shopAt[p.y * s.width + p.x] < 0
      && ((cargoCls.terrainMask >>> 0) & g.w.groundMask(p.x, p.y)) !== 0 && g.w.playable(p.x, p.y));
    const to = [...g.moveArea(t.id).targets.keys()].find((f: any) => s.unitAt[f] < 0 && s.shopAt[f] < 0 && coast(f)) as number;
    g.moveUnit(t.id, to);
    app.renderer.centerOn(s, t.x, t.y);
    app.running.screen.dirty = true;
    return { id: t.id, cargo: t.cargo[0], field: g.w.idx(t.x, t.y) };
  });
  await page.waitForTimeout(400);
  const pos = await page.evaluate((f) => (window as any).bi3app.running.screen.fieldToClient(f), info.field);
  await page.touchscreen.tap(pos.x, pos.y);
  await page.locator('.m-card [data-action="cargo"]').tap();
  await page.locator(`.m-cargo button[data-unit="${info.cargo}"]:not([disabled])`).tap();
  const mode = await page.evaluate(() => { const m = (window as any).bi3app.running.screen.mode; return { kind: m.kind, fields: m.area?.size ?? 0 }; });
  expect(mode.kind).toBe('move');
  expect(mode.fields).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

const STATS = /Einheiten \d+\/\d+ +Treibstoff \d+\/\d+\s+Munition \S/;

test('the cargo list shows strength, fuel and ammunition of every unit on board', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 103, errors);
  const cargo = await page.evaluate(() => {
    const scr = (window as any).bi3app.running.screen, g = scr.game;
    const t = g.unitsOf(0).find((u: any) => u.cargo.length)!;
    scr.openCargo(t.id);
    return t.cargo[0];
  });
  expect(await page.locator(`.m-cargo button[data-unit="${cargo}"]`).innerText()).toMatch(STATS);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/mobile-cargo-stats.png' });
  expect(await page.evaluate(() => [...document.querySelectorAll('.m-cargo .m-px')].every((c) => c.getBoundingClientRect().right <= window.innerWidth))).toBe(true);
  expect(errors).toEqual([]);
});

test('the building list shows strength, fuel and ammunition of every unit inside', async ({ page }) => {
  const errors: string[] = [];
  await startMission(page, 107, errors);
  await page.evaluate(() => {
    const scr = (window as any).bi3app.running.screen, s = scr.game.state;
    scr.openShop(s.shops.findIndex((sh: any) => sh.owner === 0 && sh.units.length));
  });
  expect(await page.locator('.m-shop button[data-unit]').first().innerText()).toMatch(STATS);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/mobile-shop-stats.png' });
  expect(await page.evaluate(() => [...document.querySelectorAll('.m-shop .m-px')].every((c) => c.getBoundingClientRect().right <= window.innerWidth))).toBe(true);
  expect(errors).toEqual([]);
});
