import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { isModel3D, parseModel3D } from '../../src/formats/model3d.ts';
let ok = 0, bad = 0, badIdx = 0;
const tex = new Set<number>(), shade = new Set<number>();
for (const l of ['UN3D000', 'UN3D001', 'LAND000', 'LAYR000', 'SCHOSS']) {
  for (const e of parseLib(readFileSync(`public/gamedata/FGT/${l}.LIB`))) {
    if (!isModel3D(e.data)) continue;
    try {
      const m = parseModel3D(e.data);
      for (const f of m.faces) { tex.add(f.texture); shade.add(f.shade); for (const i of f.vertices) if (i < 0 || i >= m.vertices.length) { badIdx++; } }
      ok++;
    } catch (err) { bad++; if (bad < 8) console.log(l, e.name, String(err)); }
  }
}
console.log({ ok, bad, badIdx, textures: [...tex].sort((a, b) => a - b), shades: [...shade].sort((a, b) => a - b).slice(0, 20) });
