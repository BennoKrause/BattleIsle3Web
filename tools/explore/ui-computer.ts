// Screenshot while the computer players move (computer window, SDI_1C.EXE w_computer.c).
import { chromium } from '@playwright/test';
const [id = '107', out = 'computer.png', delay = '400'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://localhost:5173/?mission=${id}&ui=desktop`);
await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60000 });
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
await page.click('[data-cmd="Spielerwechsel"]');
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.waitForTimeout(800);
console.log(await page.evaluate(() => { const a = (window as any).bi3app; const s = a.running.game.state; return { active: s.activePlayer, players: s.players.map((p: any) => [p.index, p.alive, p.computer]), win: !!document.querySelector('.computerwin'), msg: document.querySelector('.msgbox')?.textContent }; }));
await page.waitForTimeout(Number(delay));
await page.screenshot({ path: out });
await browser.close();
