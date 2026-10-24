// Window shown while computer players move (SDI_1C.EXE w_computer.c: CO_InitComputermove FUN_004662fa, CO_ComputerMove
// FUN_00466808, rows FUN_004634a0, progress bar FUN_00463a2a). The map is not animated meanwhile: the original shows
// only this statistics window and a progress bar. Bitmap LIB/CSTA000 CS00_00 (640×258), close button CS01_00.
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { el, label, button, DESKTOP_W, DESKTOP_H } from './desktop.ts';
import type { GameState } from '../engine/state.ts';
import type { PlayerChroma } from '../render/chroma.ts';
import { rgb } from '../render/mapview.ts';

const W = 640, H = 258;
/** Right edges of the number columns are x + 4 digits × 12 (lost, destroyed, acted, units, produced, buildings). */
const COLUMNS = [0xaf, 0xfa, 0x147, 0x19e, 0x1e0, 0x22d];

export interface ComputerWindowDeps {
  layer: HTMLElement;
  assets: Assets;
  fonts: { small: BitmapFont; medium: BitmapFont; large: BitmapFont };
  chroma: PlayerChroma[];
  playerNames: string[];
  /** Human player whose allies see the unit counts (FUN_004662fa: the last human player before the active one). */
  viewer: number;
  mobile: boolean;
  onQuit(): void;
}

export class ComputerWindow {
  readonly el: HTMLDivElement;
  private dyn: HTMLDivElement;
  private deps: ComputerWindowDeps;
  private progress = { cur: 0, total: 0 };

  constructor(deps: ComputerWindowDeps) {
    this.deps = deps;
    // centred and moved up by 35 pixels (template 0x4dfa48 with x = y = -1, DSA_MoveScreen(0, -35))
    this.el = el('div', 'gwin computerwin', deps.layer, {
      left: `${(DESKTOP_W - W) / 2}px`, top: `${Math.round((DESKTOP_H - H) / 2) - 35}px`, width: `${W}px`, height: `${H}px`,
      backgroundImage: `url(${deps.assets.url('CSTA000', 'CS00_00')})`,
    });
    this.el.style.zIndex = '4900';
    if (deps.mobile) {
      // phones: the same window, scaled to the screen width
      this.el.style.position = 'fixed';
      this.el.style.left = '50%';
      this.el.style.top = '12%';
      this.el.style.transformOrigin = 'top center';
      this.el.style.transform = `translateX(-50%) scale(${Math.min(1, (window.innerWidth - 16) / W)})`;
    }
    this.dyn = el('div', 'dyn', this.el, { left: '0', top: '0', width: `${W}px`, height: `${H}px` });
    button(this.el, deps.assets, 'CSTA000', 'CS01_00', 609, 229, () => deps.onQuit(), 'Beenden').dataset.cmd = 'Beenden';
  }

  /** FUN_004662d8: progress of the computer move (phases 7-9: unit n of the list). */
  setProgress(cur: number, total: number) { this.progress = { cur, total }; }

  /** Redraws rows, round number and progress bar (after every step of the computer, FUN_00466808). */
  update(s: GameState, active: number) {
    const { fonts, chroma, assets, playerNames } = this.deps;
    const pal = assets.palette;
    this.dyn.replaceChildren();
    const alive = s.players.filter((p) => p.alive).map((p) => p.index);
    alive.forEach((p, row) => {
      const y = row * 23 + 0x25;
      const pl = s.players[p];
      const name = playerNames[p] || `Spieler ${p + 1}`;
      label(this.dyn, fonts.small.render(name, rgb(pal, chroma[Math.min(p, 6)]?.color ?? 0)), 0x12, y + 6);
      // unit counts are only shown for the viewer and parties allied with him
      const known = p === this.deps.viewer || (pl.allies & (1 << this.deps.viewer)) !== 0 || (s.players[this.deps.viewer]?.allies & (1 << p)) !== 0;
      const units = s.units.filter((u) => u.alive && u.owner === p);
      const acted = p === active ? units.filter((u) => u.flags & (1 | 4 | 16 | 256)).length : 0;
      const values: (number | string)[] = [pl.lost, pl.killed, known ? acted : '???', known ? units.length : '???', pl.produced, pl.shopsTaken ?? 0];
      const color = rgb(pal, p === active ? 0x6f : 100);
      values.forEach((v, i) => {
        const t = String(v);
        label(this.dyn, fonts.medium.render(t, color), COLUMNS[i] + (4 - t.length) * 12, y + 6);
      });
    });
    const round = String(s.turn + 1);
    label(this.dyn, fonts.large.render(round, rgb(pal, 8)), 0x3f + (3 - round.length) * 16, 0xda);
    if (this.progress.total > 0) {
      const bar = el('div', 'computer-progress', this.dyn, {
        left: '225px', top: '215px', height: '22px',
        width: `${Math.round((Math.min(this.progress.cur, this.progress.total) * 200) / this.progress.total)}px`,
      });
      bar.style.position = 'absolute';
      bar.style.background = rgb(pal, chroma[Math.min(active, 6)]?.color ?? 0);
    }
  }

  close() { this.el.remove(); }
}
