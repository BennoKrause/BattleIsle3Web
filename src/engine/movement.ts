// Movement area, reconstructed from SDI_1C.EXE:
//   FUN_00443572 (budget), FUN_0043d9a9 (field costs, zones of control), FUN_0043cc50 (candidate
//   fields by terrain), FUN_0043d3a3 (threshold search), FUN_0043e34f (can stop on field),
//   FUN_00436afa (container entry). See docs/research/GAME_RULES.md section 5.
// Model: a field with cost c can be entered in step k if budget - 8*(k-1) - c >= 0
// (costs do not accumulate, every step consumes 8 points).
import type { UnitClassInfo } from '../data/gamedata.ts';
import { World } from './world.ts';
import { RF } from './rules.ts';
import { UCF } from './classes.ts';
import { usableWeapons } from './combat.ts';
import { Layer, NEUTRAL, type ShopState, type UnitState } from './state.ts';
import { neighbour } from './hex.ts';
import { toCombatant } from './combatant.ts';

export const BLOCKED = 20000;
const STEP = 8;

export function isShipClass(c: UnitClassInfo) { return (c.flags >>> 31) === 1; }
export function isPlaneClass(c: UnitClassInfo) { return (c.flags & UCF.PLANE) !== 0; }
export function isRailClass(c: UnitClassInfo) { return (c.flags & UCF.RAIL) !== 0; }

/** Movement budget in fields (FUN_00443572). */
export function moveBudgetFields(w: World, u: UnitState): number {
  const c = w.cls(u);
  const byRange = c.moveRange >> 3;
  const byFuel = c.fuelUsage < 1 ? u.fuel : Math.trunc(u.fuel / c.fuelUsage);
  return Math.min(byRange, byFuel);
}

/** FUN_00436afa for buildings: slot index or -1 (capture = foreign building entered by an occupying unit). */
export function shopEntrySlot(w: World, shop: ShopState, u: UnitState): number {
  const c = w.cls(u);
  let capture = false;
  if (shop.owner !== u.owner) {
    if (!(c.flags & UCF.OCCUPY)) return -1;
    capture = true;
  }
  if ((shop.type & c.shopMask) === 0) return -1;
  const free = shop.units.length < 16 ? shop.units.length : -1;
  return free === -1 && capture ? 0 : free;
}

/** FUN_00436afa for transporters: true if `carrier` can take `u` aboard. */
export function canLoad(w: World, carrier: UnitState, u: UnitState): boolean {
  const cc = w.cls(carrier), uc = w.cls(u);
  if (!(cc.flags & UCF.TRANSPORTER) || carrier.id === u.id) return false;
  if (carrier.owner !== u.owner && !((cc.flags >>> 26) & 1)) return false;
  const weight = carrier.cargo.reduce((s, id) => s + w.cls(w.state.units[id]).weight, 0);
  if (cc.transportVolume < uc.weight + weight) return false;
  if ((cc.transportMask & uc.transportClass) === 0) return false;
  return carrier.cargo.length < 8;
}

/** Terrain admission of a field for a unit class (FUN_0043cc50). */
function terrainAllows(w: World, c: UnitClassInfo, x: number, y: number): boolean {
  const mask = c.terrainMask >>> 0;
  const ground = w.groundMask(x, y);
  let blocked = (mask & ground) === 0;
  const ov = w.overlayMask(x, y);
  if (ov >= 0 && !isShipClass(c)) {
    if ((ov & 8) && isRailClass(c)) blocked = false;
    else if ((ov & 3) && !isRailClass(c)) blocked = false;
    else blocked = (mask & ov) === 0;
  }
  return !blocked;
}

function containerEnterable(w: World, u: UnitState, x: number, y: number): boolean {
  const other = w.unitAt(x, y);
  if (other && other.id !== u.id && canLoad(w, other, u)) return true;
  const shop = w.shopAt(x, y);
  return !!shop && shopEntrySlot(w, shop, u) >= 0;
}

/** FUN_0043e34f: may the unit end its move on this field? */
export function canStopOn(w: World, u: UnitState, x: number, y: number): boolean {
  const other = w.unitAt(x, y);
  const shop = w.shopAt(x, y);
  if (!other) return shop ? shopEntrySlot(w, shop, u) >= 0 : true;
  if (other.id === u.id) return false;
  // own transporter that can take the unit (not while submerged/high)
  if (canLoad(w, other, u) && other.layer !== Layer.SUBMERGED && other.layer !== Layer.HIGH_AIR) return true;
  // picking up crystals / mines with a suitable transporter on the ground
  const uc = w.cls(u), oc = w.cls(other);
  if ((uc.flags & 0x110) && (oc.stealthMask2 & uc.stealthMask) && u.layer !== Layer.SUBMERGED && u.layer !== Layer.HIGH_AIR
    && (other.owner === NEUTRAL || other.owner === u.owner || ((uc.flags >>> 26) & 1)) && canLoad(w, u, other)) return true;
  return false;
}

export interface MoveArea {
  /** field index -> step count; contains only fields the unit may end its move on. */
  targets: Map<number, number>;
  /** field index -> predecessor field index (search tree, for the move path). */
  parent: Map<number, number>;
  budget: number;
  /** All fields reached by the search, including those the unit may not stop on. */
  reached?: Set<number>;
}

/** `fields` replaces the unit's own range (computer player: search area of 64 fields, FUN_0042f260). */
export function computeMoveArea(w: World, u: UnitState, opts: { retreat?: boolean; fields?: number } = {}): MoveArea {
  const c = w.cls(u);
  const empty: MoveArea = { targets: new Map(), parent: new Map(), budget: 0 };
  if (!u.alive) return empty;
  let budgetFields = opts.fields ?? moveBudgetFields(w, u);
  if (opts.retreat) budgetFields -= u.moved; // second move after an attack (FUN_00443572, unit flag 0x400)
  if (budgetFields < 1) return empty;
  let points = opts.fields !== undefined ? budgetFields << 3 : Math.min(budgetFields << 3, c.moveRange);
  if (points < STEP) points = STEP;
  const W = w.width;
  const start = w.idx(u.x, u.y);
  const player = u.owner;
  const plane = isPlaneClass(c);
  const lowFlying = u.layer !== Layer.HIGH_AIR;

  // 1. candidates (FUN_0043cc50): breadth-first over admissible fields up to points/8 steps
  const candidate = new Set<number>([start]);
  let frontier = [start];
  for (let s = Math.min(64, points >> 3); s > 0 && frontier.length; s--) {
    const next: number[] = [];
    for (const f of frontier) {
      for (let d = 0; d < 6; d++) {
        const n = neighbour(f % W, Math.trunc(f / W), d);
        if (!w.inside(n.x, n.y)) continue;
        const ni = w.idx(n.x, n.y);
        if (candidate.has(ni)) continue;
        if (!containerEnterable(w, u, n.x, n.y) && !terrainAllows(w, c, n.x, n.y)) continue;
        candidate.add(ni);
        next.push(ni);
      }
    }
    frontier = next;
  }

  // 2. field costs (FUN_0043d9a9)
  const cost = new Map<number, number>();
  const tableA = w.state.terrainTables.move;
  const explored = w.state.explored;
  const bit = 1 << player;
  for (const f of candidate) {
    const x = f % W, y = Math.trunc(f / W);
    if (!w.playable(x, y) || (explored[f] & bit) === 0) { cost.set(f, BLOCKED); continue; }
    const gi = w.state.terrain[f];
    const g = w.data.terrain[gi];
    let k = tableA[World.lowestBit(g?.typeMask ?? 0)];
    if (plane && g?.highObstacle === 1 && lowFlying) k = BLOCKED;
    const oi = w.state.overlay[f];
    if (oi >= 0 && k < BLOCKED) {
      const o = w.data.terrain[oi];
      const ok = tableA[World.lowestBit(o?.typeMask ?? 0)];
      if (!plane) k += (o?.typeMask ?? 0) & 0xb ? ok >>> 1 : ok;
      else if (o?.highObstacle === 1 && lowFlying) k = BLOCKED;
    }
    cost.set(f, k);
  }
  const adjacentEight = () => {
    if (!(w.state.ruleFlags & RF.ADJACENT_MOVE)) return;
    for (const p of w.neighbours(u.x, u.y)) {
      if (p && w.state.unitAt[w.idx(p.x, p.y)] === -1 && cost.has(w.idx(p.x, p.y))) cost.set(w.idx(p.x, p.y), STEP);
    }
  };
  adjacentEight();
  // buildings that cannot be entered
  for (const f of candidate) {
    const s = w.state.shopAt[f];
    if (s >= 0 && shopEntrySlot(w, w.state.shops[s], u) < 0) cost.set(f, BLOCKED);
  }
  // zones of control (FUN_0043e185)
  const me = toCombatant(w, u);
  for (const f of candidate) {
    const e = w.state.unitAt[f];
    if (e < 0) continue;
    const enemy = w.state.units[e];
    if (enemy.owner === player || w.isAllied(player, enemy.owner)) continue;
    const ec = w.cls(enemy);
    if (((c.flags >>> 26) & 1) && (c.stealthMask & ec.stealthMask2)) continue;
    if (!(w.state.ruleFlags & RF.ZOC_ALL_ENEMIES) && usableWeapons(toCombatant(w, enemy), me, false) === 0) continue;
    applyZoc(w, u.x, u.y, enemy.x, enemy.y, cost);
    adjacentEight();
  }

  // 3. threshold search (FUN_0043d3a3)
  const reached = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  frontier = [start];
  let remaining = points;
  for (let step = 1; step <= Math.min(32, Math.trunc(points / STEP)) && frontier.length; step++) {
    const next: number[] = [];
    for (const f of frontier) {
      for (let d = 0; d < 6; d++) {
        const n = neighbour(f % W, Math.trunc(f / W), d);
        if (!w.playable(n.x, n.y)) continue;
        const ni = w.idx(n.x, n.y);
        if (reached.has(ni) || !candidate.has(ni)) continue;
        if (remaining - (cost.get(ni) ?? BLOCKED) < 0) continue;
        reached.set(ni, step);
        parent.set(ni, f);
        next.push(ni);
      }
    }
    frontier = next;
    remaining -= STEP;
  }

  // 4. keep fields the unit may stop on
  const targets = new Map<number, number>();
  for (const [f, steps] of reached) {
    if (f === start) continue;
    if (canStopOn(w, u, f % W, Math.trunc(f / W))) targets.set(f, steps);
  }
  return { targets, parent, budget: points, reached: new Set(reached.keys()) };
}

/** FUN_0043e185: +6 on the two neighbours of the enemy facing the mover, +16 on the others, enemy field blocked. */
function applyZoc(w: World, mx: number, my: number, ex: number, ey: number, cost: Map<number, number>) {
  const vertical = my < ey ? 0 : 3; // mover above the enemy -> the north side faces it
  let diagonal: number;
  if (ex < mx) diagonal = ey < my ? 2 : 1;
  else diagonal = ey < my ? 4 : 5;
  const around = w.neighbours(ex, ey);
  around.forEach((p, d) => {
    if (!p) return;
    const i = w.idx(p.x, p.y);
    if (!cost.has(i)) return;
    cost.set(i, (cost.get(i) ?? 0) + (d === vertical || d === diagonal ? 6 : 16));
  });
  cost.set(w.idx(ex, ey), BLOCKED);
}

/** Field path from the unit to the target (inclusive), using the search tree. */
export function pathTo(area: MoveArea, w: World, u: UnitState, target: number): number[] {
  const path = [target];
  let f = target;
  const start = w.idx(u.x, u.y);
  while (f !== start) {
    const p = area.parent.get(f);
    if (p === undefined) return [];
    path.push(p);
    f = p;
  }
  return path.reverse();
}
