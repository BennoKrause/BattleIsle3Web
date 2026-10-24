// usage: node tools/explore/fgt-dump.ts <LIB name> <entry name|index> [bytes]
import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm, isTpwm } from '../../src/formats/tpwm.ts';
const [lib, which, nS = '160'] = process.argv.slice(2);
const es = parseLib(readFileSync(`public/gamedata/FGT/${lib}.LIB`));
if (which === 'list') { console.log(es.map((e, i) => `${i}:${e.name}(${(isTpwm(e.data) ? decodeTpwm(e.data) : e.data).length})`).join(' ')); process.exit(0); }
const e = /^\d+$/.test(which) ? es[Number(which)] : es.find((x) => x.name === which)!;
const d = isTpwm(e.data) ? decodeTpwm(e.data) : e.data;
console.log(e.name, 'raw', e.data.length, 'tpwm', isTpwm(e.data), 'len', d.length);
for (let i = 0; i < Math.min(d.length, Number(nS)); i += 16) console.log(i.toString(16).padStart(4, '0'), Array.from(d.slice(i, i + 16), (v) => v.toString(16).padStart(2, '0')).join(' '));
