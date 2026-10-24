// Creates the README screenshots in docs/screenshots (needs the dev server: npm run dev, and the imported game data).
import { chromium, devices } from '@playwright/test';
const out = 'docs/screenshots';
const base = 'http://localhost:5173';
const browser = await chromium.launch();

async function open(page: import('@playwright/test').Page, query: string) {
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
}

// start menu (skip the intro video)
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`${base}/?ui=desktop`);
  await page.waitForTimeout(2500);
  await page.mouse.click(500, 400);
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(700); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/menu.png` });
  await page.close();
}
// map with roads, rails and buildings (mission 107, snow)
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await open(page, 'mission=107&ui=desktop');
  await page.evaluate(() => { const a = (window as any).bi3app, st = a.running.game.state; st.explored.fill(255); st.vision.fill(255); a.renderer.scrollX = 900; a.renderer.scrollY = 0; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/map.png` });
  await page.close();
}
// fight statistics and 3D fight
for (const mode of ['2d', '3d'] as const) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await open(page, 'mission=100&ui=desktop');
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
  await page.waitForTimeout(mode === '2d' ? 2800 : 3500);
  await page.screenshot({ path: `${out}/fight-${mode}.png` });
  await page.close();
}
// phone
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(`${base}/?mission=100`);
  await page.waitForFunction(() => (window as any).bi3app?.running);
  for (let i = 0; i < 8; i++) { const sk = page.locator('.m-skip'); if (await sk.count()) await sk.first().click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/mobile.png` });
  await ctx.close();
}
await browser.close();
