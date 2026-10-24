// Renders frames of the 3D fight to PNG files (headless).
// usage: node tools/explore/fight3d-shot.ts <outdir> <typeAtt> <typeDef> [env=grass] [t1,t2,...]
import { writeFileSync } from 'node:fs';
import { NodeSource } from '../lib/node-source.ts';
import { FightAssets, FightScene, Raster, VIEW_H, VIEW_W } from '../../src/render/fight3d.ts';
import { encodePng } from '../lib/png.ts';
const [dir, ta = '11', td = '0', env = 'grass', ts = '800,2000,2300,3200'] = process.argv.slice(2);
const assets = await FightAssets.load(new NodeSource());
const scene = new FightScene(assets, {
  attacker: { type: Number(ta), count: 6, losses: 1, scheme: 0, weaponName: 'Kanone' },
  defender: { type: Number(td), count: 5, losses: 3, scheme: 5, weaponName: 'MG' },
  defenderFiresBack: true, attackerLeft: true, weather: 0, environment: env as never,
});
const r = new Raster(VIEW_W, VIEW_H);
console.log('duration', scene.duration);
for (const t of ts.split(',').map(Number)) {
  const t0 = Date.now();
  scene.render(t, r);
  writeFileSync(`${dir}/f3d_${t}.png`, encodePng(VIEW_W, VIEW_H, new Uint8Array(r.color.buffer)));
  console.log(t, `${Date.now() - t0}ms`);
}
