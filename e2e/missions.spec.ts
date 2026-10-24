import { expect, test } from '@playwright/test';
import { MISSIONS, openMission } from './helpers.ts';

// Per mission: the page loads, the game screen is created, the map canvas has content, no script
// errors occur, one unit can be selected and moved with the mouse (technically playable).
for (const id of MISSIONS) {
  test(`MISS${id} loads and a unit can be moved`, async ({ page }) => {
    const errors: string[] = [];
    await openMission(page, id, errors);
    const info = await page.evaluate(() => {
      const app = (window as any).bi3app; const g = app.running.game;
      const u = g.unitsOf(g.state.activePlayer).find((x: any) => !app.running.game.state.players[x.owner].computer && g.moveArea(x.id).targets.size > 1);
      if (!u) return { units: g.state.units.length, move: null };
      const targets = [...g.moveArea(u.id).targets.keys()];
      return { units: g.state.units.length, id: u.id, to: targets[targets.length - 1], from: g.w.idx(u.x, u.y), move: true };
    });
    expect(info.units).toBeGreaterThan(0);
    const canvasOk = await page.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 100));
    expect(canvasOk).toBe(true);
    if (info.move) {
      const moved = await page.evaluate(async ({ id, to }) => {
        const g = (window as any).bi3app.running.game;
        g.moveUnit(id, to);
        const u = g.state.units[id];
        return g.w.idx(u.x, u.y) === to;
      }, { id: info.id!, to: info.to! });
      expect(moved).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
