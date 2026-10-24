import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { Game } from '../../src/engine/game.ts';
import { Difficulty } from '../../src/engine/rules.ts';
const data = await loadGameData(new NodeSource());
const lm = await data.loadMission(Number(process.argv[2] ?? 100));
const g = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
g.start();
console.log('events at start', g.state.events.map(e => e.kind + JSON.stringify(e.data)));
for (const u of g.unitsOf(0)) {
  const c = data.unitClasses[u.type];
  const area = g.moveArea(u.id);
  console.log(u.id, c.name, `@${u.x},${u.y}`, 'grp', u.group, 'fuel', u.fuel, 'moves', area.targets.size, 'targets', g.attackTargets(u.id).map(t => `${t.unitId}:${data.unitClasses[g.state.units[t.unitId].type].name}`).join(','));
}
for (const u of g.state.units.filter(u => u.owner !== 0)) console.log('  other', u.id, data.unitClasses[u.type].name, 'owner', u.owner, `@${u.x},${u.y}`, 'visible', g.visibleTo(0, u.id));
