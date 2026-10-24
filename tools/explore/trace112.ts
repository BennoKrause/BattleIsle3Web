import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { Game } from '../../src/engine/game.ts';
import { ComputerPlayer } from '../../src/engine/ai.ts';
import { Difficulty } from '../../src/engine/rules.ts';
import { distance } from '../../src/engine/hex.ts';
const data = await loadGameData(new NodeSource());
const lm = await data.loadMission(112);
const g = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
g.start();
const sh = g.state.shops[15];
console.log('shop15', sh.x, sh.y, 'owner', sh.owner, 'type', sh.type, 'units inside', sh.units.length, lm.texts.get(sh.nameIndex));
console.log('defeat conds', g.state.defeatConditions, 'victory', g.state.victoryConditions);
const near = g.state.units.filter(u => u.alive && !u.container && distance(u.x, u.y, sh.x, sh.y) <= 6).map(u => `${data.unitClasses[u.type].name}/o${u.owner}@${u.x},${u.y} d${distance(u.x,u.y,sh.x,sh.y)}`);
console.log(near.join('\n'));
const ai = new ComputerPlayer(g);
ai.playTurn(); g.endTurn();
console.log('after p0, active', g.state.activePlayer, 'shop15 owner', sh.owner);
ai.playTurn(); g.endTurn();
console.log('after p1 shop15 owner', sh.owner, g.state.outcome);
for (const e of g.state.events.filter(e=>e.kind==='building-captured')) console.log(JSON.stringify(e));
// --- debug guard logic on a fresh game
const g2 = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
g2.start();
const ai2 = new ComputerPlayer(g2);
ai2.planObjectives();
console.log('guard', [...(ai2 as any).guard], 'objectives', (ai2 as any).objectives.length);
const shopIdx = g2.w.idx(33, 34);
for (const u of g2.unitsOf(0).filter(u => !u.container && distance(u.x, u.y, 33, 34) <= 3)) {
  const a = g2.moveArea(u.id);
  console.log(data.unitClasses[u.type].name, 'canMove', g2.canMove(u), 'area', a.targets.size, 'reachesCity', a.targets.has(shopIdx));
}
