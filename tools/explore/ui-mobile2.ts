import { chromium, devices } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { const sk = page.locator('.m-skip'); if (await sk.count()) await sk.first().click(); await page.waitForTimeout(250); }
await page.waitForTimeout(500);
// weapon choice
await page.evaluate(() => {
  const app = (window as any).bi3app, g = app.running.game, s = g.state, scr = app.running.screen;
  app.settings.fightMode = '3d';
  const me = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.filter((w: any) => w.damage > 0).length >= 2);
  const foe = s.units.find((u: any) => u.alive && !u.container && u.owner !== 0 && u.owner < 6 && g.w.isEnemyOf(0, u));
  const free = g.w.neighbours(me.x, me.y).filter((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0)[0];
  s.unitAt[foe.y * s.width + foe.x] = -1; foe.x = free.x; foe.y = free.y; s.unitAt[free.y * s.width + free.x] = foe.id;
  s.vision.fill(255);
  const t = g.attackTargets(me.id).find((x: any) => x.unitId === foe.id);
  scr.mode = { kind: 'attack', unitId: me.id, targets: new Map([[foe.id, t.weapons]]) };
  void scr.chooseWeaponAndAttack(me.id, foe.id);
});
await page.waitForSelector('.m-weapons');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/m_weapon.png` });
await page.locator('.m-weapon').first().tap();
await page.waitForSelector('.m-fight-view');
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/m_fight.png` });
await browser.close();
