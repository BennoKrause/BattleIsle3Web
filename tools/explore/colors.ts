import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
const unit = parseLib(readFileSync('public/gamedata/LIB/UNIT000.LIB'));
const hist = new Map<number, number>();
for (const e of unit) for (const b of e.data.subarray(0, 576)) hist.set(b, (hist.get(b) ?? 0) + 1);
console.log('unit sprite indices:', [...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
const pals = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'));
for (const p of pals) {
  const d = p.data;
  const row = (i: number) => `${i}=${d[i*3]},${d[i*3+1]},${d[i*3+2]}`;
  console.log(p.name, [0, 22, 27, 37, 52, 58, 69, 75, 81, 121, 143, 182, 240, 255].map(row).join(' '));
}
const part = parseLib(readFileSync('public/gamedata/LIB/PART000.LIB'));
const h2 = new Set<number>(); for (const e of part) for (const b of e.data) h2.add(b);
console.log('terrain uses', h2.size, 'indices, min', Math.min(...h2), 'max', Math.max(...h2));
