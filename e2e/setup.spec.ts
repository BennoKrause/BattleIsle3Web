import { expect, test } from '@playwright/test';

// First start of a package without game data: the setup page imports the two CD images and then the game starts.
// Needs a package started without data, e.g. BI3_SETUP_URL=http://localhost:8796 and BI3_CD1 / BI3_CD2 as paths.
const url = process.env.BI3_SETUP_URL, cd1 = process.env.BI3_CD1, cd2 = process.env.BI3_CD2;

test.describe('first-start setup', () => {
  test.skip(!url || !cd1 || !cd2, 'set BI3_SETUP_URL, BI3_CD1 and BI3_CD2 (package started without game data)');

  test('rejects a wrong file, imports the two images and starts the game', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url!);
    await expect(page.locator('h1')).toContainText('Einrichtung');
    // wrong path
    await page.fill('#a', 'C:\gibt\es\nicht.iso');
    await page.fill('#b', cd2!);
    await page.click('#go');
    await expect(page.locator('#err')).toContainText('nicht gefunden');
    // not a Battle Isle CD (the same image twice)
    await page.fill('#a', cd2!);
    await page.click('#go');
    await expect(page.locator('#err')).toContainText('nicht die beiden');
    // right images, either order
    await page.fill('#a', cd2!);
    await page.fill('#b', cd1!);
    await page.click('#go');
    await expect(page.locator('#run')).toBeVisible();
    await expect(page.locator('#msg')).toContainText(/Video|Spieldateien|Einrichtung/);
    // the page switches to the game when the import is finished
    await page.waitForURL((u) => u.pathname === '/' && true, { timeout: 500_000 });
    await page.waitForSelector('.menu-row', { timeout: 120_000 });
    expect(errors).toEqual([]);
  });
});
