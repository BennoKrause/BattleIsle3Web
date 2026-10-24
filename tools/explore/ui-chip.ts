import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
const pos = await page.evaluate(() => {
  const app = (window as any).bi3app; const g = app.running.game;
  const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 3);
  return app.running.screen.fieldToClient(g.w.idx(u.x, u.y));
});
await page.mouse.click(pos.x, pos.y);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/chip.png` });
await browser.close();
