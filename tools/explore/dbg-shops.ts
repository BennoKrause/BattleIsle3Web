import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
const data = await loadGameData(new NodeSource());
const s = createGame(data, await data.loadMission(100), { setId: 0, difficulty: 1 });
console.log(s.shops.map((sh) => [sh.kind, sh.type, sh.func, sh.owner]));
