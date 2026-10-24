// Lists building types with their names over all missions (which type bit is which kind of building).
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const seen = new Map<string, number>();
for (const id of ALL_MISSIONS) {
  const lm = await data.loadMission(id);
  const s = createGame(data, lm, { setId: 0, difficulty: 1 });
  for (const sh of s.shops) if (sh.kind === 1) {
    const k = `${sh.type.toString(2).padStart(8, '0')} ${(lm.texts.get(sh.nameIndex) ?? sh.nameIndex).toString().replace(/[0-9 ]+$/, "").slice(0, 22)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
}
for (const [k, n] of [...seen].sort()) console.log(n, k);
