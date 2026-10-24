// Supply, repair, construction and height changes (SDI_1C.EXE game functions 0x08, 0x1b, 0x30, 0x39, 0x3a, 0x3f-0x42,
// helpers FUN_004409de, FUN_00440b30, FUN_00440d99, FUN_004412c6, FUN_00441389, FUN_0044156d, FUN_0041f2d6, FUN_00424c13).
//
// Supply vehicles carry their stock in weapon slots whose raw target bits 0..3 are set: bits 1|2 (mask 6) hold energy
// (fuel), bits 0|3 (mask 9) hold material (ammunition, spare parts). Slot bit 3 (8) is also the building material of
// construction vehicles. One stock point equals 100 points of fuel or ammunition of the supplied unit.
import type { UnitClassInfo } from '../data/gamedata.ts';
import { UCF } from './classes.ts';
import { Layer, type UnitState } from './state.ts';
import type { World } from './world.ts';

const STORE = 0xf;
const STORE_ENERGY = 6;
const STORE_MATERIAL = 9;
/** Raw target bits of real weapons (target categories), refilled with material. */
const COMBAT_AMMO = 0xff800;
/** Class flag 0x10000: may demolish roads, rails and trenches. */
export const UCF_DEMOLISH = 0x10000;
/** Class flags 1/2/4: builds roads / trenches / rails (FUN_00445b9b). */
const BUILDS_ROAD = 1, BUILDS_TRENCH = 2, BUILDS_RAIL = 4;

/** Height of a unit as the original stores it: +1 high altitude, -1 submerged, 0 otherwise. */
export function heightOf(u: UnitState) { return u.layer === Layer.HIGH_AIR ? 1 : u.layer === Layer.SUBMERGED ? -1 : 0; }

const isPlane = (c: UnitClassInfo) => (c.flags & UCF.PLANE) !== 0;
const slotBits = (c: UnitClassInfo, i: number) => (c.weapons[i]?.rawTargets ?? 0) >>> 0;
const maxAmmo = (c: UnitClassInfo, i: number) => c.weapons[i]?.ammo ?? 0;

/** Energy and material a unit needs to be filled up (FUN_004409de): [energy, material] in fuel/ammo points; null = nothing. */
export function refillNeed(w: World, u: UnitState): [number, number] | null {
  const c = w.cls(u);
  let energy = 0, material = 0, any = false;
  for (let i = 0; i < 4; i++) {
    const missing = maxAmmo(c, i) - (u.ammo[i] ?? 0);
    if (missing <= 0) continue;
    any = true;
    const b = slotBits(c, i) & 0xff;
    if (b & STORE_MATERIAL) material += missing;
    else if (b & STORE_ENERGY) energy += missing;
    else material += missing;
  }
  if (c.fuel - u.fuel > 0) { energy += c.fuel - u.fuel; any = true; }
  return any ? [energy, material] : null;
}

/** Missing strength (FUN_004412c6). */
export function repairNeed(w: World, u: UnitState) { return Math.max(0, w.maxGroup(w.cls(u)) - u.group); }

/** Can `s` refill `t` in the field (FUN_00440b30)? */
export function canRefill(w: World, s: UnitState, t: UnitState): boolean {
  const sc = w.cls(s), tc = w.cls(t);
  if (!(sc.flags & UCF.REFUEL)) return false;
  if (isPlane(tc) && !(sc.flags & UCF.REFUEL_AIR)) return false;
  if (isPlane(sc) && !isPlane(tc)) return false;
  if (s.owner !== t.owner || heightOf(s) !== heightOf(t)) return false;
  for (let i = 0; i < 4; i++) {
    const store = slotBits(sc, i);
    if (!(store & STORE) || (s.ammo[i] ?? 0) <= 0) continue;
    for (let k = 0; k < 4; k++) {
      if ((t.ammo[k] ?? 0) >= maxAmmo(tc, k)) continue;
      const need = slotBits(tc, k);
      if ((store & STORE_MATERIAL) && (need & 0xff809)) return true;
      if ((store & STORE_ENERGY) && (need & STORE_ENERGY)) return true;
    }
    if ((store & STORE_ENERGY) && t.fuel < tc.fuel) return true;
  }
  return false;
}

/** Can `s` repair `t` in the field (FUN_00441389)? Needs a repair vehicle with both energy and material in stock. */
export function canRepair(w: World, s: UnitState, t: UnitState): boolean {
  const sc = w.cls(s), tc = w.cls(t);
  if (!(sc.flags & UCF.REPAIR) || isPlane(tc) || isPlane(sc)) return false;
  if (s.owner !== t.owner || heightOf(s) !== heightOf(t)) return false;
  // a stocked material slot and a stocked energy slot
  let kinds = 0;
  for (let i = 0; i < 4; i++) {
    const b = slotBits(sc, i);
    if (!(b & STORE) || (s.ammo[i] ?? 0) <= 0) continue;
    if (b & STORE_MATERIAL) kinds |= 1;
    if (b & STORE_ENERGY) kinds |= 2;
  }
  return kinds === 3;
}

/**
 * Fills fuel and ammunition of `u` from the resources [energy, material] (FUN_00440d99). One resource point is worth
 * 100 fuel / ammunition points. Returns the resources used ([energy, material], at least 1 each when anything was filled)
 * or null when nothing was filled.
 */
export function refillFrom(w: World, u: UnitState, energy: number, material: number): [number, number] | null {
  const c = w.cls(u);
  let e = energy * 100, m = material * 100;
  let usedE = 0, usedM = 0;
  const fuelNeed = c.fuel - u.fuel;
  if (fuelNeed > 0) {
    const f = Math.min(fuelNeed, e);
    u.fuel += f; e -= f; usedE += f;
  }
  // combat ammunition from material, one point per weapon in turn
  const fill = (match: (bits: number) => boolean, amount: number) => {
    let left = amount;
    for (let changed = true; left > 0 && changed;) {
      changed = false;
      for (let i = 0; i < 4 && left > 0; i++) {
        if (match(slotBits(c, i)) && maxAmmo(c, i) - (u.ammo[i] ?? 0) > 0) { u.ammo[i] = (u.ammo[i] ?? 0) + 1; left--; changed = true; }
      }
    }
  };
  const missing = (match: (bits: number) => boolean) => {
    let n = 0;
    for (let i = 0; i < 4; i++) if (match(slotBits(c, i))) n += Math.max(0, maxAmmo(c, i) - (u.ammo[i] ?? 0));
    return n;
  };
  const isAmmo = (b: number) => (b & COMBAT_AMMO) !== 0;
  const ammo = Math.min(missing(isAmmo), m);
  m -= ammo; usedM += ammo;
  fill(isAmmo, ammo);
  // stock of another supply vehicle
  const isMat = (b: number) => (b & 0xff & STORE_MATERIAL) !== 0, isEn = (b: number) => (b & 0xff & STORE_ENERGY) !== 0;
  const mat = Math.min(missing(isMat), m), en = Math.min(missing(isEn), e);
  m -= mat; usedM += mat; e -= en; usedE += en;
  fill(isMat, mat);
  fill(isEn, en);
  if (usedE <= 0 && usedM <= 0) return null;
  return [usedE > 0 ? Math.max(1, Math.trunc(usedE / 100)) : 0, usedM > 0 ? Math.max(1, Math.trunc(usedM / 100)) : 0];
}

/** Repairs `u` with the resources [energy, material]: one of each per strength point, costs one experience point (FUN_0044156d). */
export function repairFrom(w: World, u: UnitState, energy: number, material: number): number {
  const n = Math.min(repairNeed(w, u), energy, material);
  if (n <= 0) return 0;
  u.group += n;
  u.experience = Math.max(0, u.experience - 1);
  return n;
}

/** Field refill by a supply vehicle (game function 0x39, FUN_0042522e): every stock slot pays for what it supplies. */
export function refillByUnit(w: World, s: UnitState, t: UnitState): boolean {
  const sc = w.cls(s);
  let done = false;
  for (let i = 0; i < 4; i++) {
    const b = slotBits(sc, i);
    if (!(b & STORE)) continue;
    const stock = s.ammo[i] ?? 0;
    const used = refillFrom(w, t, b & STORE_ENERGY ? stock : 0, b & STORE_MATERIAL ? stock : 0);
    if (!used) continue;
    done = true;
    if (b & STORE_ENERGY) s.ammo[i] = Math.max(0, s.ammo[i] - used[0]);
    if (b & STORE_MATERIAL) s.ammo[i] = Math.max(0, s.ammo[i] - used[1]);
  }
  return done;
}

/** Field repair by a repair vehicle (game function 0x30, FUN_00424ea0). */
export function repairByUnit(w: World, s: UnitState, t: UnitState): number {
  const sc = w.cls(s);
  let energy = 0, material = 0;
  for (let i = 0; i < 4; i++) {
    const b = slotBits(sc, i);
    if (!(b & STORE)) continue;
    if (b & STORE_ENERGY) energy += s.ammo[i] ?? 0;
    else if (b & STORE_MATERIAL) material += s.ammo[i] ?? 0;
  }
  const n = repairFrom(w, t, energy, material);
  if (n > 0) {
    for (let i = 0; i < 4; i++) {
      const b = slotBits(sc, i);
      if (b & STORE) s.ammo[i] = Math.max(0, (s.ammo[i] ?? 0) - Math.min(s.ammo[i] ?? 0, n));
    }
  }
  return n;
}

// ------------------------------------------------------------------ construction
export const Build = { ROAD: 0, RAIL: 1, TRENCH: 2, DEMOLISH: 3 } as const;
const BUILD_TYPE = [1, 8, 4]; // terrain type bits of road, rail, trench

/** Has the vehicle building material (a slot with raw bit 8 and stock)? (FUN_00445986) */
function hasBuildMaterial(w: World, u: UnitState) {
  const c = w.cls(u);
  for (let i = 0; i < 4; i++) if ((slotBits(c, i) & 8) && (u.ammo[i] ?? 0) > 0) return true;
  return false;
}

/**
 * What can be built on a field (FUN_0041f2d6): bit set of Build values. Roads, rails and trenches need the matching
 * property bit (raw byte 2: 2 road, 4 rail, 0x10 trench) of the ground and of an existing overlay; a field that already has
 * the item offers demolition instead.
 */
export function fieldBuildOptions(w: World, x: number, y: number): number {
  const s = w.state, i = w.idx(x, y);
  if (s.unitAt[i] >= 0 || s.shopAt[i] >= 0) return 0;
  const ground = w.data.terrain[s.terrain[i]];
  const prop = ground?.raw[2] ?? 0;
  let road = (prop & 2) !== 0, rail = (prop & 4) !== 0, trench = (prop & 0x10) !== 0, demolish = false;
  const ov = s.overlay[i];
  const om = ov >= 0 ? (w.data.terrain[ov]?.typeMask ?? 0) : 0;
  if (om & 1) { road = false; demolish = true; }
  if (om & 8) { rail = false; demolish = true; }
  if (om & 4) { trench = false; demolish = true; }
  if (ov >= 0) {
    const op = w.data.terrain[ov]?.raw[2] ?? 0;
    if (om & 4) { road = false; rail = false; }
    if (om & 0xb) trench = false;
    if (!(op & 2)) road = false;
    if (!(op & 4)) rail = false;
    if (!(op & 0x10)) trench = false;
  }
  return (road ? 1 << Build.ROAD : 0) | (rail ? 1 << Build.RAIL : 0) | (trench ? 1 << Build.TRENCH : 0) | (demolish ? 1 << Build.DEMOLISH : 0);
}

/** Construction targets of a vehicle on its neighbour fields (FUN_00445b9b): field index -> bit set of Build values. */
export function buildTargets(w: World, u: UnitState, buildMask: number): Map<number, number> {
  const out = new Map<number, number>();
  const c = w.cls(u);
  if (u.container || !(c.flags & (BUILDS_ROAD | BUILDS_TRENCH | BUILDS_RAIL | UCF_DEMOLISH)) || !hasBuildMaterial(w, u)) return out;
  for (const p of w.neighbours(u.x, u.y)) {
    if (!p || !w.playable(p.x, p.y)) continue;
    const opt = fieldBuildOptions(w, p.x, p.y);
    let ok = 0;
    if ((opt & 1 << Build.ROAD) && (buildMask & 1) && (c.flags & BUILDS_ROAD)) ok |= 1 << Build.ROAD;
    if ((opt & 1 << Build.RAIL) && (buildMask & 8) && (c.flags & BUILDS_RAIL)) ok |= 1 << Build.RAIL;
    if ((opt & 1 << Build.TRENCH) && (buildMask & 4) && (c.flags & BUILDS_TRENCH)) ok |= 1 << Build.TRENCH;
    if (opt & 1 << Build.DEMOLISH) {
      const ov = w.state.overlay[w.idx(p.x, p.y)];
      const om = ov >= 0 ? (w.data.terrain[ov]?.typeMask ?? 0) : 0;
      if ((c.flags & UCF_DEMOLISH) && ov >= 0 && !(om & 0x5000c0)) ok |= 1 << Build.DEMOLISH;
    }
    if (ok) out.set(w.idx(p.x, p.y), ok);
  }
  return out;
}

/** Overlay sprite whose type bits are exactly `mask` (FUN_0041f4f4: first match in PART000.DAT). */
export function overlayForMask(w: World, mask: number): number {
  return w.data.terrain.findIndex((t) => (t.typeMask >>> 0) === mask);
}

/** Builds or demolishes on a field (FUN_00424c13); pays one point of building material. */
export function buildOn(w: World, u: UnitState, field: number, what: number): boolean {
  const s = w.state;
  if (what === Build.DEMOLISH) s.overlay[field] = -1;
  else {
    const ov = s.overlay[field];
    const keep = ov >= 0 ? (w.data.terrain[ov]?.typeMask ?? 0) & 0xd : 0;
    const sprite = overlayForMask(w, BUILD_TYPE[what] | keep);
    if (sprite < 0) return false;
    s.overlay[field] = sprite;
  }
  const c = w.cls(u);
  for (let i = 0; i < 4; i++) {
    if ((slotBits(c, i) & 8) && (u.ammo[i] ?? 0) >= 1) { u.ammo[i]--; break; }
  }
  return true;
}

/** Which overlay kinds exist on the map at the start: only those can be built (SDI_1C.EXE sets 0x4c8aa0 = 0x10 | bits). */
export function initialBuildMask(w: World): number {
  let m = 0x10;
  for (const o of w.state.overlay) if (o >= 0) m |= (w.data.terrain[o]?.typeMask ?? 0) & 0xf;
  return m;
}

// ------------------------------------------------------------------ height
/** Climb / surface (up) or descend / dive (down) by one level (FUN_00444dd3 check, FUN_00444ee9 change). */
export function canChangeHeight(w: World, u: UnitState, up: boolean): boolean {
  const f = w.cls(u).flags;
  if (!(f & (UCF.CLIMB | UCF.DIVE))) return false;
  const h = heightOf(u);
  if (up) return h < 0 || (h === 0 && (f & UCF.CLIMB) !== 0);
  return h > 0 || (h === 0 && (f & UCF.DIVE) !== 0);
}

export function changeHeight(u: UnitState, up: boolean) {
  const h = heightOf(u) + (up ? 1 : -1);
  if (u.layer === Layer.AIR || u.layer === Layer.HIGH_AIR) u.layer = h > 0 ? Layer.HIGH_AIR : Layer.AIR;
  else u.layer = h < 0 ? Layer.SUBMERGED : Layer.WATER;
}
