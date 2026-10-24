import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
const b = parseInfoBitmap(decodeTpwm(parseLib(readFileSync('public/gamedata/LIB/WB000.LIB')).find((e) => e.name === 'WB01_00')!.data));
for (const y of [20, 28]) console.log('row', y, Array.from({ length: 224 }, (_, x) => b.pixels[y * 224 + x]).map((v, x) => `${x}:${v}`).filter((_, x) => x >= 60 && x <= 190).join(' ').slice(0, 900));
