// LIB/UNIT000.DAT: 64 unit classes x 88 bytes. Field offsets from BattleIsle2020 ReadUnitDefs&
// (bi2init.inc, GPLv3), checked against the CD (64 records, plausible values for every class).
// BI2020 clamps/patches a few values (e.g. damage > 999 divided by 10 for UX-2/Vision); this
// parser keeps the raw values so the rules layer can decide.

export interface WeaponDef {
  damage: number;
  minRange: number;
  maxRange: number;
  ammo: number;
  /** Target bits as in BI2020: 1 high air, 2 low air, 4 ground, 8 water, 16 submerged, 32 structures,
   *  256 supplies ammo, 512 supplies fuel, 1024 ?, 2048 repair material. */
  targets: number;
  /** Original bit layout: bits 0-3 supply kind, 4 high air, 5 air, 6 ground, 7 water, 8 submerged,
   *  9 structures, bits >= 11 target categories (matched against UnitClass.categoryMask). */
  rawTargets: number;
}

export interface UnitClass {
  index: number;
  descriptionText: number;
  nameText: number;
  flags: number;
  terrainMask: number;
  /** Target category bits (offset 12): a weapon can hit this class only if its raw target bits >= 0x800 intersect this mask (SDI_1C.EXE FUN_00440419). */
  categoryMask: number;
  /** Hit points: groupSize2 when flag 0x200 is set, else groupSize (SDI_1C.EXE FUN_00418985 et al.). */
  strength: number;
  fuel: number;
  /** Movement range in 1/8 fields. */
  moveRange: number;
  fuelUsage: number;
  costEnergy: number;
  costMaterial: number;
  weapons: WeaponDef[];
  weight: number;
  transportVolume: number;
  groupSize: number;
  groupSize2: number;
  armor: number;
  transportClass: number;
  shopMask: number;
  /** Radar jamming range in 1/8 fields. */
  sightBlock: number;
  /** Sight range in 1/8 fields. */
  sight: number;
  transportMask: number;
  attack: number;
  /** Bytes 78/79: stealth masks (a unit with flag bit 26 ignores the zone of control of enemies with
   *  stealthMask(mover) & stealthMask2(enemy) != 0, SDI_1C.EXE FUN_0043d9a9). */
  stealthMask: number;
  stealthMask2: number;
  raw: Uint8Array;
}

export const UNIT_RECORD_SIZE = 88;

export function parseUnitClasses(data: Uint8Array): UnitClass[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: UnitClass[] = [];
  for (let i = 0; i * UNIT_RECORD_SIZE + UNIT_RECORD_SIZE <= data.length; i++) {
    const p = i * UNIT_RECORD_SIZE;
    const weapons: WeaponDef[] = [];
    for (let w = 0; w < 4; w++) {
      const rawTargets = v.getUint32(p + 52 + w * 4, true);
      weapons.push({
        damage: v.getInt16(p + 28 + w * 2, true),
        minRange: data[p + 36 + w],
        maxRange: data[p + 40 + w],
        ammo: v.getInt16(p + 44 + w * 2, true),
        targets: ((rawTargets >> 4) & 63) | ((rawTargets & 15) << 8),
        rawTargets,
      });
    }
    out.push({
      index: i,
      flags: v.getUint32(p + 4, true),
      terrainMask: v.getUint32(p + 8, true),
      categoryMask: v.getUint32(p + 12, true),
      strength: (v.getUint32(p + 4, true) & 0x200) ? data[p + 71] : data[p + 70],
      descriptionText: v.getInt16(p + 16, true),
      nameText: v.getInt16(p + 18, true),
      fuel: v.getInt16(p + 22, true),
      moveRange: data[p + 24],
      fuelUsage: data[p + 25],
      costEnergy: data[p + 26],
      costMaterial: data[p + 27],
      weapons,
      weight: data[p + 68],
      transportVolume: data[p + 69],
      groupSize: data[p + 70],
      groupSize2: data[p + 71],
      armor: v.getInt16(p + 72, true),
      transportClass: data[p + 74],
      shopMask: data[p + 75],
      sightBlock: data[p + 76],
      sight: data[p + 77],
      transportMask: data[p + 80],
      attack: v.getInt16(p + 82, true),
      stealthMask: data[p + 78],
      stealthMask2: data[p + 79],
      raw: data.slice(p, p + UNIT_RECORD_SIZE),
    });
  }
  return out;
}
