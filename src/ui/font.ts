// Original bitmap fonts LIB/CHAR009, CHAR012, CHAR016 (one INFO bitmap per character, the first
// name byte is the CP1252 code). Glyph pixels: 255 = background (not drawn), 0..7 = ink (0 = full
// colour, CHAR016 additionally uses 1..7 as darker shading steps). The original pen advance is the bitmap width
// of each glyph (BASELIBR.DLL TXT_WriteString: x += glyph->width), but all bitmaps are equally wide, which looks like
// a monospaced font with big gaps; here the spacing is proportional (digits stay equally wide).
import type { FileSource } from '../data/source.ts';
import { parseLib } from '../formats/lib.ts';
import { parseInfoBitmap } from '../formats/bitmap.ts';

interface Glyph { width: number; height: number; pixels: Uint8Array; advance: number; /** First ink column; the empty left margin of the bitmap is not drawn. */ left: number; /** Extra shift when the glyph is centred in a wider cell (digits). */ dx: number }

/** The cache keeps its own canvas: a canvas element can sit in only one place in the DOM, a shared one vanished from the first label. */
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

export class BitmapFont {
  private glyphs = new Map<number, Glyph>();
  readonly height: number;
  private cache = new Map<string, HTMLCanvasElement>();
  /** CHAR016: value 0 is the dark outline, 1..7 the lit fill (7 = brightest); the small fonts use only value 0 as solid ink. */
  shaded = false;

  private constructor(height: number) {
    this.height = height;
  }

  /** Fonts are used as in the original. `thin` erodes strokes (thinGlyph), but that breaks digits and several letters, so it is off. */
  static async load(src: FileSource, lib: string, thin = false): Promise<BitmapFont> {
    const entries = parseLib(await src.read(`LIB/${lib}.LIB`));
    let h = 0;
    const font = new BitmapFont(0);
    for (const e of entries) {
      const b = parseInfoBitmap(e.data);
      h = Math.max(h, b.height);
      const code = e.name.charCodeAt(0);
      let left = b.width, right = -1;
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.pixels[y * b.width + x] !== 255) { left = Math.min(left, x); right = Math.max(right, x); }
      // proportional spacing: ink width plus a gap that grows with the font size (the bitmaps themselves are all equally wide)
      const gap = b.height <= 9 ? 2 : 3;
      const advance = right < 0 ? Math.round(b.height * 0.5) : right - left + 1 + gap;
      font.glyphs.set(code, { width: b.width, height: b.height, pixels: thin && b.height === 12 ? thinGlyph(b.pixels, b.width, b.height) : b.pixels, advance, left: right < 0 ? 0 : left, dx: 0 });
    }
    (font as { height: number }).height = h;
    font.shaded = [...font.glyphs.values()].some((g) => g.pixels.some((v) => v >= 1 && v <= 7));
    // digits keep one common width so that numbers line up (counts, values)
    const digits = [...'0123456789'].map((d) => font.glyphs.get(d.charCodeAt(0))).filter((g): g is Glyph => !!g);
    const dw = Math.max(0, ...digits.map((g) => g.advance));
    for (const g of digits) { g.dx = Math.floor((dw - g.advance) / 2); g.advance = dw; }
    return font;
  }

  private code(ch: string): number {
    const c = ch.charCodeAt(0);
    return c > 255 ? (CP1252_EXTRA[c] ?? 63) : c;
  }

  measure(text: string): number {
    let w = 0;
    for (const ch of text) w += this.glyphs.get(this.code(ch))?.advance ?? Math.ceil(this.height / 2);
    return w;
  }

  /** Renders text into a canvas in the given CSS color. */
  render(text: string, color = '#d8e070'): HTMLCanvasElement {
    const key = `${color}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return copyCanvas(hit);
    const c = document.createElement('canvas');
    c.width = Math.max(1, this.measure(text));
    c.height = this.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(c.width, c.height);
    const rgb = parseColor(color);
    let x0 = 0;
    for (const ch of text) {
      const g = this.glyphs.get(this.code(ch));
      if (!g) { x0 += Math.ceil(this.height / 2); continue; }
      for (let y = 0; y < g.height; y++) for (let x = g.left; x < g.width && x0 + g.dx + x - g.left < c.width; x++) {
        const v = g.pixels[y * g.width + x];
        if (v === 255) continue;
        const shade = this.shadeOf(v);
        const o = (y * c.width + x0 + g.dx + x - g.left) * 4;
        img.data[o] = rgb[0] * shade; img.data[o + 1] = rgb[1] * shade; img.data[o + 2] = rgb[2] * shade; img.data[o + 3] = 255;
      }
      x0 += g.advance;
    }
    ctx.putImageData(img, 0, 0);
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(key, c);
    return copyCanvas(c);
  }

  /** Renders text with palette colours like the original TXT_WriteString: ink value v (0..7) becomes palette[base + v]. */
  renderPalette(text: string, palette: Uint8Array, base: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, this.measure(text));
    c.height = this.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(c.width, c.height);
    let x0 = 0;
    for (const ch of text) {
      const g = this.glyphs.get(this.code(ch));
      if (!g) { x0 += Math.ceil(this.height / 2); continue; }
      for (let y = 0; y < g.height; y++) for (let x = g.left; x < g.width && x0 + g.dx + x - g.left < c.width; x++) {
        const v = g.pixels[y * g.width + x];
        if (v === 255) continue;
        const o = (y * c.width + x0 + g.dx + x - g.left) * 4, p = (base + this.rampOf(v)) * 3;
        img.data[o] = palette[p]; img.data[o + 1] = palette[p + 1]; img.data[o + 2] = palette[p + 2]; img.data[o + 3] = 255;
      }
      x0 += g.advance;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Brightness factor of an ink value: shaded fonts draw the outline (0) dark and the fill brighter with higher values. */
  private shadeOf(v: number): number {
    if (!this.shaded) return 1;
    return v === 0 ? 0.22 : 0.42 + 0.58 * (v / 7);
  }

  /** Offset in a palette ramp (bright to dark) for an ink value. */
  private rampOf(v: number): number {
    if (!this.shaded) return v;
    return v === 0 ? 7 : 7 - v;
  }

  /** Splits text into lines that fit the width. */
  wrap(text: string, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split(/\r?\n|\|/)) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (this.measure(t) > width && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
}

/**
 * The original small fonts have strokes 2 px (CHAR009) to 4 px (CHAR012) thick, which looks heavy on the scaled
 * desktop. Erosion with a 2x2 element removes the right/bottom boundary of every shape: each stroke becomes one
 * pixel thinner (2 -> 1, 4 -> 3) and stays connected, glyphs are 1 px shorter at their right/bottom ends.
 */
export function thinGlyph(pixels: Uint8Array, w: number, h: number, times = 1): Uint8Array {
  let cur = pixels;
  for (let n = 0; n < times; n++) {
    const out = new Uint8Array(pixels.length).fill(255);
    const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cur[y * w + x] !== 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (ink(x, y) && ink(x - 1, y) && ink(x, y - 1) && ink(x - 1, y - 1)) out[y * w + x] = cur[y * w + x];
      // single-pixel details (dots, ends of 1 px lines) are kept
      else if (ink(x, y) && !ink(x - 1, y) && !ink(x + 1, y) && !ink(x, y - 1) && !ink(x, y + 1)) out[y * w + x] = cur[y * w + x];
    }
    cur = out;
  }
  return cur;
}

/** Unicode characters outside Latin-1 that exist in the Windows-1252 code page of the original fonts. */
const CP1252_EXTRA: Record<number, number> = {
  // the bitmap fonts have no typographic dashes or quotes (code 0x96 is a letter): use the plain ASCII look-alikes
  0x2013: 0x2d, 0x2014: 0x2d, 0x2018: 0x27, 0x2019: 0x27, 0x201c: 0x22, 0x201d: 0x22, 0x201e: 0x22, 0x2026: 0x2e, 0x2022: 0x2e,
};

function parseColor(c: string): [number, number, number] {
  const m = /^#(..)(..)(..)$/.exec(c);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}
