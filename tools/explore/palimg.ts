import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { encodePng } from '../lib/png.ts';
const pals = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'));
const p = pals[0].data; const S = 20;
const img = new Uint8Array(16 * S * 16 * S * 4);
for (let i = 0; i < 256; i++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const o = (((i >> 4) * S + y) * 16 * S + (i & 15) * S + x) * 4;
  img[o] = p[i*3]; img[o+1] = p[i*3+1]; img[o+2] = p[i*3+2]; img[o+3] = (x === 0 || y === 0) ? 0 : 255;
}
writeFileSync(process.argv[2], encodePng(16 * S, 16 * S, img));
