// The game "desktop": a fixed 840x600 logical screen (the original ran as Windows windows on a
// 640x480..1024x768 desktop with the background bitmap BKGD000), scaled to the browser window.
import type { Assets } from './assets.ts';

export const DESKTOP_W = 840;
export const DESKTOP_H = 600;

export class Desktop {
  readonly root: HTMLDivElement;
  readonly layer: HTMLDivElement;
  scale = 1;

  readonly mobile: boolean;

  constructor(host: HTMLElement, assets: Assets, mobile = false) {
    this.mobile = mobile;
    this.root = document.createElement('div');
    this.root.className = mobile ? 'desktop mobile-root' : 'desktop';
    if (!mobile) {
      this.root.style.width = `${DESKTOP_W}px`;
      this.root.style.height = `${DESKTOP_H}px`;
    }
    this.root.style.backgroundImage = `url(${assets.url('BKGD000', 'BG00_00')})`;
    this.layer = document.createElement('div');
    this.layer.className = 'desktop-layer';
    this.root.append(this.layer);
    host.append(this.root);
    if (mobile) return; // the phone interface fills the viewport (CSS), no scaling
    const fit = () => {
      this.scale = Math.max(0.5, Math.min(window.innerWidth / DESKTOP_W, window.innerHeight / DESKTOP_H));
      this.root.style.transform = `scale(${this.scale})`;
      this.root.style.left = `${Math.max(0, (window.innerWidth - DESKTOP_W * this.scale) / 2)}px`;
      this.root.style.top = `${Math.max(0, (window.innerHeight - DESKTOP_H * this.scale) / 2)}px`;
    };
    window.addEventListener('resize', fit);
    fit();
  }

  /** Converts a mouse event to desktop coordinates. */
  toDesktop(ev: MouseEvent) {
    const r = this.root.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / this.scale, y: (ev.clientY - r.top) / this.scale };
  }

  clear() {
    this.layer.replaceChildren();
  }
}

/** Absolutely positioned element helper. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, style: Partial<CSSStyleDeclaration> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.assign(e.style, style);
  parent?.append(e);
  return e;
}

/** A bitmap shown at a position (canvas copy of an original graphic). */
export function sprite(parent: HTMLElement, c: HTMLCanvasElement, x: number, y: number, cls = ''): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d')!.drawImage(c, 0, 0);
  copy.className = `sprite ${cls}`;
  copy.style.left = `${x}px`;
  copy.style.top = `${y}px`;
  parent.append(copy);
  return copy;
}

/** Three-state button from an original strip (normal / hover / pressed). */
export function button(parent: HTMLElement, assets: Assets, lib: string, name: string, x: number, y: number, onClick: () => void, title = ''): HTMLDivElement {
  const b = el('div', 'btn', parent, { left: `${x}px`, top: `${y}px` });
  const states = [0, 1, 2].map((s) => assets.buttonState(lib, name, s as 0 | 1 | 2));
  b.style.width = `${states[0].width}px`;
  b.style.height = `${states[0].height}px`;
  const set = (s: number) => { b.style.backgroundImage = `url(${states[s].toDataURL()})`; };
  set(0);
  b.title = title;
  b.addEventListener('mouseenter', () => set(1));
  b.addEventListener('mouseleave', () => set(0));
  b.addEventListener('mousedown', (e) => { e.stopPropagation(); set(2); });
  b.addEventListener('mouseup', () => set(1));
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.classList.contains('disabled')) onClick(); });
  return b;
}

/** Text drawn with an original bitmap font. */
export function label(parent: HTMLElement, canvas: HTMLCanvasElement, x: number, y: number): HTMLCanvasElement {
  canvas.classList.add('sprite');
  canvas.style.left = `${x}px`;
  canvas.style.top = `${y}px`;
  parent.append(canvas);
  return canvas;
}
