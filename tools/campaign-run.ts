// Runs every mission headless with the provisional computer AI on all sides and records the
// outcome in research/campaign-run.json (input for docs/testing/CAMPAIGN_VALIDATION.md).
import { writeFileSync } from 'node:fs';
import { NodeSource } from './lib/node-source.ts';
import { loadGameData } from '../src/data/gamedata.ts';
import { createGame } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { OriginalAI } from '../src/engine/ai-original.ts';
import { Difficulty } from '../src/engine/rules.ts';

const data = await loadGameData(new NodeSource());
const maxTurns = Number(process.argv[2] ?? 40);
const out: Record<string, unknown> = {};
for (const set of data.sets) for (const m of set.missions) {
  const lm = await data.loadMission(m.fileId);
  const g = new Game(data, createGame(data, lm, { setId: set.id, difficulty: Difficulty.NORMAL }));
  g.start();
  const ai = new OriginalAI(g);
  const t0 = Date.now();
  let error: string | null = null;
  try {
    while (!g.state.outcome && g.state.turn < maxTurns) { ai.playTurn(); g.endTurn(); }
  } catch (e) { error = String(e); }
  out[m.fileId] = { outcome: g.state.outcome, turn: g.state.turn, error, ms: Date.now() - t0, units: [0, 1, 2, 3, 4, 5].map((p) => g.unitsOf(p).length) };
  console.log(m.fileId, JSON.stringify(out[m.fileId]));
}
writeFileSync('research/campaign-run.json', JSON.stringify(out, null, 1));
