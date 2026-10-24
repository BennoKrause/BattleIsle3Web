import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { parseModel3D } from '../../src/formats/model3d.ts';
const es = parseLib(readFileSync('public/gamedata/FGT/UN3D000.LIB'));
for (const n of ['UNIT011A', 'UNIT000A', 'UNIT001A', 'UNIT020A', 'UNIT030A', 'UNIT007A']) {
  const m = parseModel3D(es.find((e) => e.name === n)!.data);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of m.vertices) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  console.log(n, 'min', mn.join(','), 'max', mx.join(','));
}
