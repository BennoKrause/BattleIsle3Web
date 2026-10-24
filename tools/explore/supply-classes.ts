// Unit classes with supply, repair, construction or height-change abilities and their stock slots.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
const data = await loadGameData(new NodeSource());
const F: [number, string][] = [[1, 'road'], [2, 'trench'], [4, 'rail'], [0x10000, 'demolish'], [0x400, 'REPAIR'], [0x800, 'REFUEL'], [0x100000, 'REFUEL_AIR'], [0x1000000, 'CLIMB'], [0x2000000, 'DIVE'], [0x800000, 'PLANE']];
for (const c of data.unitClasses) {
  const f = c.flags >>> 0;
  if (!(f & (1 | 2 | 4 | 0x10000 | 0x400 | 0x800 | 0x3000000))) continue;
  const tags = F.filter(([b]) => f & b).map(([, n]) => n).join(',');
  const slots = c.weapons.map((wp, i) => `${i}:${(wp.rawTargets >>> 0).toString(16)}/${wp.ammo}`).join(' ');
  console.log(c.index, c.name.padEnd(20), tags.padEnd(36), 'fuel', c.fuel, '|', slots);
}
