// Moves a ground unit of the human player and saves a screenshot of the map (tyre tracks, map cursor).
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?mission=104&ui=desktop');
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => { const a = (window as any).bi3app; return !!a.running && !a.running.screen.busy && !document.querySelector('.video-framed, .msgbox, .menu'); })) break;
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const box = page.locator('.msgbox'); if (await box.count()) await box.first().click();
  await page.waitForTimeout(300);
}
const info = await page.evaluate(() => {
  const a = (window as any).bi3app, g = a.running.game, s = g.state;
  const u = g.unitsOf(0).find((x: any) => !x.container && !(g.w.cls(x).flags & 0x1000) && !(g.w.cls(x).flags & 0x800000) && g.moveArea(x.id).targets.size > 4);
  const far = [...g.moveArea(u.id).targets.keys()].filter((f: number) => s.unitAt[f] < 0 && s.shopAt[f] < 0).pop();
  g.moveUnit(u.id, far);
  a.renderer.centerOn(s, u.x, u.y);
  a.running.screen.cursor = g.w.idx(u.x, u.y);
  a.running.screen.dirty = true;
  return { id: u.id, tracks: (s.tracks ?? []).filter((t: number) => t).length };
});
await page.waitForTimeout(1500);
await page.locator('.map-canvas').screenshot({ path: `${out}/tracks.png` });
console.log(info, 'errors', errors);
await browser.close();
