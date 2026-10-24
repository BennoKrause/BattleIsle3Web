import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
const [lib, chars] = process.argv.slice(2);
const es = parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`));
for (const ch of chars) {
  const b = parseInfoBitmap(decodeTpwm(es.find((e) => e.name.charCodeAt(0) === ch.charCodeAt(0))!.data));
  console.log(`'${ch}' ${b.width}x${b.height}`);
  for (let y = 0; y < b.height; y++) console.log(Array.from(b.pixels.slice(y * b.width, (y + 1) * b.width), (v) => (v === 255 ? '.' : String(v))).join(' '));
}
