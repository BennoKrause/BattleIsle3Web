// Fixed AI orders of the missions: shop records with kind bit 2, bytes 72-79 (SDI_1C.EXE FUN_0042c109 -> FUN_00427912).
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const stats = new Map<number, number>();
for (const id of ALL_MISSIONS) {
  const m = (await data.loadMission(id)).mission;
  const rows: string[] = [];
  for (const sh of m.shops) {
    if (!(sh.kind & 2)) continue;
    const r = sh.raw, v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    const flags = r[72], b9 = r[73], prio = v.getInt16(74, true), target = v.getInt16(76, true), t2 = v.getInt16(78, true);
    stats.set(flags, (stats.get(flags) ?? 0) + 1);
    const unit = m.units.find((u) => u.x === sh.x && u.y === sh.y);
    rows.push(`(${sh.x},${sh.y}) k${sh.kind} f${flags.toString(16)} b${b9} p${prio} t${target < 0 ? target : `${target & 63},${target >> 6}`} o7=${t2} ${unit ? data.unitClasses[unit.type].name + '/P' + unit.owner : 'no unit'}`);
  }
  if (rows.length) console.log(id, rows.length, rows.slice(0, 4).join(' | '));
}
console.log('flags', [...stats].map(([f, n]) => `${f.toString(16)}:${n}`).join(' '));
