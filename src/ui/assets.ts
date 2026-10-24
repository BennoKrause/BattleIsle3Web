// Loads original UI graphics from the LIB archives and converts them to canvases on demand.
import type { FileSource } from '../data/source.ts';
import { parseLib } from '../formats/lib.ts';
import { decodeTpwm } from '../formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap, type IndexedBitmap } from '../formats/bitmap.ts';

export class Assets {
  private libs = new Map<string, Map<string, IndexedBitmap>>();
  private canvases = new Map<string, HTMLCanvasElement>();
  readonly src: FileSource;
  palette: Uint8Array;
  constructor(src: FileSource, palette: Uint8Array) {
    this.src = src;
    this.palette = palette;
  }

  async load(...libs: string[]) {
    await Promise.all(libs.map(async (lib) => {
      if (this.libs.has(lib)) return;
      const map = new Map<string, IndexedBitmap>();
      for (const e of parseLib(await this.src.read(`LIB/${lib}.LIB`))) {
        const d = decodeTpwm(e.data);
        if (isInfoBitmap(d)) map.set(e.name, parseInfoBitmap(d));
      }
      this.libs.set(lib, map);
    }));
  }

  bitmap(lib: string, name: string): IndexedBitmap {
    const b = this.libs.get(lib)?.get(name);
    if (!b) throw new Error(`missing bitmap ${lib}/${name}`);
    return b;
  }

  names(lib: string): string[] {
    return [...(this.libs.get(lib)?.keys() ?? [])];
  }

  /** Canvas of a bitmap (cached). `crop` = [x, y, w, h]. */
  canvas(lib: string, name: string, crop?: [number, number, number, number]): HTMLCanvasElement {
    const key = `${lib}/${name}/${crop?.join(',') ?? ''}`;
    let c = this.canvases.get(key);
    if (c) return c;
    const b = this.bitmap(lib, name);
    const [cx, cy, cw, ch] = crop ?? [0, 0, b.width, b.height];
    c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cw, ch);
    const p = this.palette;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = b.pixels[(cy + y) * b.width + cx + x];
      if (v === b.transparent) continue;
      const o = (y * cw + x) * 4;
      img.data[o] = p[v * 3]; img.data[o + 1] = p[v * 3 + 1]; img.data[o + 2] = p[v * 3 + 2]; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.canvases.set(key, c);
    return c;
  }

  /** Data URL for CSS backgrounds. */
  url(lib: string, name: string, crop?: [number, number, number, number]): string {
    return this.canvas(lib, name, crop).toDataURL();
  }

  /** Button strips of 3 states side by side (e.g. 96x31 = three 32x31 states). */
  buttonState(lib: string, name: string, state: 0 | 1 | 2): HTMLCanvasElement {
    const b = this.bitmap(lib, name);
    const w = Math.floor(b.width / 3);
    return this.canvas(lib, name, [state * w, 0, w, b.height]);
  }
}
