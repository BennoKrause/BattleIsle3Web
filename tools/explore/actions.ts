import { readFileSync } from 'node:fs';
import { parseMission } from '../../src/formats/mission.ts';
for (const id of process.argv.slice(2)) {
  const m = parseMission(readFileSync(`original/cd1/MIS/MISS${id}.DAT`));
  console.log(`== MISS${id} req=${m.requiredVictoryConditions} allies=${m.allies.map(a=>a.toString(2)).join(',')} names=${JSON.stringify(m.playerNames)}`);
  for (const a of m.actions) console.log(`  #${a.index} cat=${a.category} t=${a.turn}.${a.movement} pl=${a.playerMask.toString(2)} type=${a.type} param=${a.param} shop=${a.shop} ally=${a.newAlly} raw1=${a.raw[1]} u2=${Buffer.from(a.raw.subarray(8,12)).toString('hex')} rest=${Buffer.from(a.raw.subarray(18)).toString('hex')}`);
  console.log('  shops:', m.shops.map(s=>`${s.index}:${s.kind}/${s.shopType}@${s.x},${s.y} o${s.owner} n${s.nameIndex}`).join(' '));
  console.log('  df:', m.dfLayers.map(l=>l.length));
}
