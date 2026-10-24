// Takes a screenshot of the running dev server (npm run dev) for visual checks.
// usage: node tools/shot.ts <url-path> <out.png> [waitMs] [js-to-eval-before-shot]
import { chromium } from '@playwright/test';

const [path = '/', out = 'shot.png', wait = '1500', script = ''] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const logs: string[] = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5173${path}`);
await page.waitForTimeout(Number(wait));
if (script) {
  console.log('eval:', await page.evaluate(script));
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out });
for (const l of logs) console.log(l);
await browser.close();
