// In-game screen: map window, overview, short info, manager bar, chip window, weapon choice,
// building window; drives human input, move animation, computer turns and mission events.
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { Desktop, el, label, button, DESKTOP_W, DESKTOP_H } from './desktop.ts';
import { GameWindow } from './window.ts';
import { MapRenderer, rgb } from '../render/mapview.ts';
import type { PlayerChroma } from '../render/chroma.ts';
import type { CommandResult, Game } from '../engine/game.ts';
import { ComputerPlayer } from '../engine/ai.ts';
import type { GameEvent, UnitState } from '../engine/state.ts';
import type { CombatResult } from '../engine/combat.ts';
import { showFightPanel, type FightSide } from './fightpanel.ts';
import { showFightWindow } from './fightwindow.ts';
import { UiaWindow, type UiaTarget } from './uiawindow.ts';
import { MobileUi, type CardAction } from './mobile/mobileui.ts';
import { installTouchMap } from './mobile/touch.ts';
import { COLORS, fitScale, setText } from './mobile/pixel.ts';
import type { FileSource } from '../data/source.ts';
import { environmentFor, type FightAssets } from '../render/fight3d.ts';
import type { FxPlayer } from '../audio/fx.ts';
import { NEUTRAL, UnitFlag } from '../engine/state.ts';
import { World } from '../engine/world.ts';
import { UCF } from '../engine/classes.ts';
import { Build } from '../engine/support.ts';

export interface ScreenHooks {
  /** Plays the video of a sequence id (resolves when done). */
  playSequence(seq: number): Promise<void>;
  showText(title: string, text: string): Promise<void>;
  openDiskMenu(): void;
  openSetup(): void;
  openVideoRecorder(): void;
  showBriefing(): Promise<void>;
  /** Called after each human/computer turn change and on game end. */
  onOutcome(): void;
  onAutosave(): void;
  quit(): void;
}

export interface ScreenContext {
  assets: Assets;
  fonts: { small: BitmapFont; medium: BitmapFont; large: BitmapFont };
  desktop: Desktop;
  renderer: MapRenderer;
  chroma: PlayerChroma[];
  playerNames: string[];
  shopNames: Map<number, string>;
  missionName: string;
  src: FileSource;
  /** 3D fight (optional: without it only the statistics window is shown). */
  fight?: { enabled(): boolean; load(): Promise<FightAssets>; fx: FxPlayer };
}

type Mode = { kind: 'none' } | { kind: 'move'; unitId: number; area: Set<number> } | { kind: 'attack'; unitId: number; targets: Map<number, number> }
  | { kind: 'support'; unitId: number; action: 'refill' | 'repair'; targets: Set<number> }
  | { kind: 'build'; unitId: number; what: number; fields: Set<number> };

/** Construction commands of the build window: chip icon, title (manual p. 62: Straßenbau, Schienenbau, Befestigung, Abriß). */
const BUILD_CHIPS: [number, string, string][] = [[Build.ROAD, 'C01_20', 'Straße bauen'], [Build.RAIL, 'C01_21', 'Schiene bauen'], [Build.TRENCH, 'C01_22', 'Befestigung bauen'], [Build.DEMOLISH, 'C01_23', 'Abreißen']];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GameScreen {
  readonly game: Game;
  private ctx: ScreenContext;
  private hooks: ScreenHooks;
  private mapWin!: GameWindow;
  private overviewWin!: GameWindow;
  private overview!: HTMLCanvasElement;
  private infoWin!: HTMLDivElement;
  private infoLayer!: HTMLDivElement;
  private manager!: HTMLDivElement;
  /** Phone interface (null on the desktop). */
  private mobile: MobileUi | null = null;
  private chip: HTMLDivElement | null = null;
  private uia: UiaWindow | null = null;
  /** Open weapon selection window (a double click fires click, click and dblclick: only one window may exist). */
  private weaponWin: { win: HTMLElement; cancel: () => void } | null = null;
  private popup: HTMLDivElement | null = null;
  private mode: Mode = { kind: 'none' };
  private cursor = -1;
  private selected = -1;
  private busy = false;
  private animating: { unitId: number; px: number; py: number; dir: number } | null = null;
  private hidden = new Set<number>();
  private eventCursor = 0;
  private raf = 0;
  private dirty = true;
  /** Player whose view is shown (the human player; in hot-seat the active human). */
  viewer = 0;
  aiDelay = 120;
  destroyed = false;

  constructor(game: Game, ctx: ScreenContext, hooks: ScreenHooks) {
    this.game = game;
    this.ctx = ctx;
    this.hooks = hooks;
    const { desktop } = ctx;
    desktop.clear();
    this.eventCursor = game.state.eventSeq;
    if (desktop.mobile) this.buildMobile();
    else this.buildDesktop();
    window.addEventListener('keydown', this.onKey);
    // initial view: centre on the human player's HQ or first unit
    this.viewer = game.isHumanTurn() ? game.state.activePlayer : this.firstHuman();
    this.centerOnPlayer();
    this.loop();
  }

  private buildDesktop() {
    const { game, hooks } = this;
    const { desktop, assets } = this.ctx;
    // map window
    this.mapWin = new GameWindow(desktop.layer, { x: 0, y: 0, w: DESKTOP_W, h: 514, framed: true, assets, cls: 'map-window' });
    const r = this.ctx.renderer;
    r.resize(DESKTOP_W - 32, 514 - 32);
    r.canvas.className = 'map-canvas';
    this.mapWin.body.append(r.canvas);
    this.mapWin.el.style.zIndex = '1';
    this.mapWin.toFront = () => undefined; // the map stays behind the other windows
    this.installMapInput();
    // overview
    this.overviewWin = new GameWindow(desktop.layer, { x: DESKTOP_W - 230, y: 20, w: 210, h: 170, framed: true, assets, cls: 'overview-window' });
    this.overview = el('canvas', 'overview-canvas', this.overviewWin.body);
    this.overview.width = 178; this.overview.height = 138;
    this.overview.addEventListener('mousedown', (e) => {
      const s = game.state;
      const fx = Math.floor((e.offsetX / this.overview.clientWidth) * s.width);
      const fy = Math.floor((e.offsetY / this.overview.clientHeight) * s.height);
      r.centerOn(s, fx, fy);
      this.dirty = true;
    });
    // short info
    this.infoWin = el('div', 'gwin shortinfo', desktop.layer, { left: '0px', top: `${DESKTOP_H - 86}px`, width: '400px', height: '86px', backgroundImage: `url(${assets.url('SI000', 'SI00_00')})` });
    this.infoLayer = el('div', 'info-layer', this.infoWin);
    // manager bar
    this.manager = el('div', 'gwin manager', desktop.layer, { left: `${DESKTOP_W - 436}px`, top: `${DESKTOP_H - 48}px`, width: '436px', height: '48px', backgroundImage: `url(${assets.url('MNGR000', 'MNGR0000')})` });
    this.manager.style.zIndex = '4000';
    const slots = [10, 57, 92, 127, 175, 209, 244, 278, 313, 361, 395];
    const mb = (slot: number, name: string, title: string, fn: () => void) => button(this.manager, assets, 'MNGR000', name, slots[slot], 2, fn, title).dataset.cmd = title;
    mb(0, 'MNGR0002', 'Spielerwechsel', () => this.requestEndTurn());
    mb(1, 'MNGR0003', 'Setup', () => hooks.openSetup());
    mb(2, 'MNGR0004', 'Disk-Menü', () => hooks.openDiskMenu());
    mb(3, 'MNGR0001', 'Beenden', () => hooks.quit());
    mb(4, 'MNGR0008', 'Kartenfenster', () => { this.mapWin.visible = !this.mapWin.visible; });
    mb(5, 'MNGR0010', 'Übersichtsfenster', () => { this.overviewWin.visible = !this.overviewWin.visible; this.dirty = true; });
    mb(6, 'MNGR0012', 'UIA-Fenster', () => this.toggleUia());
    mb(7, 'MNGR0014', 'Kurzinfofenster', () => { this.infoWin.style.display = this.infoWin.style.display === 'none' ? '' : 'none'; });
    mb(8, 'MNGR0016', 'Statistikfenster', () => this.showStatistics());
    mb(9, 'MNGR0005', 'Videorecorder', () => hooks.openVideoRecorder());
    mb(10, 'MNGR0006', 'Mission Briefing', () => void hooks.showBriefing());
  }

  // ------------------------------------------------------------------ phone interface
  private buildMobile() {
    const { hooks } = this;
    const ctx = this.ctx;
    const mobile = new MobileUi({
      layer: ctx.desktop.layer, assets: ctx.assets, fonts: ctx.fonts, renderer: ctx.renderer, src: ctx.src, classes: this.game.data.unitClasses,
      chroma: ctx.chroma, missionName: ctx.missionName,
      commands: {
        endTurn: () => void this.requestEndTurn(),
        menu: () => void this.openMobileMenu(),
        setup: () => hooks.openSetup(),
        stats: () => this.showStatistics(),
        centre: () => this.centerOnPlayer(),
      },
    });
    this.mobile = mobile;
    const r = ctx.renderer;
    r.canvas.className = 'map-canvas m-map-canvas';
    mobile.mapHost.prepend(r.canvas);
    const resize = () => {
      const { w, h } = mobile.mapSize();
      if (w !== r.canvas.width || h !== r.canvas.height) { r.resize(w, h); r.clampScroll(this.game.state); this.dirty = true; }
    };
    new ResizeObserver(resize).observe(mobile.mapHost);
    resize();
    r.zoom = Math.min(r.zoom, 2);
    installTouchMap(r.canvas, {
      getZoom: () => r.zoom,
      setZoom: (z, ax, ay) => this.setZoom(z, ax, ay),
      pan: (dx, dy) => { r.scrollX -= dx; r.scrollY -= dy; r.clampScroll(this.game.state); },
      tap: (cx, cy) => {
        const rect = r.canvas.getBoundingClientRect(), k = rect.width / r.canvas.width;
        const f = r.fieldAt(this.game.state, (cx - rect.left) / k, (cy - rect.top) / k);
        if (f >= 0) void this.onFieldClick(f, false);
      },
    });
    mobile.onZoom((d) => this.setZoom(r.zoom + d, r.canvas.width / 2, r.canvas.height / 2));
    mobile.onOverview = () => this.openMobileOverview();
    mobile.onInfoRequest = () => this.showUnitInfo();
  }

  private async openMobileMenu() {
    const m = this.mobile!, h = this.hooks;
    const entries: [string, () => void][] = [
      ['Disk-Menü (Speichern / Laden)', () => h.openDiskMenu()],
      ['Setup', () => h.openSetup()],
      ['Mission Briefing', () => void h.showBriefing()],
      ['Videorecorder', () => h.openVideoRecorder()],
      ['Spiel beenden', () => h.quit()],
    ];
    const { body, close } = m.sheet('Menü', 'm-menu-sheet');
    const scale = fitScale(entries.map((e) => e[0]), Math.min(window.innerWidth, 480) - 140, { scale: 1.6 });
    for (const [text, run] of entries) {
      const b = el('button', 'm-item', body);
      el('span', 'm-item-mark', b).style.backgroundImage = `url(${this.ctx.assets.buttonState('SETUP000', 'SU01_04', 1).toDataURL()})`;
      setText(el('span', 'm-item-text', b), text, { color: COLORS.text, scale });
      b.dataset.item = text;
      b.addEventListener('click', () => { close(); run(); });
    }
  }

  private openMobileOverview() {
    const s = this.game.state, r = this.ctx.renderer;
    this.mobile!.openOverview(
      (c) => r.renderOverview(c, s, this.viewer, this.ctx.chroma),
      (fx, fy) => { r.centerOn(s, Math.floor(fx * s.width), Math.floor(fy * s.height)); this.dirty = true; },
      { w: 178, h: 138 },
    );
  }

  /** Card of the tapped unit or building (not selectable for own commands). */
  private mobileInspect(f: number) {
    const g = this.game, s = g.state, m = this.mobile!;
    const uid = s.unitAt[f], shopId = s.shopAt[f];
    const actions: CardAction[] = [];
    if (uid >= 0 && g.visibleTo(this.viewer, uid)) {
      const u = s.units[uid], c = g.data.unitClasses[u.type];
      actions.push({ id: 'info', label: 'Info', run: () => this.showUnitInfo(uid) });
      m.showCard({ title: c.name, subtitle: `${c.description} · ${this.ctx.playerNames[u.owner] || ''}`, unit: { type: u.type, scheme: this.ctx.chroma[Math.min(u.owner, 6)]?.scheme ?? 12 }, stats: [`Stärke ${u.group}/${c.strength}`, `Erfahrung ${u.experience + 1}`], actions });
    } else if (shopId >= 0 && (s.explored[f] & (1 << this.viewer))) {
      const shop = s.shops[shopId];
      m.showCard({ title: this.ctx.shopNames.get(shop.nameIndex) ?? 'Gebäude', subtitle: this.ctx.playerNames[shop.owner] ?? '', stats: [], actions });
    } else m.hideCard();
  }

  private firstHuman() {
    const p = this.game.state.players.find((pl) => pl.alive && !pl.computer);
    return p ? p.index : 0;
  }

  centerOnPlayer() {
    const s = this.game.state;
    const hq = s.shops.find((sh) => sh.owner === this.viewer && (sh.type & 1));
    const u = this.game.unitsOf(this.viewer).find((x) => !x.container);
    const t = hq ?? u;
    if (t) this.ctx.renderer.centerOn(s, t.x, t.y);
    this.dirty = true;
  }

  destroy() {
    this.destroyed = true;
    this.uia?.close();
    this.weaponWin?.cancel();
    this.mobile?.destroy();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
  }

  // ------------------------------------------------------------------ rendering
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const s = this.game.state;
    const hl = {
      move: this.mode.kind === 'move' ? this.mode.area : undefined,
      attack: this.mode.kind === 'attack' ? new Set([...this.mode.targets.keys()].map((id) => this.game.w.idx(s.units[id].x, s.units[id].y))) : undefined,
      action: this.mode.kind === 'support' ? new Set([...this.mode.targets].map((id) => this.game.w.idx(s.units[id].x, s.units[id].y)))
        : this.mode.kind === 'build' ? this.mode.fields : undefined,
      selected: this.selected >= 0 && s.units[this.selected]?.alive ? this.game.w.idx(s.units[this.selected].x, s.units[this.selected].y) : undefined,
      cursor: this.cursor,
      moving: this.animating ?? undefined,
      hidden: this.hidden,
    };
    this.ctx.renderer.render(s, this.viewer, this.ctx.chroma, hl, now);
    if (this.dirty) {
      this.dirty = false;
      if (!this.mobile) this.ctx.renderer.renderOverview(this.overview, s, this.viewer, this.ctx.chroma);
      this.updateInfo();
    }
  };

  refresh() { this.dirty = true; }

  /** Browser coordinates of a field centre (scrolls the field into view first); used by E2E tests. */
  fieldToClient(f: number): { x: number; y: number } {
    const s = this.game.state, r = this.ctx.renderer;
    const fx = f % s.width, fy = Math.floor(f / s.width);
    const p = r.fieldPixel(fx, fy);
    if (p.x - r.scrollX < 0 || p.y - r.scrollY < 0 || p.x - r.scrollX > r.canvas.width - r.tileSize || p.y - r.scrollY > r.canvas.height - r.tileSize) r.centerOn(s, fx, fy);
    const rect = r.canvas.getBoundingClientRect();
    const scale = rect.width / r.canvas.width;
    return { x: rect.left + (p.x - r.scrollX + r.tileSize / 2) * scale, y: rect.top + (p.y - r.scrollY + r.tileSize / 2) * scale };
  }

  get isBusy() { return this.busy; }

  // ------------------------------------------------------------------ input
  private installMapInput() {
    const c = this.ctx.renderer.canvas;
    let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        drag = { x: e.clientX, y: e.clientY, sx: this.ctx.renderer.scrollX, sy: this.ctx.renderer.scrollY, moved: false };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const scale = this.ctx.desktop.scale;
      const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      this.ctx.renderer.scrollX = drag.sx - dx;
      this.ctx.renderer.scrollY = drag.sy - dy;
      this.ctx.renderer.clampScroll(this.game.state);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 && drag) {
        if (!drag.moved) {
          // right click: centre the map on the field (manual p. 46)
          const f = this.fieldFromEvent(e);
          if (f >= 0) this.ctx.renderer.centerOn(this.game.state, f % this.game.state.width, Math.floor(f / this.game.state.width));
          this.closeChip();
          this.mode = { kind: 'none' };
        }
        drag = null;
        this.dirty = true;
      }
    });
    c.addEventListener('mousemove', (e) => {
      if (drag) return;
      const f = this.fieldFromEvent(e);
      if (f >= 0 && f !== this.cursor) { this.cursor = f; this.dirty = true; this.refreshUia(); }
    });
    c.addEventListener('click', (e) => {
      const f = this.fieldFromEvent(e);
      if (f >= 0) void this.onFieldClick(f, false);
    });
    c.addEventListener('dblclick', (e) => {
      const f = this.fieldFromEvent(e);
      if (f >= 0) void this.onFieldClick(f, true);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.ctx.renderer.zoom + (e.deltaY < 0 ? 0.5 : -0.5));
    }, { passive: false });
  }

  setZoom(z: number, ax = this.ctx.renderer.canvas.width / 2, ay = this.ctx.renderer.canvas.height / 2) {
    const r = this.ctx.renderer;
    const nz = this.mobile ? Math.max(0.8, Math.min(3.2, z)) : Math.max(1, Math.min(2, z));
    if (nz === r.zoom) return;
    const cx = (r.scrollX + ax) / r.zoom, cy = (r.scrollY + ay) / r.zoom;
    r.zoom = nz;
    r.scrollX = cx * nz - ax;
    r.scrollY = cy * nz - ay;
    r.clampScroll(this.game.state);
  }

  private fieldFromEvent(e: MouseEvent): number {
    const rect = this.ctx.renderer.canvas.getBoundingClientRect();
    const scale = rect.width / this.ctx.renderer.canvas.width;
    return this.ctx.renderer.fieldAt(this.game.state, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  }

  private onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.video-full, .video-framed, .menu, .msgbox')) return;
    const r = this.ctx.renderer;
    const step = 48;
    if (e.key === 'ArrowLeft') r.scrollX -= step;
    else if (e.key === 'ArrowRight') r.scrollX += step;
    else if (e.key === 'ArrowUp') r.scrollY -= step;
    else if (e.key === 'ArrowDown') r.scrollY += step;
    else if (e.key === '+') this.setZoom(r.zoom + 0.5);
    else if (e.key === '-') this.setZoom(r.zoom - 0.5);
    else if (e.key === 'Escape') { if (this.weaponWin) { this.weaponWin.cancel(); return; } this.closeChip(); this.mode = { kind: 'none' }; }
    else if (e.key === 'Enter' && e.ctrlKey) this.requestEndTurn();
    else return;
    r.clampScroll(this.game.state);
    this.dirty = true;
  };

  private canActView() { return this.game.isHumanTurn() && !this.game.state.outcome && !this.busy; }

  private canAct() {
    return !this.busy && this.game.isHumanTurn() && !this.game.state.outcome;
  }

  private async onFieldClick(f: number, double: boolean) {
    const g = this.game, s = g.state;
    this.cursor = f;
    this.dirty = true;
    if (!this.canAct()) return;
    if (this.mode.kind === 'move' && this.mode.area.has(f)) {
      await this.doMove(this.mode.unitId, f);
      return;
    }
    if (this.mode.kind === 'attack') {
      const t = s.unitAt[f];
      if (t >= 0 && this.mode.targets.has(t)) { await this.chooseWeaponAndAttack(this.mode.unitId, t); return; }
      // clicking outside: the attack is given up (manual p. 59)
      const u = s.units[this.mode.unitId];
      this.mode = { kind: 'none' };
      if ((u.flags & UnitFlag.MOVED) && !g.canMove(u)) g.skipUnit(u.id);
      this.closeChip();
      return;
    }
    if (this.mode.kind === 'support' || this.mode.kind === 'build') {
      const m = this.mode;
      this.mode = { kind: 'none' };
      const t = s.unitAt[f];
      let res: CommandResult | null = null;
      if (m.kind === 'support' && t >= 0 && m.targets.has(t)) res = m.action === 'refill' ? g.refillUnit(m.unitId, t) : g.repairUnit(m.unitId, t);
      if (m.kind === 'build' && m.fields.has(f)) res = g.build(m.unitId, f, m.what);
      if (res) await this.afterUnitCommand(m.unitId, res);
      else this.closeChip();
      return;
    }
    if (this.mode.kind === 'move') { this.mode = { kind: 'none' }; this.closeChip(); }
    const uid = s.unitAt[f];
    const shopId = s.shopAt[f];
    if (uid >= 0 && s.units[uid].owner === s.activePlayer && !(s.units[uid].flags & UnitFlag.DONE)) {
      this.selected = uid;
      if (double || true) this.openChip(uid);
    } else if (shopId >= 0 && (double || uid < 0) && s.shops[shopId].owner === s.activePlayer) {
      this.openShop(shopId);
    } else {
      this.selected = uid;
      this.closeChip();
      if (this.mobile) this.mobileInspect(f);
    }
  }

  // ------------------------------------------------------------------ chip window (manual p. 57ff)
  private openChip(unitId: number) {
    const g = this.game, s = g.state, a = this.ctx.assets;
    this.closeChip();
    const u = s.units[unitId];
    const c = g.data.unitClasses[u.type];
    if (this.mobile) { this.openMobileCard(unitId); return; }
    const at = this.chipPosition(u);
    const chip = el('div', 'gwin chipwin', this.ctx.desktop.layer, { left: `${at.x}px`, top: `${at.y}px`, width: '447px', height: '60px', backgroundImage: `url(${a.url('CMSK000', 'C00_00')})` });
    chip.style.zIndex = '4500';
    this.chip = chip;
    label(chip, this.ctx.fonts.small.render(`${c.name} – ${c.description}`, '#c4e89c'), 30, 5);
    const chips: [string, string, () => void][] = [];
    if (g.canMove(u)) chips.push(['C01_03', 'Bewegen', () => this.startMove(unitId)]);
    const targets = g.attackTargets(unitId);
    if (targets.length) chips.push(['C01_04', 'Angriff', () => this.startAttack(unitId)]);
    if (u.cargo.length) chips.push(['C01_17', 'Transporter', () => this.openCargo(unitId)]);
    for (const cmd of this.unitCommands(unitId)) chips.push([cmd.icon, cmd.title, cmd.run]);
    chips.push(['C01_11', 'Info', () => this.showUnitInfo(unitId)]);
    chips.push(['C01_02', 'Schließen', () => { if ((u.flags & UnitFlag.MOVED) || (u.flags & UnitFlag.ATTACKED)) g.skipUnit(unitId); this.closeChip(); this.mode = { kind: 'none' }; this.dirty = true; }]);
    const x0 = 33, step = 32.3;
    chips.forEach(([name, title, fn], i) => button(chip, a, 'CMSK000', name, Math.round(x0 + i * step), 20, fn, title).dataset.cmd = title);
    void UCF;
  }

  /** Phone: unit card with the same commands as the chip window. */
  private openMobileCard(unitId: number) {
    const g = this.game, s = g.state, u = s.units[unitId], c = g.data.unitClasses[u.type];
    const actions: CardAction[] = [];
    if (g.canMove(u)) actions.push({ id: 'move', label: 'Bewegen', primary: true, run: () => this.startMove(unitId) });
    if (g.attackTargets(unitId).length) actions.push({ id: 'attack', label: 'Angriff', primary: true, run: () => this.startAttack(unitId) });
    if (u.cargo.length) actions.push({ id: 'cargo', label: 'Ladung', run: () => this.openCargo(unitId) });
    for (const cmd of this.unitCommands(unitId)) actions.push({ id: cmd.id, label: cmd.short, run: cmd.run });
    actions.push({ id: 'info', label: 'Info', run: () => this.showUnitInfo(unitId) });
    actions.push({ id: 'done', label: 'Fertig', run: () => { if ((u.flags & UnitFlag.MOVED) || (u.flags & UnitFlag.ATTACKED)) g.skipUnit(unitId); this.closeChip(); this.mode = { kind: 'none' }; this.dirty = true; } });
    this.mobile!.showCard({
      title: c.name, subtitle: c.description, unit: { type: u.type, scheme: this.ctx.chroma[Math.min(u.owner, 6)]?.scheme ?? 12 },
      stats: [`Stärke ${u.group}/${c.strength}`, `Erfahrung ${u.experience + 1}`], bar: c.fuel > 0 ? u.fuel / c.fuel : undefined, actions,
    });
  }

  /** Special commands of a unit (supply, repair, construction, height); shared by the chip window and the phone card. */
  private unitCommands(unitId: number): { id: string; icon: string; title: string; short: string; run: () => void }[] {
    const g = this.game, u = g.state.units[unitId], c = g.data.unitClasses[u.type];
    const out: { id: string; icon: string; title: string; short: string; run: () => void }[] = [];
    const sup = g.supportTargets(unitId);
    if (sup.refill.length) out.push({ id: 'refill', icon: 'C01_15', title: 'Auftanken / Munition', short: 'Versorgen', run: () => this.startSupport(unitId, 'refill', sup.refill) });
    if (sup.repair.length) out.push({ id: 'repair', icon: 'C01_13', title: 'Reparieren', short: 'Reparieren', run: () => this.startSupport(unitId, 'repair', sup.repair) });
    const build = g.buildTargets(unitId);
    if (build.size) out.push({ id: 'build', icon: 'C01_14', title: 'Bauen', short: 'Bauen', run: () => this.openBuildChoice(unitId) });
    const water = (c.flags & UCF.DIVE) !== 0;
    if (g.canChangeHeight(unitId, true)) out.push({ id: 'up', icon: 'C01_09', title: water ? 'Auftauchen' : 'Steigen', short: water ? 'Auftauchen' : 'Steigen', run: () => void this.doChangeHeight(unitId, true) });
    if (g.canChangeHeight(unitId, false)) out.push({ id: 'down', icon: 'C01_10', title: water ? 'Tauchen' : 'Sinken', short: water ? 'Tauchen' : 'Sinken', run: () => void this.doChangeHeight(unitId, false) });
    return out;
  }

  private startSupport(unitId: number, action: 'refill' | 'repair', targets: number[]) {
    this.mode = { kind: 'support', unitId, action, targets: new Set(targets) };
    this.closeChip();
    this.dirty = true;
  }

  /** Build window: the possible construction commands (manual p. 62), then the field is chosen on the map. */
  private openBuildChoice(unitId: number) {
    const g = this.game, targets = g.buildTargets(unitId);
    let all = 0;
    for (const o of targets.values()) all |= o;
    const choices = BUILD_CHIPS.filter(([what]) => all & (1 << what));
    const start = (what: number) => {
      const fields = new Set([...targets].filter(([, o]) => o & (1 << what)).map(([f]) => f));
      this.mode = { kind: 'build', unitId, what, fields };
      this.closeChip();
      this.dirty = true;
    };
    if (this.mobile) {
      this.closeChip();
      this.mobile.showCard({
        title: 'Bauen', subtitle: g.data.unitClasses[g.state.units[unitId].type].name, stats: [],
        actions: [...choices.map(([what, , title]) => ({ id: `build-${what}`, label: title, primary: true, run: () => start(what) })),
          { id: 'back', label: 'Zurück', run: () => this.openChip(unitId) }],
      });
      return;
    }
    const chip = this.chip;
    if (!chip) return;
    chip.querySelectorAll('.btn').forEach((b) => b.remove());
    const a = this.ctx.assets;
    const x0 = 33, step = 32.3;
    [...choices.map(([what, icon, title]) => [icon, title, () => start(what)] as const), ['C01_02', 'Zurück', () => this.openChip(unitId)] as const]
      .forEach(([icon, title, fn], i) => button(chip, a, 'CMSK000', icon, Math.round(x0 + i * step), 20, fn, title).dataset.cmd = title);
  }

  private async doChangeHeight(unitId: number, up: boolean) {
    this.closeChip();
    await this.afterUnitCommand(unitId, this.game.changeHeight(unitId, up));
  }

  /** Plays the events of a unit command and reopens the chip window while the unit can still act. */
  private async afterUnitCommand(unitId: number, res: CommandResult) {
    this.busy = true;
    await this.playEvents(res.events);
    this.busy = false;
    const u = this.game.state.units[unitId];
    if (u.alive && !(u.flags & UnitFlag.DONE) && !u.container) this.openChip(unitId);
    else this.closeChip();
    this.afterHumanAction();
  }

  /** Desktop position of the chip window: right below the unit (above it near the bottom edge), kept on screen. */
  private chipPosition(u: UnitState): { x: number; y: number } {
    const r = this.ctx.renderer, w = 447, h = 60;
    const p = r.fieldPixel(u.x, u.y);
    const canvas = r.canvas.getBoundingClientRect();
    const root = this.ctx.desktop.root.getBoundingClientRect();
    const k = root.width / DESKTOP_W; // desktop scale
    const cx = (canvas.left - root.left) / k + (p.x - r.scrollX + r.tileSize / 2) * (canvas.width / r.canvas.width) / k;
    const cy = (canvas.top - root.top) / k + (p.y - r.scrollY + r.tileSize / 2) * (canvas.height / r.canvas.height) / k;
    const half = (r.tileSize * (canvas.width / r.canvas.width)) / k / 2;
    let y = cy + half + 6;
    if (y + h > DESKTOP_H - 4) y = cy - half - 6 - h;
    const x = Math.min(Math.max(4, cx - w / 2), DESKTOP_W - w - 4);
    return { x: Math.round(x), y: Math.round(Math.max(4, y)) };
  }

  private closeChip() {
    this.mobile?.hideCard();
    this.chip?.remove();
    this.chip = null;
    this.popup?.remove();
    this.popup = null;
  }

  private startMove(unitId: number) {
    const area = this.game.moveArea(unitId);
    this.mode = { kind: 'move', unitId, area: new Set(area.targets.keys()) };
    this.closeChip();
    this.dirty = true;
  }

  private startAttack(unitId: number) {
    const t = this.game.attackTargets(unitId);
    this.mode = { kind: 'attack', unitId, targets: new Map(t.map((x) => [x.unitId, x.weapons])) };
    this.closeChip();
    this.dirty = true;
  }

  private async doMove(unitId: number, target: number) {
    const g = this.game;
    this.busy = true;
    this.mode = { kind: 'none' };
    const res = g.moveUnit(unitId, target);
    await this.playEvents(res.events);
    this.busy = false;
    const u = g.state.units[unitId];
    if (u.alive && !(u.flags & UnitFlag.DONE) && !u.container) this.openChip(unitId);
    this.afterHumanAction();
  }

  private async chooseWeaponAndAttack(unitId: number, targetId: number) {
    if (this.weaponWin) return;
    const g = this.game, a = this.ctx.assets;
    const u = g.state.units[unitId];
    const c = g.data.unitClasses[u.type];
    const mask = (this.mode.kind === 'attack' && this.mode.targets.get(targetId)) || 0;
    const weapons = c.weapons.map((w, i) => ({ w, i })).filter(({ i }) => mask & (1 << i));
    let weapon = weapons[0].i;
    if (weapons.length > 1 && this.mobile) {
      this.weaponWin = { win: this.mobile.root, cancel: () => this.mobile!.closeSheet() };
      weapon = await this.mobile.pickWeapon(c.name, weapons.map(({ w, i }) => ({ index: i, name: c.weaponNames[i], damage: w.damage, ammo: u.ammo[i], range: w.minRange === w.maxRange ? String(w.maxRange) : `${w.minRange}–${w.maxRange}`, targets: w.targets })));
      this.weaponWin = null;
      if (weapon < 0) return;
    } else if (weapons.length > 1) {
      // weapon selection window (WW000, manual p. 59)
      weapon = await new Promise<number>((resolve) => {
        const win = el('div', 'gwin weaponwin', this.ctx.desktop.layer, { left: `${(DESKTOP_W - 240) / 2}px`, top: '160px', width: '240px', height: '174px', backgroundImage: `url(${a.url('WW000', 'WW00_00')})` });
        win.style.zIndex = '4800';
        const close = (i: number) => { win.remove(); this.weaponWin = null; resolve(i); };
        this.weaponWin = { win, cancel: () => close(-1) };
        label(win, this.ctx.fonts.small.render(c.name, '#c4e89c'), 12, 8);
        weapons.forEach(({ w, i }, k) => {
          const row = el('div', 'weapon-row', win, { left: '10px', top: `${34 + k * 30}px`, width: '220px', height: '26px' });
          row.dataset.weapon = String(i);
          label(row, this.ctx.fonts.small.render(`${u.ammo[i]}  ${c.weaponNames[i]}`, '#c4e89c'), 6, 2);
          label(row, this.ctx.fonts.small.render(`Stärke ${w.damage}   Reichw. ${w.minRange}-${w.maxRange}`, '#a0c0a0'), 6, 13);
          row.addEventListener('click', () => close(i));
        });
        const x = el('div', 'btn', win, { left: '205px', top: '6px', width: '28px', height: '24px', backgroundImage: `url(${a.buttonState('WW000', 'WW01_00', 0).toDataURL()})` });
        x.addEventListener('click', () => close(-1));
      });
      if (weapon < 0) return;
    }
    this.busy = true;
    this.mode = { kind: 'none' };
    const res = g.attack(unitId, targetId, weapon);
    await this.playEvents(res.events);
    this.busy = false;
    if (u.alive && !(u.flags & UnitFlag.DONE)) this.openChip(unitId);
    this.afterHumanAction();
  }

  private afterHumanAction() {
    this.dirty = true;
    if (this.game.state.outcome) this.hooks.onOutcome();
  }

  // ------------------------------------------------------------------ event presentation
  /** Plays move animations, combat results and messages/videos for the given events. */
  async playEvents(events: GameEvent[]) {
    for (const e of events) {
      if (this.destroyed) return;
      this.eventCursor = Math.max(this.eventCursor, e.seq + 1);
      switch (e.kind) {
        case 'message':
          if (e.data.type === 'move') await this.animateMove(e.data.unitId as number, e.data.path as number[]);
          break;
        case 'surprise':
          if (e.player === this.viewer) this.flash('Hinterhalt im Nebel!');
          break;
        case 'combat': await this.showCombat(e); break;
        case 'video':
          if (e.player === undefined || !this.game.state.players[e.player]?.computer) await this.hooks.playSequence(e.data.sequence as number);
          break;
        case 'building-captured':
          if (e.player === this.viewer || this.game.state.shops[e.data.shopId as number]) {
            const name = this.ctx.shopNames.get(this.game.state.shops[e.data.shopId as number].nameIndex) ?? '';
            if (e.player === this.viewer && !this.game.state.players[this.viewer].computer) await this.hooks.playSequence(0);
            this.flash(`${name} eingenommen`);
          }
          break;
        case 'weather': this.flash(['Sonnig', 'Leichter Regen', 'Starker Regen', 'Leichter Schneefall', 'Starker Schneefall'][e.data.weather as number] ?? ''); break;
        case 'sunk': case 'crashed': this.flash(e.kind === 'sunk' ? 'Einheit versunken' : 'Flugzeug abgestürzt'); break;
      }
      this.dirty = true;
    }
  }

  private async animateMove(unitId: number, path: number[]) {
    const s = this.game.state;
    const u = s.units[unitId];
    if (path.length < 2) return;
    const visible = path.some((f) => s.vision[f] & (1 << this.viewer)) || u.owner === this.viewer;
    if (!visible) return;
    this.hidden.add(unitId);
    const W = s.width;
    const pos = (f: number) => ({ x: (f % W) * 16, y: Math.floor(f / W) * 24 + ((f % W) & 1) * 12 });
    const stepMs = this.game.state.players[u.owner].computer ? 70 : 90;
    for (let i = 1; i < path.length; i++) {
      const a = pos(path[i - 1]), b = pos(path[i]);
      const dir = directionBetween(path[i - 1], path[i], W);
      const t0 = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - t0) / stepMs);
        this.animating = { unitId, px: a.x + (b.x - a.x) * t, py: a.y + (b.y - a.y) * t, dir };
        await new Promise((r) => requestAnimationFrame(r));
        if (t >= 1) break;
      }
    }
    this.animating = null;
    this.hidden.delete(unitId);
  }

  /** "Schneller Kampf": the statistics window of the fight (manual p. 39f), see fightpanel.ts. */
  private async showCombat(e: GameEvent) {
    const s = this.game.state;
    const a = s.units[e.data.attacker as number], d = s.units[e.data.defender as number];
    const seen = (s.vision[this.game.w.idx(d.x, d.y)] & (1 << this.viewer)) || a.owner === this.viewer || d.owner === this.viewer;
    if (!seen) return;
    const r = e.data.result as CombatResult;
    const xp = e.data.xp as { attacker: number; defender: number; attackerAfter: number; defenderAfter: number };
    const field = e.data.field as { attacker: number; defender: number };
    const cls = this.game.data.unitClasses;
    const weapon = e.data.weapon as number, dWeapon = e.data.defenderWeapon as number;
    const scheme = (o: number) => this.ctx.chroma[Math.min(o, 6)].scheme;
    const nz = (v: number) => (v > 0 ? v : 1);
    const attacker: FightSide = {
      name: cls[a.type].name, weapon: cls[a.type].weaponNames[weapon] ?? '', scheme: scheme(a.owner),
      count: r.attacker.n, losses: r.attackerLosses, firepower: nz(cls[a.type].weapons[weapon]?.damage ?? 0), armor: nz(cls[a.type].armor),
      ground: r.bars.attacker[2] ?? 0, field: field.attacker, xpBefore: xp.attacker, xpAfter: xp.attackerAfter,
    };
    const defender: FightSide = {
      name: cls[d.type].name, weapon: dWeapon >= 0 ? cls[d.type].weaponNames[dWeapon] ?? '' : '', scheme: scheme(d.owner),
      count: r.defender.n, losses: r.defenderLosses, firepower: nz(dWeapon >= 0 ? cls[d.type].weapons[dWeapon]?.damage ?? 0 : 0), armor: nz(cls[d.type].armor),
      ground: r.bars.defender[2] ?? 0, field: field.defender, xpBefore: xp.defender, xpAfter: xp.defenderAfter,
    };
    // the viewing player is shown on the left (FGT_Fight)
    const attackerLeft = a.owner === this.viewer || d.owner !== this.viewer;
    this.dirty = true;
    if (this.mobile) {
      const fight3d = this.ctx.fight?.enabled() ? await this.ctx.fight.load().catch(() => null) : null;
      const mask = this.game.data.terrain[s.terrain[d.y * s.width + d.x]]?.typeMask ?? 0;
      await this.mobile.showFight({
        fight3d, fx: this.ctx.fight!.fx, panel: { attacker, defender, attackerLeft },
        scene: fight3d ? {
          attacker: { type: a.type, count: attacker.count, losses: attacker.losses, scheme: attacker.scheme, weaponName: attacker.weapon },
          defender: { type: d.type, count: defender.count, losses: defender.losses, scheme: defender.scheme, weaponName: defender.weapon },
          defenderFiresBack: dWeapon >= 0, attackerLeft, weather: s.weather, environment: environmentFor(mask),
        } : null,
      });
      return;
    }
    if (this.ctx.fight?.enabled()) {
      const fight3d = await this.ctx.fight.load().catch(() => null);
      if (fight3d) {
        const mask = this.game.data.terrain[s.terrain[d.y * s.width + d.x]]?.typeMask ?? 0;
        await showFightWindow(this.ctx.desktop.layer, {
          assets: this.ctx.assets, fonts: this.ctx.fonts, fight3d, fx: this.ctx.fight.fx, panel: { attacker, defender, attackerLeft },
          scene: {
            attacker: { type: a.type, count: attacker.count, losses: attacker.losses, scheme: attacker.scheme, weaponName: attacker.weapon },
            defender: { type: d.type, count: defender.count, losses: defender.losses, scheme: defender.scheme, weaponName: defender.weapon },
            defenderFiresBack: dWeapon >= 0, attackerLeft, weather: s.weather, environment: environmentFor(mask),
          },
        });
        return;
      }
    }
    await showFightPanel(this.ctx.desktop.layer, this.ctx.assets, this.ctx.fonts, { attacker, defender, attackerLeft });
  }

  private flash(text: string) {
    if (this.mobile) { this.mobile.toast(text); return; }
    const b = el('div', 'flash', this.ctx.desktop.layer, { left: '20px', top: '24px' });
    label(b, this.ctx.fonts.medium.render(text, '#f0e060'), 0, 0);
    b.style.zIndex = '4950';
    setTimeout(() => b.remove(), 2200);
  }

  // ------------------------------------------------------------------ turns
  private async requestEndTurn() {
    if (!this.canAct()) return;
    this.closeChip();
    this.mode = { kind: 'none' };
    this.busy = true;
    const res = this.game.endTurn();
    await this.playEvents(res.events);
    this.hooks.onAutosave();
    await this.runComputerTurns();
    this.busy = false;
    this.dirty = true;
  }

  /** Plays the turns of computer players until a human player is to move or the game ends. */
  async runComputerTurns() {
    const g = this.game;
    while (!g.state.outcome && !g.isHumanTurn() && !this.destroyed) {
      this.busy = true;
      const ai = new ComputerPlayer(g);
      const p = g.state.activePlayer;
      this.showTurnBanner(p);
      ai.planObjectives();
      ai.produceTurn();
      for (const u of g.unitsOf(p).sort((x, y) => ai.unitOrder(y) - ai.unitOrder(x))) {
        if (g.state.outcome || this.destroyed) break;
        if (!u.alive) continue;
        const start = g.state.eventSeq;
        ai.actUnit(u);
        const evs = g.state.events.filter((ev) => ev.seq >= start);
        if (evs.length) await this.playEvents(evs);
        if (evs.length) await sleep(this.aiDelay);
      }
      const res = g.endTurn();
      await this.playEvents(res.events);
      this.hideTurnBanner();
    }
    if (!g.state.outcome) {
      // hot-seat: show the active human player's view
      this.viewer = g.state.activePlayer;
      this.dirty = true;
    }
    this.busy = false;
    if (g.state.outcome) this.hooks.onOutcome();
  }

  private banner: HTMLDivElement | null = null;
  private showTurnBanner(p: number) {
    this.hideTurnBanner();
    if (this.mobile) { this.mobile.toast(`${this.ctx.playerNames[p] || `Spieler ${p + 1}`} ist am Zug – Runde ${this.game.state.turn + 1}`, 1800); return; }
    this.banner = el('div', 'gwin turnbanner', this.ctx.desktop.layer, { left: `${(DESKTOP_W - 300) / 2}px`, top: '10px', width: '300px', height: '24px' });
    this.banner.style.zIndex = '4950';
    label(this.banner, this.ctx.fonts.small.render(`${this.ctx.playerNames[p] || `Spieler ${p + 1}`} ist am Zug – Runde ${this.game.state.turn + 1}`, '#f0e060'), 10, 6);
  }
  private hideTurnBanner() { this.banner?.remove(); this.banner = null; }

  // ------------------------------------------------------------------ info windows
  private updateInfo() {
    if (this.mobile) { this.mobile.setHeader(this.game.state.turn + 1, this.ctx.playerNames[this.game.state.activePlayer] || `Spieler ${this.game.state.activePlayer + 1}`, this.canActView()); return; }
    const g = this.game, s = g.state, f = this.ctx.fonts.small;
    this.infoLayer.replaceChildren();
    if (this.cursor < 0) return;
    const w = new World(g.data, s);
    const x = this.cursor % s.width, y = Math.floor(this.cursor / s.width);
    const terrainValue = 100 + (s.terrainTables.firepower[w.combatTerrainBit(x, y)] ?? 0);
    label(this.infoLayer, f.render(String(terrainValue), '#c4e89c'), 340, 34);
    const uid = s.unitAt[this.cursor];
    const shopId = s.shopAt[this.cursor];
    if (uid >= 0 && g.visibleTo(this.viewer, uid)) {
      const u = s.units[uid];
      const c = g.data.unitClasses[u.type];
      const own = u.owner === this.viewer || w.isAllied(this.viewer, u.owner);
      label(this.infoLayer, f.render(String(u.group), '#c4e89c'), 30, 28);
      if (own) label(this.infoLayer, f.render(String(u.fuel), '#c4e89c'), 30, 47);
      label(this.infoLayer, f.render(String(Math.trunc(c.sight / 8)), '#c4e89c'), 30, 66);
      label(this.infoLayer, f.render(fit(f, c.name, 146), '#c4e89c'), 88, 28);
      label(this.infoLayer, f.render(fit(f, u.name || this.ctx.playerNames[u.owner] || '', 146), '#c0d0c0'), 88, 47);
      label(this.infoLayer, f.render(fit(f, c.description, 146), '#c0d0c0'), 88, 66);
      c.weapons.forEach((wp, i) => {
        if (wp.damage <= 0 && wp.ammo <= 0) return;
        if (own) label(this.infoLayer, f.render(String(u.ammo[i]), '#c4e89c'), 244, 25 + i * 15);
        label(this.infoLayer, f.render(wp.damage > 0 ? String(wp.damage) : '-', '#c0d0c0'), 290, 25 + i * 15);
      });
      this.ownerBox(u.owner);
      this.xpBadge(u);
    } else if (shopId >= 0 && (s.explored[this.cursor] & (1 << this.viewer))) {
      const shop = s.shops[shopId];
      label(this.infoLayer, f.render(this.ctx.shopNames.get(shop.nameIndex) ?? 'Gebäude', '#c4e89c'), 88, 28);
      label(this.infoLayer, f.render(this.ctx.playerNames[shop.owner] ?? (shop.owner === NEUTRAL ? 'neutral' : ''), '#c0d0c0'), 88, 47);
      if (shop.owner === this.viewer) {
        label(this.infoLayer, f.render(`Energie ${s.players[shop.owner].energy}  Material ${shop.material}`, '#c0d0c0'), 88, 66);
      }
      this.ownerBox(shop.owner);
    }
  }

  private ownerBox(owner: number) {
    const c = el('div', 'ownerbox', this.infoLayer, { left: '341px', top: '60px', width: '18px', height: '18px' });
    c.style.background = rgb(this.ctx.assets.palette, this.ctx.chroma[Math.min(owner, 6)].color);
  }

  private xpBadge(u: UnitState) {
    const name = `UW01_${10 + Math.max(0, Math.min(11, u.experience))}`;
    try {
      const c = this.ctx.assets.canvas('UW000', name);
      label(this.infoLayer, (() => { const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); return cc; })(), 368, 28);
    } catch { /* badge missing */ }
  }

  showUnitInfo(unitId = this.selected) {
    const g = this.game, s = g.state;
    if (unitId < 0) unitId = this.cursor >= 0 ? s.unitAt[this.cursor] : -1;
    if (this.mobile) {
      if (unitId < 0) { this.mobile.toast('Tippen Sie zuerst eine Einheit an'); return; }
      const t = this.uiaTarget(unitId);
      this.mobile.openInfo(t, this.ctx.playerNames[t.owner] ?? '');
      return;
    }
    if (!this.uia) this.openUia();
    if (unitId >= 0) this.uia!.setTarget(this.uiaTarget(unitId));
    void g;
  }

  /** Opens the UIA window (manager button) or closes it when it is already open. */
  private toggleUia() {
    if (this.uia) { this.uia.close(); return; }
    this.showUnitInfo();
  }

  private openUia() {
    this.uia = new UiaWindow({
      assets: this.ctx.assets, fonts: this.ctx.fonts, desktop: this.ctx.desktop.layer, renderer: this.ctx.renderer, src: this.ctx.src,
      chroma: this.ctx.chroma, playerNames: this.ctx.playerNames, classes: this.game.data.unitClasses,
    }, () => { this.uia = null; });
    this.uia.element.style.zIndex = '4100';
    const f = this.cursor >= 0 ? this.game.state.unitAt[this.cursor] : this.selected;
    if (f >= 0) this.uia.setTarget(this.uiaTarget(f));
  }

  private uiaTarget(unitId: number): UiaTarget {
    const s = this.game.state, u = s.units[unitId];
    const own = u.owner === this.viewer || this.game.w.isAllied(this.viewer, u.owner);
    return { type: u.type, owner: u.owner, group: u.group, experience: u.experience, name: u.name ?? '', ammo: [...u.ammo], fuel: u.fuel, own };
  }

  /** The UIA window follows the unit under the cursor (manual p. 47). */
  private refreshUia() {
    if (!this.uia || this.cursor < 0) return;
    const s = this.game.state, uid = s.unitAt[this.cursor];
    if (uid >= 0 && this.game.visibleTo(this.viewer, uid)) this.uia.setTarget(this.uiaTarget(uid));
  }

  private showStatistics() {
    const g = this.game, s = g.state;
    const lines = s.players.filter((p) => p.alive || p.lost).map((p) => `${this.ctx.playerNames[p.index] || `Spieler ${p.index + 1}`}: ${g.unitsOf(p.index).length} Einheiten, vernichtet ${p.killed}, verloren ${p.lost}, Energie ${p.energy}`);
    if (this.mobile) { this.mobile.openMessage(`${this.ctx.missionName} – Runde ${s.turn + 1}`, lines); return; }
    void this.hooks.showText(`${this.ctx.missionName} – Runde ${s.turn + 1}`, lines.join('\n'));
  }

  // ------------------------------------------------------------------ buildings and transporters
  private openShop(shopId: number) {
    const g = this.game, s = g.state, a = this.ctx.assets, f = this.ctx.fonts.small;
    this.closeChip();
    const shop = s.shops[shopId];
    if (this.mobile) { this.openMobileShop(shopId); return; }
    const win = el('div', 'gwin shopwin', this.ctx.desktop.layer, { left: `${(DESKTOP_W - 640) / 2}px`, top: '40px', width: '640px', height: '398px', backgroundImage: `url(${a.url('SP000', 'SP00_00')})` });
    win.style.zIndex = '4600';
    this.popup = win;
    const render = () => {
      win.querySelectorAll('.dyn').forEach((n) => n.remove());
      const dyn = el('div', 'dyn', win, { left: '0', top: '0', width: '640px', height: '398px' });
      label(dyn, f.render(this.ctx.shopNames.get(shop.nameIndex) ?? 'Gebäude', '#c4e89c'), 18, 122);
      label(dyn, f.render(this.ctx.playerNames[shop.owner] ?? '', '#c0d0c0'), 18, 140);
      label(dyn, f.render(`Energie ${s.players[shop.owner]?.energy ?? 0}`, '#c4e89c'), 40, 162);
      label(dyn, f.render(`Material ${shop.material}`, '#c4e89c'), 40, 176);
      label(dyn, f.render(`+${shop.energyPlus} / +${shop.materialPlus} je Runde`, '#c0d0c0'), 40, 196);
      const pic = ['ST01_00', 'ST01_01', 'ST01_02', 'ST01_03', 'ST01_04', 'ST01_05'][Math.max(0, Math.min(5, Math.log2(shop.type & -shop.type)))];
      try { label(dyn, (() => { const c = a.canvas('ST000', pic); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); return cc; })(), 15, 16); } catch { /* */ }
      shop.units.slice(0, 6).forEach((id, k) => {
        const u = s.units[id];
        const slot = el('div', 'shop-slot', dyn, { left: '196px', top: `${38 + k * 54}px`, width: '82px', height: '50px' });
        slot.dataset.unit = String(id);
        const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
        const cctx = cv.getContext('2d')!; cctx.imageSmoothingEnabled = false;
        this.ctx.renderer.drawUnitIcon(cctx, u.type, this.ctx.chroma[Math.min(u.owner, 6)].scheme, 0, 0, 48, 1);
        label(slot, cv, 17, 0);
        slot.addEventListener('click', () => { selectedUnit = id; render(); });
        if (selectedUnit === id) slot.classList.add('selected');
      });
      if (selectedUnit >= 0) {
        const u = s.units[selectedUnit];
        const c = g.data.unitClasses[u.type];
        label(dyn, f.render(c.name, '#c4e89c'), 340, 36);
        label(dyn, f.render(`Stärke ${u.group}/${c.strength}  Treibstoff ${u.fuel}/${c.fuel}  Erf. ${u.experience}`, '#c0d0c0'), 310, 300);
      }
      const prod = g.producible(shopId);
      if (producing) {
        prod.slice(0, 12).forEach((t, k) => {
          const c = g.data.unitClasses[t];
          const row = el('div', 'prod-row', dyn, { left: '305px', top: `${60 + k * 18}px`, width: '320px', height: '16px' });
          row.dataset.type = String(t);
          label(row, f.render(`${c.name}  E${c.costEnergy} M${c.costMaterial}`, '#c4e89c'), 2, 2);
          row.addEventListener('click', () => { g.produce(shopId, t); producing = false; render(); this.dirty = true; });
        });
      }
      const own = shop.owner === s.activePlayer && this.canAct();
      const btn = (name: string, x: number, title: string, fn: () => void) => { button(dyn, a, 'SP000', name, x, 362, fn, title).dataset.cmd = title; };
      if (own && selectedUnit >= 0 && g.canMove(s.units[selectedUnit])) btn('SP01_01', 20, 'Bewegen', () => { win.remove(); this.popup = null; this.startMove(selectedUnit); });
      if (own && selectedUnit >= 0) btn('SP01_02', 56, 'Tanken', () => { g.refuelInShop(selectedUnit); render(); });
      if (own && selectedUnit >= 0) btn('SP01_03', 92, 'Reparieren', () => { g.repairInShop(selectedUnit); render(); });
      if (own && prod.length) btn('SP01_04', 128, 'Produzieren', () => { producing = !producing; render(); });
      if (own && selectedUnit >= 0 && g.canTrain(selectedUnit)) {
        const pts = s.players[shop.owner].trainingPoints ?? [0, 0, 0];
        label(dyn, f.render(`Trainingspunkte Land ${pts[0]}  Wasser ${pts[1]}  Luft ${pts[2]}`, '#c0d0c0'), 310, 316);
        button(dyn, a, 'CMSK000', 'C01_16', 164, 362, () => { g.train(selectedUnit); render(); }, 'Training').dataset.cmd = 'Training';
      }
      btn('SP01_00', 600, 'Schließen', () => { win.remove(); this.popup = null; this.dirty = true; });
    };
    let selectedUnit = shop.units[0] ?? -1;
    let producing = false;
    render();
  }

  private openMobileShop(shopId: number) {
    const g = this.game, s = g.state, shop = s.shops[shopId];
    let selected = shop.units[0] ?? -1;
    let producing = false;
    const own = shop.owner === s.activePlayer && this.canAct();
    const scheme = (o: number) => this.ctx.chroma[Math.min(o, 6)]?.scheme ?? 12;
    this.mobile!.openShop(() => {
      const prod = g.producible(shopId);
      return {
        title: this.ctx.shopNames.get(shop.nameIndex) ?? 'Gebäude',
        owner: this.ctx.playerNames[shop.owner] ?? '',
        energy: s.players[shop.owner]?.energy ?? 0,
        material: shop.material,
        income: `+${shop.energyPlus} / +${shop.materialPlus} je Runde`,
        own,
        producing,
        producible: prod.map((t) => ({ type: t, name: g.data.unitClasses[t].name, energy: g.data.unitClasses[t].costEnergy, material: g.data.unitClasses[t].costMaterial })),
        hasSelected: selected >= 0,
        canMoveSelected: selected >= 0 && g.canMove(s.units[selected]),
        canTrainSelected: selected >= 0 && g.canTrain(selected),
        units: shop.units.map((id) => { const u = s.units[id], c = g.data.unitClasses[u.type]; return { id, name: c.name, type: u.type, scheme: scheme(u.owner), group: u.group, maxGroup: c.strength, xp: u.experience, fuel: `${u.fuel}/${c.fuel}`, selected: id === selected, canMove: g.canMove(u) }; }),
      };
    }, {
      select: (id) => { selected = id; },
      move: () => { if (selected >= 0) this.startMove(selected); },
      refuel: () => { if (selected >= 0) g.refuelInShop(selected); this.dirty = true; },
      repair: () => { if (selected >= 0) g.repairInShop(selected); this.dirty = true; },
      train: () => { if (selected >= 0) g.train(selected); this.dirty = true; },
      toggleProduce: () => { producing = !producing; },
      produce: (type) => { g.produce(shopId, type); producing = false; this.dirty = true; },
    });
  }

  private openCargo(unitId: number) {
    const g = this.game, s = g.state;
    const u = s.units[unitId];
    const names = u.cargo.map((id) => g.data.unitClasses[s.units[id].type].name);
    this.closeChip();
    if (this.mobile) {
      this.mobile.openCargo('Ladung', u.cargo.map((id) => ({ id, name: g.data.unitClasses[s.units[id].type].name, type: s.units[id].type, scheme: this.ctx.chroma[Math.min(s.units[id].owner, 6)]?.scheme ?? 12, canMove: g.canMove(s.units[id]) })), (id) => this.startMove(id));
      return;
    }
    const win = el('div', 'gwin cargowin', this.ctx.desktop.layer, { left: '300px', top: '200px', width: '240px', height: `${40 + names.length * 18}px` });
    win.style.zIndex = '4600';
    this.popup = win;
    label(win, this.ctx.fonts.small.render('Ladung', '#f0e060'), 10, 6);
    u.cargo.forEach((id, k) => {
      const row = el('div', 'prod-row', win, { left: '10px', top: `${24 + k * 18}px`, width: '220px', height: '16px' });
      row.dataset.unit = String(id);
      label(row, this.ctx.fonts.small.render(names[k], g.canMove(s.units[id]) ? '#c4e89c' : '#708070'), 2, 2);
      row.addEventListener('click', () => { if (g.canMove(s.units[id])) { win.remove(); this.popup = null; this.startMove(id); } });
    });
  }
}

function fit(f: BitmapFont, text: string, width: number) {
  let t = text;
  while (t.length > 1 && f.measure(t) > width) t = t.slice(0, -1);
  return t;
}

function directionBetween(a: number, b: number, W: number) {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  if (ax === bx) return ay > by ? 0 : 3;
  if (ax < bx) return ay > by ? 1 : ay < by ? 2 : (ax & 1) === 0 ? 2 : 1;
  return ay > by ? 5 : ay < by ? 4 : (ax & 1) === 0 ? 4 : 5;
}
