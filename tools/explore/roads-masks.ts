// All 64 connection masks of a LAYR library, built like the game does. usage: node roads-masks.ts out.png LAYR000
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { buildRoadSet } from '../../src/render/roads.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const set = buildRoadSet(parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).map((e) => e.data));
const S = 2, T = 24, cols = 16, W = cols * (T * S + 2), H = 4 * (T * S + 2);
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < img.length; i += 4) { img[i] = 90; img[i + 1] = 60; img[i + 2] = 50; img[i + 3] = 255; }
set.forEach((px, k) => {
  const ox = (k % cols) * (T * S + 2), oy = Math.floor(k / cols) * (T * S + 2);
  for (let y = 0; y < T * S; y++) for (let x = 0; x < T * S; x++) {
    const c = px[Math.floor(y / S) * T + Math.floor(x / S)]; if (!c) continue;
    const o = ((oy + y) * W + ox + x) * 4; img[o] = pal[c * 3]; img[o + 1] = pal[c * 3 + 1]; img[o + 2] = pal[c * 3 + 2];
  }
});
writeFileSync(out, encodePng(W, H, img));
