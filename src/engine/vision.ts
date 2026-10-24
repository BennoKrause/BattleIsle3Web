// Vision, reconstructed from SDI_1C.EXE FUN_00439b3b (per player), FUN_0043d03d (per viewer),
// FUN_0043d8a6 (radar jamming), FUN_0043d3a3 (threshold search, same model as movement).
import { World } from './world.ts';
import { RF } from './rules.ts';
import { neighbour } from './hex.ts';
import { NEUTRAL } from './state.ts';

const STEP = 8;

/** Jamming cost per field as seen by `player` (enemy jammers only). */
function jammingMap(w: World, player: number): Map<number, number> {
  const jam = new Map<number, number>();
  const full = (w.state.ruleFlags & RF.JAM_FULL) !== 0;
  const add = (w.state.ruleFlags & RF.JAM_ADD) !== 0;
  const allies = w.allies(player);
  for (const u of w.unitsOnMap()) {
    if (u.owner < NEUTRAL && (allies & (1 << u.owner))) continue;
    const sb = w.cls(u).sightBlock;
    if (sb <= 0) continue;
    const v = full ? sb : sb >> 1;
    for (const p of w.neighbours(u.x, u.y)) {
      if (!p) continue;
      const i = w.idx(p.x, p.y);
      const cur = jam.get(i) ?? 0;
      if (cur < v) jam.set(i, add ? cur + v : v);
    }
  }
  return jam;
}

/** Fields seen from (x, y) with sight `sight` (1/8 fields) for `player` (FUN_0043d03d). */
export function viewFrom(w: World, x: number, y: number, sight: number, jam: Map<number, number>): number[] {
  const W = w.width;
  let budget = Math.max(sight, STEP);
  const start = w.idx(x, y);
  // candidates: every field within budget/8 steps
  const radius = Math.min(64, Math.trunc(budget / STEP));
  const cost = new Map<number, number>();
  let frontier = [start];
  cost.set(start, 0);
  const tableB = w.state.terrainTables.sight;
  for (let s = 0; s < radius; s++) {
    const next: number[] = [];
    for (const f of frontier) for (let d = 0; d < 6; d++) {
      const n = neighbour(f % W, Math.trunc(f / W), d);
      if (!w.inside(n.x, n.y)) continue;
      const ni = w.idx(n.x, n.y);
      if (cost.has(ni)) continue;
      const g = w.data.terrain[w.state.terrain[ni]]?.typeMask ?? 0;
      const oi = w.state.overlay[ni];
      const o = oi >= 0 ? w.data.terrain[oi]?.typeMask ?? 0 : 0;
      cost.set(ni, (jam.get(ni) ?? 0) + tableB[World.lowestBit(g)] + tableB[World.lowestBit(o)]);
      next.push(ni);
    }
    frontier = next;
  }
  if (w.state.ruleFlags & RF.ADJACENT_VISIBLE) {
    for (const p of w.neighbours(x, y)) if (p) cost.set(w.idx(p.x, p.y), 0);
  }
  const seen = [start];
  const reached = new Set([start]);
  frontier = [start];
  const rounds = Math.min(32, Math.trunc(budget / STEP));
  for (let step = 0; step < rounds && frontier.length; step++) {
    const next: number[] = [];
    for (const f of frontier) for (let d = 0; d < 6; d++) {
      const n = neighbour(f % W, Math.trunc(f / W), d);
      if (!w.playable(n.x, n.y)) continue;
      const ni = w.idx(n.x, n.y);
      if (reached.has(ni) || !cost.has(ni)) continue;
      if (budget - (cost.get(ni) ?? 0) < 0) continue;
      reached.add(ni);
      seen.push(ni);
      next.push(ni);
    }
    frontier = next;
    budget -= STEP;
  }
  return seen;
}

/** Recomputes the watched fields of one player and extends the explored fields (FUN_00439b3b). */
export function updateVision(w: World, player: number) {
  const s = w.state;
  const bit = 1 << player;
  for (let i = 0; i < s.vision.length; i++) s.vision[i] &= ~bit;
  const mark = (fields: number[]) => {
    for (const f of fields) { s.vision[f] |= bit; s.explored[f] |= bit; }
  };
  if (s.ruleFlags & RF.NO_FOG) {
    mark(s.vision.map((_, i) => i));
    return;
  }
  const jam = jammingMap(w, player);
  const viewers = (owner: number) => owner === player || (owner < NEUTRAL && (s.ruleFlags & 0x400) !== 0 && w.isAllied(player, owner));
  for (const u of w.unitsOnMap()) {
    if (!viewers(u.owner)) continue;
    mark(viewFrom(w, u.x, u.y, w.cls(u).sight, jam));
  }
  for (const shop of s.shops) {
    if (!viewers(shop.owner)) continue;
    let sight = STEP;
    for (const id of shop.units) sight = Math.max(sight, w.cls(s.units[id]).sight);
    mark(viewFrom(w, shop.x, shop.y, sight, jam));
  }
}

export function updateVisionAll(w: World) {
  for (const p of w.state.players) if (p.alive) updateVision(w, p.index);
}

/** Is a unit visible to `player`? Enemy units only on watched fields; submerged enemies only next to own units. */
export function unitVisibleTo(w: World, player: number, unitId: number): boolean {
  const u = w.state.units[unitId];
  if (!u.alive || u.container) return false;
  if (u.owner === player || w.isAllied(player, u.owner)) return true;
  const i = w.idx(u.x, u.y);
  if ((w.state.vision[i] & (1 << player)) === 0) return false;
  if (u.layer === 4 /* submerged */) {
    return w.neighbours(u.x, u.y).some((p) => {
      const o = p && w.unitAt(p.x, p.y);
      return !!o && w.isAllied(player, o.owner);
    });
  }
  return true;
}
