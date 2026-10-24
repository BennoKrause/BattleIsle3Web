// Generic menus of the original (Disk-Menü, Setup, difficulty, ...), assembled from SETUP000:
// SU01_00 header with title field, SU01_02 one line per entry (yellow button + text field),
// SU01_01 footer with the X button (SU01_03), SU01_04 = the small yellow entry button (3 states).
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { el, label } from './desktop.ts';
import { DESKTOP_H, DESKTOP_W } from './desktop.ts';
import { isMobileUi } from './mobile/detect.ts';
import { COLORS, fitScale, setText } from './mobile/pixel.ts';

export interface MenuItem { text: string; enabled?: boolean; action: () => void }

export class Menu {
  readonly el: HTMLDivElement;
  constructor(parent: HTMLElement, assets: Assets, font: BitmapFont, title: string, items: MenuItem[], onExit?: () => void) {
    const h = 98 + items.length * 15 + 48;
    this.el = el('div', 'menu gwin', parent, { left: `${(DESKTOP_W - 400) / 2}px`, top: `${Math.max(4, (DESKTOP_H - h) / 2)}px`, width: '400px', height: `${h}px` });
    this.el.style.zIndex = '5000';
    const bg = (name: string, y: number) => {
      const c = assets.canvas('SETUP000', name);
      el('div', 'frame-piece', this.el, { left: '0', top: `${y}px`, width: `${c.width}px`, height: `${c.height}px`, backgroundImage: `url(${c.toDataURL()})` });
    };
    bg('SU01_00', 0);
    items.forEach((_, i) => bg('SU01_02', 98 + i * 15));
    bg('SU01_01', 98 + items.length * 15);
    const t = font.render(title, '#f0e060');
    label(this.el, t, Math.round(200 - t.width / 2), 37 - Math.round(t.height / 2));
    items.forEach((it, i) => {
      const y = 98 + i * 15;
      const enabled = it.enabled !== false;
      const row = el('div', `menu-row${enabled ? '' : ' disabled'}`, this.el, { left: '0', top: `${y}px`, width: '400px', height: '15px' });
      row.dataset.item = it.text;
      const btn = el('div', 'menu-btn', row, { left: '18px', top: '4px', width: '12px', height: '8px' });
      btn.style.backgroundImage = `url(${assets.buttonState('SETUP000', 'SU01_04', enabled ? 1 : 0).toDataURL()})`;
      label(row, font.render(it.text, enabled ? '#c4e89c' : '#6a8060'), 44, 2);
      if (enabled) row.addEventListener('click', (e) => { e.stopPropagation(); it.action(); });
    });
    if (onExit) {
      const x = el('div', 'btn menu-exit', this.el, { left: '369px', top: `${98 + items.length * 15 + 17}px`, width: '28px', height: '26px' });
      x.style.backgroundImage = `url(${assets.buttonState('SETUP000', 'SU01_03', 0).toDataURL()})`;
      x.dataset.item = 'X';
      x.addEventListener('click', (e) => { e.stopPropagation(); onExit(); });
    }
  }
  close() { this.el.remove(); }
}

/** Phone variant of the menus: a full-screen list with large touch targets. */
function chooseMobile(parent: HTMLElement, assets: Assets, title: string, entries: (string | { text: string; enabled?: boolean })[], allowExit: boolean): Promise<number> {
  return new Promise((resolve) => {
    const sheet = el('div', 'm-sheet m-menu', parent);
    const head = el('div', 'm-sheet-head', sheet);
    const tf = el('div', 'm-field m-sheet-title', head);
    setText(el('h2', 'm-title', tf), title, { font: 'small', color: COLORS.accent, scale: 1.8 });
    const list = el('div', 'm-list', sheet);
    const done = (i: number) => { sheet.remove(); resolve(i); };
    // one lettering size for the whole list: as large as the longest entry allows
    const scale = fitScale(entries.map((e) => (typeof e === 'string' ? e : e.text)), Math.min(window.innerWidth, 480) - 140, { scale: 1.7 });
    entries.forEach((e, i) => {
      const text = typeof e === 'string' ? e : e.text;
      const enabled = typeof e === 'string' || e.enabled !== false;
      const b = el('button', 'm-item', list);
      // the small yellow entry button of the original menus (SETUP000 SU01_04), enlarged
      const mark = el('span', 'm-item-mark', b);
      mark.style.backgroundImage = `url(${assets.buttonState('SETUP000', 'SU01_04', enabled ? 1 : 0).toDataURL()})`;
      setText(el('span', 'm-item-text', b), text, { color: enabled ? COLORS.text : '#4f6d48', scale });
      b.dataset.item = text;
      b.disabled = !enabled;
      b.addEventListener('click', () => done(i));
    });
    if (allowExit) {
      const x = el('button', 'm-icon-btn m-close', head);
      const c = assets.buttonState('SETUP000', 'SU01_03', 0);
      x.style.backgroundImage = `url(${c.toDataURL()})`;
      x.style.setProperty('--iw', `${c.width}px`);
      x.style.setProperty('--ih', `${c.height}px`);
      x.setAttribute('aria-label', 'Zurück');
      x.addEventListener('click', () => done(-1));
    }
  });
}

/** Shows a menu and resolves with the index of the chosen entry (-1 = X). */
export function choose(parent: HTMLElement, assets: Assets, font: BitmapFont, title: string, entries: (string | { text: string; enabled?: boolean })[], allowExit = true): Promise<number> {
  if (isMobileUi()) return chooseMobile(parent, assets, title, entries, allowExit);
  return new Promise((resolve) => {
    let m: Menu | null = null;
    const done = (i: number) => { m?.close(); resolve(i); };
    m = new Menu(parent, assets, font, title, entries.map((e, i) => (typeof e === 'string' ? { text: e, action: () => done(i) } : { ...e, action: () => done(i) })), allowExit ? () => done(-1) : undefined);
  });
}
