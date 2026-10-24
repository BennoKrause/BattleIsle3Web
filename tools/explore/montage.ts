// Lays out all INFO bitmaps of LIB files in one PNG (row packing) and prints the positions.
// usage: node tools/explore/montage.ts <out.png> <maxWidth> <lib>...
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap, toRgba, type IndexedBitmap } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';

const [out, maxW, ...libs] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const items: { name: string; bmp: IndexedBitmap }[] = [];
for (const l of libs) for (const e of parseLib(readFileSync(l))) {
  const d = decodeTpwm(e.data);
  if (isInfoBitmap(d)) items.push({ name: `${basename(l, '.LIB')}/${e.name}`, bmp: parseInfoBitmap(d) });
}
const W = Number(maxW);
let x = 0, y = 0, rowH = 0;
const pos = items.map((it) => {
  if (x + it.bmp.width > W && x > 0) { x = 0; y += rowH + 4; rowH = 0; }
  const p = { x, y };
  x += it.bmp.width + 4;
  rowH = Math.max(rowH, it.bmp.height);
  return p;
});
const H = y + rowH;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < img.length; i += 4) { img[i] = 255; img[i + 1] = 0; img[i + 2] = 255; img[i + 3] = 255; }
items.forEach((it, k) => {
  const rgba = toRgba(it.bmp, pal);
  for (let yy = 0; yy < it.bmp.height; yy++) for (let xx = 0; xx < it.bmp.width; xx++) {
    const s = (yy * it.bmp.width + xx) * 4;
    if (rgba[s + 3] === 0) continue;
    const t = ((pos[k].y + yy) * W + pos[k].x + xx) * 4;
    img[t] = rgba[s]; img[t + 1] = rgba[s + 1]; img[t + 2] = rgba[s + 2];
  }
  console.log(`${it.name} ${it.bmp.width}x${it.bmp.height} @${pos[k].x},${pos[k].y} transp=${it.bmp.transparent}`);
});
writeFileSync(out, encodePng(W, H, img));
