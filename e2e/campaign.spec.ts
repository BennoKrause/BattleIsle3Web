import { expect, test } from '@playwright/test';

// Campaign transitions in the real UI. The victory itself is forced (state.outcome); this test proves
// the transition chain (end videos, pool transfer, next mission, password), NOT that the mission is
// winnable. Playability per mission is covered by missions.spec.ts and docs/testing/CAMPAIGN_VALIDATION.md.
test('forced victory of the first mission leads to the second campaign mission with carried-over units', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nointro');
  await page.waitForFunction(() => (window as any).bi3app);
  await page.evaluate(async () => {
    const app = (window as any).bi3app;
    // = newCampaign(0, Normal); written out so that the test also runs against a built package (no source modules there)
    void app.runCampaign({ version: 1, setId: 0, difficulty: 1, missionIndex: 0, pool: [], seenSequences: [], completed: [], finished: false });
  });
  // chapter video and briefing are skipped with ESC (original behaviour)
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!(window as any).bi3app.running)); i++) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  const first = await page.evaluate(() => (window as any).bi3app.running.mission.fileId);
  expect(first).toBe(100);
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.evaluate(() => {
    const app = (window as any).bi3app; const g = app.running.game;
    g.state.outcome = { result: 'victory', turn: g.state.turn, conditions: [0] };
    void app.onOutcome();
  });
  let second = first;
  for (let i = 0; i < 40 && second === first; i++) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    second = await page.evaluate(() => (window as any).bi3app.running?.mission.fileId ?? 0);
  }
  expect(second).toBe(101);
  const pool = await page.evaluate(() => (window as any).bi3app.running.campaign.completed);
  expect(pool).toEqual([100]);
  expect(errors).toEqual([]);
});
