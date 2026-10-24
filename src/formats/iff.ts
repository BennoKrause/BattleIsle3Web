// IFF ILBM/PBM reader (Deluxe Paint style) used by the 3D fight data: FGT/TEX000.LIB textures (320x200)
// and FGT/BACKS000.LIB backgrounds (640x480). Only 8-bit "PBM " forms with optional ByteRun1 are needed.

export interface IffImage {
  width: number;
  height: number;
  /** Palette index per pixel. */
  pixels: Uint8Array;
  /** 256 * 3 bytes (8-bit RGB) from the CMAP chunk, if present. */
  palette: Uint8Array | null;
}

export function parseIffPbm(data: Uint8Array): IffImage {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (p: number) => String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);
  if (tag(0) !== 'FORM' || tag(8) !== 'PBM ') throw new Error('not an IFF PBM file');
  let width = 0, height = 0, compression = 0;
  let palette: Uint8Array | null = null;
  let body: Uint8Array | null = null;
  let p = 12;
  while (p + 8 <= data.length) {
    const id = tag(p), len = v.getUint32(p + 4);
    const start = p + 8;
    if (id === 'BMHD') { width = v.getUint16(start); height = v.getUint16(start + 2); compression = data[start + 10]; }
    else if (id === 'CMAP') palette = data.slice(start, start + len);
    else if (id === 'BODY') body = data.subarray(start, start + len);
    p = start + len + (len & 1);
  }
  if (!body || !width || !height) throw new Error('IFF file without BODY/BMHD');
  const pixels = new Uint8Array(width * height);
  if (compression === 0) pixels.set(body.subarray(0, pixels.length));
  else {
    // ByteRun1 per row; rows are padded to an even number of bytes
    let src = 0, dst = 0;
    const rowBytes = width + (width & 1);
    for (let y = 0; y < height; y++) {
      let n = 0;
      while (n < rowBytes && src < body.length) {
        const c = (body[src++] << 24) >> 24;
        if (c >= 0) { for (let i = 0; i <= c && n < rowBytes; i++, n++) { if (n < width) pixels[dst + n] = body[src]; src++; } }
        else if (c !== -128) { const b = body[src++]; for (let i = 0; i < 1 - c && n < rowBytes; i++, n++) if (n < width) pixels[dst + n] = b; }
      }
      dst += width;
    }
  }
  return { width, height, pixels, palette };
}
