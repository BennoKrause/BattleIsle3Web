import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
for (const lib of ['CHAR009', 'CHAR012', 'CHAR016']) {
  const es = parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`));
  const rows = es.filter((e) => 'AiIWmM.l1 '.includes(String.fromCharCode(e.name.charCodeAt(0)))).map((e) => {
    const b = parseInfoBitmap(decodeTpwm(e.data));
    let right = 0, left = 99;
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.pixels[y * b.width + x] !== 255) { right = Math.max(right, x + 1); left = Math.min(left, x); }
    return `'${e.name[0]}' nameBytes=${Array.from(e.name.slice(1, 8), (c) => c.charCodeAt(0)).join(',')} bmpW=${b.width} ink=${left}..${right}`;
  });
  console.log(lib, '\n ', rows.join('\n  '));
}
