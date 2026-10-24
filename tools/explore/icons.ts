// Renders chosen INFO bitmaps of a LIB enlarged (3x) next to each other with their names' order. usage: node icons.ts out.png LIB name...
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap, toRgba } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib, ...names] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const es = parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`));
const bmps = names.map((n) => parseInfoBitmap(decodeTpwm(es.find((e) => e.name.startsWith(n))!.data)));
const S = 3, W = bmps.reduce((a, b) => a + (b.width / 3) * S + 6, 0), H = Math.max(...bmps.map((b) => b.height)) * S;
const img = new Uint8ClampedArray(W * H * 4).fill(255);
let x0 = 0;
for (const b of bmps) {
  const rgba = toRgba(b, pal);
  const w = Math.floor(b.width / 3); // first of the three button states
  for (let y = 0; y < b.height * S; y++) for (let x = 0; x < w * S; x++) {
    const si = (Math.floor(y / S) * b.width + Math.floor(x / S)) * 4, di = (y * W + x0 + x) * 4;
    img[di] = rgba[si]; img[di + 1] = rgba[si + 1]; img[di + 2] = rgba[si + 2]; img[di + 3] = 255;
  }
  x0 += w * S + 6;
}
writeFileSync(out, encodePng(W, H, img));
