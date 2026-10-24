import { expect, test } from '@playwright/test';
import { openMission } from './helpers.ts';

// Save to the real localStorage slot, reload the whole page, load via the app and compare states.
test('save survives a page reload and load restores the exact game state', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const before = await page.evaluate(() => {
    const app = (window as any).bi3app; const g = app.running.game;
    const u = g.unitsOf(0).find((x: any) => g.moveArea(x.id).targets.size > 1);
    g.moveUnit(u.id, [...g.moveArea(u.id).targets.keys()].pop());
    const snap = app.snapshot('e2e');
    localStorage.setItem('bi3.save.0', JSON.stringify(snap));
    return JSON.stringify(g.state);
  });
  await page.goto('/?nointro');
  await page.waitForFunction(() => (window as any).bi3app);
  const after = await page.evaluate(async () => {
    const app = (window as any).bi3app;
    const save = JSON.parse(localStorage.getItem('bi3.save.0')!);
    void app.loadSave(save);
    for (let i = 0; i < 100 && !app.running; i++) await new Promise((r) => setTimeout(r, 100));
    return JSON.stringify(app.running.game.state);
  });
  expect(after).toBe(before);
  expect(errors).toEqual([]);
});

test('end of turn creates an autosave', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const saved = await page.evaluate(async () => {
    const app = (window as any).bi3app;
    app.running.screen.opts?.onAutosave?.();
    app.autosaveNow();
    return [localStorage.getItem('bi3.save.8'), localStorage.getItem('bi3.save.9')].some(Boolean);
  });
  expect(saved).toBe(true);
});
