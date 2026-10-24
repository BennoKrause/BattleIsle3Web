import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { isModel3D, parseModel3D } from '../../src/formats/model3d.ts';
const a = new Map(parseLib(readFileSync('public/gamedata/FGT/UN3D000.LIB')).map((e) => [e.name, e.data]));
const b = new Map(parseLib(readFileSync('public/gamedata/FGT/UN3D001.LIB')).map((e) => [e.name, e.data]));
const onlyA = [...a.keys()].filter((k) => !b.has(k)), onlyB = [...b.keys()].filter((k) => !a.has(k));
console.log('only 000:', onlyA.filter((n) => n.endsWith('A')).join(' '));
console.log('only 001:', onlyB.filter((n) => n.endsWith('A')).join(' '));
let same = 0, diff: string[] = [];
for (const [k, d] of a) if (b.has(k) && k.endsWith('A')) { const e = b.get(k)!; if (e.length === d.length && e.every((v, i) => v === d[i])) same++; else diff.push(`${k}:${d.length}/${e.length}`); }
console.log('identical', same, 'different', diff.slice(0, 12).join(' '), diff.length);
for (const k of ['UNIT011A', 'UNIT000A', 'UNIT020A']) for (const [n, m] of [['000', a], ['001', b]] as const) { const d = m.get(k); if (d && isModel3D(d)) { const p = parseModel3D(d); console.log(k, n, p.vertices.length, p.faces.length, p.partCount); } }
