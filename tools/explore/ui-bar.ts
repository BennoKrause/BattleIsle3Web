import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/?mission=100&ui=desktop');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
await page.screenshot({ path: process.argv[2], clip: { x: 560, y: 790, width: 640, height: 110 } });
await browser.close();
