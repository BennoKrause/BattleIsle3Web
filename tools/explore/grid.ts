// Renders a LIB bitmap 3x with a coordinate grid. usage: node tools/explore/grid.ts <out.png> <LIB> <bitmap> [step=20] [x0 y0 w h]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib, name, stepS = '20', cx = '0', cy = '0', cw = '0', ch = '0'] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const b = parseInfoBitmap(decodeTpwm(parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).find((e) => e.name === name)!.data));
const S = 3, step = Number(stepS), x0 = Number(cx), y0 = Number(cy), w = Number(cw) || b.width, h = Number(ch) || b.height;
const W = w * S, H = h * S;
const rgba = new Uint8Array(W * H * 4).fill(255);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const v = b.pixels[(y0 + y) * b.width + x0 + x]; const t = v === b.transparent;
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const o = ((y * S + dy) * W + x * S + dx) * 4; rgba[o] = t ? 255 : pal[v * 3]; rgba[o + 1] = t ? 0 : pal[v * 3 + 1]; rgba[o + 2] = t ? 255 : pal[v * 3 + 2]; }
}
for (let gx = Math.ceil(x0 / step) * step; gx < x0 + w; gx += step) for (let y = 0; y < H; y++) { const o = (y * W + (gx - x0) * S) * 4; rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 0; }
for (let gy = Math.ceil(y0 / step) * step; gy < y0 + h; gy += step) for (let x = 0; x < W; x++) { const o = (((gy - y0) * S) * W + x) * 4; rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 0; }
writeFileSync(out, encodePng(W, H, rgba));
console.log('ok', w, h);
