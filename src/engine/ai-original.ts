// Computer player rebuilt from SDI_1C.EXE (phase machine FUN_00426c2b; see docs/research/AI.md for the analysis).
// Like the original it works in phases and performs one command per step(), so the screen can show every action.
// Planning phases 0-5 run in begin(); the acting phases 6-16 are stepped.
import type { Game } from './game.ts';
import { UCF } from './classes.ts';
import { computeMoveArea } from './movement.ts';
import { distance, neighbours } from './hex.ts';
import { usableWeapons } from './combat.ts';
import { toCombatant } from './combatant.ts';
import { unitVisibleTo } from './vision.ts';
import { nextRandom } from './rng.ts';
import { refillNeed } from './support.ts';
import { SF, shopFunction, type World } from './world.ts';
import { Layer, NEUTRAL, UnitFlag, type UnitState } from './state.ts';

/** Most units of a type the computer produces (table 0x4ccd50, -1 = unlimited); existing own units count. */
const PRODUCTION_LIMIT = [0, 0, 3, 10, 10, 5, 4, -1, -1, -1, -1, -1, -1, -1, -1, 5, 10, -1, 3, 5, 3, 5, -1, -1, 0, 0, -1, -1, -1, -1,
  3, -1, -1, -1, -1, -1, -1, -1, -1, 2, 0, -1, 5, -1, -1, -1, 0, -1, -1, -1, -1, -1, 10, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];

/** Rank of the reason code for the order of execution in phase 6 (FUN_00417ed0). */
const CODE_RANK: Record<number, number> = { 8: 12, 3: 10, 1: 9, 2: 7, 4: 5, 7: 4 };

interface Order { kind: number; prio: number; target: number; code: number }
interface Rating { flags: number; value: number; wanted: number }
interface Target { value: number; field: number; unit: number; art: number; cat: number; open: boolean }

const VF = { OWN: 1, ALLY: 2, NEUTRAL: 4, ENEMY: 8, OCCUPY: 0x10, ENERGY: 0x20, MATERIAL: 0x40, REPAIR: 0x80 } as const;

export class OriginalAI {
  private readonly g: Game;
  private readonly w: World;
  private p = 0;
  private orders = new Map<number, Order>();
  private ratings = new Map<number, Rating>();
  private targets: Target[] = [];
  private strategy = 0;
  private phase = 6;
  private list: number[] | null = null;
  private cursor = 0;
  private pass = 0;
  private produceQueue: { shop: number; types: number[] } | null = null;

  constructor(game: Game) {
    this.g = game;
    this.w = game.w;
  }

  /** Plays the whole turn of the active computer player (headless). */
  playTurn(maxSteps = 2000) {
    this.begin();
    for (let i = 0; i < maxSteps && this.step(); i++);
  }

  // ------------------------------------------------------------------ helpers
  private get s() { return this.g.state; }
  private units() { return this.s.units.filter((u) => u.alive && u.owner === this.p); }
  private cls(u: UnitState) { return this.w.cls(u); }
  private maxStrength(u: UnitState) { return this.w.maxGroup(this.cls(u)); }
  /** FUN_00430bbe: strength at most 1/3 (k=0), 1/2 (k=1), 2/3 (k=2) of the maximum. */
  private weak(u: UnitState, k = 0, group = u.group) {
    const m = this.maxStrength(u);
    const limit = k === 0 ? Math.trunc(m / 3) : k === 1 ? Math.trunc(m / 2) : Math.trunc((m * 2) / 3);
    return group <= limit;
  }
  /** FUN_004406eb: fields the fuel lasts. */
  private fuelRange(u: UnitState) { return Math.trunc(u.fuel / Math.max(1, this.cls(u).fuelUsage)); }
  private allied(owner: number) { return owner === this.p || (owner < NEUTRAL && this.w.isAllied(this.p, owner)); }
  private field(u: UnitState) { return this.w.idx(u.x, u.y); }
  private fxy(f: number) { return { x: f % this.s.width, y: Math.trunc(f / this.s.width) }; }
  private dist(a: number, b: number) { const p = this.fxy(a), q = this.fxy(b); return distance(p.x, p.y, q.x, q.y); }
  private order(u: UnitState): Order { return this.orders.get(u.id) ?? { kind: 0, prio: 0, target: -1, code: 0 }; }
  private free(f: number) { return this.s.unitAt[f] < 0 && this.s.shopAt[f] < 0; }
  /** Combat weapons with ammunition (no supply stock). */
  private weapons(u: UnitState) {
    return this.cls(u).weapons.map((wp, i) => ({ wp, i }))
      .filter(({ wp, i }) => wp.damage > 0 && (u.ammo[i] ?? 0) > 0 && ((wp.rawTargets >>> 0) & 0xf) === 0);
  }

  /** FUN_0042f260 / FUN_0043ec92: greedy best-first path in the 64-field search area, from the target back to the unit. */
  private path(u: UnitState, target: number, includeTarget: boolean): number[] | null {
    if (!(this.s.explored[target] & (1 << this.p))) return null;
    const area = computeMoveArea(this.w, u, { fields: 64 });
    const reach = new Set(area.reached ?? []);
    reach.add(this.field(u));
    if (includeTarget) reach.add(target);
    if (!reach.has(target)) return null;
    const t = this.fxy(target);
    const key = (f: number) => { const p = this.fxy(f); return (p.y - t.y) ** 2 + (p.x - t.x) ** 2; };
    const start = this.field(u);
    const parent = new Map<number, number>([[start, -1]]);
    const open = [start];
    while (open.length) {
      open.sort((a, b) => key(a) - key(b));
      const f = open.shift()!;
      if (f === target) {
        const out: number[] = [];
        for (let c = f; c >= 0; c = parent.get(c)!) out.push(c);
        return out;
      }
      const p = this.fxy(f);
      for (const n of neighbours(p.x, p.y, this.s.width, this.s.height)) {
        if (!n) continue;
        const ni = this.w.idx(n.x, n.y);
        if (!reach.has(ni) || parent.has(ni)) continue;
        parent.set(ni, f);
        open.push(ni);
      }
    }
    return null;
  }
  private pathLength(u: UnitState, target: number, includeTarget = true) {
    const p = this.path(u, target, includeTarget);
    return p ? p.length : -1;
  }
  /** Turns needed for a path: length·8/movement (FUN_0042f620). */
  private turns(u: UnitState, len: number) { return Math.trunc((len * 8) / Math.max(1, this.cls(u).moveRange)); }

  /** FUN_00417c61: the point on the way to `target` closest to it that the unit reaches this turn and may stop on. */
  private stepTowards(u: UnitState, target: number, f: number): number {
    const path = this.path(u, target, (f & 1) !== 0);
    if (!path || path.length < 2 || path.length >= 80) return -1;
    const reach = this.g.moveArea(u.id).targets;
    const ok = (p: number) => {
      if (!reach.has(p)) return false;
      if (this.s.unitAt[p] >= 0 && !(p === target && (f & 4))) return false;
      if ((f & 2) && p !== target) {
        const sh = this.s.shopAt[p];
        if (sh >= 0 && this.allied(this.s.shops[sh].owner)) return false;
      }
      return true;
    };
    for (let i = 0; i < path.length; i++) {
      if (ok(path[i])) return path[i];
      if (i > 0) {
        const a = this.fxy(path[i]), b = this.fxy(path[i - 1]);
        const na = neighbours(a.x, a.y, this.s.width, this.s.height).filter(Boolean).map((q) => this.w.idx(q!.x, q!.y));
        const nb = new Set(neighbours(b.x, b.y, this.s.width, this.s.height).filter(Boolean).map((q) => this.w.idx(q!.x, q!.y)));
        for (const c of na) if (nb.has(c) && ok(c)) return c;
      }
    }
    return -1;
  }

  /** Enemy units the unit could hit with weapon i when standing on `at`. */
  private targetsFrom(u: UnitState, at: number, i: number): UnitState[] {
    const me = { ...toCombatant(this.w, u), ...this.fxy(at) };
    const wp = this.cls(u).weapons[i];
    const out: UnitState[] = [];
    for (const t of this.w.unitsOnMap()) {
      if (this.allied(t.owner) || t.owner >= NEUTRAL) continue;
      if (this.cls(t).flags & UCF.CRYSTAL) continue;
      if (!unitVisibleTo(this.w, this.p, t.id)) continue;
      const d = this.dist(at, this.field(t));
      if (d < Math.max(1, wp.minRange) || d > wp.maxRange) continue;
      if (usableWeapons(me, toCombatant(this.w, t)) & (1 << i)) out.push(t);
    }
    return out;
  }

  // ------------------------------------------------------------------ phases 0-5 (planning)
  begin() {
    const s = this.s;
    this.p = s.activePlayer;
    this.orders.clear();
    this.targets = [];
    this.phase = 6;
    this.list = null;
    this.pass = 0;
    this.produceQueue = null;
    this.strategy = this.strategyFlags();
    this.fixedOrders();
    this.rateUnits();
    this.retreatDamaged();
    this.crystalTransports();
    this.buildTargets();
    this.assign([1, 2]);
    this.escortTargets();
    this.assign([3, 4, 5]);
    this.retreatDamaged();
  }

  /**
   * Phase 0 (FUN_00426c2b): orders from the fixed mission orders of the units (flags in `aiOrder`, see state.ts).
   * 0x10 counts down `aiTimer` and ends the order; 0x08 moves to `aiTarget`; 0x01 → order 2 (hold and fight) while the
   * unit is strong, fuelled and armed; 0x02 → order 3 (wait) while it is strong; 0x04 → order 4 (hold field `aiTimer`).
   */
  private fixedOrders() {
    for (const u of this.units()) {
      let f = u.aiOrder & 0xff;
      if (!f) continue;
      let kind = 0, prio = 0, target = 0;
      if (f & 0x10) {
        u.aiTimer = (u.aiTimer ?? 0) - 1;
        if (u.aiTimer < 0) f = 0;
      }
      if (f & 8) {
        const t = u.aiTarget ?? 0, tf = this.w.idx(t & 63, t >> 6);
        if (this.field(u) === tf) { f &= ~0x18; u.aiTarget = 1; }
        else { kind = 1; target = tf; }
      }
      if ((f & 1) && kind === 0) {
        const ammo = u.ammo.reduce((a, b) => a + b, 0);
        if (!this.weak(u) && u.fuel >= Math.trunc(this.cls(u).fuel / 3) && ammo !== 0) { kind = 2; prio = u.aiPrio ?? 0; }
        else { f &= ~0x11; u.aiPrio = 0; u.aiTimer = 0; }
      }
      if ((f & 2) && kind === 0) {
        if (!this.weak(u)) { kind = 3; prio = u.aiPrio ?? 0; }
        else { f &= ~0x12; u.aiPrio = 0; u.aiTimer = 0; }
      }
      if ((f & 4) && kind === 0) {
        const t = u.aiTimer ?? 0;
        kind = 4; target = this.w.idx(t & 63, t >> 6); prio = 200;
      }
      u.aiOrder = (u.aiOrder & ~0xff) | f;
      if (kind) this.orders.set(u.id, { kind, prio, target, code: 8 });
    }
  }

  /** FUN_0041bb6e. */
  private strategyFlags(): number {
    const s = this.s;
    let enemy = 0, enemyAir = 0, own = 0, ownAir = 0, inShops = 0, outside = 0;
    let has13 = false, has12 = false;
    for (const u of s.units) {
      if (!u.alive) continue;
      const plane = (this.cls(u).flags & UCF.PLANE) !== 0;
      if (this.allied(u.owner)) { own++; if (plane) ownAir++; } else { enemy++; if (plane) enemyAir++; }
      if (u.type === 0x13) has13 = true;
      if (u.type === 0x12) has12 = true;
      if (u.container?.kind === 'shop') inShops++; else outside++;
    }
    let f = ownAir + 5 < enemyAir ? 1 : 0;
    if (own + Math.trunc(own / 2) < enemy) f |= 0x40;
    if (s.shops.length > 20) f |= 2;
    if (s.width * s.height > 1600) f |= 4;
    if (!has13) f |= 8;
    if (!has12) f |= 0x10;
    let land = 0, water = 0;
    for (const t of s.terrain) { if ((this.g.data.terrain[t]?.typeMask ?? 0) & 0x70000) water++; else land++; }
    if (land + Math.trunc(land / 3) < water) f |= 0x20;
    if (inShops < Math.trunc(outside / 20)) f |= 0x80;
    return f;
  }

  /** FUN_0041faa0: abilities of every unit and the value of enemies. */
  private rateUnits() {
    for (const u of this.s.units) {
      if (!u.alive) continue;
      const c = this.cls(u);
      let flags = (c.flags & UCF.OCCUPY) ? VF.OCCUPY : 0;
      let energy = false, material = false;
      c.weapons.forEach((wp, i) => {
        if ((u.ammo[i] ?? 0) <= 0) return;
        if ((wp.rawTargets >>> 0) & 2) flags |= VF.ENERGY;
        if ((wp.rawTargets >>> 0) & 1) flags |= VF.MATERIAL;
        if ((wp.rawTargets >>> 0) & 0xf) { if ((wp.rawTargets >>> 0) & 9) material = true; if ((wp.rawTargets >>> 0) & 6) energy = true; }
      });
      if ((c.flags & UCF.REPAIR) && energy && material) flags |= VF.REPAIR;
      let value = 0, wanted = 0;
      if (u.owner === this.p) flags |= VF.OWN;
      else if (this.allied(u.owner)) flags |= VF.ALLY;
      else if (u.owner >= NEUTRAL) flags |= VF.NEUTRAL;
      else {
        flags |= VF.ENEMY;
        value = u.type === 0x18 ? 1 : 5;
        if (c.flags & UCF.OCCUPY) {
          value += 2;
          if (!u.container) value += 5 * (this.shopsInReach(u, true) + this.shopsInReach(u, false));
        }
        if ((c.flags & UCF.TRANSPORTER) && u.cargo.length) {
          for (const id of u.cargo) { const cu = this.s.units[id]; if (cu.type !== 0x18) value += (this.cls(cu).flags & UCF.OCCUPY) ? 4 : 2; }
        }
        if (flags & VF.ENERGY) value += 2;
        if (flags & VF.MATERIAL) value += 2;
        if (flags & VF.REPAIR) value += 2;
        wanted = Math.trunc(value / 6) + 1;
      }
      this.ratings.set(u.id, { flags, value, wanted });
    }
  }

  /** FUN_0041ff9e: buildings within the unit's move area (own buildings of the computer / any building). */
  private shopsInReach(u: UnitState, ownOnly: boolean) {
    const area = computeMoveArea(this.w, u, {});
    let n = 0;
    for (const f of area.reached ?? []) {
      const sh = this.s.shopAt[f];
      if (sh < 0) continue;
      if (ownOnly ? this.s.shops[sh].owner === this.p : true) n++;
    }
    return n;
  }

  /** FUN_00430779: weak units go to the best own building. */
  private retreatDamaged() {
    for (const u of this.units()) {
      if (u.container || !this.weak(u) || this.order(u).prio >= 30) continue;
      let best = 0, field = -1;
      for (const sh of this.s.shops) {
        if (sh.owner !== this.p || this.g.shopEntrySlot(sh.id, u.id) < 0) continue;
        const f = this.w.idx(sh.x, sh.y);
        const len = this.pathLength(u, f, false);
        if (len >= 0 && 20 - len > best) { best = 20 - len; field = f; }
      }
      if (field >= 0) this.orders.set(u.id, { kind: 1, prio: 30, target: field, code: 6 });
    }
  }

  /** FUN_00430928: transporters with a crystal deliver it. */
  private crystalTransports() {
    for (const u of this.units()) {
      if (u.container || !(this.cls(u).flags & UCF.TRANSPORTER)) continue;
      if (!u.cargo.some((id) => this.cls(this.s.units[id]).flags & UCF.CRYSTAL)) continue;
      let best = 0, field = -1;
      for (const sh of this.s.shops) {
        if (sh.owner !== this.p || this.g.shopEntrySlot(sh.id, u.id) < 0) continue;
        const f = this.w.idx(sh.x, sh.y);
        const len = this.pathLength(u, f, false);
        if (len < 0) continue;
        const v = (shopFunction(sh) & SF.PRODUCTION ? 50 : 20) - len;
        if (v > best) { best = v; field = f; }
      }
      if (field >= 0) this.orders.set(u.id, { kind: 1, prio: 100, target: field, code: 7 });
    }
  }

  /** FUN_0041db47: buildings to capture or defend, crystals. */
  private buildTargets() {
    const s = this.s;
    const threats = s.units.filter((u) => u.alive && !u.container && !this.allied(u.owner) && u.owner < NEUTRAL && (this.cls(u).flags & UCF.OCCUPY));
    for (const sh of s.shops) {
      const f = this.w.idx(sh.x, sh.y);
      if (!this.allied(sh.owner)) {
        this.targets.push({ value: 20 + 2 * sh.units.length, field: f, unit: -1, art: 1, cat: 1, open: true });
      } else if (sh.owner === this.p && threats.length) {
        const near = Math.min(...threats.map((t) => this.dist(this.field(t), f)));
        if (near < 11) {
          let n = near < 5 ? 2 : 1, v = 10;
          for (const q of neighbours(sh.x, sh.y, s.width, s.height)) {
            if (!q) continue;
            const qi = this.w.idx(q.x, q.y);
            if (s.unitAt[qi] >= 0) continue;
            this.targets.push({ value: v, field: qi, unit: -1, art: 2, cat: 2, open: true });
            v -= 2;
            if (--n === 0 || v < 1) break;
          }
        }
      }
    }
    for (const u of s.units) {
      if (u.alive && !u.container && (this.cls(u).flags & UCF.CRYSTAL)) this.targets.push({ value: 5, field: this.field(u), unit: u.id, art: 5, cat: 3, open: true });
    }
  }

  /** FUN_0041de3d: escorts for units on the way to capture or with a crystal. */
  private escortTargets() {
    for (const u of this.units()) {
      const o = this.orders.get(u.id);
      if (!o) continue;
      if (o.code === 1 && this.dist(this.field(u), o.target) >= 4) this.targets.push({ value: 9, field: o.target, unit: u.id, art: 3, cat: 4, open: true });
      if (o.code === 7) this.targets.push({ value: 1, field: o.target, unit: u.id, art: 4, cat: 5, open: true });
    }
  }

  /** FUN_0042f484: units that may take a target of the category. */
  private candidates(cat: number): UnitState[] {
    return this.units().filter((u) => {
      if (u.container || (u.flags & UnitFlag.ENTERED)) return false;
      const c = this.cls(u);
      if (cat === 1) return (c.flags & UCF.OCCUPY) !== 0 && c.moveRange > 0;
      if (cat === 3) return (c.flags & UCF.TRANSPORTER) !== 0 && c.moveRange > 15;
      return ((c.flags >>> 0) & 0x5f860d1f) === 0 && !this.weak(u) && c.moveRange > 15;
    });
  }

  /** FUN_0042f620 (categories 1, 2) and FUN_0042fcbf (3, 4, 5). */
  private assign(cats: number[]) {
    const params: Record<number, { max: number; base: number; turns: number; weak: number; fuel: number }> = {
      1: { max: 8, base: 200, turns: 3, weak: 50, fuel: 30 },
      2: { max: 6, base: 80, turns: 4, weak: 80, fuel: 30 },
      3: { max: 5, base: 80, turns: 3, weak: 40, fuel: 40 },
      4: { max: 8, base: 90, turns: 3, weak: 10, fuel: 30 },
      5: { max: 6, base: 50, turns: 4, weak: 99, fuel: 99 },
    };
    for (const cat of cats) {
      const cands = this.candidates(cat);
      const P = params[cat];
      for (;;) {
        const open = this.targets.filter((t) => t.open && t.cat === cat);
        if (!open.length) break;
        const t = open.reduce((a, b) => (b.value > a.value ? b : a));
        t.open = false;
        let goal = t.field;
        if (cat === 4 || (cat === 5 && t.unit >= 0)) {
          // escort: three steps along the way of the escorted unit
          const eu = this.s.units[t.unit];
          const step = this.stepTowards(eu, t.field, 3);
          goal = step >= 0 ? step : this.field(eu);
          if (goal === t.field) continue;
        }
        if (cat === 3 && t.unit >= 0) goal = this.field(this.s.units[t.unit]);
        const sorted = cands.filter((c) => c.alive).sort((a, b) => this.dist(this.field(a), goal) - this.dist(this.field(b), goal)).slice(0, P.max);
        let best = -1, who: UnitState | null = null, bestLen = 0;
        for (const u of sorted) {
          const len = this.pathLength(u, goal, cat !== 1);
          if (len < 0) continue;
          let v = t.value + (P.base - len) - P.turns * this.turns(u, len);
          if (this.weak(u)) v -= P.weak;
          if (this.fuelRange(u) < len) v -= P.fuel;
          if (v > best && v > this.order(u).prio) { best = v; who = u; bestLen = len; }
        }
        if (who) this.orders.set(who.id, { kind: cat === 2 && bestLen < 4 ? 5 : 1, prio: best, target: goal, code: t.art });
      }
    }
  }

  // ------------------------------------------------------------------ phases 6-16 (acting)
  /** Performs the next command of the turn; false when the turn is over. */
  step(): boolean {
    while (this.phase <= 16) {
      if (this.s.outcome || this.s.activePlayer !== this.p) return false;
      if (this.phase === 16) {
        // production works on the buildings, not on the units
        if (this.list === null) { this.list = []; this.shopQueue = this.productionOrder(); }
        if (this.produceQueue ? this.produceNext() : this.plan()) return true;
        this.phase++;
        continue;
      }
      if (this.list === null) { this.list = this.phaseList(); this.cursor = 0; }
      while (this.cursor < this.list.length) {
        const id = this.list[this.cursor++];
        const u = this.s.units[id];
        if (!u?.alive || u.owner !== this.p) continue;
        if (this.act(u)) return true;
      }
      this.list = null;
      if (this.phase >= 7 && this.phase <= 9 && ++this.pass < 3) continue;
      this.pass = 0;
      this.phase++;
    }
    return false;
  }

  private phaseList(): number[] {
    const us = this.units();
    switch (this.phase) {
      case 6: return us.filter((u) => !u.container && !(u.flags & UnitFlag.ENTERED) && (this.order(u).kind === 1 || this.order(u).kind === 4))
        .sort((a, b) => (CODE_RANK[this.order(b).code] ?? 0) - (CODE_RANK[this.order(a).code] ?? 0)).map((u) => u.id);
      case 7: case 8: case 9: return us.filter((u) => {
        if (u.container || (u.flags & UnitFlag.ENTERED) || u.type === 0x18) return false;
        const k = this.order(u).kind;
        if (k !== 0 && k !== 2 && k !== 3 && k !== 5) return false;
        return ((this.ratings.get(u.id)?.flags ?? 0) & 0xe0) === 0;
      }).sort((a, b) => this.combatRank(b) - this.combatRank(a)).map((u) => u.id);
      case 10: case 11: case 12: case 13: case 14: case 15: return us.map((u) => u.id);
      default: return [];
    }
  }

  private combatRank(u: UnitState) {
    const c = this.cls(u);
    let v = 1000;
    c.weapons.forEach((wp, i) => {
      if ((u.ammo[i] ?? 0) !== 0 && ((wp.rawTargets >>> 0) & 0xff800)) { v += wp.damage; if (wp.maxRange > 2) v += 600; }
    });
    if (c.moveRange < 16) v += 500;
    return v + u.group + Math.trunc(c.armor / 20);
  }

  private act(u: UnitState): boolean {
    switch (this.phase) {
      case 6: return this.executeOrder(u);
      case 7: case 8: case 9: return this.fight(u);
      case 10: return this.supply(u, 'repair');
      case 11: return this.supply(u, 'material');
      case 12: return this.supply(u, 'energy');
      case 13: return this.shopRepair(u);
      case 14: return this.shopRefill(u);
      case 15: return this.moveOut(u);
      default: return false;
    }
  }

  private move(u: UnitState, field: number): boolean {
    if (field === this.field(u)) return true;
    return this.g.moveUnit(u.id, field).ok;
  }

  /** Best attack from the current position (end of FUN_00417ed0). */
  private attackFromHere(u: UnitState, phase7 = false): { target: UnitState; weapon: number; score: number } | null {
    let best: { target: UnitState; weapon: number; score: number } | null = null;
    const legal = new Map(this.g.attackTargets(u.id).map((t) => [t.unitId, t.weapons]));
    for (const { i } of this.weapons(u)) {
      for (const t of this.targetsFrom(u, this.field(u), i)) {
        if (!((legal.get(t.id) ?? 0) & (1 << i))) continue;
        const sc = this.score(u, i, t, this.field(u), phase7);
        if (sc > (best?.score ?? 0)) best = { target: t, weapon: i, score: sc };
      }
    }
    return best;
  }

  /** Attack value of FUN_00417ed0 (phase 6) or FUN_00418985 (phases 7-9). */
  private score(u: UnitState, weapon: number, t: UnitState, at: number, phase7: boolean): number {
    const r = this.g.previewCombat(u, weapon, t, this.fxy(at));
    const rating = this.ratings.get(t.id) ?? { value: 5, wanted: 0, flags: 0 };
    const counter = r.defenderFiresBack && this.dist(at, this.field(t)) === 1;
    let v: number;
    if (!phase7) {
      v = rating.value + 1 + r.defenderLosses;
      if (counter) v -= 4 * r.attackerLosses;
      if (t.group - r.defenderLosses < 1) v += 10;
      if (counter) {
        if (u.group - r.attackerLosses < 1) v -= 30;
        else if (this.weak(u, 1, u.group - r.attackerLosses)) v -= 8;
      }
      if (r.defenderLosses === 0) v -= 30;
      return v;
    }
    v = rating.value + 3 + 2 * r.defenderLosses;
    if (counter) v -= 2 * r.attackerLosses;
    if (t.group - r.defenderLosses < 1) v += 8;
    if (counter) {
      if (u.group - r.attackerLosses < 1) v -= 12;
      else if (this.weak(u, 0, u.group - r.attackerLosses)) v -= 3;
    }
    if (r.defenderLosses === 0) v -= 4;
    const p = this.fxy(at);
    for (const q of neighbours(p.x, p.y, this.s.width, this.s.height)) {
      if (!q) continue;
      const o = this.w.unitAt(q.x, q.y);
      if (!o || o.id === u.id) continue;
      if (o.owner === this.p) v += 1; else if (!this.allied(o.owner)) v -= 2;
    }
    if (this.order(u).kind === 5) v += (this.cls(t).flags & UCF.OCCUPY) ? 100 : -300;
    return v;
  }

  private attack(u: UnitState, t: UnitState, weapon: number) {
    const r = this.ratings.get(t.id);
    if (r && r.wanted > 0) r.wanted--;
    this.g.attack(u.id, t.id, weapon);
  }

  /** Phase 6: move along the order, then attack (except capturing units); order 4 attacks the unit on its field. */
  private executeOrder(u: UnitState): boolean {
    const o = this.order(u);
    if (o.kind === 4) {
      const tid = this.s.unitAt[o.target];
      const legal = tid >= 0 ? this.g.attackTargets(u.id).find((t) => t.unitId === tid) : undefined;
      if (legal) {
        const wi = this.weapons(u).find(({ i }) => legal.weapons & (1 << i));
        if (wi) { this.attack(u, this.s.units[tid], wi.i); return true; }
      }
      u.aiOrder &= ~4;
      u.aiTimer = 0;
      return false;
    }
    const f = o.code === 1 || o.code === 6 || o.code === 7 ? 2 : 3 | (o.code === 5 ? 4 : 0);
    const step = this.stepTowards(u, o.target, f);
    if (step < 0) return false;
    if (!this.move(u, step)) return false;
    if (u.alive && !u.container && o.code !== 1) {
      const a = this.attackFromHere(u);
      if (a) this.attack(u, a.target, a.weapon);
    }
    // the order stays: units with an order are not free for phases 7-9
    return true;
  }

  /** Phases 7-9 (FUN_00418985): change height, best position and attack, or approach an enemy. */
  private fight(u: UnitState): boolean {
    const c = this.cls(u);
    if (u.flags & UnitFlag.DONE) return false;
    // submarines dive, climbing aircraft climb: one step aside, then change height
    if ((c.flags & (UCF.CLIMB | UCF.DIVE)) && (u.layer === Layer.AIR || u.layer === Layer.WATER) && this.g.canMove(u)) {
      const reach = this.g.moveArea(u.id).targets;
      const p = this.fxy(this.field(u));
      for (const q of neighbours(p.x, p.y, this.s.width, this.s.height)) {
        if (!q) continue;
        const qi = this.w.idx(q.x, q.y);
        if (reach.has(qi) && this.free(qi)) {
          this.move(u, qi);
          const up = (c.flags & UCF.CLIMB) !== 0;
          if (u.alive && this.g.canChangeHeight(u.id, up)) this.g.changeHeight(u.id, up);
          return true;
        }
      }
    }
    const o = this.order(u);
    // candidate positions: reachable free fields without buildings plus the own field
    const here = this.field(u);
    const positions = [here];
    if (!((c.flags >>> 0) & 0x40020000) && o.kind !== 2 && this.g.canMove(u)) {
      for (const f of this.g.moveArea(u.id).targets.keys()) if (this.free(f)) positions.push(f);
    }
    let best: { at: number; target: UnitState; weapon: number; score: number } | null = null;
    let anyTarget = false;
    if (!(u.flags & (UnitFlag.ATTACKED))) {
      for (const at of positions) {
        if (at !== here && (c.flags & UCF.COOLDOWN)) continue;
        for (const { i } of this.weapons(u)) {
          for (const t of this.targetsFrom(u, at, i)) {
            anyTarget = true;
            const sc = this.score(u, i, t, at, true);
            if (sc > (best?.score ?? 0)) best = { at, target: t, weapon: i, score: sc };
          }
        }
      }
    }
    if (best && (best.score > o.prio || o.kind === 2)) {
      if (best.at !== here && !this.move(u, best.at)) return false;
      // a waiting unit (fixed order 0x02) is free after its first attack
      if (u.aiOrder & 2) { u.aiOrder &= ~2; u.aiPrio = 0; }
      if (u.alive && this.g.attackTargets(u.id).some((t) => t.unitId === best!.target.id)) this.attack(u, best.target, best.weapon);
      return true;
    }
    // approach (no target within reach)
    if (anyTarget || (c.flags & UCF.CRYSTAL) || o.kind !== 0 || c.moveRange < 16 || !this.g.canMove(u)) return false;
    const R = Math.min(30, Math.max(15, (c.moveRange * 6) >> 3));
    const me = toCombatant(this.w, u);
    const enemies = this.w.unitsOnMap().filter((t) => !this.allied(t.owner) && t.owner < NEUTRAL && !(this.cls(t).flags & UCF.CRYSTAL)
      && unitVisibleTo(this.w, this.p, t.id) && usableWeapons(me, toCombatant(this.w, t)) !== 0 && this.dist(here, this.field(t)) <= R)
      .sort((a, b) => this.dist(here, this.field(a)) - this.dist(here, this.field(b))).slice(0, 6);
    let goal: UnitState | null = null, bestV = -1;
    for (const t of enemies) {
      const len = this.pathLength(u, this.field(t), true);
      if (len < 0) continue;
      let v = (this.fuelRange(u) < len ? 40 : 50) - this.turns(u, len);
      const r = this.ratings.get(t.id) ?? { value: 0, wanted: 0, flags: 0 };
      v += r.value;
      if (r.wanted === 0) v = Math.trunc(v / 3);
      if (v > bestV) { bestV = v; goal = t; }
    }
    if (!goal || bestV <= o.prio) return false;
    const step = this.stepTowards(u, this.field(goal), 3);
    if (step < 0) return false;
    const r = this.ratings.get(goal.id);
    if (r && r.wanted > 0) r.wanted--;
    return this.move(u, step);
  }

  /** Phases 10-12 (FUN_0041a1a6, FUN_0041a4ea, FUN_0041a810) with FUN_00419dd5 / FUN_0041a023. */
  private supply(u: UnitState, kind: 'repair' | 'material' | 'energy'): boolean {
    if (u.container || (u.flags & (UnitFlag.ENTERED | UnitFlag.DONE))) return false;
    const flag = kind === 'repair' ? VF.REPAIR : kind === 'material' ? VF.MATERIAL : VF.ENERGY;
    if (!((this.ratings.get(u.id)?.flags ?? 0) & flag)) return false;
    const here = this.field(u);
    const needy = this.units().filter((t) => {
      if (t.id === u.id || t.container || t.type === 0x18) return false;
      if (kind === 'repair') return this.weak(t, 1);
      const need = refillNeed(this.w, t);
      if (!need) return false;
      return kind === 'material' ? need[1] > 0 : t.fuel < this.cls(t).fuel / 2;
    }).sort((a, b) => this.dist(here, this.field(a)) - this.dist(here, this.field(b))).slice(0, 12);
    let best = -1, who: UnitState | null = null;
    for (const t of needy) {
      const len = this.pathLength(u, this.field(t), true);
      if (len < 0) continue;
      let v = 50 - len;
      if (kind === 'repair') v += Math.trunc((this.maxStrength(t) - t.group) / 2);
      else if (kind === 'material') v += Math.trunc((refillNeed(this.w, t)?.[1] ?? 0) / 4);
      if (this.fuelRange(u) < len) v -= 30;
      if (v > best) { best = v; who = t; }
    }
    if (!who) return false;
    const doIt = () => {
      const st = this.g.supportTargets(u.id);
      if (kind === 'repair' && st.repair.includes(who!.id)) this.g.repairUnit(u.id, who!.id);
      else if (kind !== 'repair' && st.refill.includes(who!.id)) this.g.refillUnit(u.id, who!.id);
    };
    if (this.dist(here, this.field(who)) === 1) { doIt(); return true; }
    if (!this.g.canMove(u)) return false;
    // best reachable field next to the target
    const tp = this.fxy(this.field(who));
    const reach = this.g.moveArea(u.id).targets;
    let bestF = -1, bestS = 0;
    for (const q of neighbours(tp.x, tp.y, this.s.width, this.s.height)) {
      if (!q) continue;
      const qi = this.w.idx(q.x, q.y);
      if (!reach.has(qi) || !this.free(qi)) continue;
      let sc = 50;
      for (const n of neighbours(q.x, q.y, this.s.width, this.s.height)) {
        const o = n && this.w.unitAt(n.x, n.y);
        if (!o || o.id === u.id) continue;
        sc += this.allied(o.owner) ? 1 : -20;
      }
      if (sc > bestS) { bestS = sc; bestF = qi; }
    }
    if (bestF >= 0) { if (this.move(u, bestF) && u.alive) doIt(); return true; }
    const step = this.stepTowards(u, this.field(who), 3);
    return step >= 0 && this.move(u, step);
  }

  /** Phase 13 (FUN_0041aca2). */
  private shopRepair(u: UnitState): boolean {
    if (u.container?.kind !== 'shop' || (u.flags & UnitFlag.ENTERED) || !this.weak(u, 2)) return false;
    return this.g.repairInShop(u.id).ok;
  }

  /** Phase 14 (FUN_0041ab6b). */
  private shopRefill(u: UnitState): boolean {
    if (u.container?.kind !== 'shop' || (u.flags & UnitFlag.ENTERED)) return false;
    const c = this.cls(u);
    const ammo = c.weapons.some((wp, i) => ((wp.rawTargets >>> 0) & 0xf) === 0 && wp.ammo > (u.ammo[i] ?? 0));
    if (!(u.fuel < c.fuel / 2 || ammo)) return false;
    return this.g.refuelInShop(u.id).ok;
  }

  /** Phase 15 (FUN_0041adc4): leave buildings and transporters. */
  private moveOut(u: UnitState): boolean {
    if (!u.container || (u.flags & UnitFlag.ENTERED) || this.weak(u, 1) || (this.cls(u).flags & UCF.CRYSTAL)) return false;
    if (!this.g.canMove(u)) return false;
    const home = this.field(u);
    let best = -1, field = -1;
    for (const f of this.g.moveArea(u.id).targets.keys()) {
      const p = this.fxy(f);
      if (!this.w.playable(p.x, p.y)) continue;
      let v = -1;
      const sh = this.s.shopAt[f];
      if (sh >= 0) {
        if ((this.cls(u).flags & UCF.OCCUPY) && !this.allied(this.s.shops[sh].owner)) v = 200;
      } else if (this.s.unitAt[f] < 0) {
        v = 100 - this.dist(f, home);
        for (const q of neighbours(p.x, p.y, this.s.width, this.s.height)) {
          const o = q && this.w.unitAt(q.x, q.y);
          if (!o || this.allied(o.owner)) continue;
          v += (this.cls(o).flags & UCF.OCCUPY) ? 5 : -3;
        }
      }
      if (v > best) { best = v; field = f; }
    }
    return field >= 0 && this.move(u, field);
  }

  // ------------------------------------------------------------------ production (phase 16, FUN_0041b290)
  /** Own production buildings, most material and threat first. */
  private productionOrder(): number[] {
    return this.s.shops.filter((sh) => sh.owner === this.p && (shopFunction(sh) & SF.PRODUCTION))
      .map((sh) => ({ id: sh.id, v: sh.material + this.threat(sh) })).sort((a, b) => b.v - a.v).map((x) => x.id);
  }
  private shopQueue: number[] = [];

  /** FUN_0041b18b: share of enemy units within 12 fields × 200. */
  private threat(sh: { x: number; y: number }) {
    const f = this.w.idx(sh.x, sh.y);
    let enemy = 0, own = 0;
    for (const u of this.s.units) {
      if (!u.alive || this.dist(f, this.field(u)) > 12) continue;
      if (u.owner === this.p) own++; else if (!this.allied(u.owner)) enemy++;
    }
    return enemy + own ? Math.trunc((enemy * 200) / (enemy + own)) : 0;
  }

  /** Plans the production of the buildings in turn (one building per call). */
  private plan(): boolean {
    while (this.shopQueue.length) {
      const id = this.shopQueue.shift()!;
      const sh = this.s.shops[id];
      const energy = this.s.players[this.p].energy;
      if (energy <= 24 || sh.material <= 24) continue;
      const prod = this.g.producible(id);
      const free = 16 - sh.units.length;
      if (!prod.length || free <= 0) continue;
      const r = 3 + Math.floor(nextRandom(this.s) * 3);
      const n = Math.min(free, r);
      const limit = PRODUCTION_LIMIT.map((l, t) => (l < 0 ? 1e9 : l - this.units().filter((u) => u.type === t).length));
      let e = energy - 10, m = sh.material - 10;
      const types: number[] = [];
      while (types.length < n) {
        const t = this.chooseType(prod, limit);
        if (t < 0) break;
        const c = this.g.data.unitClasses[t];
        if (c.costEnergy > e || c.costMaterial > m) break;
        types.push(t);
        limit[t]--;
        e -= c.costEnergy; m -= c.costMaterial;
      }
      if (types.length) { this.produceQueue = { shop: id, types }; return this.produceNext(); }
    }
    return false;
  }

  private produceNext(): boolean {
    const q = this.produceQueue;
    if (!q) return false;
    const t = q.types.shift();
    if (t === undefined) { this.produceQueue = null; return this.plan(); }
    this.g.produce(q.shop, t);
    return true;
  }

  /** FUN_0041bf8e. */
  private chooseType(list: number[], limit: number[]): number {
    const has = (t: number) => list.includes(t);
    const f = this.strategy;
    if ((f & 8) && has(0x13)) { this.strategy &= ~8; return 0x13; }
    if ((f & 0x10) && has(0x12)) { this.strategy &= ~0x10; return 0x12; }
    if ((f & 0x80) && has(6)) { this.strategy &= ~0x80; return 6; }
    const group = (types: number[]) => {
      let pick = -1;
      for (const t of types) if (has(t)) pick = t;
      return pick >= 0 && limit[pick] > 0 ? pick : -1;
    };
    if (f & 1) { const t = group((f & 0x40) ? [0x25, 0x20, 0x24, 0x21, 0x15, 0x34] : [0x34, 0x15, 0x21, 0x24, 0x20, 0x25]); if (t >= 0) return t; }
    if (f & 2) { const t = group((f & 0x40) ? [3, 0x10, 6] : [6, 0x10, 3]); if (t >= 0) return t; }
    if (f & 0x20) { const t = group((f & 0x40) ? [0x2a, 0x31, 0x30, 0x2f, 0x32] : [0x2a, 0x32, 0x2f, 0x30, 0x31]); if (t >= 0) return t; }
    const cls = this.g.data.unitClasses;
    for (const kind of [0, 1, 2]) {
      for (let t = 63; t >= 0; t--) {
        const fl = (cls[t]?.flags ?? 0) >>> 0;
        const ok = kind === 0 ? (fl & 0x80000000) !== 0 : kind === 1 ? (fl & 0x800000) !== 0 : (fl & 0x80800000) === 0;
        if (ok && limit[t] > 0 && has(t)) return t;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) if (limit[list[i]] > 0) return list[i];
    return -1;
  }
}
