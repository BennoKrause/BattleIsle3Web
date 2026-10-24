// Plays missions with the rebuilt original AI for all sides and prints actions per mission (smoke test, timing).
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { Game } from '../../src/engine/game.ts';
import { OriginalAI } from '../../src/engine/ai-original.ts';
import { ALL_MISSIONS } from '../../tests/helpers.ts';
const data = await loadGameData(new NodeSource());
const which = 'original';
const ids = process.argv[3] ? process.argv[3].split(',').map(Number) : ALL_MISSIONS;
const rounds = Number(process.argv[4] ?? 2);
for (const id of ids) {
  const g = new Game(data, createGame(data, await data.loadMission(id), { setId: 0, difficulty: 1 }));
  g.start();
  const t0 = performance.now();
  let steps = 0;
  for (let i = 0; i < 6 * rounds + 6 && !g.state.outcome && g.state.turn < rounds; i++) {
    const ai = new OriginalAI(g); ai.begin(); while (steps < 1e6 && ai.step()) steps++;
    g.endTurn();
  }
  const ev = g.state.events;
  const n = (k: string) => ev.filter((e) => e.kind === k).length;
  const kills = g.state.players.map((p) => p.killed).join('/');
  console.log(id, which, `${Math.round(performance.now() - t0)}ms`, 'steps', steps, 'combat', n('combat'), 'captured', n('building-captured'), 'produced', g.state.players.map((p) => p.produced).join('/'), 'kills', kills, g.state.outcome?.result ?? '');
}
