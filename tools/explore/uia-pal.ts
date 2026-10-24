import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
for (const n of ['UIA011', 'UIA006', 'UIA014']) {
  const es = parseLib(readFileSync(`public/gamedata/UIA/${n}.LIB`));
  const h = new Map<number, number>();
  for (const e of es.slice(0, 20)) for (const v of parseInfoBitmap(decodeTpwm(e.data)).pixels) h.set(v, (h.get(v) ?? 0) + 1);
  const keys = [...h.keys()].sort((a, b) => a - b);
  console.log(n, 'distinct', keys.length, 'idx<8:', keys.filter((k) => k < 8).join(','), '0x80-0x9f:', keys.filter((k) => k >= 0x80 && k < 0xa0).length, 'range', keys[0], '..', keys[keys.length - 1]);
}
