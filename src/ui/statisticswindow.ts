// Statistics window (SDI_1C.EXE w_statistik.c, manual p. 52-55): 272x200 window with six tabs on the bitmaps of
// LIB/SK000 (SK00_00..05 backgrounds, SK01_00 close, SK01_01..06 tabs, SK01_11 alliance smiley, SK01_14/15 scroll,
// SK01_16..21 yellow row buttons). Positions and rules from STAT_Init / STAT_ActivateTAB / STAT_Handler:
//   0 unit count per player and round (curves), 1 own units destroyed since the end of the last own turn,
//   2 energy production per round (curves), 3 map data (name, password, round), 4 alliance table, 5 Top 5 units.
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { el, label, button } from './desktop.ts';
import type { GameState } from '../engine/state.ts';
import type { UnitClassInfo } from '../data/gamedata.ts';
import type { PlayerChroma } from '../render/chroma.ts';
import { rgb } from '../render/mapview.ts';

export const STAT_W = 272, STAT_H = 200;
const UCF_NOT_COMBAT = 0x20000000;

export interface StatisticsDeps {
  assets: Assets;
  fonts: { small: BitmapFont; medium: BitmapFont; large: BitmapFont };
  chroma: PlayerChroma[];
  classes: UnitClassInfo[];
  missionName: string;
  /** Level code of the map (shown when it has 7 digits) or 0. */
  password: number;
  /** Centres the map on a field (yellow buttons). */
  centerOn(field: number): void;
  onClose(): void;
}

export class StatisticsWindow {
  readonly el: HTMLDivElement;
  private dyn: HTMLDivElement;
  private tab = 0;
  private scroll = 0;
  private viewer = 0;
  private d: StatisticsDeps;

  constructor(parent: HTMLElement, d: StatisticsDeps) {
    this.d = d;
    this.el = el('div', 'gwin statwin', parent, { width: `${STAT_W}px`, height: `${STAT_H}px` });
    this.dyn = el('div', 'dyn', this.el, { left: '0', top: '0', width: `${STAT_W}px`, height: `${STAT_H}px` });
  }

  /** Redraws the window for the state and the viewing player (STAT_ActivateTAB). */
  update(s: GameState, viewer: number, tab = this.tab) {
    if (tab !== this.tab) this.scroll = 0;
    this.tab = tab; this.viewer = viewer;
    const { assets } = this.d;
    this.el.style.backgroundImage = `url(${assets.url('SK000', `SK00_0${tab}`)})`;
    this.dyn.replaceChildren();
    // close button and the other five tabs (the active tab is part of the background)
    button(this.dyn, assets, 'SK000', 'SK01_00', 241, 171, () => this.d.onClose(), 'Schließen').dataset.cmd = 'Statistik schließen';
    const titles = ['Anzahl der Einheiten', 'Vernichtete eigene Einheiten', 'Energiehaushalt', 'Kartendaten', 'Allianzen', 'Top 5'];
    for (let k = 0; k < 6; k++) {
      if (k === tab) continue;
      button(this.dyn, assets, 'SK000', `SK01_0${k + 1}`, 10 + k * 43, 24, () => this.update(s, viewer, k), titles[k]).dataset.cmd = titles[k];
    }
    const st = s.statistics;
    if (tab === 0 || tab === 2) this.drawCurves(s, tab === 0 ? st?.units : st?.energy);
    else if (tab === 1) this.drawDestroyed(s);
    else if (tab === 3) this.drawMapData(s);
    else if (tab === 4) this.drawAlliances(s);
    else this.drawTop5(s);
  }

  private colour(p: number) { return rgb(this.d.assets.palette, this.d.chroma[Math.min(p, 6)]?.color ?? 0); }

  private alivePlayers(s: GameState) { return s.players.filter((p) => p.alive && p.index < 6).map((p) => p.index); }

  /** STAT_DrawTimeStatistic: scale 100 / maximum, y = 162 - value * scale, two pixels per round from x = 37. */
  private drawCurves(s: GameState, data: number[][] | undefined) {
    if (!data) return;
    const players = this.alivePlayers(s);
    let max = 0;
    for (const p of players) for (const v of data[p] ?? []) max = Math.max(max, v);
    const scale = max ? 100 / max : 1;
    const cv = el('canvas', '', this.dyn, { left: '0', top: '0' });
    cv.width = STAT_W; cv.height = STAT_H;
    cv.style.position = 'absolute';
    const ctx = cv.getContext('2d')!;
    const vline = (x: number, y: number, h: number) => ctx.fillRect(x, y, 1, Math.max(1, h));
    for (const p of players) {
      ctx.fillStyle = this.colour(p);
      let prev = 0;
      (data[p] ?? []).forEach((v, i) => {
        const y = Math.trunc(100 - v * scale + 62);
        if (i > 0) {
          const half = Math.trunc((y - prev) / 2);
          if (half < -1 || half > 1) {
            if (half < 1) { vline(i * 2 + 37, prev + half, -half); vline(i * 2 + 38, y, prev + half - y + 1); }
            else { vline(i * 2 + 37, prev, half + 1); vline(i * 2 + 38, prev + half, y - (prev + half)); }
          } else { ctx.fillRect(i * 2 + 37, prev, 1, 1); ctx.fillRect(i * 2 + 38, y, 1, 1); }
        }
        prev = y;
      });
    }
  }

  private rank(xp: number, x: number, y: number) {
    try {
      const c = this.d.assets.canvas('UW000', `UW01_${10 + Math.max(0, Math.min(11, xp))}`);
      const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0);
      label(this.dyn, cc, x, y).dataset.rank = String(xp);
    } catch { /* without the library no symbol */ }
  }

  /** STAT_DrawDestroyedUnits: six rows of 18 pixels from y = 64 (name or type), yellow buttons at x = 34. */
  private drawDestroyed(s: GameState) {
    const list = s.statistics?.destroyed[this.viewer] ?? [];
    const { assets, fonts, classes } = this.d;
    if (this.scroll > 0) button(this.dyn, assets, 'SK000', 'SK01_14', 223, 61, () => { this.scroll--; this.update(s, this.viewer, 1); }, 'nach oben');
    if (this.scroll + 6 < list.length) button(this.dyn, assets, 'SK000', 'SK01_15', 223, 151, () => { this.scroll++; this.update(s, this.viewer, 1); }, 'nach unten');
    const rows = list.slice(this.scroll, this.scroll + 6);
    rows.forEach((d, k) => {
      const text = d.name || classes[d.type]?.name || '';
      const c = fonts.small.render(text, this.colour(this.viewer));
      label(this.dyn, clip(c, 0x90), 0x36, k * 18 + 0x40);
      button(this.dyn, assets, 'SK000', `SK01_${16 + k}`, 34, 65 + k * 18, () => {
        this.d.centerOn(d.field);
        this.rank(d.experience, 0xde, 100);
      }, text).dataset.row = String(k);
    });
  }

  /** STAT_WriteMapData: mission name centred at y = 71, the 7-digit password at (94, 96), the round at y = 166. */
  private drawMapData(s: GameState) {
    const { fonts } = this.d;
    const name = this.d.missionName.slice(0, 24);
    label(this.dyn, fonts.small.render(name, '#c4e89c'), ((24 - name.length) >> 1) * 9 + 0x1d, 0x47);
    const pw = String(this.d.password || '');
    if (pw.length === 7) label(this.dyn, fonts.medium.render(pw, '#c4e89c'), 0x5e, 0x60);
    const round = String(s.turn + 1);
    label(this.dyn, fonts.large.render(round, '#f0e060'), ((7 - round.length) & ~1) * 8 + 0x53, 0xa6);
  }

  /** STAT_WriteAlliances: player colour squares at the edges, smiley SK01_11 where the column player allies the row. */
  private drawAlliances(s: GameState) {
    const players = this.alivePlayers(s);
    const box = (x: number, y: number, c: string) => el('div', 'stat-box', this.dyn, { left: `${x}px`, top: `${y}px`, width: '12px', height: '12px', background: c });
    players.forEach((p, k) => { box(k * 14 + 0x5c, 0x44, this.colour(p)); box(0x47, k * 14 + 0x58, this.colour(p)); });
    const smiley = this.d.assets.canvas('SK000', 'SK01_11');
    players.forEach((row, r) => players.forEach((col, c) => {
      if (s.players[col].allies & (1 << row)) {
        const cc = document.createElement('canvas'); cc.width = smiley.width; cc.height = smiley.height; cc.getContext('2d')!.drawImage(smiley, 0, 0);
        label(this.dyn, cc, c * 14 + 0x5c, r * 14 + 0x58).dataset.ally = `${row}-${col}`;
      }
    }));
  }

  /**
   * STAT_WriteTop5Data: the five most experienced units of all players (not slot 6, not class flag 0x20000000, not the
   * unit destroyed last); with more candidates the dearer units (energy + material) come first within a rank.
   */
  private drawTop5(s: GameState) {
    const { assets, fonts, classes } = this.d;
    const last = s.statistics?.lastDestroyed ?? -1;
    const ok = s.units.filter((u) => u.alive && u.owner < 6 && !((classes[u.type]?.flags ?? 0) & UCF_NOT_COMBAT) && u.id !== last);
    const cands: typeof ok = [];
    for (let xp = 11; xp >= 0 && cands.length < 5; xp--) cands.push(...ok.filter((u) => u.experience === xp));
    let top = cands.slice(0, 5);
    if (cands.length >= 6) {
      top = [];
      const cost = (t: number) => (classes[t]?.costEnergy ?? 0) + (classes[t]?.costMaterial ?? 0);
      for (let xp = 11; xp >= 0 && top.length < 5; xp--) {
        const level = cands.filter((u) => u.experience === xp).sort((a, b) => cost(b.type) - cost(a.type));
        for (const u of level) if (top.length < 5) top.push(u);
      }
    }
    top.forEach((u, k) => {
      const text = u.name || classes[u.type]?.name || '';
      label(this.dyn, clip(fonts.small.render(text, this.colour(u.owner)), 0xd8), 0x36, k * 19 + 0x62);
      button(this.dyn, assets, 'SK000', `SK01_${16 + k}`, 20, 99 + k * 19, () => {
        const f = u.y * s.width + u.x;
        // only units the viewer can see are shown on the map (STAT_Handler)
        if (s.vision[f] & (1 << this.viewer)) this.d.centerOn(f);
        this.rank(u.experience, 0x7c, 0x3e);
      }, text).dataset.row = String(k);
    });
    if (top.length) this.rank(top[0].experience, 0x7c, 0x3e);
  }
}

function clip(c: HTMLCanvasElement, w: number): HTMLCanvasElement {
  if (c.width <= w) return c;
  const o = document.createElement('canvas');
  o.width = w; o.height = c.height;
  o.getContext('2d')!.drawImage(c, 0, 0);
  return o;
}
