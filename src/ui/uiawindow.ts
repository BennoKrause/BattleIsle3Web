// UIA window ("Unit-Info-Animation", manual p. 47ff): the unit information window with the rotating animation
// of the unit (LIB: UIA/UIAnnn.LIB, 101 frames of 160x100), name lines, two map symbols, number of units,
// experience, six values with icons, up to three properties and the weapon table.
// Layout read from the original bitmaps UI/UI00_00 (small, 336x322) and UI001/UG00_00 (large, 336x449, the
// animation is shown at double size = "vierfache Größe"); the coordinates below are measured on those bitmaps.
// Not verified against the original: exact text colours, the animation speed (12 frames/s here) and the content
// of the wide weapon field (strength and name here).
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import type { FileSource } from '../data/source.ts';
import type { UnitClassInfo } from '../data/gamedata.ts';
import type { MapRenderer } from '../render/mapview.ts';
import type { PlayerChroma } from '../render/chroma.ts';
import { parseLib } from '../formats/lib.ts';
import { decodeTpwm } from '../formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap } from '../formats/bitmap.ts';
import { UCF } from '../engine/classes.ts';
import { el, DESKTOP_W } from './desktop.ts';
import { GameWindow } from './window.ts';

export interface UiaTarget {
  type: number;
  owner: number;
  group: number;
  experience: number;
  /** Own name given by the player. */
  name: string;
  ammo: number[];
  fuel: number;
  /** Own or allied units show ammunition and fuel. */
  own: boolean;
}

export interface UiaContext {
  assets: Assets;
  fonts: { small: BitmapFont; medium: BitmapFont; large: BitmapFont };
  desktop: HTMLElement;
  renderer: MapRenderer;
  src: FileSource;
  chroma: PlayerChroma[];
  playerNames: string[];
  classes: UnitClassInfo[];
}

interface Layout {
  bitmap: [string, string];
  size: [number, number];
  caps: [number, number][];
  lines: [number, number];
  count: { icon: [number, number]; field: [number, number, number, number]; xp: [number, number] };
  anim: { x: number; y: number; scale: number };
  props: { x: number; y: number; dy: number };
  /** value fields: [armor, range, sight, energy, material, fuel] -> [x, y] (fields are 53x22) */
  values: Record<'armor' | 'range' | 'sight' | 'energy' | 'material' | 'fuel', [number, number]>;
  fuelBar: [number, number];
  weapons: [number, number];
  expand: [number, number, number, number];
  close: [number, number, number, number];
}

const SMALL: Layout = {
  bitmap: ['UI000', 'UI00_00'], size: [336, 322],
  caps: [[16, 29], [207, 29]], lines: [43, 24],
  count: { icon: [10, 72], field: [8, 105, 29, 22], xp: [10, 136] },
  anim: { x: 43, y: 68, scale: 1 },
  props: { x: 212, y: 69, dy: 34 },
  values: { armor: [277, 24], range: [277, 56], sight: [277, 88], energy: [277, 142], material: [277, 174], fuel: [277, 230] },
  fuelBar: [277, 255], weapons: [6, 178], expand: [314, 3, 20, 18], close: [305, 294, 29, 28],
};

const LARGE: Layout = {
  bitmap: ['UI001', 'UG00_00'], size: [336, 449],
  caps: [[114, 29], [305, 29]], lines: [141, 24],
  count: { icon: [18, 29], field: [46, 30, 29, 22], xp: [83, 31] },
  anim: { x: 9, y: 66, scale: 2 },
  props: { x: 12, y: 70, dy: 30 },
  values: { fuel: [270, 280], armor: [270, 312], range: [270, 344], sight: [270, 376], energy: [47, 417], material: [135, 417] },
  fuelBar: [270, 304], weapons: [6, 271], expand: [314, 3, 20, 18], close: [305, 421, 29, 26],
};

const FRAME_COUNT = 101;
const FPS = 12;

/** Decoded animations per unit class (the 64 files are 600 KB each, only a few are kept). */
export class AnimationCache {
  private cache = new Map<number, Promise<HTMLCanvasElement[] | null>>();
  private src: FileSource;
  private assets: Assets;
  constructor(src: FileSource, assets: Assets) { this.src = src; this.assets = assets; }

  get(type: number): Promise<HTMLCanvasElement[] | null> {
    let p = this.cache.get(type);
    if (!p) {
      p = this.load(type).catch(() => null);
      this.cache.set(type, p);
      if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  private async load(type: number): Promise<HTMLCanvasElement[]> {
    const lib = parseLib(await this.src.read(`UIA/UIA${String(type).padStart(3, '0')}.LIB`));
    const pal = this.assets.palette;
    return lib.filter((e) => e.name.startsWith('PIC')).slice(0, FRAME_COUNT).map((e) => {
      const d = decodeTpwm(e.data);
      const b = isInfoBitmap(d) ? parseInfoBitmap(d) : null;
      const c = document.createElement('canvas');
      c.width = b?.width ?? 160; c.height = b?.height ?? 100;
      if (!b) return c;
      const ctx = c.getContext('2d')!, img = ctx.createImageData(c.width, c.height);
      b.pixels.forEach((v, i) => {
        if (v === b.transparent) return;
        img.data[i * 4] = pal[v * 3]; img.data[i * 4 + 1] = pal[v * 3 + 1]; img.data[i * 4 + 2] = pal[v * 3 + 2]; img.data[i * 4 + 3] = 255;
      });
      ctx.putImageData(img, 0, 0);
      return c;
    });
  }
}

/** Properties in the order of the manual (flag, road, trench, height, move-attack-move, move only, repair) with their UW000 icon. */
export function unitProperties(c: UnitClassInfo): string[] {
  const out: string[] = [];
  if (c.flags & UCF.OCCUPY) out.push('UW01_50');
  if (c.flags & UCF.BUILD) out.push('UW01_51');
  if (c.flags & UCF.FORTIFY) out.push('UW01_52');
  if (c.flags & (UCF.CLIMB | UCF.DIVE)) out.push('UW01_55');
  if (c.flags & UCF.RETREAT) out.push('UW01_54');
  if (c.flags & UCF.COOLDOWN) out.push('UW01_53');
  if (c.flags & (UCF.REPAIR | UCF.REFUEL | UCF.REFUEL_AIR)) out.push('UW01_56');
  return out.slice(0, 3);
}

/** Weapon target bits (WT) in the order of the six slots of the weapon row template. */
const TARGET_SLOTS: [number, string][] = [[1, 'WB01_01'], [2, 'WB01_02'], [4, 'WB01_03'], [8, 'WB01_04'], [16, 'WB01_05'], [32, 'WB01_06']];

export class UiaWindow {
  private win: GameWindow;
  private dyn: HTMLElement;
  private animCanvas: HTMLCanvasElement | null = null;
  private frames: HTMLCanvasElement[] | null = null;
  private target: UiaTarget | null = null;
  private layout: Layout = SMALL;
  private timer = 0;
  private startedAt = performance.now();
  private closed = false;
  private animations: AnimationCache;
  /** Alternates between owner and own name in the third line. */
  private nameTimer = 0;
  private showOwner = true;

  private ctx: UiaContext;
  private onClose: () => void;

  constructor(ctx: UiaContext, onClose: () => void, large = false) {
    this.ctx = ctx;
    this.onClose = onClose;
    this.animations = new AnimationCache(ctx.src, ctx.assets);
    this.layout = large ? LARGE : SMALL;
    const [w, h] = this.layout.size;
    this.win = new GameWindow(ctx.desktop, { x: DESKTOP_W - w - 14, y: 40, w, h, cls: 'uia-window' });
    this.win.el.dataset.window = 'uia';
    this.dyn = el('div', 'uia-dyn', this.win.el, { left: '0', top: '0', width: `${w}px`, height: `${h}px` });
    this.applyLayout();
    this.timer = window.setInterval(() => this.tick(), 1000 / FPS);
    this.nameTimer = window.setInterval(() => { this.showOwner = !this.showOwner; if (this.target) this.drawLines(); }, 2500);
  }

  get large() { return this.layout === LARGE; }
  get element() { return this.win.el; }

  private applyLayout() {
    const L = this.layout;
    this.win.el.style.width = `${L.size[0]}px`;
    this.win.el.style.height = `${L.size[1]}px`;
    this.win.el.style.backgroundImage = `url(${this.ctx.assets.url(L.bitmap[0], L.bitmap[1])})`;
    this.dyn.style.width = `${L.size[0]}px`;
    this.dyn.style.height = `${L.size[1]}px`;
    this.render();
  }

  setLarge(large: boolean) {
    this.layout = large ? LARGE : SMALL;
    this.applyLayout();
  }

  setTarget(t: UiaTarget | null) {
    const changedType = !this.target || !t || this.target.type !== t.type;
    this.target = t;
    if (changedType) {
      this.frames = null;
      if (t) void this.animations.get(t.type).then((f) => { if (this.target?.type === t.type) this.frames = f; });
    }
    this.render();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.timer);
    window.clearInterval(this.nameTimer);
    this.win.close();
    this.onClose();
  }

  // ------------------------------------------------------------------ drawing
  private put(canvas: HTMLCanvasElement, x: number, y: number) {
    canvas.classList.add('sprite');
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    this.dyn.append(canvas);
    return canvas;
  }

  private copy(lib: string, name: string): HTMLCanvasElement {
    const c = this.ctx.assets.canvas(lib, name);
    const k = document.createElement('canvas');
    k.width = c.width; k.height = c.height;
    k.getContext('2d')!.drawImage(c, 0, 0);
    return k;
  }

  private text(font: BitmapFont, s: string, base: number, x: number, y: number, maxW?: number) {
    let t = s;
    while (maxW !== undefined && t.length > 1 && font.measure(t) > maxW) t = t.slice(0, -1);
    return this.put(font.renderPalette(t, this.ctx.assets.palette, base), x, y);
  }

  /** Number centred in a field (large font when it fits, else medium or small). */
  private number(v: number | string, x: number, y: number, w: number, h: number) {
    const s = String(v);
    const f = [this.ctx.fonts.large, this.ctx.fonts.medium, this.ctx.fonts.small].find((ft) => ft.measure(s) <= w - 2) ?? this.ctx.fonts.small;
    const c = f.renderPalette(s, this.ctx.assets.palette, 0xd0);
    this.put(c, x + Math.round((w - c.width) / 2), y + Math.round((h - c.height) / 2));
  }

  private render() {
    this.dyn.replaceChildren();
    this.animCanvas = null;
    const t = this.target, L = this.layout;
    this.hit(L.expand, this.large ? 'Verkleinern' : 'Vergrößern', () => this.setLarge(!this.large));
    this.hit(L.close, 'Schließen', () => this.close());
    if (!t) return;
    const c = this.ctx.classes[t.type];
    this.drawLines();
    // two map symbols (both orientations of the sprite) in the caps next to the text lines
    L.caps.forEach(([x, y], i) => {
      const cv = document.createElement('canvas');
      cv.width = 24; cv.height = 24;
      const cx = cv.getContext('2d')!;
      cx.imageSmoothingEnabled = false;
      this.ctx.renderer.drawUnitIcon(cx, t.type, this.ctx.chroma[Math.min(t.owner, 6)]?.scheme ?? 12, 0, 0, 24, i === 0 ? 1 : 4);
      this.put(cv, x, y);
    });
    this.number(t.group, ...L.count.field);
    this.put(this.copy('UW000', `UW01_${10 + Math.max(0, Math.min(11, t.experience))}`), ...L.count.xp);
    unitProperties(c).forEach((name, i) => this.put(this.copy('UW000', name), L.props.x, L.props.y + i * L.props.dy));
    const fuelFields = Math.trunc((t.own ? t.fuel : c.fuel) / Math.max(1, c.fuelUsage));
    const v = L.values;
    this.number(c.armor, v.armor[0], v.armor[1], 53, 22);
    this.number(c.moveRange >> 3, v.range[0], v.range[1], 53, 22);
    this.number(Math.trunc(c.sight / 8), v.sight[0], v.sight[1], 53, 22);
    this.number(c.costEnergy, v.energy[0], v.energy[1], 53, 22);
    this.number(c.costMaterial, v.material[0], v.material[1], 53, 22);
    this.number(fuelFields, v.fuel[0], v.fuel[1], 53, 22);
    // fuel bar: green, yellow below 50 %, red below 25 % (manual p. 50)
    const pct = c.fuel > 0 ? Math.max(0, Math.min(1, (t.own ? t.fuel : c.fuel) / c.fuel)) : 0;
    const bar = el('div', 'uia-fuel', this.dyn, { left: `${L.fuelBar[0]}px`, top: `${L.fuelBar[1]}px`, width: `${Math.round(53 * pct)}px`, height: '4px' });
    bar.style.background = pct < 0.25 ? '#c83020' : pct < 0.5 ? '#d8c020' : '#58c040';
    this.drawWeapons(t, c);
    this.drawAnimationFrame();
  }

  /** Three text lines: class name, description, owner / own name alternately. */
  private drawLines() {
    const t = this.target;
    if (!t) return;
    this.dyn.querySelectorAll('.uia-line').forEach((n) => n.remove());
    const c = this.ctx.classes[t.type], [x, y] = this.layout.lines;
    const own = t.name || this.ctx.playerNames[t.owner] || '';
    const owner = this.ctx.playerNames[t.owner] || '';
    const third = t.name && !this.showOwner ? t.name : owner || own;
    [c.name, c.description, third].forEach((s, i) => this.text(this.ctx.fonts.small, s, 0xeb, x + 2, y + 1 + i * 12, 156).classList.add('uia-line'));
  }

  private drawWeapons(t: UiaTarget, c: UnitClassInfo) {
    const [x0, y0] = this.layout.weapons;
    let row = 0;
    c.weapons.forEach((w, i) => {
      if (row >= 4 || (w.damage <= 0 && w.ammo <= 0) || c.weaponNames[i] === '-' || !c.weaponNames[i]) return;
      const y = y0 + row * 34;
      this.put(this.copy('WB000', 'WB01_00'), x0, y);
      const fs = this.ctx.fonts.small, pal = this.ctx.assets.palette;
      const ammo = String(t.own ? t.ammo[i] ?? 0 : w.ammo);
      const a = fs.renderPalette(ammo, pal, 0xeb);
      this.put(a, x0 + 2 + Math.round((36 - a.width) / 2), y + 3);
      const icon = c.weaponIcons[i] < 100 ? `WB01_${10 + c.weaponIcons[i]}` : '';
      if (icon) { try { this.put(this.copy('WB000', icon), x0 + 38, y + 2); } catch { /* picture missing */ } }
      this.text(fs, `${w.damage} ${c.weaponNames[i]}`, 0xeb, x0 + 84, y + 4, 138);
      for (const [bit, name] of TARGET_SLOTS) {
        if (w.targets & bit) this.put(this.copy('WB000', name), x0 + 66 + TARGET_SLOTS.findIndex((s) => s[0] === bit) * 19, y + 15);
      }
      const range = w.minRange === w.maxRange ? String(w.maxRange) : `${w.minRange}-${w.maxRange}`;
      const r = fs.renderPalette(range, pal, 0xeb);
      this.put(r, x0 + 187 + Math.round((36 - r.width) / 2), y + 20);
      row++;
    });
  }

  /** Invisible click area. */
  private hit(r: [number, number, number, number], title: string, fn: () => void) {
    const h = el('div', 'uia-hit', this.dyn, { left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2]}px`, height: `${r[3]}px` });
    h.title = title;
    h.dataset.cmd = `UIA ${title}`;
    h.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  }

  // ------------------------------------------------------------------ animation
  private tick() {
    if (this.closed) return;
    this.drawAnimationFrame();
  }

  private drawAnimationFrame() {
    const f = this.frames;
    if (!f || !f.length) return;
    const L = this.layout, s = L.anim.scale;
    if (!this.animCanvas) {
      const cv = document.createElement('canvas');
      cv.width = 160 * s; cv.height = 100 * s;
      cv.className = 'uia-anim';
      this.animCanvas = this.put(cv, L.anim.x, L.anim.y);
      this.dyn.prepend(cv); // behind the icons that are drawn over the large animation
    }
    const idx = Math.floor(((performance.now() - this.startedAt) / 1000) * FPS) % f.length;
    const ctx = this.animCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f[idx], 0, 0, 160 * s, 100 * s);
  }
}
