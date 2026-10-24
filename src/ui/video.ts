// Video playback of the converted original AVIs (public/gamedata/video/APInnn.mp4).
// Framed videos (VIDEOSEQUENCE kind 0, 320x240 Indeo) appear in the original video frame
// (CMFRM000 pieces) over the game; full-screen videos (kind 2, 640x480 slide shows, intro,
// epilogue) cover the screen. ESC skips; SPACE skips to the next part of a multi-part sequence
// (README.TXT: "Der Vorspann kann mithilfe der LEER-Taste zum nächsten Punkt ... vorgespult werden").
import type { Assets } from './assets.ts';
import { el } from './desktop.ts';

export interface VideoRequest {
  files: string[];
  fullscreen: boolean;
  /** Allow SPACE to jump to the next file. */
  parts?: boolean;
}

export const videoUrl = (file: number | string) =>
  typeof file === 'number' ? `/gamedata/video/API${String(file).padStart(3, '0')}.mp4` : `/gamedata/video/${file}.mp4`;

export class VideoPlayer {
  private parent: HTMLElement;
  private assets: Assets;
  volume = 1;
  /** Called with the file name of each started video (for tests / statistics). */
  onStart?: (file: string) => void;
  /** Called before a video sequence starts / after it ended (the original stops the MIDI music during videos). */
  onBegin?: () => void;
  onEnd?: () => void;

  constructor(parent: HTMLElement, assets: Assets) {
    this.parent = parent;
    this.assets = assets;
  }

  /** Plays the files one after another; resolves when finished or skipped. Missing files are reported, not fatal. */
  play(req: VideoRequest): Promise<{ skipped: boolean; errors: string[] }> {
    this.onBegin?.();
    return this.playSequence(req).finally(() => this.onEnd?.());
  }

  private playSequence(req: VideoRequest): Promise<{ skipped: boolean; errors: string[] }> {
    return new Promise((resolve) => {
      const box = el('div', req.fullscreen ? 'video-full' : 'video-framed', this.parent);
      if (!req.fullscreen) {
        const frame = (name: string, x: number, y: number) => {
          const c = this.assets.canvas('CMFRM000', name);
          const e = el('div', 'frame-piece', box, { left: `${x}px`, top: `${y}px`, width: `${c.width}px`, height: `${c.height}px` });
          e.style.backgroundImage = `url(${c.toDataURL()})`;
        };
        frame('01', 40, 0); frame('02', 0, 0); frame('03', 40, 270); frame('04', 360, 0);
      }
      const video = el('video', 'video-el', box);
      if (document.body.classList.contains('mobile-ui')) {
        // phones: visible skip button (no ESC / SPACE)
        const skip = el('button', 'm-skip', box);
        skip.textContent = req.parts ? 'Weiter ▶' : 'Überspringen ▶';
        skip.addEventListener('click', (e) => { e.stopPropagation(); if (req.parts && idx < req.files.length) next(); else finish(true); });
      }
      video.playsInline = true;
      video.volume = this.volume;
      const errors: string[] = [];
      let idx = 0;
      let done = false;
      const finish = (skipped: boolean) => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        video.pause();
        box.remove();
        resolve({ skipped, errors });
      };
      const next = () => {
        if (idx >= req.files.length) { finish(false); return; }
        const f = req.files[idx++];
        video.src = f;
        this.onStart?.(f);
        video.play().catch((e) => {
          // autoplay with sound may be blocked until the first user gesture: retry muted
          if (e?.name === 'NotAllowedError') { video.muted = true; video.play().catch(() => next()); } else { errors.push(f); next(); }
        });
      };
      video.addEventListener('ended', next);
      video.addEventListener('error', () => { errors.push(String(video.src)); next(); });
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
        else if (e.key === ' ' && req.parts) { e.preventDefault(); e.stopPropagation(); next(); }
      };
      window.addEventListener('keydown', onKey, true);
      box.addEventListener('click', () => (req.parts ? next() : finish(true)));
      next();
    });
  }
}
