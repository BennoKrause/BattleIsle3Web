import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
await page.evaluate(() => { const a = (window as any).bi3app, g = a.running.game; const u = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.filter((w: any) => w.damage > 0).length >= 2) ?? g.unitsOf(0)[0]; a.running.screen.showUnitInfo(u.id); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/uia_small.png` });
await page.click('[data-cmd="UIA Vergrößern"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/uia_large.png` });
await browser.close();
