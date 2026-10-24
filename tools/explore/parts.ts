import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
const es = parseLib(readFileSync('public/gamedata/FGT/UN3D000.LIB'));
for (const n of process.argv.slice(2)) {
  const d = es.find((e) => e.name === n)!.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const work = v.getUint32(8, true), end = v.getUint32(0x10, true), nv = v.getUint32(0xa6, true), parts = v.getUint32(0xae, true);
  console.log(n, 'len', d.length, 'work', work.toString(16), 'end', end.toString(16), 'verts', nv, 'parts', parts);
  let p = end;
  // records of 0x40 bytes?
  for (let i = 0; i < parts; i++) {
    const rec = Array.from({ length: 16 }, (_, k) => v.getInt32(p + i * 0x40 + k * 4, true));
    const listPtr = rec[2], cnt = rec[3];
    const list = Array.from({ length: Math.min(cnt, 40) }, (_, k) => Math.round((v.getUint32(listPtr + k * 4, true) - work) / 20));
    console.log(' part', i, rec.map((x) => x.toString()).join(' '), '\n   verts', list.join(','));
  }
  console.log(' tail bytes', d.length - end - parts * 0x40);
}
