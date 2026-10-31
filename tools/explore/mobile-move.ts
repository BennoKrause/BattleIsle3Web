// Reproduces the mobile move test and prints errors and the state after the taps.
import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['iPhone 13'] });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 8; i++) { const sk = page.locator('.m-skip'); if (await sk.count()) await sk.first().click(); await page.waitForTimeout(200); }
const u = await page.evaluate(() => { const a = (window as any).bi3app, g = a.running.game; const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 3); return { id: u.id, pos: a.running.screen.fieldToClient(g.w.idx(u.x, u.y)) }; });
await page.touchscreen.tap(u.pos.x, u.pos.y);
await page.waitForTimeout(300);
console.log('card actions', await page.locator('.m-card [data-action]').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.action)));
await page.locator('[data-action="move"]').tap();
const t = await page.evaluate((id) => { const a = (window as any).bi3app, g = a.running.game; const t = [...g.moveArea(id).targets.keys()].pop(); return { t, pos: a.running.screen.fieldToClient(t), mode: a.running.screen.mode.kind }; }, u.id);
console.log('target', t);
await page.touchscreen.tap(t.pos.x, t.pos.y);
await page.waitForTimeout(2000);
console.log(await page.evaluate((id) => { const a = (window as any).bi3app, g = a.running.game, x = g.state.units[id]; return { at: g.w.idx(x.x, x.y), mode: a.running.screen.mode.kind, busy: a.running.screen.busy }; }, u.id));
console.log('errors', errors);
await browser.close();
