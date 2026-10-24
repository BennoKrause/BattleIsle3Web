import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm, isTpwm } from '../../src/formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap } from '../../src/formats/bitmap.ts';
const f = process.argv[2] ?? 'UIA000';
const es = parseLib(readFileSync(`public/gamedata/UIA/${f}.LIB`));
console.log(f, es.length, 'entries');
console.log(es.map((e) => { const d = isTpwm(e.data) ? decodeTpwm(e.data) : e.data; const b = isInfoBitmap(d) ? parseInfoBitmap(d) : null; return `${e.name}(${d.length}${b ? ` ${b.width}x${b.height} t${b.transparent}` : ''})`; }).join(' '));
