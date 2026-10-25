// Compares our 8-bit transport/shop entry tests with the 16-bit tests of SDI_1C.EXE FUN_00436afa over all data.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const cls = data.unitClasses;
const w16 = (r: Uint8Array, o: number) => r[o] | (r[o + 1] << 8);
let diffT = 0;
for (const c of cls) {
  if (!(c.flags & 0x10)) continue;
  for (const u of cls) {
    const ours = (c.transportMask & u.transportClass) !== 0;
    const exe = (w16(c.raw, 80) & w16(u.raw, 74)) !== 0;
    if (ours !== exe) { diffT++; if (diffT < 10) console.log('transport', c.name, '<-', u.name, 'ours', ours, 'exe', exe, w16(c.raw, 80).toString(16), w16(u.raw, 74).toString(16)); }
  }
}
let diffS = 0;
const seen = new Set<string>();
for (const id of ALL_MISSIONS) {
  const m = (await data.loadMission(id)).mission;
  for (const sh of m.shops) {
    if (!(sh.kind & 1) || sh.shopType === 0) continue;
    const sw = sh.raw[50] | (sh.raw[51] << 8);
    for (const u of cls) {
      const ours = (sh.shopType & u.shopMask) !== 0;
      const exe = (sw & w16(u.raw, 74)) !== 0;
      if (ours !== exe) { diffS++; const k = `${sw.toString(16)}/${u.name}`; if (!seen.has(k) && seen.size < 10) { seen.add(k); console.log('shop', id, sw.toString(16), u.name, w16(u.raw, 74).toString(16), 'ours', ours, 'exe', exe); } }
    }
  }
}
console.log('differences: transport', diffT, 'shop', diffS);
