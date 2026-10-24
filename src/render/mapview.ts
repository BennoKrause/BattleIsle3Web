// Map window renderer: terrain, overlays, buildings, units, fog of war and selection markers.
// Hex layout: field (x, y) at (16x, 24y + 12(x&1)) in 24-pixel units; zoom levels 24/36/48
// ("kleine/mittlere/große Hexfelder", TEXT000.TXT).
import { buildRoadSet, connectionMask, roadLayers, ROAD_KIND } from './roads.ts';
import type { GameData } from '../data/gamedata.ts';
import type { GameState } from '../engine/state.ts';
import { NEUTRAL, Layer, UnitFlag } from '../engine/state.ts';
import { unitVisibleTo } from '../engine/vision.ts';
import { World } from '../engine/world.ts';
import { remapForScheme, type PlayerChroma } from './chroma.ts';
import { SpriteSheet, TILE } from './sprites.ts';

export interface MapHighlights {
  /** Fields the selected unit can move to (others are tinted red). */
  move?: Set<number>;
  /** Fields with attackable targets. */
  attack?: Set<number>;
  /** Target fields of supply, repair or construction (others are darkened). */
  action?: Set<number>;
  selected?: number;
  cursor?: number;
  /** Unit drawn at an intermediate position during a move animation. */
  moving?: { unitId: number; px: number; py: number; dir: number };
  /** Units not to draw (e.g. the one being animated). */
  hidden?: Set<number>;
}

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainSheet: SpriteSheet;
  private unitRaw: Uint8Array[];
  private unitSheets = new Map<number, SpriteSheet>();
  private palette: Uint8Array;
  private hexMask: HTMLCanvasElement;
  private tint = new Map<string, HTMLCanvasElement>();
  zoom = 2;
  scrollX = 0;
  scrollY = 0;
  private data: GameData;

  constructor(data: GameData, palette: Uint8Array, terrainSprites: Uint8Array[], unitSprites: Uint8Array[]) {
    this.data = data;
    this.palette = palette;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.terrainSheet = new SpriteSheet(terrainSprites, palette, 0);
    this.unitRaw = unitSprites;
    // hex shape from a full ground tile
    this.hexMask = document.createElement('canvas');
    this.hexMask.width = this.hexMask.height = TILE;
    const mctx = this.hexMask.getContext('2d')!;
    const img = mctx.createImageData(TILE, TILE);
    const tile = terrainSprites[9] ?? terrainSprites[0];
    for (let i = 0; i < TILE * TILE; i++) if (tile[i] !== 0) { img.data[i * 4 + 3] = 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; }
    mctx.putImageData(img, 0, 0);
  }

  private roadSheets: SpriteSheet[] = [];
  /** LIB/LAYR000..006 pieces (see roads.ts); without them roads are drawn with the generic sprite. */
  setRoadSprites(libs: Uint8Array[][]) {
    this.roadSheets = libs.map((l) => new SpriteSheet(buildRoadSet(l), this.palette, 0));
  }

  get tileSize() { return TILE * this.zoom; }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  mapPixelSize(s: GameState) {
    return { w: (s.width * 16 + 8) * this.zoom, h: (s.height * 24 + 12) * this.zoom };
  }

  clampScroll(s: GameState) {
    const m = this.mapPixelSize(s);
    this.scrollX = Math.max(0, Math.min(this.scrollX, m.w - this.canvas.width));
    this.scrollY = Math.max(0, Math.min(this.scrollY, m.h - this.canvas.height));
  }

  centerOn(s: GameState, x: number, y: number) {
    const p = this.fieldPixel(x, y);
    this.scrollX = p.x + this.tileSize / 2 - this.canvas.width / 2;
    this.scrollY = p.y + this.tileSize / 2 - this.canvas.height / 2;
    this.clampScroll(s);
  }

  fieldPixel(x: number, y: number) {
    return { x: x * 16 * this.zoom, y: (y * 24 + (x & 1) * 12) * this.zoom };
  }

  /** Field index under a canvas pixel, or -1. */
  fieldAt(s: GameState, cx: number, cy: number): number {
    const mx = (cx + this.scrollX) / this.zoom, my = (cy + this.scrollY) / this.zoom;
    const col = Math.floor(mx / 16);
    const mctx = this.hexMask.getContext('2d')!;
    for (const x of [col, col - 1]) {
      if (x < 0 || x >= s.width) continue;
      const lx = Math.floor(mx - x * 16);
      const y = Math.floor((my - (x & 1) * 12) / 24);
      for (const yy of [y, y - 1, y + 1]) {
        if (yy < 0 || yy >= s.height) continue;
        const ly = Math.floor(my - (yy * 24 + (x & 1) * 12));
        if (lx < 0 || ly < 0 || lx >= TILE || ly >= TILE) continue;
        if (mctx.getImageData(lx, ly, 1, 1).data[3] > 0) return yy * s.width + x;
      }
    }
    return -1;
  }

  private unitSheet(scheme: number): SpriteSheet {
    let sh = this.unitSheets.get(scheme);
    if (!sh) {
      sh = new SpriteSheet(this.unitRaw, this.palette, 143, remapForScheme(scheme));
      this.unitSheets.set(scheme, sh);
    }
    return sh;
  }

  private hexTint(color: string): HTMLCanvasElement {
    let c = this.tint.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = TILE;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(this.hexMask, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, TILE, TILE);
      this.tint.set(color, c);
    }
    return c;
  }

  /** Sprite index and mirroring for a unit direction (two base sprites per type, BI2020 LoadSpritesFromLib). */
  static unitSprite(type: number, dir: number) {
    const odd = dir === 0 || dir === 3 ? 0 : 1;
    return { index: type * 2 + odd, flipX: dir === 4 || dir === 5, flipY: dir === 2 || dir === 3 || dir === 4 };
  }

  drawUnitIcon(ctx: CanvasRenderingContext2D, type: number, scheme: number, x: number, y: number, size: number, dir = 1) {
    const sp = MapRenderer.unitSprite(type, dir);
    this.unitSheet(scheme).draw(ctx, sp.index, x, y, size, sp.flipX, sp.flipY);
  }

  render(s: GameState, viewer: number, chroma: PlayerChroma[], hl: MapHighlights, time: number) {
    const ctx = this.ctx;
    const w = new World(this.data, s);
    const size = this.tileSize;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#3c4040'; // unexplored area (grey veil, manual p. 13)
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const x0 = Math.max(0, Math.floor(this.scrollX / (16 * this.zoom)) - 1);
    const x1 = Math.min(s.width - 1, Math.ceil((this.scrollX + this.canvas.width) / (16 * this.zoom)) + 1);
    const y0 = Math.max(0, Math.floor(this.scrollY / (24 * this.zoom)) - 1);
    const y1 = Math.min(s.height - 1, Math.ceil((this.scrollY + this.canvas.height) / (24 * this.zoom)) + 1);
    const bit = 1 << viewer;
    const animStep = Math.floor(time / 250);
    const terrainSprite = (t: number) => {
      const d = this.data.terrain[t];
      return d && d.animationLength > 0 ? d.animationStart + (animStep % d.animationLength) : t;
    };
    // pass 1: ground and overlays
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const i = y * s.width + x;
      const p = this.fieldPixel(x, y);
      const px = p.x - this.scrollX, py = p.y - this.scrollY;
      if (!(s.explored[i] & bit)) continue;
      this.terrainSheet.draw(ctx, terrainSprite(s.terrain[i]), px, py, size);
      const ov = s.overlay[i];
      if (ov >= 0) {
        // snow (weather 3/4): roads and paths use the snow-covered pieces of LAYR005/006 (FUN_0043a15f)
        const snow = s.weather === 3 || s.weather === 4;
        const kinds = this.roadSheets.length ? roadLayers(ov).map((k) => snow && k === ROAD_KIND.road ? ROAD_KIND.snowRoad : snow && k === ROAD_KIND.path ? ROAD_KIND.snowPath : k) : [];
        if (kinds.length) {
          const nb = w.neighbours(x, y);
          for (const kind of kinds) {
            const mask = connectionMask(kind, nb, (nx, ny) => s.overlay[ny * s.width + nx], (nx, ny) => s.shopAt[ny * s.width + nx] >= 0);
            this.roadSheets[kind]?.draw(ctx, mask, px, py, size);
          }
        } else this.terrainSheet.draw(ctx, terrainSprite(ov), px, py, size);
      }
    }
    // pass 2: building owner markers, units, fog
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const i = y * s.width + x;
      if (!(s.explored[i] & bit)) continue;
      const p = this.fieldPixel(x, y);
      const px = p.x - this.scrollX, py = p.y - this.scrollY;
      const shopId = s.shopAt[i];
      if (shopId >= 0) {
        const shop = s.shops[shopId];
        const col = chroma[Math.min(shop.owner, 6)]?.color ?? 0;
        ctx.fillStyle = rgb(this.palette, col);
        const d = Math.max(3, size / 6);
        ctx.fillRect(px + size / 2 - d / 2, py + size / 2 - d / 2, d, d);
      }
      const uid = s.unitAt[i];
      if (uid >= 0 && !hl.hidden?.has(uid) && unitVisibleTo(w, viewer, uid)) {
        const u = s.units[uid];
        const scheme = chroma[Math.min(u.owner, 6)]?.scheme ?? 12;
        if (u.layer === Layer.SUBMERGED) ctx.globalAlpha = 0.55;
        this.drawUnitIcon(ctx, u.type, scheme, px, py, size, u.dir);
        ctx.globalAlpha = 1;
        if (u.owner === viewer && (u.flags & UnitFlag.DONE)) ctx.drawImage(this.hexTint('rgba(255,255,255,0.35)'), px, py, size, size);
        if (u.layer === Layer.HIGH_AIR) ctx.drawImage(this.hexTint('rgba(160,220,255,0.25)'), px, py, size, size);
      }
      if (!(s.vision[i] & bit)) ctx.drawImage(this.hexTint('rgba(0,0,0,0.35)'), px, py, size, size);
      if (hl.move && i !== hl.selected && !hl.move.has(i)) ctx.drawImage(this.hexTint('rgba(200,30,20,0.45)'), px, py, size, size);
      if (hl.attack) ctx.drawImage(this.hexTint(hl.attack.has(i) ? 'rgba(230,20,20,0.55)' : 'rgba(40,60,110,0.45)'), px, py, size, size);
      // fields without a possible action turn red, the others keep their look (manual p. 61)
      if (hl.action && !hl.action.has(i)) ctx.drawImage(this.hexTint('rgba(200,30,20,0.45)'), px, py, size, size);
    }
    if (hl.moving) {
      const u = s.units[hl.moving.unitId];
      const scheme = chroma[Math.min(u.owner, 6)]?.scheme ?? 12;
      this.drawUnitIcon(ctx, u.type, scheme, hl.moving.px * this.zoom - this.scrollX, hl.moving.py * this.zoom - this.scrollY, size, hl.moving.dir);
    }
    for (const [f, color] of [[hl.selected, '#ffff60'], [hl.cursor, '#ffffff']] as const) {
      if (f === undefined || f < 0) continue;
      const p = this.fieldPixel(f % s.width, Math.floor(f / s.width));
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, this.zoom);
      hexPath(ctx, p.x - this.scrollX, p.y - this.scrollY, size);
      ctx.stroke();
    }
    void NEUTRAL;
  }

  /** Overview map (one pixel block per field in owner / terrain colours). */
  renderOverview(target: HTMLCanvasElement, s: GameState, viewer: number, chroma: PlayerChroma[]) {
    const ctx = target.getContext('2d')!;
    const sx = target.width / s.width, sy = target.height / s.height;
    const w = new World(this.data, s);
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const i = y * s.width + x;
      let col = '#303030';
      if (s.explored[i] & (1 << viewer)) {
        const m = w.groundMask(x, y);
        col = m & 0x70000 ? '#20508a' : m & (1 << 10) ? '#2d5a20' : m & (1 << 7) ? '#7a6a50' : '#5c7a3a';
        const uid = s.unitAt[i];
        if (s.shopAt[i] >= 0) col = rgb(this.palette, chroma[Math.min(s.shops[s.shopAt[i]].owner, 6)]?.color ?? 0);
        if (uid >= 0 && unitVisibleTo(w, viewer, uid)) col = rgb(this.palette, chroma[Math.min(s.units[uid].owner, 6)]?.color ?? 0);
      }
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy + (x & 1) * sy / 2), Math.ceil(sx), Math.ceil(sy));
    }
  }
}

export function rgb(pal: Uint8Array, i: number) {
  return `rgb(${pal[i * 3]},${pal[i * 3 + 1]},${pal[i * 3 + 2]})`;
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const q = size / 3;
  ctx.beginPath();
  ctx.moveTo(x + q, y + 1);
  ctx.lineTo(x + 2 * q, y + 1);
  ctx.lineTo(x + size - 1, y + size / 2);
  ctx.lineTo(x + 2 * q, y + size - 1);
  ctx.lineTo(x + q, y + size - 1);
  ctx.lineTo(x + 1, y + size / 2);
  ctx.closePath();
}
