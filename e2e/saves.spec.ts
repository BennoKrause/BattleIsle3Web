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

test('save on the server, list it and load it again', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  const result = await page.evaluate(async () => {
    const app = (window as any).bi3app;
    const snap = app.snapshot('e2e server');
    const put = await fetch('/__saves/7', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
    const list = await (await fetch('/__saves')).json();
    const back = await (await fetch('/__saves/7')).json();
    const bad = await fetch('/__saves/7', { method: 'PUT', body: '{"no":"save"}' });
    await fetch('/__saves/7', { method: 'DELETE' });
    const gone = await fetch('/__saves/7');
    return { put: put.status, label: list[7]?.label, slots: list.length, same: JSON.stringify(back.state) === JSON.stringify(snap.state), bad: bad.status, gone: gone.status };
  });
  expect(result).toEqual({ put: 200, label: 'e2e server', slots: 10, same: true, bad: 400, gone: 404 });
  expect(errors).toEqual([]);
});
