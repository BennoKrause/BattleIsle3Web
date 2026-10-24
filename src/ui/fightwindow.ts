// 3D fight window (manual p. 39): picture window with the original frame (LIB/FF000: top strip, two side
// bars) and the statistics panel below it (fightpanel.ts). 640x480 variant ("Kampfgröße 640 x 480").
// The picture is produced by render/fight3d.ts.
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { el } from './desktop.ts';
import { DESKTOP_H, DESKTOP_W } from './desktop.ts';
import { createFightPanel, type FightPanelInput } from './fightpanel.ts';
import { FightScene, Raster, VIEW_H, VIEW_W, type FightAssets, type FightInput3D } from '../render/fight3d.ts';
import type { FxPlayer } from '../audio/fx.ts';

const WIN_W = 640, WIN_H = 480;

export interface FightWindowOptions {
  assets: Assets;
  fonts: { small: BitmapFont; large: BitmapFont };
  fight3d: FightAssets;
  fx: FxPlayer;
  panel: FightPanelInput;
  scene: FightInput3D;
}

/** Shows the 3D fight; resolves when it is over or skipped with ESC / right mouse button. */
export function showFightWindow(parent: HTMLElement, o: FightWindowOptions): Promise<void> {
  return new Promise((resolve) => {
    const box = el('div', 'fightwindow', parent, { left: `${(DESKTOP_W - WIN_W) / 2}px`, top: `${(DESKTOP_H - WIN_H) / 2}px`, width: `${WIN_W}px`, height: `${WIN_H}px` });
    box.style.zIndex = '4800';
    const view = document.createElement('canvas');
    view.width = VIEW_W; view.height = VIEW_H;
    view.className = 'fightview';
    view.style.cssText = 'position:absolute;left:20px;top:6px;image-rendering:auto';
    box.append(view);
    const piece = (name: string, x: number, y: number) => {
      const c = o.assets.canvas('FF000', name);
      c.classList.add('fightframe');
      const k = document.createElement('canvas');
      k.width = c.width; k.height = c.height;
      k.getContext('2d')!.drawImage(c, 0, 0);
      k.style.cssText = `position:absolute;left:${x}px;top:${y}px;pointer-events:none`;
      box.append(k);
    };
    piece('FF00_00', 0, 0); piece('FF00_01', 0, 0); piece('FF00_02', WIN_W - 20, 0);

    const scene = new FightScene(o.fight3d, o.scene);
    const firstHit = Math.min(...scene.sounds.filter((s) => s.lib === 'FGTEXPLO').map((s) => s.t), scene.duration);
    const panel = createFightPanel(box, o.assets, o.fonts, o.panel, { left: 0, top: WIN_H - 73, startDelay: firstHit, embedded: true });

    const raster = new Raster(VIEW_W, VIEW_H);
    const ctx = view.getContext('2d')!;
    const img = ctx.createImageData(VIEW_W, VIEW_H);
    const total = Math.max(scene.duration, firstHit + 2600);
    const cues = [...scene.sounds].sort((a, b) => a.t - b.t);
    let cue = 0, closed = false;
    const start = performance.now();

    const finish = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      panel.close();
      box.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); finish(); });
    box.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.button === 2) finish(); });

    const frame = () => {
      if (closed) return;
      const t = performance.now() - start;
      while (cue < cues.length && cues[cue].t <= t) { void o.fx.play(o.fight3d.wave(cues[cue].lib, cues[cue].index)); cue++; }
      scene.render(Math.min(t, scene.duration), raster);
      new Uint32Array(img.data.buffer).set(raster.color);
      ctx.putImageData(img, 0, 0);
      if (t >= total) { finish(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
