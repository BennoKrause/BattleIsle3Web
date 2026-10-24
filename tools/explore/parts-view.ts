// Highlights the faces of a part (all vertices in the part's list) in red; usage: parts-view.ts <out.png> <model> <partIndex> [yaw] [pitch]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { parseModel3D } from '../../src/formats/model3d.ts';
import { encodePng } from '../lib/png.ts';
const [out, name, partS, yawS = '40', pitchS = '25'] = process.argv.slice(2);
const d = parseLib(readFileSync('public/gamedata/FGT/UN3D000.LIB')).find((e) => e.name === name)!.data;
const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
const m = parseModel3D(d);
const work = v.getUint32(8, true), end = v.getUint32(0x10, true);
const p = end + Number(partS) * 0x40;
const cnt = v.getInt32(p + 12, true), lp = v.getInt32(p + 8, true);
const set = new Set(Array.from({ length: cnt }, (_, k) => Math.round((v.getUint32(lp + k * 4, true) - work) / 20)));
const pivot = [v.getInt32(p + 16, true), v.getInt32(p + 20, true), v.getInt32(p + 24, true)];
const W = 480, H = 360;
const rgba = new Uint8Array(W * H * 4).fill(40); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
const yaw = (Number(yawS) * Math.PI) / 180, pitch = (Number(pitchS) * Math.PI) / 180;
let maxR = 1; for (const [x, y, z] of m.vertices) maxR = Math.max(maxR, Math.hypot(x, y, z));
const P = (q: number[]) => { const x1 = q[0] * Math.cos(yaw) - q[2] * Math.sin(yaw), z1 = q[0] * Math.sin(yaw) + q[2] * Math.cos(yaw); const y2 = q[1] * Math.cos(pitch) - z1 * Math.sin(pitch); const s = (Math.min(W, H) * 0.4) / maxR; return [W / 2 + x1 * s, H / 2 + 30 + y2 * s]; };
const line = (a: number[], b: number[], c: number[]) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) { const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n); if (x >= 0 && y >= 0 && x < W && y < H) { const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; } } };
for (const f of m.faces) { const inSet = f.vertices.every((i) => set.has(i)); const col = inSet ? [255, 60, 60] : [140, 140, 140]; const ps = f.vertices.map((i) => P(m.vertices[i])); for (let k = 0; k < ps.length; k++) line(ps[k], ps[(k + 1) % ps.length], col); }
const pp = P(pivot); for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const o = (Math.round(pp[1]) + dy) * W * 4 + (Math.round(pp[0]) + dx) * 4; rgba[o] = 60; rgba[o + 1] = 255; rgba[o + 2] = 60; }
writeFileSync(out, encodePng(W, H, rgba));
console.log(name, 'part', partS, 'verts', set.size, 'pivot', pivot.join(','));
