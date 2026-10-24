import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { CHROMA_SCHEMES } from '../../src/render/chroma.ts';
const es = parseLib(readFileSync('public/gamedata/LIB/FF000.LIB'));
for (const n of ['FF01_05', 'FF01_06', 'FF01_07']) {
  const b = parseInfoBitmap(decodeTpwm(es.find((e) => e.name === n)!.data));
  const h = new Map<number, number>(); b.pixels.forEach((v) => h.set(v, (h.get(v) ?? 0) + 1));
  console.log(n, b.width, b.height, 'transp', b.transparent, [...h].sort((a, c) => a[0] - c[0]).map(([k, v]) => `${k.toString(16)}:${v}`).join(' '));
  console.log(Array.from({ length: b.height }, (_, y) => Array.from(b.pixels.slice(y * 8, y * 8 + 8), (v) => v.toString(16).padStart(2, '0')).join(' ')).filter((_, y) => y % 6 === 0).join(' | '));
}
console.log(CHROMA_SCHEMES.map((s, i) => `${i}:${s.join(',')}`).join('\n'));
