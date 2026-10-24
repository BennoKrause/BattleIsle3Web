// Screenshot of a mission map after skipping the briefing. usage: node ui-roads.ts <mission> <out.png> [scrollX scrollY]
import { chromium } from '@playwright/test';
const [id = '100', out = 'roads.png', sx = '0', sy = '0'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://localhost:5173/?mission=${id}&ui=desktop`);
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
await page.evaluate(() => { const st = (window as any).bi3app.running.game.state; st.explored.fill(255); st.vision.fill(255); });
await page.evaluate(([x, y]) => { const r = (window as any).bi3app.renderer; r.scrollX = Number(x); r.scrollY = Number(y); }, [sx, sy]);
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await browser.close();
