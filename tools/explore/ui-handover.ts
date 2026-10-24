// Measures the computer move and shows the "Nächster Spieler" requester over the statistics window.
import { chromium } from '@playwright/test';
const [id = '107', out = 'handover.png'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5173/?mission=${id}&ui=desktop`);
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
const t0 = Date.now();
await page.click('[data-cmd="Spielerwechsel"]');
await page.waitForSelector('.msgbox', { timeout: 300000 });
console.log('computer move took', ((Date.now() - t0) / 1000).toFixed(1), 's; window still open:', await page.locator('.computerwin').count());
await page.screenshot({ path: out });
await page.locator('.msgbox').click();
await page.waitForTimeout(500);
console.log('after OK, window:', await page.locator('.computerwin').count(), 'human turn:', await page.evaluate(() => (window as any).bi3app.running.game.isHumanTurn()));
await browser.close();
