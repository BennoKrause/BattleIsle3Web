// Missions in which player 0 owns units with special abilities (supply, repair, construction, height change).
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const SPECIAL = new Set([0, 1, 2, 14, 18, 19, 30, 31, 32, 33, 34, 39, 42, 45, 46, 47, 54, 62]);
for (const id of ALL_MISSIONS) {
  const lm = await data.loadMission(id);
  const s = createGame(data, lm, { setId: 0, difficulty: 1 });
  const own = s.units.filter((u) => u.owner === 0 && SPECIAL.has(u.type));
  if (own.length) console.log(id, lm.mission.width + 'x' + lm.mission.height, own.map((u) => `${data.unitClasses[u.type].name}${u.container ? '(in)' : ''}`).join(', '), 'build', s.buildMask?.toString(2));
}
