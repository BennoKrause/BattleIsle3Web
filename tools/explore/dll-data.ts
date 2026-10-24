// Reads initialised data of a PE file by virtual address.
// usage: node tools/explore/dll-data.ts <dll> <VA hex> <count> [dwords|words|bytes|double]
import { readFileSync } from 'node:fs';
const [dll, vaS, countS, mode = 'dwords'] = process.argv.slice(2);
const b = readFileSync(dll);
const pe = b.readUInt32LE(0x3c), n = b.readUInt16LE(pe + 6), opt = b.readUInt16LE(pe + 20), base = b.readUInt32LE(pe + 24 + 28);
const va = parseInt(vaS, 16), count = Number(countS);
for (let i = 0; i < n; i++) {
  const s = pe + 24 + opt + i * 40;
  const sva = base + b.readUInt32LE(s + 12), raw = b.readUInt32LE(s + 20), rsz = b.readUInt32LE(s + 16);
  if (va >= sva && va < sva + Math.max(rsz, b.readUInt32LE(s + 8))) {
    const off = raw + (va - sva);
    const out: string[] = [];
    const step = mode === 'bytes' ? 1 : mode === 'words' ? 2 : mode === 'double' ? 8 : 4;
    for (let k = 0; k < count; k++) {
      const p = off + k * step, a = (va + k * step).toString(16);
      if (va - sva + k * step >= rsz) { out.push(`${a}:bss`); continue; }
      const v = mode === 'bytes' ? b.readUInt8(p) : mode === 'words' ? b.readInt16LE(p) : mode === 'double' ? b.readDoubleLE(p) : b.readInt32LE(p);
      out.push(`${a}:${v}`);
    }
    console.log(b.toString('ascii', s, s + 8).replace(/\0/g, ''), out.join(' '));
    process.exit(0);
  }
}
console.log('not mapped');
