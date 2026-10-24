import { writeFileSync } from 'node:fs';
import { NodeSource } from '../lib/node-source.ts';
import { FightAssets, Raster } from '../../src/render/fight3d.ts';
import { encodePng } from '../lib/png.ts';
const a = await FightAssets.load(new NodeSource());
const r = new Raster(); r.clear(); r.cam = { x: 0, y: -500, z: -3000, yaw: 0, pitch: 0 };
for (let i = 0; i < 8; i++) {
  const img = a.texture(64 + i);
  console.log(64 + i, img ? `${img.width}x${img.height} pal0=${(a.texturePalette(img)[0] >>> 0).toString(16)} max=${Math.max(...img.pixels)}` : 'none');
  if (img) r.drawSprite(img, a.texturePalette(img), -1400 + i * 400, 0, 0, 380, 1);
}
writeFileSync(process.argv[2], encodePng(600, 400, new Uint8Array(r.color.buffer)));
