// Unit-versus-unit combat, reconstructed from the original program (SDI_1C.EXE):
// FUN_0042342f (control), FUN_00415630 (context), FUN_0044aed0 (calculation),
// FUN_0044bd4b (losses), FUN_00440419 (weapon usability), FUN_00440618 (weapon choice).
// See docs/research/GAME_RULES.md section 4 for the derivation.
import type { UnitClassInfo } from '../data/gamedata.ts';
import { distance, neighbours } from './hex.ts';
import { Layer } from './state.ts';

/** Combat flag bits (0x4c8ada): a set bit disables the step. */
export const CF = {
  NO_SURROUND: 0x0001,
  NO_RANDOM: 0x0002,
  NO_RANGE: 0x0004,
  NO_XP_ATTACKER: 0x0010,
  NO_XP_DEFENDER: 0x0020,
  NO_BONUS: 0x0080,
  NO_TERRAIN: 0x0400,
  NO_FIRST_STRIKE: 0x0800,
  /** Set on every difficulty level: all units on the neighbouring fields count for flanking, without the weapon
   *  usability test (FUN_00440419) that the original applies to the neighbours when this bit is clear (SDI_1C.EXE 0x415630). */
  ALL_NEIGHBOURS: 0x1000,
} as const;

/** 0x4c8b08: ΔF_att, ΔP_att, ΔF_def, ΔP_def, pattern[6] (relative to the attacker position), count. */
export const SURROUND_PATTERNS: readonly (readonly number[])[] = [
  [100, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [30, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [30, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
  [10, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [10, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [0, 0, 0, 10, 0, -1, 0, 0, 0, 0, 1],
  [0, 0, 0, 10, 0, 0, 0, 0, 0, -1, 1],
];

/** 0x4c8bb8: experience factor table, index 11 + (own xp - enemy xp). */
export const XP_TABLE = [20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59, 62, 65, 68, 70, 72, 74, 76, 78, 80];

/** Original percentage helper FUN_0044bcfe. */
export function pct(v: number, p: number): number {
  const scaled = Math.trunc((v << 8) / 100);
  return ((p * scaled + 0x80) >> 8) << 16 >> 16;
}

/** FUN_0044bd4b: losses inflicted by nAtt units with firepower f on nDef units with armour a. */
export function losses(nAtt: number, f: number, nDef: number, a: number): number {
  if (nAtt < 0) nAtt = 0;
  if (nDef < 0) nDef = 0;
  const reduced = f - pct(f, 30);
  let den = a * nDef;
  if (den < 1) den = 1;
  const v = nDef * Math.trunc((nAtt * reduced * 256) / den);
  return v >> 8 > 0 ? (v >> 8) << 16 >> 16 : 0;
}

/** Target layer bit of the original weapon target mask (FUN_00440419). */
export function layerTargetBit(layer: number): number {
  switch (layer) {
    case Layer.HIGH_AIR: return 0x10;
    case Layer.AIR: return 0x20;
    case Layer.WATER: return 0x80;
    case Layer.SUBMERGED: return 0x100;
    default: return 0x40;
  }
}

export interface Combatant {
  cls: UnitClassInfo;
  group: number;
  experience: number;
  layer: number;
  ammo: number[];
  x: number;
  y: number;
  /** Owner bit mask of the unit (bit = player index). */
  ownerMask: number;
}

/** Weapon mask usable by `a` against `d` (FUN_00440419 with checkAmmo = 1). */
export function usableWeapons(a: Combatant, d: Combatant, checkAmmo = true): number {
  let mask = 0;
  const layerBit = layerTargetBit(d.layer);
  a.cls.weapons.forEach((w, i) => {
    const raw = w.rawTargets >>> 0;
    if (w.damage <= 0 || (raw & 0xf) !== 0) return;
    if (checkAmmo && a.ammo[i] <= 0) return;
    if ((layerBit & raw) !== 0 && ((d.cls.categoryMask >>> 0) & 0xfffff800 & raw) !== 0) mask |= 1 << i;
  });
  return mask;
}

/** FUN_00440618: weapon with the highest damage among the mask (needs class ammo > 0). */
export function bestWeapon(cls: UnitClassInfo, mask: number): number {
  let best = -1, dmg = -1;
  cls.weapons.forEach((w, i) => {
    if ((mask & (1 << i)) && w.ammo > 0 && dmg < w.damage) { dmg = w.damage; best = i; }
  });
  return best;
}

export interface CombatTerrain {
  /** Terrain bit (lowest set bit of the type mask; overlay before ground) of a field. */
  terrainBit(x: number, y: number): number;
  /** Mission tables C (agility %) and D (firepower %), 32 entries each. */
  agility: number[];
  firepower: number[];
}

export interface CombatInput {
  attacker: Combatant;
  attackerWeapon: number;
  defender: Combatant;
  /** -1 = defender cannot fire back. */
  defenderWeapon: number;
  /** Units on the fields around the defender (owner mask or 0 for empty), indexed by direction 0..5. */
  neighbourOwners: number[];
  /** Mask of players allied with the attacker (incl. attacker). */
  attackerAllies: number;
  flags: number;
  terrain: CombatTerrain;
  mapWidth: number;
  mapHeight: number;
  /** Random source returning a signed value in [-32767, 32767]; omitted = no randomness. */
  random?: () => number;
}

export interface SideValues { n: number; f: number; p: number; w: number; xp: number }

export interface CombatResult {
  /** Losses of the defender / attacker. */
  defenderLosses: number;
  attackerLosses: number;
  defenderFiresBack: boolean;
  /** Values after all modifiers (for the combat display). */
  attacker: SideValues;
  defender: SideValues;
  /** Display bars like the original (firepower·armour·strength after each step). */
  bars: { attacker: number[]; defender: number[] };
  distance: number;
}

export function resolveCombat(inp: CombatInput): CombatResult {
  const { attacker: A, defender: D } = inp;
  const dist = distance(A.x, A.y, D.x, D.y);
  const isArt = (c: UnitClassInfo) => ((c.flags >>> 27) & 1) === 1;
  // FUN_0042342f: counter fire needs a weapon, adjacency and a non-artillery defender;
  // a submerged attacker cannot be answered by a non-submerged defender.
  const adjacent = neighbours(D.x, D.y, inp.mapWidth, inp.mapHeight).some((p) => p && p.x === A.x && p.y === A.y);
  const fires = inp.defenderWeapon >= 0 && adjacent && !isArt(D.cls)
    && !(A.layer === Layer.SUBMERGED && D.layer !== Layer.SUBMERGED);

  const a: SideValues = {
    n: A.group, xp: A.experience, p: A.cls.armor, w: A.cls.attack,
    f: A.cls.weapons[inp.attackerWeapon]?.damage ?? 0,
  };
  const d: SideValues = {
    n: D.group, xp: D.experience, p: D.cls.armor, w: D.cls.attack,
    f: fires ? D.cls.weapons[inp.defenderWeapon].damage : 0,
  };
  let flags = inp.flags;
  if ((A.cls.flags & 0x800000) !== 0) flags |= CF.NO_TERRAIN; // attacking aircraft ignore terrain
  const bars = { attacker: [] as number[], defender: [] as number[] };
  const snap = (na: number, nd: number) => {
    if (bars.attacker.length < 8) { bars.attacker.push(a.f * a.p * na); bars.defender.push(d.f * d.p * nd); }
  };

  snap(a.n, d.n);
  // 1. bonus: values are 0 except with a cheat flag -> no effect
  snap(a.n, d.n);
  // 2. terrain
  if (!(flags & CF.NO_TERRAIN)) {
    for (const [side, unit] of [[a, A], [d, D]] as const) {
      const bit = inp.terrain.terrainBit(unit.x, unit.y);
      side.w += pct(side.w, inp.terrain.agility[bit] ?? 0);
      side.f += pct(side.f, inp.terrain.firepower[bit] ?? 0);
    }
  }
  snap(a.n, d.n);
  // 3. surrounding (Klemmen / Blocken)
  if (!(flags & CF.NO_SURROUND) && dist < 2) {
    const around = neighbours(D.x, D.y, inp.mapWidth, inp.mapHeight);
    const attackerDir = Math.max(0, around.findIndex((p) => p && p.x === A.x && p.y === A.y));
    const side = inp.neighbourOwners.map((m) => (m === 0 ? 0 : m & inp.attackerAllies ? 1 : -1));
    let dFa = 0, dPa = 0, dFd = 0, dPd = 0;
    for (const pat of SURROUND_PATTERNS) {
      let hits = 0;
      for (let k = 0; k < 6; k++) {
        const want = pat[4 + k];
        if (want !== 0 && side[(attackerDir + k) % 6] === want) hits++;
      }
      if (hits === pat[10]) { dFa += pat[0]; dPa += pat[1]; dFd += pat[2]; dPd += pat[3]; }
    }
    a.f += pct(a.f, dFa); a.p += pct(a.p, dPa);
    d.f += pct(d.f, dFd); d.p += pct(d.p, dPd);
  }
  snap(a.n, d.n);
  // 4. range penalty (expert only)
  if (!(flags & CF.NO_RANGE)) {
    const w = A.cls.weapons[inp.attackerWeapon];
    if (w && (((w.rawTargets >>> 16) & 9) !== 0) && w.maxRange !== w.minRange) {
      let q = Math.trunc(((dist - w.minRange) * 100) / (w.maxRange - w.minRange));
      q = Math.trunc(q / 3);
      q = Math.max(0, Math.min(30, q));
      a.f -= Math.trunc((a.f * q) / 100);
    }
  }
  snap(a.n, d.n);

  // 5. result
  let first = 0;
  if (!(flags & CF.NO_FIRST_STRIKE) && a.w > 0) {
    // Faithful to the original (divisor is the attacker's own agility); disabled on all difficulty levels.
    const div = d.w < 1 ? 1 : a.w;
    let r = Math.trunc((a.w << 8) / div) >> 8;
    let pre = losses(a.n, a.f, d.n, d.p);
    if (!(flags & CF.NO_XP_ATTACKER)) pre = pct(r, XP_TABLE[a.xp] ?? 0);
    if (pre < r) r = pre;
    first = r;
  }
  snap(a.n, d.n - first);
  let lD = losses(a.n, a.f, d.n, d.p);
  let lA = losses(d.n - first, d.f, a.n, a.p);
  const xpIdx = (own: number, other: number) => Math.max(0, Math.min(22, 11 + own - other));
  if (!(flags & CF.NO_XP_ATTACKER)) lD = pct(lD, pct(XP_TABLE[xpIdx(a.xp, d.xp)], Math.trunc((a.xp * 100) / 22) + 50));
  if (!(flags & CF.NO_XP_DEFENDER)) lA = pct(lA, pct(XP_TABLE[xpIdx(d.xp, a.xp)], Math.trunc((d.xp * 100) / 22) + 50));
  if (lD > d.n) lD = d.n;
  if (lA > a.n) lA = a.n;
  if (!(flags & CF.NO_RANDOM) && inp.random) {
    lD += Math.trunc(inp.random() / 32767);
    lA += Math.trunc(inp.random() / 32767);
  }
  if (lD < 1) lD = 0;
  if (!(lA > 0 && !isArt(D.cls)) || !fires) lA = 0;
  snap(a.n - lA, d.n - lD);
  return { defenderLosses: lD, attackerLosses: lA, defenderFiresBack: fires, attacker: a, defender: d, bars, distance: dist };
}
