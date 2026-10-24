// usage: node tools/explore/uia-sheet.ts <out.png> <UIAnnn> [every]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';
const [out, name, everyS = '12'] = process.argv.slice(2);
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const es = parseLib(readFileSync(`public/gamedata/UIA/${name}.LIB`)).filter((e) => e.name.startsWith('PIC'));
const frames = es.filter((_, i) => i % Number(everyS) === 0).map((e) => parseInfoBitmap(decodeTpwm(e.data)));
const cols = 5, W = cols * 164, H = Math.ceil(frames.length / cols) * 104;
const rgba = new Uint8Array(W * H * 4).fill(60); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
frames.forEach((b, k) => { const ox = (k % cols) * 164, oy = Math.floor(k / cols) * 104; for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) { const v = b.pixels[y * b.width + x]; if (v === b.transparent) continue; const o = ((oy + y) * W + ox + x) * 4; rgba[o] = pal[v * 3]; rgba[o + 1] = pal[v * 3 + 1]; rgba[o + 2] = pal[v * 3 + 2]; } });
writeFileSync(out, encodePng(W, H, rgba)); console.log(es.length, 'frames, showing', frames.length);
