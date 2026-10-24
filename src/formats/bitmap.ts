// 8-bit paletted bitmaps used by Battle Isle 3.
//
// "INFO" bitmaps (most LIB files, UIA frames after TPWM decoding):
//   0  "INFO"
//   4  8 bytes (unknown, mostly constant)
//   12 u8  transparent palette index
//   13 u8  bits per pixel (always 8)
//   18 u16 width, 20 u16 height
//   22 "BODY", 26 width*height pixels, row-major
//
// Raw hex sprites (PART000.LIB, UNIT000.LIB, LAYR00x.LIB): headerless 24x24 = 576 bytes.

import { decodeTpwm } from './tpwm.ts';

export interface IndexedBitmap {
  width: number;
  height: number;
  /** Palette index per pixel, row-major. */
  pixels: Uint8Array;
  /** Palette index that is not drawn, or -1. */
  transparent: number;
}

export function isInfoBitmap(data: Uint8Array): boolean {
  return data.length >= 26 && data[0] === 0x49 && data[1] === 0x4e && data[2] === 0x46 && data[3] === 0x4f;
}

export function parseInfoBitmap(raw: Uint8Array): IndexedBitmap {
  const data = decodeTpwm(raw);
  if (!isInfoBitmap(data)) throw new Error('INFO bitmap: missing INFO signature');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(18, true);
  const height = view.getUint16(20, true);
  const bodyTag = String.fromCharCode(data[22], data[23], data[24], data[25]);
  if (bodyTag !== 'BODY') throw new Error(`INFO bitmap: expected BODY tag, got ${JSON.stringify(bodyTag)}`);
  const size = width * height;
  if (data.length < 26 + size) throw new Error(`INFO bitmap: ${width}x${height} needs ${26 + size} bytes, have ${data.length}`);
  return { width, height, pixels: data.slice(26, 26 + size), transparent: data[12] };
}

export const HEX_SPRITE_SIZE = 24;

/** Headerless 24x24 sprite; pixel index 0 is transparent. */
export function parseRawSprite(data: Uint8Array): IndexedBitmap {
  const size = HEX_SPRITE_SIZE * HEX_SPRITE_SIZE;
  if (data.length < size) throw new Error(`raw sprite: expected ${size} bytes, have ${data.length}`);
  return { width: HEX_SPRITE_SIZE, height: HEX_SPRITE_SIZE, pixels: data.slice(0, size), transparent: 0 };
}

/** Palette: 256 RGB triplets, 8 bits per channel. */
export function parsePalette(data: Uint8Array): Uint8Array {
  if (data.length < 768) throw new Error(`palette: expected 768 bytes, have ${data.length}`);
  return data.slice(0, 768);
}

/** Converts an indexed bitmap to RGBA using a 768-byte palette. */
export function toRgba(bmp: IndexedBitmap, palette: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bmp.width * bmp.height * 4);
  for (let i = 0; i < bmp.pixels.length; i++) {
    const c = bmp.pixels[i];
    out[i * 4] = palette[c * 3];
    out[i * 4 + 1] = palette[c * 3 + 1];
    out[i * 4 + 2] = palette[c * 3 + 2];
    out[i * 4 + 3] = c === bmp.transparent ? 0 : 255;
  }
  return out;
}
