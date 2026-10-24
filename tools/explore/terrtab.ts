import { readFileSync } from 'node:fs';
import { parseMission } from '../../src/formats/mission.ts';
for (const id of process.argv.slice(2)) {
  const m = parseMission(readFileSync(`public/gamedata/MIS/MISS${id}.DAT`));
  const r = m.missRaw; // starts 4 bytes after the MISS tag
  const tab = (o: number) => Array.from(r.subarray(o - 4, o - 4 + 32), (b) => (b << 24) >> 24).join(' ');
  console.log(`MISS${id}\n A ${tab(0x1c)}\n B ${tab(0x3c)}\n C ${tab(0x5c)}\n D ${tab(0x7c)}\n w1 ${Array.from(r.subarray(0x124-4,0x129-4))} w2 ${Array.from(r.subarray(0x12c-4,0x131-4))} x ${Array.from(r.subarray(0x11c-4,0x124-4))}`);
}
