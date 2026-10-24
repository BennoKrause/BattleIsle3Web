// FileSource for Node (tests, tools): reads the imported game data from public/gamedata.
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileSource } from '../../src/data/source.ts';

export const GAMEDATA_DIR = join(import.meta.dirname, '..', '..', 'public', 'gamedata');

export class NodeSource implements FileSource {
  private dir: string;
  constructor(dir = GAMEDATA_DIR) {
    this.dir = dir;
  }
  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.dir, path.toUpperCase())));
  }
  async exists(path: string): Promise<boolean> {
    try { await access(join(this.dir, path.toUpperCase())); return true; } catch { return false; }
  }
}
