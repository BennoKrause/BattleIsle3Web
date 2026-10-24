import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
const info = await page.evaluate(() => {
  const app = (window as any).bi3app; const g = app.running.game;
  const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 3);
  const targets = [...g.moveArea(u.id).targets.keys()];
  return { id: u.id, from: g.w.idx(u.x, u.y), to: targets[targets.length - 1], pos: app.running.screen.fieldToClient(g.w.idx(u.x, u.y)) };
});
console.log(info);
await page.mouse.click(info.pos.x, info.pos.y);
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2] + '/ui1.png' });
await page.click('[data-cmd="Bewegen"]');
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2] + '/ui2.png' });
const tp = await page.evaluate((f) => (window as any).bi3app.running.screen.fieldToClient(f), info.to);
await page.mouse.click(tp.x, tp.y);
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] + '/ui3.png' });
console.log(await page.evaluate((id) => { const u = (window as any).bi3app.running.game.state.units[id]; return { x: u.x, y: u.y, flags: u.flags }; }, info.id));
await browser.close();
