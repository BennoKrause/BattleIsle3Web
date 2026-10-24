// Draws named bitmaps of a LIB side by side, scaled 4x, with the names printed to the console.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib, filter, scaleS = '4'] = process.argv.slice(2);
const S = Number(scaleS);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const es = parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).filter((e) => e.name.includes(filter));
const bs = es.map((e) => ({ n: e.name, b: parseInfoBitmap(decodeTpwm(e.data)) }));
const W = bs.reduce((a, x) => a + x.b.width * S + 6, 0), H = Math.max(...bs.map((x) => x.b.height)) * S;
const rgba = new Uint8Array(W * H * 4).fill(30); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
let ox = 0;
for (const { b } of bs) { for (let y = 0; y < b.height * S; y++) for (let x = 0; x < b.width * S; x++) { const v = b.pixels[Math.floor(y / S) * b.width + Math.floor(x / S)]; if (v === b.transparent) continue; const o = (y * W + ox + x) * 4; rgba[o] = pal[v * 3]; rgba[o + 1] = pal[v * 3 + 1]; rgba[o + 2] = pal[v * 3 + 2]; } ox += b.width * S + 6; }
writeFileSync(out, encodePng(W, H, rgba)); console.log(bs.map((x) => x.n).join(' '));
