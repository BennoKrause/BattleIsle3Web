// Text with the original bitmap fonts for the phone interface. The visible text is a canvas drawn at an
// integer number of device pixels per font pixel (crisp on every screen density); the real text stays in the
// DOM as visually hidden text (screen readers, tests, copy).
import type { BitmapFont } from '../font.ts';

export interface PixelFonts { small: BitmapFont; medium: BitmapFont; large: BitmapFont }

let fonts: PixelFonts | null = null;

export function initPixelText(f: PixelFonts) { fonts = f; }

export interface PixelOptions {
  font?: 'small' | 'medium' | 'large';
  /** CSS colour (default: the light green of the original text fields). */
  color?: string;
  /** Wanted CSS pixels per font pixel (snapped to whole device pixels); smaller if the text would be wider than maxWidth. */
  scale?: number;
  maxWidth?: number;
}

export const COLORS = {
  text: '#c4e89c',
  muted: '#84a967',
  accent: '#ffe433',
  white: '#e7ffff',
  danger: '#ff7a60',
} as const;

const DEFAULT_SCALE = { small: 1.7, medium: 1.5, large: 1.4 };

/** Replaces the content of `el` by pixel text. Returns the canvas. */
export function setText(el: HTMLElement, text: string, o: PixelOptions = {}): HTMLCanvasElement | null {
  el.replaceChildren();
  const sr = document.createElement('span');
  sr.className = 'm-sr';
  sr.textContent = text;
  el.append(sr);
  if (!fonts || !text) return null;
  const font = fonts[o.font ?? 'small'];
  const canvas = font.render(text, o.color ?? COLORS.text);
  const copy = document.createElement('canvas');
  copy.width = canvas.width; copy.height = canvas.height;
  copy.getContext('2d')!.drawImage(canvas, 0, 0);
  const dpr = window.devicePixelRatio || 1;
  let scale = Math.max(1 / dpr, Math.round((o.scale ?? DEFAULT_SCALE[o.font ?? 'small']) * dpr) / dpr);
  if (o.maxWidth) while (scale > 1 / dpr && copy.width * scale > o.maxWidth) scale -= 1 / dpr;
  copy.className = 'm-px';
  copy.style.width = `${copy.width * scale}px`;
  copy.style.height = `${copy.height * scale}px`;
  el.append(copy);
  return copy;
}

/** Multi-line text: wraps at maxWidth (CSS px) and draws one pixel-text line per row. */
export function setParagraph(el: HTMLElement, text: string, maxWidth: number, o: PixelOptions = {}) {
  el.replaceChildren();
  const sr = document.createElement('span');
  sr.className = 'm-sr';
  sr.textContent = text;
  el.append(sr);
  if (!fonts) return;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1 / dpr, Math.round((o.scale ?? DEFAULT_SCALE[o.font ?? 'small']) * dpr) / dpr);
  const lines = fonts[o.font ?? 'small'].wrap(text, Math.floor(maxWidth / scale));
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'm-px-line';
    el.append(row);
    if (line) setTextInto(row, line, o);
  }
}

function setTextInto(row: HTMLElement, line: string, o: PixelOptions) {
  setText(row, line, o);
  row.querySelector('.m-sr')?.remove();
}

/**
 * One common scale for a list of texts: the preferred scale, reduced (in whole device pixels) until the longest
 * text fits into maxWidth. Using it for every row keeps the lettering of a list uniform.
 */
export function fitScale(texts: string[], maxWidth: number, o: Pick<PixelOptions, 'font' | 'scale'> = {}): number {
  const dpr = window.devicePixelRatio || 1;
  const font = o.font ?? 'small';
  let scale = Math.max(1 / dpr, Math.round((o.scale ?? DEFAULT_SCALE[font]) * dpr) / dpr);
  if (!fonts) return scale;
  const widest = Math.max(1, ...texts.map((t) => fonts![font].measure(t)));
  while (scale > 1 / dpr && widest * scale > maxWidth) scale -= 1 / dpr;
  return scale;
}
