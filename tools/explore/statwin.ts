// Screenshots of the six tabs of the statistics window after a few rounds of mission 103.
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?mission=103&ui=desktop');
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => { const a = (window as any).bi3app; return !!a.running && !a.running.screen.busy && !document.querySelector('.video-framed, .msgbox, .menu'); })) break;
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const box = page.locator('.msgbox'); if (await box.count()) await box.first().click();
  await page.waitForTimeout(300);
}
await page.evaluate(() => {
  const g = (window as any).bi3app.running.game, s = g.state;
  // some history for the curves and a destroyed unit
  for (let r = 0; r < 12; r++) g.recordRoundStatistics();
  s.statistics.units[1] = s.statistics.units[1].map((v: number, i: number) => Math.max(0, v - i));
  const u = g.unitsOf(0)[0];
  s.statistics.destroyed[0] = [{ type: u.type, experience: 3, field: g.w.idx(u.x, u.y), name: 'Rote Baronin' }];
});
await page.click('[data-cmd="Statistikfenster"]');
const titles = ['Anzahl der Einheiten', 'Vernichtete eigene Einheiten', 'Energiehaushalt', 'Kartendaten', 'Allianzen', 'Top 5'];
for (let k = 0; k < 6; k++) {
  if (k > 0) await page.click(`.statwin [data-cmd="${titles[k]}"]`);
  await page.waitForTimeout(200);
  await page.locator('.statwin').screenshot({ path: `${out}/stat_${k}.png` });
}
console.log('errors', errors);
await browser.close();
