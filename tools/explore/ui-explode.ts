// Shows the explosion of a destroyed unit on the map (EXPLO000 frames).
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'explode.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=100&ui=desktop');
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
const info = await page.evaluate(() => {
  const a = (window as any).bi3app, g = a.running.game, s = g.state;
  const u = g.unitsOf(0).find((x: any) => !x.container);
  const ev = { seq: s.eventSeq + 1, kind: 'unit-destroyed', turn: 0, data: { unitId: u.id, x: u.x, y: u.y } };
  void a.running.screen.playEvents([ev]);
  return { x: u.x, y: u.y, pos: a.running.screen.fieldToClient(g.w.idx(u.x, u.y)), played: a.fx?.played };
});
await page.waitForTimeout(350);
await page.screenshot({ path: out, clip: { x: info.pos.x - 60, y: info.pos.y - 60, width: 120, height: 120 } });
console.log(info, await page.evaluate(() => (window as any).bi3app.fx?.played));
await browser.close();
