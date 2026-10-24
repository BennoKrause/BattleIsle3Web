import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm, isTpwm } from '../../src/formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap } from '../../src/formats/bitmap.ts';
for (const l of ['BACKS000', 'FGTEXPLO', 'FGTSHOOT', 'GRND000', 'LAND000', 'LAYR000', 'PAL000', 'SCHOSS', 'TEX000', 'UN3D000', 'UN3D001']) {
  const es = parseLib(readFileSync(`public/gamedata/FGT/${l}.LIB`));
  const kinds = new Map<string, number>();
  let sample = '';
  es.forEach((e, i) => {
    const raw = isTpwm(e.data) ? decodeTpwm(e.data) : e.data;
    const k = (isTpwm(e.data) ? 'tpwm:' : 'raw:') + (isInfoBitmap(raw) ? 'info' : `len${raw.length > 2000 ? 'big' : raw.length}`);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
    if (i < 3 || i === es.length - 1) { const b = isInfoBitmap(raw) ? parseInfoBitmap(raw) : null; sample += ` ${JSON.stringify(e.name)}(${raw.length}${b ? ` ${b.width}x${b.height}` : ''})`; }
  });
  console.log(l, es.length, [...kinds].map(([k, v]) => `${k}=${v}`).join(' '), '\n   ', sample);
}
