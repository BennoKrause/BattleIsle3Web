// Software-renders a 3DO2 model to PNG for format checks.
// usage: node tools/explore/model-view.ts <out.png> <LIB> <entry> [yawDeg=30] [pitchDeg=20] [palette=PAL3D00]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { parseModel3D } from '../../src/formats/model3d.ts';
import { parseIffPbm } from '../../src/formats/iff.ts';
import { encodePng } from '../lib/png.ts';
const [out, lib, name, yawS = '30', pitchS = '20', palName = ''] = process.argv.slice(2);
const entries = (l: string) => parseLib(readFileSync(`public/gamedata/FGT/${l}.LIB`));
const m = parseModel3D(entries(lib).find((e) => e.name === name)!.data);
const texLib = entries('TEX000');
const textures = new Map<number, ReturnType<typeof parseIffPbm>>();
const tex = (n: number) => { if (!textures.has(n)) { const e = texLib.find((x) => x.name === `TEX${String(n).padStart(3, '0')}`); textures.set(n, e && e.data.length > 100 ? parseIffPbm(e.data) : null as never); } return textures.get(n) ?? null; };
const pal3d = palName ? entries('PAL000').find((e) => e.name === palName)!.data : null;
const W = 480, H = 400;
const rgba = new Uint8Array(W * H * 4).fill(40);
for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
const zbuf = new Float32Array(W * H).fill(Infinity);
const yaw = (Number(yawS) * Math.PI) / 180, pitch = (Number(pitchS) * Math.PI) / 180;
let maxR = 1; for (const [x, y, z] of m.vertices) maxR = Math.max(maxR, Math.hypot(x, y, z));
const proj = m.vertices.map(([x, y, z]) => {
  const x1 = x * Math.cos(yaw) - z * Math.sin(yaw), z1 = x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch), z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  const s = (Math.min(W, H) * 0.42) / maxR;
  return [W / 2 + x1 * s, H / 2 + 40 + y2 * s, z2] as [number, number, number];
});
function tri(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], face: (typeof m.faces)[number]) {
  const t = tex(face.texture);
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const z = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (z >= zbuf[y * W + x]) continue;
    zbuf[y * W + x] = z;
    let r = 180, g = 180, bl = 180;
    if (t) {
      const u = l1 * ua[0] + l2 * ub[0] + l3 * uc[0], v = l1 * ua[1] + l2 * ub[1] + l3 * uc[1];
      const px = t.pixels[Math.min(t.height - 1, Math.max(0, Math.floor(v * t.height))) * t.width + Math.min(t.width - 1, Math.max(0, Math.floor(u * t.width)))];
      const p = pal3d ?? t.palette!;
      r = p[px * 3]; g = p[px * 3 + 1]; bl = p[px * 3 + 2];
    }
    const o = (y * W + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl;
  }
}
for (const f of m.faces) {
  const vs = f.vertices.map((i) => proj[i]);
  for (let k = 1; k + 1 < vs.length; k++) tri(vs[0], vs[k], vs[k + 1], f.uv[0], f.uv[k], f.uv[k + 1], f);
}
writeFileSync(out, encodePng(W, H, rgba));
console.log(name, 'verts', m.vertices.length, 'faces', m.faces.length, 'textures', [...new Set(m.faces.map((f) => f.texture))].join(','));
