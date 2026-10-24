// Converts the original 8-bit sprites to canvases for drawing.
import { parseLib } from '../formats/lib.ts';
import { decodeTpwm } from '../formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap, type IndexedBitmap } from '../formats/bitmap.ts';
import type { FileSource } from '../data/source.ts';

export const TILE = 24;

export function bitmapToCanvas(bmp: IndexedBitmap, palette: Uint8Array, remap?: (c: number) => number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(bmp.width, bmp.height);
  for (let i = 0; i < bmp.pixels.length; i++) {
    let c = bmp.pixels[i];
    if (c === bmp.transparent) continue;
    if (remap) c = remap(c);
    img.data[i * 4] = palette[c * 3];
    img.data[i * 4 + 1] = palette[c * 3 + 1];
    img.data[i * 4 + 2] = palette[c * 3 + 2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A strip of equally sized 24x24 sprites in one canvas (index -> x offset). */
export class SpriteSheet {
  readonly canvas: HTMLCanvasElement;
  readonly count: number;
  constructor(sprites: Uint8Array[], palette: Uint8Array, transparent: number, remap?: (c: number) => number) {
    this.count = sprites.length;
    const cols = 64;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cols * TILE;
    this.canvas.height = Math.ceil(sprites.length / cols) * TILE;
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(this.canvas.width, this.canvas.height);
    sprites.forEach((px, n) => {
      const ox = (n % cols) * TILE, oy = Math.floor(n / cols) * TILE;
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c = px[y * TILE + x];
        if (c === transparent) continue;
        if (remap) c = remap(c);
        const o = ((oy + y) * this.canvas.width + ox + x) * 4;
        img.data[o] = palette[c * 3];
        img.data[o + 1] = palette[c * 3 + 1];
        img.data[o + 2] = palette[c * 3 + 2];
        img.data[o + 3] = 255;
      }
    });
    ctx.putImageData(img, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, size = TILE, flipX = false, flipY = false) {
    if (index < 0 || index >= this.count) return;
    const sx = (index % 64) * TILE, sy = Math.floor(index / 64) * TILE;
    if (!flipX && !flipY) {
      ctx.drawImage(this.canvas, sx, sy, TILE, TILE, x, y, size, size);
      return;
    }
    ctx.save();
    ctx.translate(x + (flipX ? size : 0), y + (flipY ? size : 0));
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(this.canvas, sx, sy, TILE, TILE, 0, 0, size, size);
    ctx.restore();
  }
}

export async function loadRawSprites(src: FileSource, path: string): Promise<Uint8Array[]> {
  return parseLib(await src.read(path)).map((e) => e.data.subarray(0, TILE * TILE));
}

export async function loadInfoBitmaps(src: FileSource, path: string): Promise<Map<string, IndexedBitmap>> {
  const out = new Map<string, IndexedBitmap>();
  for (const e of parseLib(await src.read(path))) {
    const d = decodeTpwm(e.data);
    if (isInfoBitmap(d)) out.set(e.name, parseInfoBitmap(d));
  }
  return out;
}
