// Palette indices used by the overlay sprites of building fields (are there player-colour indices to remap?).
import { readFileSync } from 'node:fs';
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { createGame } from '../../src/engine/setup.ts';
import { parseLib } from '../../src/formats/lib.ts';
const data = await loadGameData(new NodeSource());
const sprites = parseLib(readFileSync('public/gamedata/LIB/PART000.LIB'));
for (const id of [104, 107]) {
  const s = createGame(data, await data.loadMission(id), { setId: 0, difficulty: 1 });
  for (const sh of s.shops.slice(0, 6)) {
    const i = sh.y * s.width + sh.x;
    const sp = [s.terrain[i], s.overlay[i]];
    const hist = new Map<number, number>();
    for (const t of sp) if (t >= 0) for (const v of sprites[t].data.subarray(0, 576)) hist.set(v, (hist.get(v) ?? 0) + 1);
    const player = [...hist].filter(([v]) => v >= 128 && v < 160).map(([v, n]) => `${v}x${n}`).join(' ');
    console.log(id, 'owner', sh.owner, 'func', sh.func, 'sprites', sp.join('/'), 'playerIdx:', player || '-');
  }
}
