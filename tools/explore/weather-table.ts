// Weather sprite table of PART000.DAT: how many records change their picture per weather, and whether the replacement has other type bits.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
const data = await loadGameData(new NodeSource());
const t = data.terrain;
for (let w = 0; w < 5; w++) {
  let self = 0, other = 0, neg = 0, typeDiff = 0;
  t.forEach((d, i) => { const r = d.weatherSprites[w]; if (r < 0) neg++; else if (r === i) self++; else { other++; if (t[r] && t[r].typeMask !== d.typeMask) typeDiff++; } });
  console.log('weather', w, { self, other, neg, typeDiff });
}
console.log('examples', [9, 90, 96, 120].map((i) => `${i}:${t[i].weatherSprites.join(',')}`));
