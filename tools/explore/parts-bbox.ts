import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { parseModel3D } from '../../src/formats/model3d.ts';
const d = parseLib(readFileSync('public/gamedata/FGT/UN3D000.LIB')).find((e) => e.name === process.argv[2])!.data;
const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
const m = parseModel3D(d);
const work = v.getUint32(8, true), end = v.getUint32(0x10, true), parts = v.getUint32(0xae, true);
const sets: Set<number>[] = [];
for (let i = 0; i < parts; i++) {
  const p = end + i * 0x40, cnt = v.getInt32(p + 12, true), lp = v.getInt32(p + 8, true);
  sets.push(new Set(Array.from({ length: cnt }, (_, k) => Math.round((v.getUint32(lp + k * 4, true) - work) / 20))));
}
sets.forEach((s, i) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const k of s) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], m.vertices[k][a]); mx[a] = Math.max(mx[a], m.vertices[k][a]); }
  const p = end + i * 0x40;
  console.log(i, 'pivot', [16, 20, 24].map((o) => v.getInt32(p + o, true)).join(','), 'bbox', mn.join(','), '..', mx.join(','), 'a', v.getInt32(p, true), 'b', v.getInt32(p + 4, true), 'rest', Array.from({ length: 9 }, (_, k) => v.getInt32(p + 28 + k * 4, true)).join(','));
});
