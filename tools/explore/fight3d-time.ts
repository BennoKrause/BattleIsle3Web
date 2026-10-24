import { NodeSource } from '../lib/node-source.ts';
import { FightAssets, FightScene, Raster } from '../../src/render/fight3d.ts';
const a = await FightAssets.load(new NodeSource());
const s = new FightScene(a, { attacker: { type: 11, count: 8, losses: 2, scheme: 0, weaponName: 'Kanone' }, defender: { type: 11, count: 8, losses: 3, scheme: 5, weaponName: 'Kanone' }, defenderFiresBack: true, attackerLeft: true, weather: 0, environment: 'grass' });
const r = new Raster();
s.render(100, r);
const ts: number[] = [];
for (let t = 200; t < 5000; t += 300) { const t0 = performance.now(); s.render(t, r); ts.push(performance.now() - t0); }
console.log('ms per frame:', ts.map((x) => x.toFixed(0)).join(' '), 'avg', (ts.reduce((p, c) => p + c, 0) / ts.length).toFixed(1));
