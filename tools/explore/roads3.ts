import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
for (const id of ALL_MISSIONS) {
  const m = (await data.loadMission(id)).mission;
  const hits: string[] = [];
  m.overlay.forEach((o, i) => { if (o >= 1264 && o <= 1275) hits.push(`${o}@${i % m.width},${Math.floor(i / m.width)}`); });
  if (hits.length) console.log(id, hits.slice(0, 4).join(' '), hits.length);
}
