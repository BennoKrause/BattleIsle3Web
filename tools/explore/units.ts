import { readFileSync } from 'node:fs';
import { parseUnitClasses } from '../../src/formats/unitdef.ts';
import { textTable } from '../../src/formats/text.ts';
import { parseTerrainDefs } from '../../src/formats/terraindef.ts';
const u = parseUnitClasses(readFileSync('original/cd1/LIB/UNIT000.DAT'));
const t = textTable(readFileSync('original/cd1/GER/UNIT000.TXT'), 'cp850');
for (const c of u) console.log(c.index, t.get(c.nameText), '|', t.get(c.descriptionText), `fuel=${c.fuel} mv=${c.moveRange} use=${c.fuelUsage} cost=${c.costEnergy}/${c.costMaterial} grp=${c.groupSize}/${c.groupSize2} arm=${c.armor} att=${c.attack} sight=${c.sight} jam=${c.sightBlock} flags=${c.flags.toString(16)} terr=${c.terrainMask.toString(16)} w=${c.weapons.map(w=>`${w.damage}/${w.minRange}-${w.maxRange}/a${w.ammo}/t${w.targets.toString(16)}`).join(' ')}`);
const td = parseTerrainDefs(readFileSync('original/cd1/LIB/PART000.DAT'));
console.log('terrain', td.length, td.slice(0,5).map(x=>JSON.stringify({m:x.typeMask.toString(16),d:x.defense,a:[x.animationStart,x.animationLength],w:x.weatherSprites})));
