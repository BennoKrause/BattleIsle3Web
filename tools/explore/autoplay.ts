// Plays a mission with computer players on all sides (incl. the human side) to exercise the engine.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { Game } from '../../src/engine/game.ts';
import { OriginalAI } from '../../src/engine/ai-original.ts';
import { Difficulty } from '../../src/engine/rules.ts';
const data = await loadGameData(new NodeSource());
const id = Number(process.argv[2] ?? 100), maxTurns = Number(process.argv[3] ?? 40);
const lm = await data.loadMission(id);
const g = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
g.start();
const ai = new OriginalAI(g);
const t0 = Date.now();
while (!g.state.outcome && g.state.turn < maxTurns) {
  ai.playTurn();
  g.endTurn();
}
const alive = [0,1,2,3,4,5].map(p => g.unitsOf(p).length);
console.log(`MISS${id}: outcome=${JSON.stringify(g.state.outcome)} turn=${g.state.turn} units=${alive} time=${Date.now()-t0}ms events=${g.state.events.length}`);
const kinds: Record<string, number> = {}; for (const e of g.state.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; console.log(kinds);
