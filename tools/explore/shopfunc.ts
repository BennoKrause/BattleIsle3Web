// Compares the shop record fields "function" (+4, used by SDI_1C.EXE as building type) and "shopType" (+51) with the names.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const seen = new Map<string, string[]>();
for (const id of ALL_MISSIONS) {
  const lm = await data.loadMission(id);
  for (const sh of lm.mission.shops) if (sh.kind & 1) {
    const k = `func ${(sh.function & 0xff).toString(2).padStart(8, '0')} type ${sh.shopType.toString(2).padStart(8, '0')}`;
    const n = (lm.texts.get(sh.nameIndex) ?? '?').slice(0, 16);
    const arr = seen.get(k) ?? []; if (arr.length < 6 && !arr.includes(n)) arr.push(n); seen.set(k, arr);
  }
}
for (const [k, v] of [...seen].sort()) console.log(k, '|', v.join(', '));
