// Saves the bitmaps of LIB/ST000.LIB as PNG files (statistics window tabs / buttons).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/?nointro&ui=desktop');
await page.waitForFunction(() => (window as any).bi3app?.assets, null, { timeout: 60000 });
const urls = await page.evaluate(() => {
  const a = (window as any).bi3app.assets;
  return a.names("CURS000").map((n: string) => { try { const c = a.canvas("CURS000", n); return [n, c.width, c.height, c.toDataURL()]; } catch (e) { return [n, 0, 0, String(e)]; } });
});
for (const [n, w, h, u] of urls) { console.log(n, w, h); if (String(u).startsWith('data:')) writeFileSync(`${out}/${n}.png`, Buffer.from(String(u).split(',')[1], 'base64')); }
await browser.close();
