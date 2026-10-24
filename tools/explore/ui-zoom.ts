// Map screenshot at a given zoom and scroll on a phone-sized viewport (looks for seams between the hexes).
// usage: node ui-zoom.ts <mission> <out.png> <zoom> <scrollX> <scrollY>
import { chromium, devices } from '@playwright/test';
const [id = '107', out = 'zoom.png', zoom = '1.5', sx = '0', sy = '0'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.goto(`http://localhost:5173/?mission=${id}`);
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 8; i++) { const sk = page.locator('.m-skip'); if (await sk.count()) await sk.first().click(); await page.waitForTimeout(250); }
await page.evaluate(([z, x, y]) => { const a = (window as any).bi3app, st = a.running.game.state; st.explored.fill(255); a.renderer.zoom = Number(z); a.renderer.scrollX = Number(x); a.renderer.scrollY = Number(y); a.running.screen.dirty = true; }, [zoom, sx, sy]);
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await browser.close();
