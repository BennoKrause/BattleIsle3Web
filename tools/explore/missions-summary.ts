import { readFileSync } from 'node:fs';
import { parseMission } from '../../src/formats/mission.ts';
const ids=[...Array(20).keys()].map(i=>100+i).concat([...Array(8).keys()].map(i=>200+i),[...Array(12).keys()].map(i=>300+i));
for (const id of ids){
  const m=parseMission(readFileSync(`original/cd1/MIS/MISS${id}.DAT`));
  const owners=[...new Set(m.units.map(u=>u.owner).concat(m.shops.filter(s=>s.kind==1&&s.shopType>0).map(s=>s.owner)))].sort();
  const cats:Record<string,number>={}; for(const a of m.actions){const k=a.category+':'+a.type;cats[k]=(cats[k]||0)+1}
  console.log(id,`${m.width}x${m.height}`,'next',m.nextMissionRaw,m.nextMissionRaw2,'wx',m.weather,'ai',m.aiMask.toString(2),'req',m.requiredVictoryConditions,'brief',m.briefingMessage,'bonus',m.bonusMission,'units',m.units.length,'shops',m.shops.length,'owners',owners.join(''),'df',m.dfLayers.map(l=>l.length).join('/'),'acts',JSON.stringify(cats));
}
