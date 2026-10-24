// Reads data from the original EXE by virtual address (reverse-engineering helper).
// usage: node tools/re-dump.ts <VA hex> <count> [s8|u8|s16|u16|s32|hex] [row]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadPe(path: string) {
  const buf = readFileSync(path);
  const pe = buf.readUInt32LE(0x3c);
  const nsec = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const imageBase = buf.readUInt32LE(pe + 24 + 28);
  const secs: { name: string; va: number; vsize: number; raw: number; rawSize: number }[] = [];
  for (let i = 0; i < nsec; i++) {
    const s = pe + 24 + optSize + i * 40;
    secs.push({
      name: buf.toString('ascii', s, s + 8).replace(/\0+$/, ''),
      va: imageBase + buf.readUInt32LE(s + 12), vsize: buf.readUInt32LE(s + 8),
      raw: buf.readUInt32LE(s + 20), rawSize: buf.readUInt32LE(s + 16),
    });
  }
  const off = (va: number) => {
    const s = secs.find((x) => va >= x.va && va < x.va + Math.max(x.vsize, x.rawSize));
    if (!s) throw new Error(`VA ${va.toString(16)} not mapped`);
    if (va - s.va >= s.rawSize) return -1; // uninitialised (bss)
    return s.raw + (va - s.va);
  };
  return { buf, secs, off };
}

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  const exe = loadPe(join(import.meta.dirname, '..', 'original', 'cd1', 'BIN', 'SDI_1C.EXE'));
  const [vaHex, countStr, type = 'hex', rowStr = '16'] = process.argv.slice(2);
  const va = parseInt(vaHex, 16), count = Number(countStr), row = Number(rowStr);
  const o = exe.off(va);
  if (o < 0) { console.log('uninitialised data (bss)'); process.exit(0); }
  const size = { s8: 1, u8: 1, s16: 2, u16: 2, s32: 4, hex: 1 }[type] ?? 1;
  const vals: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = o + i * size;
    const b = exe.buf;
    vals.push(type === 's8' ? String(b.readInt8(p)) : type === 'u8' ? String(b[p]) : type === 's16' ? String(b.readInt16LE(p))
      : type === 'u16' ? String(b.readUInt16LE(p)) : type === 's32' ? String(b.readInt32LE(p)) : b[p].toString(16).padStart(2, '0'));
  }
  for (let i = 0; i < vals.length; i += row) console.log((va + i * size).toString(16), vals.slice(i, i + row).join(' '));
}
