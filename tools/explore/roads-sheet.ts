// Renders PART000 sprites [from, from+count) as a grid (16 per row, 3x) to look at road/rail variants. usage: node roads-sheet.ts out.png from count
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { encodePng } from '../lib/png.ts';
const [out, from, count] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const sp = parseLib(readFileSync('public/gamedata/LIB/'+(process.env.LIB??'PART000.LIB')+''));
const S = 3, T = 24, cols = 16, n = Number(count);
const W = cols * (T * S + 2), H = Math.ceil(n / cols) * (T * S + 2);
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < img.length; i += 4) { img[i] = 255; img[i + 1] = 0; img[i + 2] = 255; img[i + 3] = 255; }
for (let k = 0; k < n; k++) {
  const e = sp[Number(from) + k]; if (!e) break;
  const ox = (k % cols) * (T * S + 2), oy = Math.floor(k / cols) * (T * S + 2);
  for (let y = 0; y < T * S; y++) for (let x = 0; x < T * S; x++) {
    const c = e.data[Math.floor(y / S) * T + Math.floor(x / S)];
    if (c === 0) continue;
    const o = ((oy + y) * W + ox + x) * 4;
    img[o] = pal[c * 3]; img[o + 1] = pal[c * 3 + 1]; img[o + 2] = pal[c * 3 + 2];
  }
}
writeFileSync(out, encodePng(W, H, img));
