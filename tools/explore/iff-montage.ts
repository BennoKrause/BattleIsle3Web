// usage: node tools/explore/iff-montage.ts <out.png> <FGT lib> <cols> <scaleDiv> [filter]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { parseIffPbm } from '../../src/formats/iff.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib, colsS, divS, filter = ''] = process.argv.slice(2);
const cols = Number(colsS), div = Number(divS);
const imgs = parseLib(readFileSync(`public/gamedata/FGT/${lib}.LIB`)).filter((e) => e.data.length > 100 && e.name.includes(filter)).map((e) => ({ n: e.name, i: parseIffPbm(e.data) }));
const cw = Math.max(...imgs.map((x) => Math.ceil(x.i.width / div))) + 4, ch = Math.max(...imgs.map((x) => Math.ceil(x.i.height / div))) + 4;
const rows = Math.ceil(imgs.length / cols), W = cols * cw, H = rows * ch;
const rgba = new Uint8Array(W * H * 4).fill(30);
imgs.forEach((x, k) => {
  const ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
  for (let y = 0; y < Math.floor(x.i.height / div); y++) for (let xx = 0; xx < Math.floor(x.i.width / div); xx++) {
    const p = x.i.pixels[y * div * x.i.width + xx * div], o = ((oy + y) * W + ox + xx) * 4;
    const pal = x.i.palette!;
    rgba[o] = pal[p * 3]; rgba[o + 1] = pal[p * 3 + 1]; rgba[o + 2] = pal[p * 3 + 2]; rgba[o + 3] = 255;
  }
});
writeFileSync(out, encodePng(W, H, rgba));
console.log(imgs.map((x) => `${x.n}:${x.i.width}x${x.i.height}`).join(' '));
