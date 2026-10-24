import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
const data = await loadGameData(new NodeSource());
const counts = new Map<number, number>();
for (const id of [100, 101, 102, 103, 110, 200, 300]) {
  const m = await data.loadMission(id);
  for (const o of m.mission.overlay) if (o >= 0 && (data.terrain[o].typeMask & 0b1111)) counts.set(o, (counts.get(o) ?? 0) + 1);
}
for (const [o, n] of [...counts].sort((a, b) => a[0] - b[0])) console.log(o, n, data.terrain[o].typeMask.toString(16));
