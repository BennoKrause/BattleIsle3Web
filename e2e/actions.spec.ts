// Special unit commands through the chip window: refuel by a tanker, road building, climbing (src/engine/support.ts).
import { expect, test, type Page } from '@playwright/test';
import { openMission as open } from './helpers.ts';

/** Opens a mission with the overview window hidden (it covers the upper right corner of the map). */
async function openMission(page: Page, id: number, errors: string[]) {
  await open(page, id, errors);
  await page.click('[data-cmd="Übersichtsfenster"]');
}

/** Places `type` (player 0) next to the first own unit matching `pred` and returns both ids and their screen positions. */
async function pair(page: Page, supplierType: number) {
  return page.evaluate((st) => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    const sup = g.unitsOf(0).find((u: any) => u.type === st && !u.container);
    const other = g.unitsOf(0).find((u: any) => u.id !== sup.id && !u.container && g.w.cls(u).fuel > 0 && !(g.w.cls(u).flags & 0x800000));
    // move the other unit next to the supplier
    const free = g.w.neighbours(sup.x, sup.y).find((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0 && g.w.playable(p.x, p.y));
    s.unitAt[other.y * s.width + other.x] = -1; other.x = free.x; other.y = free.y; s.unitAt[free.y * s.width + free.x] = other.id;
    other.fuel = 1;
    app.renderer.centerOn(s, sup.x, sup.y);
    const scr = app.running.screen;
    return { sup: sup.id, other: other.id, supPos: scr.fieldToClient(g.w.idx(sup.x, sup.y)), otherPos: scr.fieldToClient(g.w.idx(other.x, other.y)) };
  }, supplierType);
}

test('a tanker refuels a neighbouring unit via the chip window', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 104, errors);
  const p = await pair(page, 18); // ALGOL
  await page.waitForTimeout(200);
  await page.mouse.click(p.supPos.x, p.supPos.y);
  await page.locator('.chipwin [data-cmd="Auftanken / Munition"]').click();
  await page.mouse.click(p.otherPos.x, p.otherPos.y);
  await expect.poll(() => page.evaluate((id) => {
    const g = (window as any).bi3app.running.game, u = g.state.units[id];
    return u.fuel === g.w.cls(u).fuel;
  }, p.other)).toBe(true);
  expect(errors).toEqual([]);
});

test('a construction vehicle builds a road next to it', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 104, errors);
  const info = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    const pl = g.unitsOf(0).find((u: any) => u.type === 0 && !u.container); // PLANUM 5
    const targets = g.buildTargets(pl.id);
    const field = [...targets].find(([, o]: any) => o & 1)?.[0];
    app.renderer.centerOn(s, pl.x, pl.y);
    const scr = app.running.screen;
    return { id: pl.id, field, pos: scr.fieldToClient(g.w.idx(pl.x, pl.y)), target: field === undefined ? null : scr.fieldToClient(field) };
  });
  expect(info.field, 'a road field next to the PLANUM').not.toBeUndefined();
  await page.waitForTimeout(200);
  await page.mouse.click(info.pos.x, info.pos.y);
  await page.locator('.chipwin [data-cmd="Bauen"]').click();
  await page.locator('.chipwin [data-cmd="Straße bauen"]').click();
  await page.mouse.click(info.target!.x, info.target!.y);
  await expect.poll(() => page.evaluate((f) => {
    const g = (window as any).bi3app.running.game;
    const o = g.state.overlay[f];
    return o >= 0 && (g.data.terrain[o].typeMask & 1) === 1;
  }, info.field)).toBe(true);
  expect(errors).toEqual([]);
});

test('a reconnaissance plane climbs to high altitude', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 110, errors);
  const info = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    const uhu = g.unitsOf(0).find((u: any) => u.type === 31 && !u.container);
    app.renderer.centerOn(s, uhu.x, uhu.y);
    return { id: uhu.id, pos: app.running.screen.fieldToClient(g.w.idx(uhu.x, uhu.y)) };
  });
  await page.waitForTimeout(200);
  await page.mouse.click(info.pos.x, info.pos.y);
  await page.locator('.chipwin [data-cmd="Steigen"]').click();
  await expect.poll(() => page.evaluate((id) => (window as any).bi3app.running.game.state.units[id].layer, info.id)).toBe(0);
  expect(errors).toEqual([]);
});

test('after moving a transporter its cargo can still be unloaded', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 103, errors);
  const info = await page.evaluate(() => {
    const app = (window as any).bi3app, g = app.running.game, s = g.state;
    const t = g.unitsOf(0).find((u: any) => !u.container && u.cargo.length && g.canMove(u))!;
    // a free field on the coast: one of its neighbours is land the cargo may drive on
    const cargoCls = g.w.cls(s.units[t.cargo[0]]);
    const coast = (f: number) => g.w.neighbours(f % s.width, Math.trunc(f / s.width)).some((p: any) => p && s.unitAt[p.y * s.width + p.x] < 0 && s.shopAt[p.y * s.width + p.x] < 0
      && ((cargoCls.terrainMask >>> 0) & g.w.groundMask(p.x, p.y)) !== 0 && g.w.playable(p.x, p.y));
    const to = [...g.moveArea(t.id).targets.keys()].find((f: any) => s.unitAt[f] < 0 && s.shopAt[f] < 0 && coast(f)) as number;
    g.moveUnit(t.id, to);
    app.renderer.centerOn(s, t.x, t.y);
    app.running.screen.dirty = true;
    return { id: t.id, done: !!(t.flags & 16), cargo: t.cargo[0], pos: app.running.screen.fieldToClient(g.w.idx(t.x, t.y)) };
  });
  await page.waitForTimeout(300);
  await page.mouse.click(info.pos.x, info.pos.y);
  await page.locator('.chipwin [data-cmd="Transporter"]').click();
  await page.locator(`.cargowin [data-unit="${info.cargo}"]`).click();
  const mode = await page.evaluate(() => { const m = (window as any).bi3app.running.screen.mode; return { kind: m.kind, fields: m.area?.size ?? 0 }; });
  expect(mode.kind).toBe('move');
  expect(mode.fields).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
