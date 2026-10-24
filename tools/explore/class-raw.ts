import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
const data = await loadGameData(new NodeSource());
for (const t of process.argv.slice(2).map(Number)) {
  const c = data.unitClasses[t];
  console.log(t, c.name, '|', c.weaponNames.join(' / '));
  console.log('  ', Array.from(c.raw.slice(0, 88), (v, i) => `${i}:${v}`).filter((s) => !s.endsWith(':0')).join(' '));
}
