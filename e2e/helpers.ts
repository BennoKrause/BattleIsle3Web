import type { Page } from '@playwright/test';

/** Opens a mission directly (single-map start) and waits until the game screen is running. */
export async function openMission(page: Page, id: number, errors: string[], difficulty = 1) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?mission=${id}&difficulty=${difficulty}`);
  await page.waitForFunction(() => (window as any).bi3app?.running, null, { timeout: 60_000 });
  // dismiss briefing / event videos that run at mission start
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
}

export const MISSIONS = [
  ...Array.from({ length: 20 }, (_, i) => 100 + i),
  ...Array.from({ length: 8 }, (_, i) => 200 + i),
  ...Array.from({ length: 12 }, (_, i) => 300 + i),
];
