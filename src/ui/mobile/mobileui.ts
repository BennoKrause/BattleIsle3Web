// Phone interface of the game screen, styled after the original game: mottled green metal panels with bevels,
// dark-blue text fields, the original bitmap fonts, the yellow command icons (CMSK000) and manager icons (MNGR000).
// Layout: top bar, full-size touch map, unit card with commands, bottom dock and bottom sheets (weapon choice, unit
// information with the UIA animation, buildings, cargo, overview) plus the full-screen fight view. The game logic
// (selection, moving, fights, computer turns) is shared with the desktop GameScreen; this class only builds the DOM.
import type { Assets } from '../assets.ts';
import type { FileSource } from '../../data/source.ts';
import type { UnitClassInfo } from '../../data/gamedata.ts';
import type { MapRenderer } from '../../render/mapview.ts';
import type { PlayerChroma } from '../../render/chroma.ts';
import { el } from '../desktop.ts';
import { AnimationCache, unitProperties, type UiaTarget } from '../uiawindow.ts';
import type { FightPanelInput } from '../fightpanel.ts';
import { createMobileFightStats } from './fightstats.ts';
import { FightScene, Raster, type FightAssets, type FightInput3D } from '../../render/fight3d.ts';
import type { FxPlayer } from '../../audio/fx.ts';
import { COLORS, setParagraph, setText, type PixelFonts } from './pixel.ts';

export interface CardAction { id: string; label: string; enabled?: boolean; primary?: boolean; run: () => void }

export interface CardData {
  title: string;
  subtitle: string;
  /** Unit symbol (class, colour scheme) or none for buildings. */
  unit?: { type: number; scheme: number };
  stats: string[];
  /** 0..1 fuel bar. */
  bar?: number;
  actions: CardAction[];
}

/** Values of a unit in a building or on board: strength, ammunition per weapon ("6/8 2/2"), fuel. */
export interface UnitStats { group: number; maxGroup: number; ammo: string; fuel: string }

export interface ShopView {
  title: string;
  owner: string;
  energy: number;
  material: number;
  income: string;
  units: (UnitStats & { id: number; name: string; type: number; scheme: number; xp: number; selected: boolean; canMove: boolean })[];
  own: boolean;
  producible: { type: number; name: string; energy: number; material: number }[];
  producing: boolean;
  canMoveSelected: boolean;
  canTrainSelected?: boolean;
  hasSelected: boolean;
}

export interface ShopActions {
  select(id: number): void;
  move(): void;
  refuel(): void;
  repair(): void;
  train(): void;
  toggleProduce(): void;
  produce(type: number): void;
}

export interface MobileDeps {
  layer: HTMLElement;
  assets: Assets;
  fonts: PixelFonts;
  renderer: MapRenderer;
  src: FileSource;
  classes: UnitClassInfo[];
  chroma: PlayerChroma[];
  missionName: string;
  /** Dock / header commands. */
  commands: { endTurn(): void; menu(): void; setup(): void; stats(): void; centre(): void };
}

const TARGET_ICONS: [number, string, string][] = [[1, 'WB01_01', 'Hochfliegend'], [2, 'WB01_02', 'Luft'], [4, 'WB01_03', 'Boden'], [8, 'WB01_04', 'Wasser'], [16, 'WB01_05', 'Getaucht'], [32, 'WB01_06', 'Gebäude']];
const PROP_NAMES: Record<string, string> = {
  UW01_50: 'Kann Gebäude besetzen', UW01_51: 'Baut Straßen', UW01_52: 'Baut Befestigungen', UW01_53: 'Ziehen, aber nicht angreifen',
  UW01_54: 'Ziehen, Angreifen, Ziehen', UW01_55: 'Wechselt die Höhenstufe', UW01_56: 'Repariert und betankt',
};
/** Original command icons (chip window, CMSK000) for the unit card. */
const ACTION_ICONS: Record<string, string> = { move: 'C01_03', attack: 'C01_04', cargo: 'C01_17', info: 'C01_11', done: 'C01_02', refill: 'C01_15', repair: 'C01_13', build: 'C01_14', up: 'C01_09', down: 'C01_10', train: 'C01_16', 'build-0': 'C01_20', 'build-1': 'C01_21', 'build-2': 'C01_22', 'build-3': 'C01_23' };

export class MobileUi {
  readonly root: HTMLElement;
  readonly mapHost: HTMLElement;
  private d: MobileDeps;
  private roundEl: HTMLElement;
  private playerEl: HTMLElement;
  private card: HTMLElement;
  private dock: HTMLElement;
  private sheetEl: HTMLElement | null = null;
  private toasts: HTMLElement;
  private animations: AnimationCache;
  private animTimer = 0;
  private closers: (() => void)[] = [];
  private zoomHandler: ((delta: number) => void) | null = null;
  onOverview: (() => void) | null = null;
  onInfoRequest: (() => void) | null = null;

  constructor(d: MobileDeps) {
    this.d = d;
    this.animations = new AnimationCache(d.src, d.assets);
    this.root = el('div', 'm-game', d.layer);
    const top = el('header', 'm-top', this.root);
    const menu = this.iconButton(top, 'MNGR000', 'MNGR0004', 'Menü', () => d.commands.menu());
    menu.classList.add('m-menu-btn');
    const titleBox = el('div', 'm-top-title m-field', top);
    this.text(el('div', 'm-mission', titleBox), d.missionName, { font: 'small', color: COLORS.accent, scale: 1.7 });
    const sub = el('div', 'm-top-sub', titleBox);
    this.roundEl = el('span', 'm-round', sub);
    this.playerEl = el('span', 'm-player', sub);
    this.mapHost = el('main', 'm-map', this.root);
    const zoom = el('div', 'm-zoom', this.mapHost);
    for (const [txt, delta, title] of [['+', 0.4, 'Vergrößern'], ['-', -0.4, 'Verkleinern']] as const) {
      const b = el('button', 'm-zoom-btn', zoom);
      this.text(b, txt, { font: 'large', color: COLORS.accent, scale: 1.4 });
      b.title = title;
      b.dataset.cmd = `Zoom ${txt === '-' ? '−' : txt}`;
      b.addEventListener('click', () => this.zoomHandler?.(delta));
    }
    this.toasts = el('div', 'm-toasts', this.mapHost);
    this.card = el('section', 'm-card', this.root);
    this.card.hidden = true;
    this.dock = el('nav', 'm-dock', this.root);
    this.buildDock();
  }

  // ------------------------------------------------------------------ helpers
  private text(parent: HTMLElement, text: string, o: Parameters<typeof setText>[2] = {}) {
    setText(parent, text, o);
    return parent;
  }

  private bmp(lib: string, name: string, state: 0 | 1 | 2 = 0): string {
    return this.d.assets.buttonState(lib, name, state).toDataURL();
  }

  /** Original icon button (three-state strip), scaled up. */
  private iconButton(parent: HTMLElement, lib: string, name: string, label: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'm-icon-btn', parent);
    const c = this.d.assets.buttonState(lib, name, 0);
    const normal = `url(${c.toDataURL()})`, pressed = `url(${this.bmp(lib, name, 2)})`;
    b.style.backgroundImage = normal;
    b.style.setProperty('--iw', `${c.width}px`);
    b.style.setProperty('--ih', `${c.height}px`);
    b.setAttribute('aria-label', label);
    b.dataset.cmd = label;
    b.addEventListener('pointerdown', () => { b.style.backgroundImage = pressed; });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { b.style.backgroundImage = normal; });
    b.addEventListener('click', run);
    return b;
  }

  private canvasCopy(lib: string, name: string, cls = ''): HTMLCanvasElement {
    const c = this.d.assets.canvas(lib, name);
    const k = el('canvas', cls);
    k.width = c.width; k.height = c.height;
    k.getContext('2d')!.drawImage(c, 0, 0);
    return k;
  }

  private unitIcon(parent: HTMLElement, type: number, scheme: number, cls = 'm-unit-icon') {
    const cv = el('canvas', cls, parent);
    cv.width = 24; cv.height = 24;
    const cx = cv.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    this.d.renderer.drawUnitIcon(cx, type, scheme, 0, 0, 24, 1);
    return cv;
  }

  // ------------------------------------------------------------------ chrome
  onZoom(fn: (delta: number) => void) { this.zoomHandler = fn; }

  private buildDock() {
    const c = this.d.commands;
    // label = command name (tests, accessibility), short = text on the button
    const items: { name: string; label: string; short: string; cls?: string; run: () => void }[] = [
      { name: 'MNGR0010', label: 'Übersicht', short: 'Karte', run: () => this.onOverview?.() },
      { name: 'MNGR0012', label: 'Info', short: 'Info', run: () => this.onInfoRequest?.() },
      { name: 'MNGR0002', label: 'Zug beenden', short: 'Zugende', cls: 'm-end', run: () => c.endTurn() },
      { name: 'MNGR0016', label: 'Statistik', short: 'Stats', run: () => c.stats() },
      { name: 'MNGR0003', label: 'Setup', short: 'Setup', run: () => c.setup() },
    ];
    for (const it of items) {
      const b = el('button', `m-dock-btn ${it.cls ?? ''}`, this.dock);
      b.dataset.cmd = it.label;
      el('span', 'm-dock-icon', b).style.backgroundImage = `url(${this.bmp('MNGR000', it.name)})`;
      this.text(el('span', 'm-dock-label', b), it.short, { color: it.cls ? COLORS.white : COLORS.text, scale: 1.0 });
      b.setAttribute('aria-label', it.label);
      b.addEventListener('click', it.run);
    }
  }

  setHeader(round: number, player: string, mine: boolean) {
    this.text(this.roundEl, `Runde ${round}`, { color: COLORS.text, scale: 1.2 });
    this.text(this.playerEl, player, { color: COLORS.muted, scale: 1.2 });
    this.root.classList.toggle('m-waiting', !mine);
    (this.dock.querySelector('.m-end') as HTMLButtonElement).disabled = !mine;
  }

  toast(text: string, ms = 2200) {
    const t = el('div', 'm-toast', this.toasts);
    this.text(t, text, { color: COLORS.accent });
    setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------------ unit card
  showCard(data: CardData) {
    this.card.hidden = false;
    this.card.replaceChildren();
    const head = el('div', 'm-card-head', this.card);
    if (data.unit) this.unitIcon(el('div', 'm-icon-well', head), data.unit.type, data.unit.scheme);
    const text = el('div', 'm-card-text', head);
    const f1 = el('div', 'm-field', text);
    this.text(el('div', 'm-card-title', f1), data.title, { font: 'small', color: COLORS.accent, scale: 1.7 });
    this.text(el('div', 'm-card-sub', f1), data.subtitle, { color: COLORS.muted, scale: 1.2 });
    if (data.stats.length) {
      const f2 = el('div', 'm-field m-field-row', text);
      this.text(el('div', 'm-card-stats', f2), data.stats.join('   '), { color: COLORS.text, scale: 1.3 });
    }
    if (data.bar !== undefined) {
      const bar = el('div', 'm-bar', text);
      const fill = el('div', 'm-bar-fill', bar);
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, data.bar)) * 100)}%`;
      fill.classList.toggle('m-low', data.bar < 0.5);
      fill.classList.toggle('m-crit', data.bar < 0.25);
    }
    const acts = el('div', 'm-card-actions', this.card);
    for (const a of data.actions) {
      const b = el('button', 'm-cmd', acts);
      b.dataset.cmd = a.label;
      b.dataset.action = a.id;
      b.disabled = a.enabled === false;
      const icon = ACTION_ICONS[a.id];
      if (icon) el('span', 'm-cmd-icon', b).style.backgroundImage = `url(${this.bmp('CMSK000', icon)})`;
      this.text(el('span', 'm-cmd-label', b), a.label, { color: COLORS.text, scale: 1.3 });
      b.addEventListener('click', a.run);
    }
  }

  hideCard() {
    this.card.hidden = true;
    this.card.replaceChildren();
  }

  // ------------------------------------------------------------------ sheets
  /** Opens a bottom sheet; returns its body. Only one sheet at a time. */
  sheet(title: string, cls = '', onClose?: () => void): { body: HTMLElement; close: () => void } {
    this.closeSheet();
    const back = el('div', 'm-backdrop', this.root);
    const sh = el('div', `m-bsheet ${cls}`, back);
    const head = el('div', 'm-sheet-head', sh);
    const tf = el('div', 'm-field m-sheet-title', head);
    this.text(el('h2', 'm-title', tf), title, { font: 'small', color: COLORS.accent, scale: 1.8 });
    const close = () => { window.clearInterval(this.animTimer); back.remove(); if (this.sheetEl === back) this.sheetEl = null; onClose?.(); };
    const x = this.iconButton(head, 'SETUP000', 'SU01_03', 'Schließen', close);
    x.classList.add('m-close');
    const body = el('div', 'm-sheet-body', sh);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    this.sheetEl = back;
    this.closers = [close];
    return { body, close };
  }

  closeSheet() { this.closers.forEach((c) => c()); this.closers = []; }

  get hasSheet() { return !!this.sheetEl; }

  private targetIcons(parent: HTMLElement, mask: number) {
    for (const [bit, name, title] of TARGET_ICONS) {
      const k = this.canvasCopy('WB000', name, `m-target${mask & bit ? ' on' : ''}`);
      k.title = title;
      parent.append(k);
    }
  }

  /** One row of the weapon table: ammo, name, strength and range, target icons. */
  private weaponRow(parent: HTMLElement, tag: 'button' | 'div', w: { name: string; damage: number; ammo: number | string; range: string; targets: number }) {
    const row = el(tag, 'm-weapon', parent);
    this.text(el('span', 'm-w-ammo m-field', row), String(w.ammo), { font: 'large', color: COLORS.accent, scale: 1.0 });
    const mid = el('span', 'm-w-mid', row);
    this.text(el('span', 'm-w-name', mid), w.name, { color: COLORS.text, scale: 1.5 });
    this.text(el('span', 'm-w-sub', mid), `Stärke ${w.damage}   Reichweite ${w.range}`, { color: COLORS.muted, scale: 1.15 });
    this.targetIcons(el('span', 'm-w-targets', row), w.targets);
    return row;
  }

  pickWeapon(unitName: string, weapons: { index: number; name: string; damage: number; ammo: number; range: string; targets: number }[]): Promise<number> {
    return new Promise((resolve) => {
      let chosen = false;
      const { body, close } = this.sheet(`Waffe wählen – ${unitName}`, 'm-weapons', () => { if (!chosen) resolve(-1); });
      for (const w of weapons) {
        const row = this.weaponRow(body, 'button', w);
        row.dataset.weapon = String(w.index);
        row.addEventListener('click', () => { chosen = true; close(); resolve(w.index); });
      }
    });
  }

  /** Unit information (the phone version of the UIA window) with the rotating animation. */
  openInfo(t: UiaTarget, ownerName: string) {
    const c = this.d.classes[t.type];
    const { body } = this.sheet(c.name, 'm-info');
    setParagraph(el('div', 'm-info-desc', body), `${c.description}${ownerName ? ` – ${ownerName}` : ''}${t.name ? ` („${t.name}“)` : ''}`, 330, { color: COLORS.muted, scale: 1.3 });
    const frame = el('div', 'm-anim-frame', body);
    const anim = el('canvas', 'm-info-anim', frame);
    anim.width = 160; anim.height = 100;
    const actx = anim.getContext('2d')!;
    actx.imageSmoothingEnabled = false;
    let frames: HTMLCanvasElement[] | null = null;
    void this.animations.get(t.type).then((f) => { frames = f; });
    const started = performance.now();
    window.clearInterval(this.animTimer);
    this.animTimer = window.setInterval(() => {
      if (!frames?.length) return;
      actx.drawImage(frames[Math.floor(((performance.now() - started) / 1000) * 12) % frames.length], 0, 0, 160, 100);
    }, 1000 / 12);
    const grid = el('div', 'm-info-grid', body);
    const fuelFields = Math.trunc((t.own ? t.fuel : c.fuel) / Math.max(1, c.fuelUsage));
    const cell = (label: string, value: string | number, icon?: string) => {
      const d = el('div', 'm-cell m-field', grid);
      if (icon) d.append(this.canvasCopy('UW000', icon, 'm-cell-icon'));
      this.text(el('div', 'm-cell-label', d), label, { color: COLORS.muted, scale: 1.0 });
      this.text(el('div', 'm-cell-value', d), String(value), { font: 'large', color: COLORS.text, scale: 1.0 });
    };
    cell('Stärke', `${t.group}/${c.strength}`);
    cell('Erfahrung', `${t.experience + 1}`, `UW01_${10 + Math.max(0, Math.min(11, t.experience))}`);
    cell('Panzerung', c.armor);
    cell('Reichweite', c.moveRange >> 3);
    cell('Aufklärung', Math.trunc(c.sight / 8));
    cell('Treibstoff', `${fuelFields}`);
    cell('Energie', c.costEnergy);
    cell('Material', c.costMaterial);
    const props = unitProperties(c);
    if (props.length) {
      const row = el('div', 'm-props', body);
      for (const p of props) {
        const chip = el('div', 'm-prop', row);
        chip.append(this.canvasCopy('UW000', p, 'm-cell-icon'));
        this.text(el('span', 'm-prop-text', chip), PROP_NAMES[p] ?? '', { color: COLORS.text, scale: 1.3 });
      }
    }
    this.text(el('h3', 'm-section', body), 'Bewaffnung', { color: COLORS.accent, scale: 1.5 });
    c.weapons.forEach((w, i) => {
      if ((w.damage <= 0 && w.ammo <= 0) || !c.weaponNames[i] || c.weaponNames[i] === '-') return;
      this.weaponRow(body, 'div', { name: c.weaponNames[i], damage: w.damage, ammo: t.own ? t.ammo[i] ?? 0 : w.ammo, range: w.minRange === w.maxRange ? String(w.maxRange) : `${w.minRange}–${w.maxRange}`, targets: w.targets }).classList.add('m-static');
    });
  }

  openMessage(title: string, lines: string[]) {
    const { body } = this.sheet(title, 'm-text');
    for (const l of lines) setParagraph(el('p', 'm-line', body), l, 330, { color: COLORS.text, scale: 1.4 });
  }

  /** A row with unit symbol, name and secondary lines (cargo, building contents). */
  private unitRow(parent: HTMLElement, u: { id: number; name: string; type: number; scheme: number }, sub: string[], selected = false) {
    const b = el('button', `m-weapon${selected ? ' m-selected' : ''}`, parent);
    b.dataset.unit = String(u.id);
    this.unitIcon(el('span', 'm-icon-well', b), u.type, u.scheme);
    const mid = el('span', 'm-w-mid', b);
    this.text(el('span', 'm-w-name', mid), u.name, { color: COLORS.text, scale: 1.5 });
    for (const line of sub) this.text(el('span', 'm-w-sub', mid), line, { color: COLORS.muted, scale: 1.15 });
    return b;
  }

  /** Two lines: units and fuel, then the ammunition of every weapon (up to four, too long for one line). */
  private statsLines(u: UnitStats) {
    return [`Einheiten ${u.group}/${u.maxGroup}   Treibstoff ${u.fuel}`, `Munition ${u.ammo}`];
  }

  /** Units on board; `blocked` = may still move but no field around the transporter can be entered. */
  openCargo(title: string, rows: (UnitStats & { id: number; name: string; type: number; scheme: number; state: 'move' | 'moved' | 'blocked' })[], onMove: (id: number) => void) {
    const { body, close } = this.sheet(title, 'm-cargo');
    for (const r of rows) {
      const b = this.unitRow(body, r, [...this.statsLines(r), r.state === 'move' ? 'Bewegen' : r.state === 'moved' ? 'bereits bewegt' : 'kein Ausstieg möglich']);
      b.disabled = r.state !== 'move';
      b.addEventListener('click', () => { close(); onMove(r.id); });
    }
    if (!rows.length) setParagraph(el('p', 'm-line', body), 'Keine Ladung.', 330, { scale: 1.4 });
  }

  /** Building (shop) sheet; `view()` is called again after every action. */
  openShop(view: () => ShopView, act: ShopActions) {
    const { body } = this.sheet('Gebäude', 'm-shop');
    const render = () => {
      const v = view();
      body.replaceChildren();
      const head = el('div', 'm-field m-shop-head', body);
      this.text(el('div', 'm-shop-title', head), v.title, { color: COLORS.accent, scale: 1.7 });
      this.text(el('div', 'm-shop-sub', head), `${v.owner}   Energie ${v.energy}   Material ${v.material}   ${v.income}`, { color: COLORS.muted, scale: 1.15 });
      this.text(el('h3', 'm-section', body), `Einheiten im Gebäude (${v.units.length})`, { color: COLORS.accent, scale: 1.5 });
      for (const u of v.units) {
        const b = this.unitRow(body, { id: u.id, name: u.name, type: u.type, scheme: u.scheme }, [...this.statsLines(u), `Erfahrung ${u.xp + 1}`], u.selected);
        b.addEventListener('click', () => { act.select(u.id); render(); });
      }
      if (v.own) {
        const row = el('div', 'm-card-actions', body);
        const btn = (label: string, id: string, on: boolean, run: () => void) => {
          const b = el('button', 'm-cmd', row);
          b.dataset.cmd = label; b.dataset.action = id; b.disabled = !on;
          if (ACTION_ICONS[id]) el('span', 'm-cmd-icon', b).style.backgroundImage = `url(${this.bmp('CMSK000', ACTION_ICONS[id])})`;
          this.text(el('span', 'm-cmd-label', b), label, { color: COLORS.text, scale: 1.3 });
          b.addEventListener('click', () => { run(); render(); });
        };
        btn('Bewegen', 'move', v.canMoveSelected, () => { this.closeSheet(); act.move(); });
        btn('Tanken', 'refuel', v.hasSelected, () => act.refuel());
        btn('Reparieren', 'repair', v.hasSelected, () => act.repair());
        if (v.canTrainSelected) btn('Training', 'train', true, () => act.train());
        btn(v.producing ? 'Schließen' : 'Produzieren', 'produce', v.producible.length > 0, () => act.toggleProduce());
        if (v.producing) {
          this.text(el('h3', 'm-section', body), 'Produzieren', { color: COLORS.accent, scale: 1.5 });
          for (const p of v.producible) {
            const b = el('button', 'm-weapon', body);
            b.dataset.type = String(p.type);
            const mid = el('span', 'm-w-mid', b);
            this.text(el('span', 'm-w-name', mid), p.name, { color: COLORS.text, scale: 1.5 });
            this.text(el('span', 'm-w-sub', mid), `Energie ${p.energy}   Material ${p.material}`, { color: COLORS.muted, scale: 1.15 });
            b.addEventListener('click', () => { act.produce(p.type); render(); });
          }
        }
      }
    };
    render();
  }

  /** Overview map; tapping a spot centres the map there. */
  openOverview(draw: (c: HTMLCanvasElement) => void, onPick: (fx: number, fy: number) => void, size: { w: number; h: number }) {
    const { body, close } = this.sheet('Übersicht', 'm-overview');
    const frame = el('div', 'm-anim-frame', body);
    const cv = el('canvas', 'm-overview-canvas', frame);
    cv.width = size.w; cv.height = size.h;
    draw(cv);
    cv.addEventListener('click', (e) => {
      const r = cv.getBoundingClientRect();
      onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      close();
    });
  }

  // ------------------------------------------------------------------ fight
  /** Full-screen fight: 3D scene (when `scene` is given) and the large statistics panel; the button skips. */
  showFight(o: { fight3d: FightAssets | null; fx: FxPlayer; panel: FightPanelInput; scene: FightInput3D | null }): Promise<void> {
    return new Promise((resolve) => {
      const back = el('div', 'm-fight', this.root);
      const stage = el('div', 'm-fight-stage', back);
      let scene: FightScene | null = null;
      let view: HTMLCanvasElement | null = null;
      // the picture fills the whole screen: it is rendered in the aspect ratio of the screen (at most ~260k pixels, smoothly scaled up)
      const sw = Math.max(200, back.clientWidth), sh = Math.max(200, back.clientHeight);
      const k = Math.min(1, Math.sqrt(260000 / (sw * sh)));
      const rw = Math.round((sw * k) / 2) * 2, rh = Math.round((sh * k) / 2) * 2;
      if (o.fight3d && o.scene) {
        view = el('canvas', 'm-fight-view', stage);
        view.width = rw; view.height = rh;
        scene = new FightScene(o.fight3d, o.scene);
      }
      if (!scene) back.classList.add('m-fight-quick');
      const firstHit = scene ? Math.min(...scene.sounds.filter((s) => s.lib === 'FGTEXPLO').map((s) => s.t), scene.duration) : 0;
      const panel = createMobileFightStats(back, this.d.assets, o.panel, firstHit);
      const skip = el('button', 'm-cmd m-fight-skip', back);
      this.text(el('span', 'm-cmd-label', skip), 'Weiter  >', { color: COLORS.accent, scale: 1.6 });
      let closed = false;
      const finish = () => { if (closed) return; closed = true; panel.close(); back.remove(); resolve(); };
      skip.addEventListener('click', finish);
      const total = scene ? Math.max(scene.duration, firstHit + 2600) : 3600;
      const start = performance.now();
      const raster = new Raster(rw, rh);
      if (rh > rw) raster.focal = rw * 0.95; // portrait: narrower picture, keep both groups in view
      const ctx = view?.getContext('2d') ?? null;
      const img = ctx?.createImageData(rw, rh) ?? null;
      const cues = scene ? [...scene.sounds].sort((a, b) => a.t - b.t) : [];
      let cue = 0;
      const frame = () => {
        if (closed) return;
        const t = performance.now() - start;
        if (scene && o.fight3d && ctx && img) {
          while (cue < cues.length && cues[cue].t <= t) { void o.fx.play(o.fight3d.wave(cues[cue].lib, cues[cue].index)); cue++; }
          scene.render(Math.min(t, scene.duration), raster);
          new Uint32Array(img.data.buffer).set(raster.color);
          ctx.putImageData(img, 0, 0);
        }
        if (t >= total) { finish(); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  /** Called when the map area was resized (rotation, address bar). */
  mapSize(): { w: number; h: number } {
    return { w: Math.max(100, this.mapHost.clientWidth), h: Math.max(100, this.mapHost.clientHeight) };
  }

  destroy() {
    window.clearInterval(this.animTimer);
    this.root.remove();
  }
}
