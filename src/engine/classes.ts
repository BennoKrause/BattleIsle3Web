// Unit class flags and terrain bits (values from BattleIsle2020 bi2const.inc; meanings checked
// against the BI3 unit list, e.g. all aircraft carry PLANE, all ships SHIP, PLANUM/REGIO BUILD).
import type { TerrainDef } from '../formats/terraindef.ts';
import type { UnitClassInfo } from '../data/gamedata.ts';

export const UCF = {
  BUILD: 1,
  FORTIFY: 2,
  OCCUPY: 8,
  TRANSPORTER: 16,
  REPAIR: 1024,
  REFUEL: 2048,
  NO_TRAILS: 4096,
  COOLDOWN: 131072, // may not attack in a turn in which it moved (artillery)
  RETREAT: 262144, // may move again after attacking
  REFUEL_AIR: 1048576,
  BAD_DEFENDER: 2097152, // mines
  PLANE: 8388608,
  CLIMB: 16777216,
  DIVE: 33554432,
  RAIL: 268435456,
  CRYSTAL: 1073741824,
  SHIP: 2147483648,
} as const;

export const WT = {
  HIGH_AIR: 1,
  AIR: 2,
  GROUND: 4,
  WATER: 8,
  SUBMERGED: 16,
  STRUCTURE: 32,
  AMMO: 256,
  FUEL: 512,
  MATERIAL: 2048,
} as const;

export const TT = {
  ROAD: 1 << 0,
  PATH: 1 << 1,
  TRENCH: 1 << 2,
  RAIL: 1 << 3,
  OBSTACLE: 1 << 4,
  HILL: 1 << 6,
  MOUNTAIN: 1 << 7,
  SLOPE: 1 << 8,
  FOREST: 1 << 10,
  SHALLOW_WATER: 1 << 16,
  MEDIUM_WATER: 1 << 17,
  DEEP_WATER: 1 << 18,
  BUILDING: 1 << 20,
  BUILDING2: 1 << 21,
  ENTRANCE: 1 << 22,
} as const;
export const TT_WATER = TT.SHALLOW_WATER | TT.MEDIUM_WATER | TT.DEEP_WATER;

/** Flag test that also works for bit 31 (SHIP), which JavaScript bit operators make negative. */
export const has = (flags: number, bit: number) => ((flags & bit) >>> 0) !== 0;

export function isPlane(c: UnitClassInfo) { return (c.flags & UCF.PLANE) !== 0; }
export function isShip(c: UnitClassInfo) { return (c.flags >>> 31) === 1; }
export function isCrystal(c: UnitClassInfo) { return (c.flags & UCF.CRYSTAL) !== 0; }
export function isTransporter(c: UnitClassInfo) { return (c.flags & UCF.TRANSPORTER) !== 0; }

export function terrainMask(defs: TerrainDef[], terrain: number, overlay: number): number {
  let m = defs[terrain]?.typeMask ?? 0;
  if (overlay >= 0) m |= defs[overlay]?.typeMask ?? 0;
  return m;
}
