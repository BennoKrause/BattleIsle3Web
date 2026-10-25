// Phone: move a transporter, then open its cargo and move a unit out (reproduces a user report).
import { chromium, devices } from '@playwright/test';
const out = process.argv[2] ?? 'mcargo.png';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=103');
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 8; i++) { const sk = page.locator('.m-skip'); if (await sk.count()) await sk.first().click(); await page.waitForTimeout(200); }
const info = await page.evaluate(() => {
  const app = (window as any).bi3app, g = app.running.game, s = g.state;
  const t = g.unitsOf(0).find((u: any) => !u.container && u.cargo.length && g.canMove(u));
  const cc = g.w.cls(s.units[t.cargo[0]]);
  const coast = (f: number) => g.w.neighbours(f % s.width, Math.trunc(f / s.width)).some((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0 && s.shopAt[p.y * s.width + p.x] < 0 && ((cc.terrainMask >>> 0) & g.w.groundMask(p.x, p.y)) !== 0 && g.w.playable(p.x, p.y));
  const free = [...g.moveArea(t.id).targets.keys()].filter((f: any) => s.unitAt[f] < 0 && s.shopAt[f] < 0);
  const to = free.find((f: any) => coast(f)) ?? free[0];
  return { id: t.id, to, field: g.w.idx(t.x, t.y) };
});
console.log('transporter', info);
// select the transporter by tapping, then move it via the card
const tapField = async (f: number) => {
  await page.evaluate((ff) => { const a = (window as any).bi3app; const s = a.running.game.state; a.renderer.centerOn(s, ff % s.width, Math.trunc(ff / s.width)); a.running.screen.dirty = true; }, f);
  await page.waitForTimeout(400);
  // the position after the layout has settled (the card at the bottom changes the size of the map)
  const p = await page.evaluate((ff) => (window as any).bi3app.running.screen.fieldToClient(ff), f);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(400);
};
await tapField(info.field);
console.log('card actions:', await page.locator('[data-action]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.action)));
await page.locator('[data-action="move"]').first().tap();
await tapField(info.to);
await page.waitForTimeout(1500);
console.log('after move flags:', await page.evaluate((id) => (window as any).bi3app.running.game.state.units[id].flags, info.id));
console.log('card after move:', await page.locator('[data-action]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.action)));
// tap the transporter again
await tapField(info.to);
console.log('card on tap:', await page.locator('[data-action]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.action)));
console.log('state:', await page.evaluate((id) => { const a = (window as any).bi3app, sc = a.running.screen, g = a.running.game, u = g.state.units[id];
  return { busy: sc.busy, mode: sc.mode.kind, canAct: sc.canAct(), cargoLeave: sc.cargoCanLeave(u), cargo: u.cargo.map((c: number) => ({ c, canMove: g.canMove(g.state.units[c]), flags: g.state.units[c].flags })), unitAt: g.state.unitAt[g.w.idx(u.x, u.y)] === id }; }, info.id));
await tapField(info.to);
console.log('card on 2nd tap:', await page.locator('[data-action]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.action)));
await page.locator('[data-action="cargo"]').first().tap();
await page.waitForTimeout(300);
await page.locator('.m-cargo button[data-unit]:not([disabled])').first().tap();
await page.waitForTimeout(300);
console.log('mode after choosing cargo:', await page.evaluate(() => { const m = (window as any).bi3app.running.screen.mode; return { kind: m.kind, fields: m.area?.size ?? 0 }; }));
await page.screenshot({ path: out });
await browser.close();
