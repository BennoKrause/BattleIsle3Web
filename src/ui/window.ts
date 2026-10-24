// Draggable game windows. Fixed-size windows use a complete original bitmap as background
// (UI000, SI000, SP000, WW000, ...); resizable windows (map, overview) are framed with the
// FRMS000 edge pieces like the original.
import type { Assets } from './assets.ts';
import { el } from './desktop.ts';

let zTop = 10;

export class GameWindow {
  readonly el: HTMLDivElement;
  readonly body: HTMLDivElement;
  private onCloseCb?: () => void;

  constructor(parent: HTMLElement, opts: { x: number; y: number; w: number; h: number; bg?: string; framed?: boolean; assets?: Assets; cls?: string; dragArea?: number }) {
    this.el = el('div', `gwin ${opts.cls ?? ''}`, parent, { left: `${opts.x}px`, top: `${opts.y}px`, width: `${opts.w}px`, height: `${opts.h}px` });
    if (opts.bg) this.el.style.backgroundImage = `url(${opts.bg})`;
    this.body = el('div', 'gwin-body', this.el);
    if (opts.framed && opts.assets) this.frame(opts.assets, opts.w, opts.h);
    this.el.addEventListener('mousedown', () => this.toFront());
    this.enableDrag(opts.dragArea ?? 16);
    this.toFront();
  }

  private frame(a: Assets, w: number, h: number) {
    // edges are stretched to the window size (the original bitmaps are 800 / 579 pixels long)
    const piece = (name: string, x: number, y: number, cw: number, ch: number) => {
      const c = a.canvas('FRMS000', name);
      el('div', 'frame-piece', this.el, { left: `${x}px`, top: `${y}px`, width: `${cw}px`, height: `${ch}px`, backgroundImage: `url(${c.toDataURL()})`, backgroundSize: '100% 100%' });
    };
    piece('FR00_00', 0, 0, 16, h);
    piece('FR00_02', w - 16, 0, 16, h);
    piece('FR00_01', 0, 0, w, 16);
    piece('FR00_03', 0, h - 16, w, 16);
    this.body.style.inset = '16px';
  }

  private enableDrag(area: number) {
    let start: { x: number; y: number; l: number; t: number } | null = null;
    this.el.addEventListener('mousedown', (e) => {
      const r = this.el.getBoundingClientRect();
      const scale = r.width / this.el.offsetWidth;
      if ((e.clientY - r.top) / scale > area) return;
      start = { x: e.clientX, y: e.clientY, l: this.el.offsetLeft, t: this.el.offsetTop };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!start) return;
      const scale = this.el.getBoundingClientRect().width / this.el.offsetWidth;
      this.el.style.left = `${start.l + (e.clientX - start.x) / scale}px`;
      this.el.style.top = `${start.t + (e.clientY - start.y) / scale}px`;
    });
    window.addEventListener('mouseup', () => { start = null; });
  }

  toFront() { this.el.style.zIndex = String(++zTop); }
  onClose(cb: () => void) { this.onCloseCb = cb; }
  close() { this.el.remove(); this.onCloseCb?.(); }
  set visible(v: boolean) { this.el.style.display = v ? '' : 'none'; }
  get visible() { return this.el.style.display !== 'none'; }
}
