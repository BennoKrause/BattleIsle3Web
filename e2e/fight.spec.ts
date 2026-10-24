import { expect, test } from '@playwright/test';
import { openMission } from './helpers.ts';

// Starts a fight between two adjacent units of mission 100.
async function startFight(page: import('@playwright/test').Page, mode: '3d' | 'fast') {
  await page.evaluate((m) => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    app.settings.fightMode = m;
    const me = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.some((w: any) => w.damage > 0 && w.minRange <= 1));
    const foe = s.units.find((u: any) => u.alive && !u.container && u.owner !== 0 && u.owner < 6 && g.w.isEnemyOf(0, u));
    const free = g.w.neighbours(me.x, me.y).filter((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0)[0];
    s.unitAt[foe.y * s.width + foe.x] = -1; foe.x = free.x; foe.y = free.y; s.unitAt[free.y * s.width + free.x] = foe.id;
    s.vision.fill(255);
    void app.running.screen.playEvents(g.attack(me.id, foe.id).events);
  }, mode);
}

test('"Kampf: schnell" shows only the statistics window; ESC closes it', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  await startFight(page, 'fast');
  const panel = page.locator('.fightpanel canvas');
  await panel.waitFor();
  expect(await panel.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([640, 73]);
  expect(await page.locator('.fightwindow').count()).toBe(0);
  // the panel contains drawn names (not just the empty frame): count light pixels in the name field
  const ink = await panel.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0x7f, 0x2c, 0x90, 9).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150) n++;
    return n;
  });
  expect(ink).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('"Kampf: 3D" shows the picture window with a rendered scene and the panel; right click closes it', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  await startFight(page, '3d');
  const view = page.locator('.fightview');
  await view.waitFor({ timeout: 30000 });
  expect(await view.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([600, 400]);
  expect(await page.locator('.fightwindow .fightpanel canvas').count()).toBe(1);
  // the scene is drawn: sky/ground colours, not a black canvas
  await page.waitForTimeout(700);
  const stats = await view.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, 600, 400).data;
    let nonBlack = 0; const colours = new Set<number>();
    for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 30) nonBlack++; colours.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4)); }
    return { nonBlack, colours: colours.size };
  });
  expect(stats.nonBlack).toBeGreaterThan(200000);
  expect(stats.colours).toBeGreaterThan(40);
  await view.click({ button: 'right' });
  await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a double click on a target opens only one weapon window and none remains after the fight', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const ok = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state, scr = app.running.screen;
    app.settings.fightMode = 'fast';
    const me = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.filter((w: any) => w.damage > 0).length >= 2);
    const foe = s.units.find((u: any) => u.alive && !u.container && u.owner !== 0 && u.owner < 6 && g.w.isEnemyOf(0, u));
    const free = g.w.neighbours(me.x, me.y).filter((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0)[0];
    s.unitAt[foe.y * s.width + foe.x] = -1; foe.x = free.x; foe.y = free.y; s.unitAt[free.y * s.width + free.x] = foe.id;
    s.vision.fill(255);
    const t = g.attackTargets(me.id).find((x: any) => x.unitId === foe.id);
    if (!t || [0, 1, 2, 3].filter((i) => t.weapons & (1 << i)).length < 2) return false;
    scr.mode = { kind: 'attack', unitId: me.id, targets: new Map([[foe.id, t.weapons]]) };
    // a double click delivers click, click, dblclick
    void scr.chooseWeaponAndAttack(me.id, foe.id); void scr.chooseWeaponAndAttack(me.id, foe.id); void scr.chooseWeaponAndAttack(me.id, foe.id);
    return true;
  });
  test.skip(!ok, 'no unit with two usable weapons in this setup');
  await page.locator('.weaponwin').first().waitFor();
  expect(await page.locator('.weaponwin').count()).toBe(1);
  await page.locator('.weaponwin .weapon-row').first().click();
  await page.locator('.fightpanel canvas').waitFor();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fightpanel canvas')).toHaveCount(0);
  expect(await page.locator('.weaponwin').count()).toBe(0);
  expect(errors).toEqual([]);
});
