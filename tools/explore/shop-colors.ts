// Prints, for every building on screen, its owner, the owner's colour scheme and the colours drawn at its field centre.
import { chromium } from '@playwright/test';
const id = process.argv[2] ?? '104';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://localhost:5173/?mission=${id}&ui=desktop`);
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
const out = await page.evaluate(() => {
  const app = (window as any).bi3app, g = app.running.game, s = g.state, r = app.renderer;
  s.explored.fill(255); s.vision.fill(255); r.scrollX = 0; r.scrollY = 0;
  app.running.screen.dirty = true;
  return s.shops.map((sh: any) => ({ x: sh.x, y: sh.y, owner: sh.owner, scheme: app.running.screen.ctx.chroma[Math.min(sh.owner, 6)].scheme, at: app.running.screen.fieldToClient(g.w.idx(sh.x, sh.y)) }));
});
await page.waitForTimeout(500);
for (const o of out) {
  if (o.at.x > 860 || o.at.y > 720) continue;
  const shot = await page.screenshot({ clip: { x: o.at.x - 20, y: o.at.y - 20, width: 40, height: 40 } });
  await import('node:fs').then((fs) => fs.writeFileSync(`${process.env.OUT}/shop_${o.x}_${o.y}_o${o.owner}_s${o.scheme}.png`, shot));
  console.log(o);
}
await browser.close();
