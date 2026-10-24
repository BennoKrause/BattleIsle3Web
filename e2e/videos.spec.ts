import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';

// Every converted video must be decodable by the browser and report a plausible duration.
// API900 is the unreferenced 7-frame test clip (identical to BIN/TST.AVI); ffmpeg decodes only its first frame.
const KNOWN_BAD = ['API900.mp4'];
const videos = readdirSync('public/gamedata/video').filter((f) => f.endsWith('.mp4') && !KNOWN_BAD.includes(f));
test('all converted videos decode in the browser', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/?nointro');
  const failures = await page.evaluate(async (files) => {
    const bad: string[] = [];
    for (const f of files) {
      const ok = await new Promise<boolean>((res) => {
        const v = document.createElement('video');
        v.preload = 'auto'; v.muted = true;
        v.onloadeddata = () => res(v.duration > 0.3 && v.videoWidth >= 320);
        v.onerror = () => res(false);
        v.src = `/gamedata/video/${f}`;
        setTimeout(() => res(false), 15000);
      });
      if (!ok) bad.push(f);
    }
    return bad;
  }, videos);
  expect(videos.length).toBe(142);
  expect(failures).toEqual([]);
});
