// 3D fight scene (manual p. 39: "Kampf 3D"). The original renders with its own polygon engine in
// BIN/WC_FIGTR.DLL; the data files (FGT/*.LIB) are decoded in formats/model3d.ts and formats/iff.ts. This
// module is an independent re-implementation: a small perspective-correct software rasteriser, a
// ground plane / horizon like the original and a scripted camera + fire sequence.
//
// NOT original: the exact camera script, formation layout, projectile models and the unit part animation
// (turrets) of the original are not reconstructed; they are approximated (see docs/research/FORMAT_3DO2.md).
import type { FileSource } from '../data/source.ts';
import { parseLib } from '../formats/lib.ts';
import { parseModel3D, isModel3D, type Model3D, type ModelPart } from '../formats/model3d.ts';
import { parseIffPbm, type IffImage } from '../formats/iff.ts';

export const VIEW_W = 600;
export const VIEW_H = 400;

// ------------------------------------------------------------------------------------------ assets
export class FightAssets {
  private models = new Map<string, Model3D | null>();
  private entries = new Map<string, Uint8Array>();
  private textures = new Map<number, IffImage | null>();
  private palettes = new Map<number, Uint32Array>();
  private backgrounds = new Map<number, IffImage | null>();
  private waves = new Map<string, Uint8Array>();

  static async load(src: FileSource): Promise<FightAssets> {
    const a = new FightAssets();
    for (const lib of ['UN3D000', 'TEX000', 'BACKS000', 'PAL000', 'FGTSHOOT', 'FGTEXPLO']) {
      for (const e of parseLib(await src.read(`FGT/${lib}.LIB`))) a.entries.set(`${lib}/${e.name}`, e.data);
    }
    return a;
  }

  /** Model of a unit class (UNITnnnA of UN3D000.LIB). */
  unitModel(type: number): Model3D | null {
    const name = `UNIT${String(type).padStart(3, '0')}A`;
    if (!this.models.has(name)) {
      const d = this.entries.get(`UN3D000/${name}`);
      this.models.set(name, d && isModel3D(d) ? parseModel3D(d) : null);
    }
    return this.models.get(name) ?? null;
  }

  texture(n: number): IffImage | null {
    if (!this.textures.has(n)) {
      const d = this.entries.get(`TEX000/TEX${String(n).padStart(3, '0')}`);
      this.textures.set(n, d && d.length > 100 ? parseIffPbm(d) : null);
    }
    return this.textures.get(n) ?? null;
  }

  /** PAL3Dxx: index = weather * 16 + colour scheme (palette entries 128..159 hold the player colours). */
  palette(index: number): Uint32Array {
    let p = this.palettes.get(index);
    if (!p) {
      const d = this.entries.get(`PAL000/PAL3D${index.toString(16).toUpperCase().padStart(2, '0')}`) ?? this.entries.get('PAL000/PAL3D00')!;
      p = new Uint32Array(256);
      for (let i = 0; i < 256; i++) p[i] = (255 << 24) | (d[i * 3 + 2] << 16) | (d[i * 3 + 1] << 8) | d[i * 3];
      this.palettes.set(index, p);
    }
    return p;
  }

  /** Palette stored in a texture's own CMAP chunk (explosion sprites). */
  texturePalette(img: IffImage): Uint32Array {
    const p = new Uint32Array(256), c = img.palette!;
    for (let i = 0; i < 256; i++) p[i] = (255 << 24) | (c[i * 3 + 2] << 16) | (c[i * 3 + 1] << 8) | c[i * 3];
    return p;
  }

  background(i: number): IffImage | null {
    if (!this.backgrounds.has(i)) {
      const d = this.entries.get(`BACKS000/SGBR${String(i).padStart(3, '0')}`);
      this.backgrounds.set(i, d && d.length > 100 ? parseIffPbm(d) : null);
    }
    return this.backgrounds.get(i) ?? null;
  }

  /** WAV files of the weapon sounds (FGTSHOOT) and explosion sounds (FGTEXPLO). */
  wave(lib: 'FGTSHOOT' | 'FGTEXPLO', index: number): Uint8Array | null {
    const key = `${lib}:${index}`;
    if (!this.waves.has(key)) {
      const names = [...this.entries.keys()].filter((k) => k.startsWith(`${lib}/`));
      const k = names.find((n) => n.startsWith(`${lib}/${String(index).padStart(2, '0')}`));
      if (k) this.waves.set(key, this.entries.get(k)!);
    }
    return this.waves.get(key) ?? null;
  }
}

// ------------------------------------------------------------------------------------------ rig
export interface Rig {
  turret: ModelPart | null;
  barrel: ModelPart | null;
  /** Vertex index of the muzzle (front-most vertex of the barrel, or of the whole model). */
  muzzle: number;
}

export interface ModelPose {
  /** Turret rotation about the vertical axis through its pivot (radians, same convention as the hull yaw). */
  turretYaw: number;
  /** Barrel elevation in radians, positive raises the muzzle. */
  barrelPitch: number;
  /** Barrel recoil in model units (the front of the models is -z, so recoil moves the barrel to +z). */
  recoil: number;
}

const rigCache = new WeakMap<Model3D, Rig>();

/** Finds turret and barrel among the part records: the barrel is the long thin part near the centre line,
 *  the turret the smallest part that contains it. Other parts (wheels, doors) are not animated. */
export function rigOf(m: Model3D): Rig {
  let rig = rigCache.get(m);
  if (rig) return rig;
  const box = (vs: number[]) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const i of vs) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], m.vertices[i][a]); mx[a] = Math.max(mx[a], m.vertices[i][a]); }
    return { mn, mx };
  };
  const central = m.parts.filter((pt) => Math.abs(pt.pivot[0]) <= 40 && pt.vertices.length > 0);
  const barrels = central.filter((pt) => {
    const b = box(pt.vertices);
    return b.mx[2] - b.mn[2] > 150 && b.mx[2] - b.mn[2] > 2.2 * (b.mx[0] - b.mn[0]) && b.mn[2] < -100;
  }).sort((a, b) => a.vertices.length - b.vertices.length);
  const barrel = barrels[0] ?? null;
  let turret: ModelPart | null = null;
  if (barrel) {
    turret = central.filter((pt) => pt !== barrel && pt.vertices.length > barrel.vertices.length && barrel.vertices.every((i) => pt.vertices.includes(i)))
      .sort((a, b) => a.vertices.length - b.vertices.length)[0] ?? null;
  }
  const front = (vs: number[]) => vs.reduce((best, i) => (m.vertices[i][2] < m.vertices[best][2] ? i : best), vs[0]);
  const muzzle = barrel ? front(barrel.vertices) : front(m.vertices.map((_, i) => i));
  rig = { turret, barrel, muzzle };
  rigCache.set(m, rig);
  return rig;
}

/** Model vertices with the turret/barrel pose applied. */
export function posedVertices(m: Model3D, pose?: ModelPose): [number, number, number][] {
  if (!pose) return m.vertices;
  const rig = rigOf(m);
  const out = m.vertices.map((v) => [...v] as [number, number, number]);
  if (rig.barrel && (pose.barrelPitch || pose.recoil)) {
    const py = rig.barrel.pivot[1], pz = rig.barrel.pivot[2], c = Math.cos(pose.barrelPitch), sn = Math.sin(pose.barrelPitch);
    for (const i of rig.barrel.vertices) {
      const dy = out[i][1] - py, dz = out[i][2] - pz;
      out[i] = [out[i][0], py + dy * c + dz * sn, pz - dy * sn + dz * c + pose.recoil];
    }
  }
  if (rig.turret && pose.turretYaw) {
    const px = rig.turret.pivot[0], pz = rig.turret.pivot[2], c = Math.cos(pose.turretYaw), sn = Math.sin(pose.turretYaw);
    for (const i of rig.turret.vertices) {
      const dx = out[i][0] - px, dz = out[i][2] - pz;
      out[i] = [px + dx * c + dz * sn, out[i][1], pz - dx * sn + dz * c];
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ rasteriser
interface Camera { x: number; y: number; z: number; yaw: number; pitch: number }

/** RGBA texture with a mip chain (box filtered); sampled bilinearly. */
export interface Mip { levels: { w: number; h: number; data: Uint32Array }[] }

const mipCache = new WeakMap<IffImage, WeakMap<Uint32Array, Mip>>();

/** Builds (and caches) the mip chain of an indexed texture for a palette. */
export function mipOf(img: IffImage, pal: Uint32Array): Mip {
  let per = mipCache.get(img);
  if (!per) { per = new WeakMap(); mipCache.set(img, per); }
  let m = per.get(pal);
  if (m) return m;
  const l0 = new Uint32Array(img.width * img.height);
  for (let i = 0; i < l0.length; i++) l0[i] = pal[img.pixels[i]];
  const levels = [{ w: img.width, h: img.height, data: l0 }];
  while (levels[levels.length - 1].w > 4 && levels[levels.length - 1].h > 4) {
    const p = levels[levels.length - 1], w = p.w >> 1, h = p.h >> 1, d = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const c = p.data[(y * 2 + dy) * p.w + x * 2 + dx]; r += c & 255; g += (c >> 8) & 255; b += (c >> 16) & 255; }
      d[y * w + x] = 0xff000000 | ((b >> 2) << 16) | ((g >> 2) << 8) | (r >> 2);
    }
    levels.push({ w, h, data: d });
  }
  m = { levels };
  per.set(pal, m);
  return m;
}

/** Bilinear lookup with wrap-around (u, v in texture fractions). Returns r, g, b packed in out. */
function sampleBilinear(level: { w: number; h: number; data: Uint32Array }, u: number, v: number, wrap: boolean): number {
  const fx = u * level.w - 0.5, fy = v * level.h - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  if (wrap) { x0 = ((x0 % level.w) + level.w) % level.w; x1 = ((x1 % level.w) + level.w) % level.w; y0 = ((y0 % level.h) + level.h) % level.h; y1 = ((y1 % level.h) + level.h) % level.h; }
  else { x0 = Math.min(level.w - 1, Math.max(0, x0)); x1 = Math.min(level.w - 1, Math.max(0, x1)); y0 = Math.min(level.h - 1, Math.max(0, y0)); y1 = Math.min(level.h - 1, Math.max(0, y1)); }
  const a = level.data[y0 * level.w + x0], b = level.data[y0 * level.w + x1], c = level.data[y1 * level.w + x0], d = level.data[y1 * level.w + x1];
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  const r = (a & 255) * w00 + (b & 255) * w10 + (c & 255) * w01 + (d & 255) * w11;
  const g = ((a >> 8) & 255) * w00 + ((b >> 8) & 255) * w10 + ((c >> 8) & 255) * w01 + ((d >> 8) & 255) * w11;
  const bl = ((a >> 16) & 255) * w00 + ((b >> 16) & 255) * w10 + ((c >> 16) & 255) * w01 + ((d >> 16) & 255) * w11;
  return 0xff000000 | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

/** Models and sprites are rasterised at SS times the output resolution and box-filtered down (edge anti-aliasing). */
const SS = 2;

export class Raster {
  readonly w: number;
  readonly h: number;
  /** Final picture (w x h, ABGR little endian); filled by resolve(). */
  readonly color: Uint32Array;
  private hw: number;
  private hh: number;
  private chi: Uint32Array;
  private depth: Float32Array;
  focal: number;
  cam: Camera = { x: 0, y: -1500, z: -9000, yaw: 0, pitch: 0 };

  constructor(w = VIEW_W, h = VIEW_H) {
    this.w = w; this.h = h;
    this.hw = w * SS; this.hh = h * SS;
    this.color = new Uint32Array(w * h);
    this.chi = new Uint32Array(this.hw * this.hh);
    this.depth = new Float32Array(this.hw * this.hh);
    this.focal = w * 0.72;
  }

  clear() { this.chi.fill(0xff000000); this.depth.fill(Infinity); }

  /** Box filter from the supersampled buffer into `color`. */
  resolve() {
    const { w, h, hw, chi, color } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) { const c = chi[(y * SS + dy) * hw + x * SS + dx]; r += c & 255; g += (c >> 8) & 255; b += (c >> 16) & 255; }
      const n = SS * SS;
      color[y * w + x] = 0xff000000 | (((b / n) | 0) << 16) | (((g / n) | 0) << 8) | ((r / n) | 0);
    }
  }

  private setPx(x: number, y: number, c: number) {
    const o = y * SS * this.hw + x * SS;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) this.chi[o + dy * this.hw + dx] = c;
  }

  /** World to camera space. */
  toCam(x: number, y: number, z: number): [number, number, number] {
    const c = this.cam, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
    return [x1, dy * cp - z1 * sp, dy * sp + z1 * cp];
  }

  horizonY(): number { return this.h / 2 - this.focal * Math.tan(this.cam.pitch); }

  /** Sky (stretched top row of the background image), horizon image and textured ground plane with fog.
   *  The ground is sampled bilinearly from a mip chain chosen by distance, which removes the shimmering of far texels. */
  drawEnvironment(bg: IffImage | null, bgPalette: Uint32Array | null, ground: IffImage | null, groundPalette: Uint32Array | null, tile: number, fog: number) {
    const { w, h, focal } = this;
    const hy = Math.round(this.horizonY());
    const skyTop = bg && bgPalette ? bgPalette[bg.pixels[0]] : 0xffb08040;
    const bgH = bg ? bg.height : 0;
    const scroll = Math.round(this.cam.yaw * 300);
    for (let y = 0; y < h && y < hy; y++) {
      const by = y - (hy - bgH);
      for (let x = 0; x < w; x++) {
        if (bg && bgPalette && by >= 0) {
          const bx = (((x + scroll) % bg.width) + bg.width) % bg.width;
          this.setPx(x, y, bgPalette[bg.pixels[by * bg.width + bx]]);
        } else this.setPx(x, y, skyTop);
      }
    }
    const c = this.cam, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const horizonColor = bg && bgPalette ? bgPalette[bg.pixels[(bg.height - 1) * bg.width]] : 0xff808080;
    const hr = horizonColor & 255, hg = (horizonColor >> 8) & 255, hb = (horizonColor >> 16) & 255;
    const mip = ground && groundPalette ? mipOf(ground, groundPalette) : null;
    for (let y = Math.max(0, hy); y < h; y++) {
      const ry = (y + 0.5 - h / 2) / focal;
      for (let x = 0; x < w; x++) {
        const rx = (x + 0.5 - w / 2) / focal;
        const wy = ry * cp + sp, z1 = -ry * sp + cp;
        if (wy <= 1e-4) { this.setPx(x, y, horizonColor); continue; }
        const t = -c.y / wy;
        const wx = rx * cy + z1 * sy, wz = -rx * sy + z1 * cy;
        const gx = c.x + t * wx, gz = c.z + t * wz;
        let px = 0xff507050;
        if (mip) {
          // texels per pixel along the view direction grows with distance; the foreshortening adds a little more
          const footprint = (t / focal) * (mip.levels[0].w / tile) * Math.sqrt(Math.max(1, t / Math.max(1, -c.y)));
          const lod = Math.min(mip.levels.length - 1, Math.max(0, Math.log2(Math.max(1, footprint))));
          const l0 = Math.floor(lod), f = lod - l0;
          const a = sampleBilinear(mip.levels[l0], gx / tile, gz / tile, true);
          if (f > 0.02 && l0 + 1 < mip.levels.length) {
            const b = sampleBilinear(mip.levels[l0 + 1], gx / tile, gz / tile, true);
            const mixc = (sh: number) => ((((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f) | 0);
            px = 0xff000000 | (mixc(16) << 16) | (mixc(8) << 8) | mixc(0);
          } else px = a;
        }
        const f = Math.min(1, t / fog);
        const r = ((px & 255) * (1 - f) + hr * f) | 0, g = (((px >> 8) & 255) * (1 - f) + hg * f) | 0, b = (((px >> 16) & 255) * (1 - f) + hb * f) | 0;
        this.setPx(x, y, 0xff000000 | (b << 16) | (g << 8) | r);
      }
    }
  }

  /** Perspective-correct textured triangle (camera space vertices, near clipped by the caller), mip-mapped and bilinear. */
  private tri(p: number[][], uv: number[][], tex: Mip | null, shade: number) {
    const { hw, hh } = this, fh = this.focal * SS;
    const sx = p.map((q) => hw / 2 + (fh * q[0]) / q[2]), sy = p.map((q) => hh / 2 + (fh * q[1]) / q[2]);
    const iz = p.map((q) => 1 / q[2]);
    const minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), maxX = Math.min(hw - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), maxY = Math.min(hh - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    const d = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2]);
    if (Math.abs(d) < 1e-9) return;
    const inv = 1 / d;
    const uz = uv.map((q, i) => q[0] * iz[i]), vz = uv.map((q, i) => q[1] * iz[i]);
    // mip level from the ratio of texel area to (supersampled) pixel area; output pixels are SS times larger
    let level = 0;
    if (tex) {
      const t0 = tex.levels[0];
      const texArea = Math.abs((uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1])) * t0.w * t0.h;
      level = Math.min(tex.levels.length - 1, Math.max(0, 0.5 * Math.log2(Math.max(1e-6, (texArea * SS * SS) / Math.abs(d))) + 0.2));
    }
    const l0 = tex ? tex.levels[Math.floor(level)] : null;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const l0w = ((sy[1] - sy[2]) * (x + 0.5 - sx[2]) + (sx[2] - sx[1]) * (y + 0.5 - sy[2])) * inv;
        const l1w = ((sy[2] - sy[0]) * (x + 0.5 - sx[2]) + (sx[0] - sx[2]) * (y + 0.5 - sy[2])) * inv;
        const l2w = 1 - l0w - l1w;
        if (l0w < -1e-6 || l1w < -1e-6 || l2w < -1e-6) continue;
        const z = 1 / (l0w * iz[0] + l1w * iz[1] + l2w * iz[2]);
        const o = y * hw + x;
        if (z >= this.depth[o]) continue;
        let px = 0xffb0b0b0;
        if (l0) {
          const u = (l0w * uz[0] + l1w * uz[1] + l2w * uz[2]) * z, v = (l0w * vz[0] + l1w * vz[1] + l2w * vz[2]) * z;
          px = sampleBilinear(l0, u, v, false);
        }
        this.depth[o] = z;
        const r = Math.min(255, (px & 255) * shade), g = Math.min(255, ((px >> 8) & 255) * shade), b = Math.min(255, ((px >> 16) & 255) * shade);
        this.chi[o] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
  }

  /** Draws a model; the front of the models is -z, yaw -PI/2 turns it towards +x. `dark` dims destroyed units. */
  drawModel(m: Model3D, assets: FightAssets, pal: Uint32Array, px: number, py: number, pz: number, yaw: number, dark = 1, pose?: ModelPose) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const world = posedVertices(m, pose).map(([x, y, z]) => [px + x * cy + z * sy, py + y, pz - x * sy + z * cy]);
    const cam = world.map(([x, y, z]) => this.toCam(x, y, z));
    for (const f of m.faces) {
      const idx = f.vertices;
      if (idx.length < 3) continue;
      // two-sided lighting from above/left (y grows downwards)
      const nx = f.normal[0] * cy + f.normal[2] * sy, ny = f.normal[1], nz = -f.normal[0] * sy + f.normal[2] * cy;
      const lit = Math.abs(nx * -0.35 + ny * -0.85 + nz * -0.4);
      const shade = (0.5 + 0.5 * Math.min(1, lit)) * dark;
      const img = f.texture >= 0 && f.texture < 20 ? assets.texture(f.texture) : null;
      const tex = img ? mipOf(img, pal) : null;
      for (let k = 1; k + 1 < idx.length; k++) this.clipTri([cam[idx[0]], cam[idx[k]], cam[idx[k + 1]]], [f.uv[0], f.uv[k], f.uv[k + 1]], tex, shade);
    }
  }

  private clipTri(p: number[][], uv: number[][], tex: Mip | null, shade: number) {
    const near = 50;
    const n = p.filter((q) => q[2] > near).length;
    if (n === 0) return;
    if (n === 3) { this.tri(p, uv, tex, shade); return; }
    // clip the polygon against z = near (Sutherland-Hodgman), then fan it
    const poly: { p: number[]; uv: number[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const a = { p: p[i], uv: uv[i] }, b = { p: p[(i + 1) % 3], uv: uv[(i + 1) % 3] };
      const ia = a.p[2] > near, ib = b.p[2] > near;
      if (ia) poly.push(a);
      if (ia !== ib) {
        const t = (near - a.p[2]) / (b.p[2] - a.p[2]);
        poly.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, near], uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t] });
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) this.tri([poly[0].p, poly[k].p, poly[k + 1].p], [poly[0].uv, poly[k].uv, poly[k + 1].uv], tex, shade);
  }

  /** Additive camera-facing sprite (explosions, tracer): black pixels add nothing; bilinear and supersampled. */
  drawSprite(img: IffImage, pal: Uint32Array, x: number, y: number, z: number, size: number, alpha = 1) {
    const [cx, cy, cz] = this.toCam(x, y, z);
    if (cz < 100) return;
    const fh = this.focal * SS;
    const s = (size * fh) / cz, sx = this.hw / 2 + (fh * cx) / cz, sy = this.hh / 2 + (fh * cy) / cz;
    const x0 = Math.max(0, Math.floor(sx - s / 2)), x1 = Math.min(this.hw - 1, Math.ceil(sx + s / 2));
    const y0 = Math.max(0, Math.floor(sy - s / 2)), y1 = Math.min(this.hh - 1, Math.ceil(sy + s / 2));
    const level = mipOf(img, pal).levels[0];
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const o = yy * this.hw + xx;
      if (cz > this.depth[o]) continue;
      const u = (xx + 0.5 - (sx - s / 2)) / s, v = (yy + 0.5 - (sy - s / 2)) / s;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      const q = sampleBilinear(level, u, v, false);
      const d = this.chi[o];
      const r = Math.min(255, (d & 255) + (q & 255) * alpha), g = Math.min(255, ((d >> 8) & 255) + ((q >> 8) & 255) * alpha), b = Math.min(255, ((d >> 16) & 255) + ((q >> 16) & 255) * alpha);
      this.chi[o] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }
}

// ------------------------------------------------------------------------------------------ scene
export interface FightSide3D {
  /** Unit class index = model number. */
  type: number;
  count: number;
  losses: number;
  /** Chroma scheme of the player (PAL3D colour variant). */
  scheme: number;
  weaponName: string;
}

export interface FightInput3D {
  attacker: FightSide3D;
  defender: FightSide3D;
  defenderFiresBack: boolean;
  /** true: the attacker stands on the left of the picture. */
  attackerLeft: boolean;
  weather: number;
  /** Ground and horizon kind derived from the terrain of the defender's field. */
  environment: 'grass' | 'water' | 'snow' | 'rock' | 'road' | 'forest';
}

export interface SoundCue { t: number; lib: 'FGTSHOOT' | 'FGTEXPLO'; index: number }

const GROUND: Record<FightInput3D['environment'], { texture: number; background: number }> = {
  grass: { texture: 49, background: 0 },
  forest: { texture: 50, background: 0 },
  water: { texture: 45, background: 3 },
  snow: { texture: 57, background: 1 },
  rock: { texture: 54, background: 4 },
  road: { texture: 52, background: 0 },
};

/** FGTSHOOT sample index by weapon name (the file names MG / KAN / ARI / ROC / BOMB / TORP). */
export function shotSample(weapon: string): number {
  const w = weapon.toLowerCase();
  if (/mg|maschinen|gewehr/.test(w)) return 4;
  if (/rak|missile|rocket/.test(w)) return 16;
  if (/bomb/.test(w)) return 26;
  if (/torp/.test(w)) return 32;
  if (/art|haubitz|granat|mörser/.test(w)) return 12;
  return 8;
}

interface DisplayUnit { x: number; z: number; destroyedAt: number; yaw: number; type: number }

export class FightScene {
  readonly duration: number;
  readonly sounds: SoundCue[] = [];
  private assets: FightAssets;
  private input: FightInput3D;
  private left: DisplayUnit[] = [];
  private right: DisplayUnit[] = [];
  private shots: { from: DisplayUnit; to: DisplayUnit; fireAt: number; hitAt: number; fromSide: 'left' | 'right'; kills: boolean; elevation: number }[] = [];
  private static readonly FLIGHT = 520;

  constructor(assets: FightAssets, input: FightInput3D) {
    this.assets = assets; this.input = input;
    const att = input.attacker, def = input.defender;
    const layout = (count: number, dir: number, type: number): DisplayUnit[] => {
      const n = Math.min(10, Math.max(1, count));
      return Array.from({ length: n }, (_, i) => ({ x: dir * (3200 + Math.floor(i / 5) * 1300), z: ((i % 5) - 2) * 1500 + (Math.floor(i / 5) ? 600 : 0), destroyedAt: Infinity, yaw: dir < 0 ? -Math.PI / 2 : Math.PI / 2, type }));
    };
    const L = layout(input.attackerLeft ? att.count : def.count, -1, input.attackerLeft ? att.type : def.type), R = layout(input.attackerLeft ? def.count : att.count, 1, input.attackerLeft ? def.type : att.type);
    this.left = L; this.right = R;
    const attacker = input.attackerLeft ? L : R, defender = input.attackerLeft ? R : L;
    const shown = (side: FightSide3D, units: DisplayUnit[]) => (side.losses <= 0 ? 0 : Math.max(1, Math.min(units.length, Math.round((side.losses / Math.max(1, side.count)) * units.length))));
    const volley = (from: DisplayUnit[], to: DisplayUnit[], side: 'left' | 'right', lossCount: number, start: number, weapon: string) => {
      const kills = to.slice(to.length - lossCount);
      let t = start;
      from.forEach((u, i) => {
        const target = to[(i * 7 + 3) % to.length];
        const fireAt = t + i * 110, hitAt = fireAt + FightScene.FLIGHT;
        this.shots.push({ from: u, to: target, fireAt, hitAt, fromSide: side, kills: kills.includes(target), elevation: shotSample(weapon) === 12 ? 0.5 : 0.04 });
        this.sounds.push({ t: fireAt, lib: 'FGTSHOOT', index: shotSample(weapon) }, { t: hitAt, lib: 'FGTEXPLO', index: (i * 3) % 9 });
      });
      // units that are lost fall at the first hit on them, otherwise at the end of the volley
      const end = start + from.length * 110 + FightScene.FLIGHT;
      for (const k of kills) {
        const hit = this.shots.find((s) => s.to === k && s.hitAt >= start);
        k.destroyedAt = hit ? hit.hitAt : end - 200;
      }
      return end + 900;
    };
    const attUnits = attacker, defUnits = defender;
    let t = 1600;
    t = volley(attUnits, defUnits, input.attackerLeft ? 'left' : 'right', shown(def, defUnits), t, att.weaponName);
    if (input.defenderFiresBack && att.losses >= 0) {
      const survivors = defUnits.filter((u) => u.destroyedAt === Infinity);
      if (survivors.length) t = volley(survivors, attUnits, input.attackerLeft ? 'right' : 'left', shown(att, attUnits), t, def.weaponName);
    }
    this.duration = t + 700;
  }

  /** Camera for time t: establishing shot, then a closer view of the side that is currently shooting. */
  private camera(t: number, r: Raster) {
    // portrait pictures (phone, full screen) are narrow: the camera stays further back so both groups remain in view
    const back = r.h > r.w ? 1400 : 0;
    const wide = { x: 0, y: -2100, z: -10200 - back, yaw: 0, pitch: 0.12 };
    const push = Math.min(1, t / 1600);
    r.cam = { ...wide, z: wide.z + 900 * push };
    const active = this.shots.find((s) => t >= s.fireAt - 120 && t <= s.hitAt + 700);
    if (t > 1600 && active) {
      // side view from the middle ground, close to the target group
      const toX = active.to.x;
      const k = Math.min(1, (t - (active.fireAt - 120)) / 400);
      r.cam = { x: toX * 0.25 * k + wide.x * (1 - k), y: -1500 - 300 * (1 - k), z: -7200 + 1500 * (1 - k) - 800 * k - back * 0.8, yaw: wide.yaw, pitch: 0.1 };
    }
  }

  /** Turret/barrel pose of a unit at time t: it turns to its target before the shot, recoils after it and turns back. */
  private poseOf(u: DisplayUnit, t: number): ModelPose | undefined {
    const shot = this.shots.find((s) => s.from === u && t >= s.fireAt - 650 && t <= s.hitAt + 900);
    if (!shot) return undefined;
    const aim = Math.atan2(shot.to.x - u.x, shot.to.z - u.z) - (u.yaw + Math.PI);
    const norm = Math.atan2(Math.sin(aim), Math.cos(aim));
    const up = Math.min(1, Math.max(0, (t - (shot.fireAt - 650)) / 500)), down = Math.min(1, Math.max(0, (t - (shot.hitAt + 100)) / 700));
    const k = up * (1 - down);
    const since = t - shot.fireAt;
    return { turretYaw: norm * k, barrelPitch: shot.elevation * k, recoil: since >= 0 && since < 500 ? 70 * Math.exp(-since / 90) : 0 };
  }

  /** World position of the muzzle of a unit with the given pose. */
  private muzzleOf(u: DisplayUnit, pose: ModelPose | undefined): [number, number, number] {
    const model = this.assets.unitModel(u.type);
    if (!model) return [u.x, -190, u.z];
    const v = posedVertices(model, pose)[rigOf(model).muzzle];
    const c = Math.cos(u.yaw), sn = Math.sin(u.yaw);
    return [u.x + v[0] * c + v[2] * sn, v[1], u.z - v[0] * sn + v[2] * c];
  }

  render(t: number, r: Raster) {
    const inp = this.input;
    const env = GROUND[inp.environment];
    const base = inp.weather * 16;
    r.clear();
    this.camera(t, r);
    const bg = this.assets.background(env.background);
    const ground = this.assets.texture(env.texture);
    r.drawEnvironment(bg, bg ? this.assets.texturePalette(bg) : null, ground, ground ? this.assets.texturePalette(ground) : null, 6000, 60000);
    const sideUnits: [DisplayUnit[], FightSide3D, number][] = inp.attackerLeft
      ? [[this.left, inp.attacker, 0], [this.right, inp.defender, 0]]
      : [[this.left, inp.defender, 0], [this.right, inp.attacker, 0]];
    const sprites: { x: number; y: number; z: number; size: number; frame: number; alpha: number }[] = [];
    // painter order is not needed (z buffer), but the sprites go last
    for (const [units, side] of sideUnits) {
      const model = this.assets.unitModel(side.type);
      const pal = this.assets.palette(base + Math.min(15, side.scheme));
      if (!model) continue;
      for (const u of units) {
        const gone = t - u.destroyedAt;
        if (gone > 1800) continue;
        r.drawModel(model, this.assets, pal, u.x, 0, u.z, u.yaw, gone > 0 ? 0.35 : 1, gone > 0 ? undefined : this.poseOf(u, t));
        if (gone > 0 && gone < 1800) sprites.push({ x: u.x, y: -300 - gone * 0.15, z: u.z, size: 700, frame: 2 + Math.floor(gone / 120) % 4, alpha: 0.5 });
      }
    }
    for (const s of this.shots) {
      const tx = s.to.x;
      const mz = this.muzzleOf(s.from, this.poseOf(s.from, s.fireAt));
      if (t >= s.fireAt && t < s.fireAt + 140) sprites.push({ x: mz[0], y: mz[1], z: mz[2], size: 600, frame: 0, alpha: 1 });
      if (t >= s.fireAt && t < s.hitAt) {
        const k = (t - s.fireAt) / FightScene_FLIGHT;
        sprites.push({ x: mz[0] + (tx - mz[0]) * k, y: mz[1] + (-170 - mz[1]) * k - Math.sin(k * Math.PI) * 120 * (s.elevation > 0.2 ? 3 : 1), z: mz[2] + (s.to.z - mz[2]) * k, size: 260, frame: 1, alpha: 1 });
      }
      if (t >= s.hitAt && t < s.hitAt + 720) {
        const frame = Math.min(7, Math.floor((t - s.hitAt) / 90));
        sprites.push({ x: s.to.x, y: -220, z: s.to.z, size: s.kills ? 1500 : 800, frame: 2 + Math.min(5, frame), alpha: 1 });
      }
    }
    for (const sp of sprites) {
      const img = this.assets.texture(64 + sp.frame);
      if (img) r.drawSprite(img, this.assets.texturePalette(img), sp.x, sp.y, sp.z, sp.size, sp.alpha);
    }
    r.resolve();
  }
}
const FightScene_FLIGHT = 520;

/** Ground / horizon kind from the terrain type mask of a field. */
export function environmentFor(typeMask: number): FightInput3D['environment'] {
  if (typeMask & ((1 << 16) | (1 << 17) | (1 << 18))) return 'water';
  if (typeMask & (1 << 10)) return 'forest';
  if (typeMask & ((1 << 6) | (1 << 7) | (1 << 8))) return 'rock';
  if (typeMask & ((1 << 0) | (1 << 1) | (1 << 3))) return 'road';
  return 'grass';
}
