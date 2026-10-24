import { expect, test } from '@playwright/test';
import { openMission } from './helpers.ts';

// The music of a mission is the MIDI file M_<mission number in the set>.MID (SDI_1C.EXE w_music.c).
// Checks that the right file is selected, the Web Audio context runs and notes are scheduled, that
// it stops during videos and that the song loops. Audible quality cannot be asserted here.
test('mission 103 plays M_003.MID, setting switches to A_003.MID, off stops it', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 103, errors);
  await page.mouse.click(600, 400);
  await page.waitForFunction(() => (window as any).bi3app.music.notesStarted > 5, null, { timeout: 15000 });
  const s = await page.evaluate(() => { const a = (window as any).bi3app; return { file: a.musicFile, state: a.music.contextState, playing: a.music.playing }; });
  expect(s).toEqual({ file: 'M_003.MID', state: 'running', playing: true });
  const peak = await page.evaluate(async () => {
    const a = (window as any).bi3app; let m = 0;
    for (let i = 0; i < 40; i++) { m = Math.max(m, a.music.peak()); await new Promise((r) => setTimeout(r, 50)); }
    return m;
  });
  expect(peak).toBeGreaterThan(0.01);
  await page.evaluate(async () => { const a = (window as any).bi3app; a.settings.music = 1; await a.startMusic(3); });
  expect(await page.evaluate(() => (window as any).bi3app.musicFile)).toBe('A_003.MID');
  await page.evaluate(async () => { const a = (window as any).bi3app; a.settings.music = 0; await a.startMusic(3); });
  expect(await page.evaluate(() => (window as any).bi3app.music.playing)).toBe(false);
  expect(errors).toEqual([]);
});

test('music stops while a video plays and restarts afterwards', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 101, errors);
  await page.mouse.click(600, 400);
  await page.waitForFunction(() => (window as any).bi3app.music.playing && !document.querySelector('.video-full, .video-framed'));
  const during = await page.evaluate(async () => {
    const a = (window as any).bi3app;
    const p = a.video.play({ files: ['/gamedata/video/API001.mp4'], fullscreen: true });
    await new Promise((r) => setTimeout(r, 300));
    const playingDuring = a.music.playing;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
    await new Promise((r) => setTimeout(r, 500));
    return { playingDuring, playingAfter: a.music.playing };
  });
  expect(during).toEqual({ playingDuring: false, playingAfter: true });
});

test('the song restarts when it has ended', async ({ page }) => {
  const errors: string[] = [];
  await openMission(page, 100, errors);
  await page.mouse.click(600, 400);
  await page.waitForFunction(() => (window as any).bi3app.music.playing);
  // squeeze a short song through the real sequencer: three notes in 0.2 s
  const loops = await page.evaluate(async () => {
    const a = (window as any).bi3app;
    const ev = (t: number, kind: string, note: number) => ({ t, kind, ch: 0, note, vel: 90 });
    a.music.play({ events: [ev(0, 'on', 60), ev(0.1, 'off', 60), ev(0.2, 'on', 64), ev(0.3, 'off', 64)], duration: 0.3 });
    await new Promise((r) => setTimeout(r, 5500));
    return a.music.loops;
  });
  expect(loops).toBeGreaterThanOrEqual(2);
});
