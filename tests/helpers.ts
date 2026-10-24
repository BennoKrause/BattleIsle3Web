import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NodeSource, GAMEDATA_DIR } from '../tools/lib/node-source.ts';
import { loadGameData, type GameData } from '../src/data/gamedata.ts';

/** Tests that need the imported original data are skipped when it is missing. */
export const hasGameData = existsSync(join(GAMEDATA_DIR, 'manifest.json'));

let cached: Promise<GameData> | null = null;
export function gameData(): Promise<GameData> {
  cached ??= loadGameData(new NodeSource());
  return cached;
}

export const ALL_MISSIONS = [
  ...Array.from({ length: 20 }, (_, i) => 100 + i),
  ...Array.from({ length: 8 }, (_, i) => 200 + i),
  ...Array.from({ length: 12 }, (_, i) => 300 + i),
];
