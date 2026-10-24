// Triggers a fight in mission 100 (units placed next to each other) and screenshots the fight window.
import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?mission=100');
await page.waitForFunction(() => (window as any).bi3app?.running);
for (let i = 0; i < 8; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
const info = await page.evaluate(() => {
  const app = (window as any).bi3app, g = app.running.game, s = g.state;
  const me = g.unitsOf(0).find((x: any) => g.w.cls(x).weapons.some((w: any) => w.damage > 0 && w.minRange <= 1));
  const foe = s.units.find((u: any) => u.alive && !u.container && u.owner !== 0 && u.owner < 6 && g.w.isEnemyOf(0, u));
  const free = g.w.neighbours(me.x, me.y).filter((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0)[0];
  s.unitAt[foe.y * s.width + foe.x] = -1; foe.x = free.x; foe.y = free.y; s.unitAt[free.y * s.width + free.x] = foe.id;
  g.state.vision.fill(255);
  const t = g.attackTargets(me.id).find((x: any) => x.unitId === foe.id);
  (window as any).__ev = g.attack(me.id, foe.id).events;
  void app.running.screen.playEvents((window as any).__ev);
  return { me: me.id, foe: foe.id, t: !!t, kinds: (window as any).__ev.map((e: any) => e.kind), viewer: app.running.screen.viewer, vis: s.vision[foe.y * s.width + foe.x] };
});
console.log(info);
page.on('console', (m) => { if (m.type() !== 'debug') console.log(m.type(), m.text()); });
console.log(await page.evaluate(() => { const p = document.querySelector('.fightpanel'); return p ? [p.getBoundingClientRect().toJSON(), getComputedStyle(p).display] : 'none'; }));
for (const ms of [2600, 3300]) { await page.waitForTimeout(ms); await page.screenshot({ path: `${out}/fight_${ms}.png`, fullPage: false }); }
await browser.close();
