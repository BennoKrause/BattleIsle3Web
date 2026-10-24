import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { encodePng } from '../lib/png.ts';
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const bmp = (lib: string, name: string) => parseInfoBitmap(decodeTpwm(parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).find((e) => e.name === name)!.data));
const crops: [string, string, number, number, number, number][] = [
  ['UI001', 'UG00_00', 15, 70, 128, 96], ['UI000', 'UI00_00', 8, 180, 128, 96], ['UI000', 'UI00_00', 206, 70, 36, 96], ['SETUP000', 'SU01_00', 0, 0, 128, 60],
  ['MNGR000', 'MNGR0000', 0, 0, 128, 48], ['CMSK000', 'C00_00', 0, 0, 128, 60], ['SI000', 'SI00_00', 0, 0, 128, 86], ['SP000', 'SP00_00', 0, 0, 128, 96],
];
const S = 2, W = crops.reduce((a, c) => a + c[4] * S + 6, 0), H = 96 * S;
const rgba = new Uint8Array(W * H * 4).fill(40); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
let ox = 0;
for (const [lib, name, cx, cy, cw, ch] of crops) {
  const b = bmp(lib, name);
  for (let y = 0; y < ch * S; y++) for (let x = 0; x < cw * S; x++) { const sx = cx + Math.floor(x / S), sy = cy + Math.floor(y / S); if (sx >= b.width || sy >= b.height) continue; const v = b.pixels[sy * b.width + sx]; if (v === b.transparent) continue; const o = (y * W + ox + x) * 4; rgba[o] = pal[v * 3]; rgba[o + 1] = pal[v * 3 + 1]; rgba[o + 2] = pal[v * 3 + 2]; }
  ox += cw * S + 6;
}
writeFileSync(process.argv[2], encodePng(W, H, rgba));
const hex = (i: number) => '#' + [0, 1, 2].map((k) => pal[i * 3 + k].toString(16).padStart(2, '0')).join('');
console.log('field 227', hex(227), 'neighbours', [225, 226, 228, 229, 230].map(hex).join(' '));
const u = bmp('SETUP000', 'SU01_04'); console.log('yellow btn', u.width, u.height, [...new Set(u.pixels)].slice(0, 12).map((v) => `${v}:${hex(v)}`).join(' '));
