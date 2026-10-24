import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 400 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?nointro');
await page.waitForFunction(() => (window as any).bi3app?.fonts);
await page.evaluate(() => {
  const a = (window as any).bi3app;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#000;z-index:99999;padding:20px;display:flex;flex-direction:column;gap:14px';
  const add = (c: HTMLCanvasElement, scale: number) => { c.style.width = `${c.width * scale}px`; c.style.height = `${c.height * scale}px`; c.style.imageRendering = 'pixelated'; box.append(c); };
  add(a.fonts.large.render('Battle Isle 3 - Schatten des Imperators', '#f0e060'), 1.5);
  add(a.fonts.medium.render('Klicken oder Taste drücken zum Starten', '#c0d0c0'), 1.5);
  add(a.fonts.small.render('Neue Kampagne starten  GOLEM  Stärke 10/10', '#c4e89c'), 1.5);
  add(a.fonts.large.renderPalette('0123456789 320', a.assets.palette, 0xd0), 1.5);
  document.body.append(box);
});
await page.screenshot({ path: `${process.argv[2]}/fonts.png` });
await browser.close();
